"""
DBY POS - Face Attendance Service
FastAPI server chạy local, Electron giao tiếp qua HTTP
"""

import os
import io
import base64
import pickle
import numpy as np
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager

import face_recognition
from PIL import Image
import cv2
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# Load Haar cascade
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
# CLAHE một lần ở module level — tránh tạo mới mỗi lần gọi
_clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

def get_face_locations_fast(img_np, upsample: int = 1):
    """Tìm mặt bằng HOG, fallback sang Haar Cascade nếu HOG trượt.
    Luôn thử upsample=1 trước (nhanh). Nếu không thấy mặt → thử upsample=2 → rồi Haar.
    """
    # 1. HOG upsample=1 — nhanh, đủ với mặt to/rõ
    locs = face_recognition.face_locations(img_np, number_of_times_to_upsample=1, model="hog")
    if locs:
        return locs

    # 2. HOG upsample=2 — chậm hơn 4x, dùng khi mặt nhỏ/xa
    if upsample >= 2:
        locs = face_recognition.face_locations(img_np, number_of_times_to_upsample=2, model="hog")
        if locs:
            return locs

    # 2. Haar Cascade với CLAHE để chuẩn hóa ánh sáng (bắt mặt tối/ngược sáng)
    try:
        img_bgr = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        # CLAHE: normalize độ sáng cục bộ — giúp detect mặt trong điều kiện ánh sáng kém
        gray_eq = _clahe.apply(gray)
        # minNeighbors=3 (thay vì 4) để nhạy hơn, minSize=20 để bắt mặt nhỏ hơn
        faces = face_cascade.detectMultiScale(gray_eq, scaleFactor=1.1, minNeighbors=3, minSize=(20, 20))
        if len(faces) > 0:
            x, y, w, h = faces[0]
            return [(int(y), int(x+w), int(y+h), int(x))]
    except:
        pass
    return []

# ─── Paths ────────────────────────────────────────────────────────────────────
# Dùng FACE_DATA_DIR từ Electron (userData) để dữ liệu không bị mất sau restart
# Fallback về thư mục script nếu chạy standalone
_data_root = os.environ.get("FACE_DATA_DIR") or str(Path(__file__).parent)
BASE_DIR = Path(_data_root)
FACES_DIR = BASE_DIR / "faces"          # Ảnh đăng ký
ENCODINGS_FILE = BASE_DIR / "encodings.pkl"  # Cache encodings

FACES_DIR.mkdir(parents=True, exist_ok=True)

# ── Startup: In rõ đường dẫn để debug ──────────────────────────────
print(f"[Face] FACE_DATA_DIR env = {os.environ.get('FACE_DATA_DIR', 'NOT SET')}")
print(f"[Face] BASE_DIR         = {BASE_DIR}")
print(f"[Face] FACES_DIR        = {FACES_DIR} (exists={FACES_DIR.exists()})")
print(f"[Face] ENCODINGS_FILE   = {ENCODINGS_FILE} (exists={ENCODINGS_FILE.exists()})")
if FACES_DIR.exists():
    subdirs = [d.name for d in FACES_DIR.iterdir() if d.is_dir()]
    print(f"[Face] Face folders     = {subdirs}")
else:
    print(f"[Face] Face folders     = (dir not found)")

# ─── In-memory encodings ──────────────────────────────────────────────────────
# { "nguyen_van_a": [ encoding1, encoding2, ... ] }
known_encodings: dict[str, list] = {}


def _save_encodings_atomic():
    """Ghi encodings.pkl an toàn — ghi vào file tạm rồi rename.
    Tránh corruption nếu bị kill giữa chừng (10-min idle timer).
    """
    tmp_file = ENCODINGS_FILE.with_suffix(".pkl.tmp")
    try:
        with open(tmp_file, "wb") as f:
            pickle.dump(known_encodings, f)
            f.flush()
            os.fsync(f.fileno())
        # Atomic rename (trên Windows sẽ overwrite nếu dst tồn tại từ Python 3.3+)
        tmp_file.replace(ENCODINGS_FILE)
    except Exception as e:
        print(f"[Face] ❌ Atomic save failed: {e}")
        # Fallback: ghi trực tiếp
        try:
            with open(ENCODINGS_FILE, "wb") as f:
                pickle.dump(known_encodings, f)
        except Exception as e2:
            print(f"[Face] ❌ Fallback save also failed: {e2}")


def load_encodings():
    """Load encodings từ file cache hoặc tính lại từ ảnh."""
    global known_encodings
    if ENCODINGS_FILE.exists() and ENCODINGS_FILE.stat().st_size > 10:
        try:
            with open(ENCODINGS_FILE, "rb") as f:
                cached = pickle.load(f)
            # Verify pickle khớp với thư mục thực tế trên disk
            # Chỉ tính folder có ít nhất 1 ảnh .jpg để tránh mismatch do folder rỗng
            disk_ids = {d.name for d in FACES_DIR.iterdir() if d.is_dir() and any(d.glob("*.jpg"))}
            cache_ids = set(cached.keys())
            if disk_ids == cache_ids:
                known_encodings = cached
                print(f"[Face] ✅ Loaded {len(known_encodings)} profiles from cache")
            else:
                print(f"[Face] ⚠️ Cache mismatch (disk={disk_ids}, cache={cache_ids}), rebuilding...")
                rebuild_encodings(cached_fallback=cached)
        except Exception as e:
            print(f"[Face] ❌ Cache corrupted, rebuilding: {e}")
            rebuild_encodings()
    else:
        rebuild_encodings()


def rebuild_encodings(cached_fallback: dict = None):
    """Tính lại encodings từ toàn bộ ảnh trong FACES_DIR.
    
    cached_fallback: Nếu có, giữ lại encoding cũ cho profile mà ảnh JPEG
    không detect được mặt (tránh mất data âm thầm do nén ảnh).
    """
    global known_encodings
    new_encodings = {}
    skipped_profiles = []
    
    for person_dir in FACES_DIR.iterdir():
        if not person_dir.is_dir():
            continue
        face_id = person_dir.name
        jpg_files = list(person_dir.glob("*.jpg"))
        if not jpg_files:
            continue
            
        encodings = []
        skip_count = 0
        for img_file in jpg_files:
            if not img_file.exists():
                print(f"[Face] Skip deleted file: {img_file.name}")
                continue
            try:
                img = face_recognition.load_image_file(str(img_file))
            except Exception as e:
                print(f"[Face] Skip unreadable file {img_file.name}: {e}")
                skip_count += 1
                continue
            # upsample=2 khi rebuild — chậm hơn nhưng tin cậy hơn với ảnh JPEG nén
            locs = get_face_locations_fast(np.array(img), upsample=2)
            if not locs:
                print(f"[Face] ⚠️ No face in saved photo: {face_id}/{img_file.name}")
                skip_count += 1
                continue
            encs = face_recognition.face_encodings(img, locs)
            if encs:
                encodings.append(encs[0])
                
        if encodings:
            new_encodings[face_id] = encodings
            print(f"[Face] ✅ Rebuilt '{face_id}': {len(encodings)}/{len(jpg_files)} photos")
        else:
            # ★ KHÔNG âm thầm xóa profile — dùng cached encoding nếu có
            if cached_fallback and face_id in cached_fallback:
                new_encodings[face_id] = cached_fallback[face_id]
                print(f"[Face] ⚠️ '{face_id}': ảnh JPEG không detect được mặt, GIỮ encoding cũ từ cache ({len(cached_fallback[face_id])} encs)")
            else:
                skipped_profiles.append(face_id)
                print(f"[Face] ❌ '{face_id}': {len(jpg_files)} ảnh nhưng KHÔNG detect được mặt nào, BỎ QUA!")
    
    known_encodings = new_encodings
    _save_encodings_atomic()
    
    if skipped_profiles:
        print(f"[Face] ⚠️ CẢNH BÁO: {len(skipped_profiles)} profile bị bỏ: {skipped_profiles}")
    print(f"[Face] Rebuilt encodings: {len(known_encodings)} profiles")


def decode_image(base64_str: str) -> np.ndarray:
    """Convert base64 image → numpy array cho face_recognition."""
    # Strip data URL prefix nếu có
    if "," in base64_str:
        base64_str = base64_str.split(",", 1)[1]
    img_bytes = base64.b64decode(base64_str)
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    return np.array(img)


# ─── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app):
    # Startup
    load_encodings()
    print("[Face] Service ready on port 5001")
    yield
    # Shutdown
    print("[Face] Service shutting down")


# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="DBY Face Attendance", version="1.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ─── Models ───────────────────────────────────────────────────────────────────
class RecognizeRequest(BaseModel):
    image: str          # base64 frame từ camera

class RegisterRequest(BaseModel):
    face_id: str        # "nguyen_van_a"
    user_name: str      # "Nguyễn Văn A"
    images: list[str]  # list base64 ảnh (3-5 ảnh)

class DeleteRequest(BaseModel):
    face_id: str


# ─── Routes ───────────────────────────────────────────────────────────────────
@app.get("/status")
def status():
    return {
        "ok": True,
        "profiles": len(known_encodings),
        "face_ids": list(known_encodings.keys())
    }


@app.post("/detect")
def detect_face(req: RecognizeRequest):
    """Chỉ phát hiện khuôn mặt, không so khớp — dùng cho modal đăng ký."""
    try:
        img = decode_image(req.image)
    except Exception as e:
        raise HTTPException(400, f"Invalid image: {e}")

    face_locations = get_face_locations_fast(img)
    if not face_locations:
        return {"found": False, "reason": "no_face"}

    top, right, bottom, left = face_locations[0]
    face_box = {"top": top, "right": right, "bottom": bottom, "left": left}
    img_h, img_w = img.shape[:2]
    return {"found": True, "face_box": face_box, "img_width": img_w, "img_height": img_h}


@app.post("/recognize")
def recognize(req: RecognizeRequest):
    """Nhận diện khuôn mặt từ frame camera."""
    if not known_encodings:
        # Vẫn detect face để modal đăng ký hoạt động được
        try:
            img = decode_image(req.image)
            face_locations = get_face_locations_fast(img)
            if face_locations:
                top, right, bottom, left = face_locations[0]
                img_h, img_w = img.shape[:2]
                print(f"[DEBUG] No profiles loaded! face detected but 0 encodings")
                return {"found": False, "reason": "no_profiles",
                        "face_box": {"top": top, "right": right, "bottom": bottom, "left": left},
                        "img_height": img_h, "img_width": img_w}
        except Exception:
            pass
        return {"found": False, "reason": "no_profiles"}

    try:
        img = decode_image(req.image)
    except Exception as e:
        raise HTTPException(400, f"Invalid image: {e}")

    # Detect faces
    face_locations = get_face_locations_fast(img)
    if not face_locations:
        return {"found": False, "reason": "no_face"}

    face_encs = face_recognition.face_encodings(img, face_locations)
    if not face_encs:
        return {"found": False, "reason": "no_encoding"}

    # THRESHOLD: khoảng cách tối đa để chấp nhận. Default face_recognition là 0.6.
    # Đặt 0.45 để chặt hơn, tránh nhận diện nhầm giữa người có nét tương tự
    THRESHOLD = 0.45
    # MARGIN: khoảng cách giữa người Top 1 và Top 2
    # Tăng lên 0.10 để tránh nhầm khi 2 người có distance gần nhau
    MIN_MARGIN = 0.10

    img_h, img_w = img.shape[:2]

    # ── DEBUG: Log chi tiết distance cho từng profile ──────────────────────
    debug_distances = {}

    # Xử lý từng mặt độc lập — tránh lẫn lộn best_match giữa nhiều mặt trong frame
    # Lấy mặt đầu tiên match được (thực tế chấm công thường chỉ có 1 người)
    for idx, face_enc in enumerate(face_encs):
        best_match = None
        best_confidence = 0.0
        best_dist = 1.0
        second_best_dist = 1.0

        for face_id, encs in known_encodings.items():
            distances = face_recognition.face_distance(encs, face_enc)
            min_dist = float(np.min(distances))
            avg_dist = float(np.mean(distances))
            confidence = float(1.0 - min_dist)
            debug_distances[face_id] = {"min": round(min_dist, 4), "avg": round(avg_dist, 4), "n_encs": len(encs)}

            if min_dist < best_dist:
                second_best_dist = best_dist
                best_dist = min_dist
                best_confidence = confidence
                best_match = face_id
            elif min_dist < second_best_dist:
                second_best_dist = min_dist

        # Điều kiện chấp nhận:
        # 1. Khoảng cách phải < THRESHOLD
        # 2. Nếu best_dist rất nhỏ (< 0.32) thì chắc chắn đúng, không cần xét margin
        # 3. Còn lại phải có margin >= MIN_MARGIN để tránh nhầm
        margin = second_best_dist - best_dist
        match_accepted = (
            best_match is not None
            and best_dist < THRESHOLD
            and (len(known_encodings) == 1 or best_dist < 0.32 or margin >= MIN_MARGIN)
        )

        # ── DEBUG LOG ──────────────────────────────────────────────────────
        print(f"[DEBUG recognize] img={img_w}x{img_h} | faces_detected={len(face_encs)}")
        print(f"[DEBUG recognize] Distances: {debug_distances}")
        print(f"[DEBUG recognize] Best: {best_match} dist={best_dist:.4f} | 2nd_dist={second_best_dist:.4f} | margin={margin:.4f}")
        print(f"[DEBUG recognize] THRESHOLD={THRESHOLD} | dist<TH? {best_dist < THRESHOLD} | dist<0.32? {best_dist < 0.32} | margin>=MIN? {margin >= MIN_MARGIN}")
        print(f"[DEBUG recognize] → match_accepted={match_accepted}")

        # face_box khớp đúng với mặt đang xét (không dùng mặt #0 cố định)
        top, right, bottom, left = face_locations[idx]
        face_box = {"top": top, "right": right, "bottom": bottom, "left": left}

        if match_accepted:
            return {
                "found": True,
                "face_id": best_match,
                "confidence": round(best_confidence, 3),
                "dist": round(best_dist, 3),
                "margin": round(margin, 3),
                "face_box": face_box,
                "img_width": img_w,
                "img_height": img_h,
                "_debug": debug_distances,
            }

    # Không có mặt nào match — trả về face_box của mặt đầu tiên để UI vẫn vẽ được khung
    top, right, bottom, left = face_locations[0]
    face_box = {"top": top, "right": right, "bottom": bottom, "left": left}
    return {
        "found": False,
        "reason": "no_match",
        "confidence": round(best_confidence, 3),
        "dist": round(best_dist, 3),
        "face_box": face_box,
        "img_width": img_w,
        "img_height": img_h,
        "_debug": debug_distances,
    }


@app.post("/register")
def register(req: RegisterRequest):
    """Đăng ký khuôn mặt nhân viên mới."""
    if not req.face_id or not req.images:
        raise HTTPException(400, "Thiếu face_id hoặc ảnh")

    person_dir = FACES_DIR / req.face_id
    if person_dir.exists():
        # Xóa các ảnh cũ để tránh rác nếu đăng ký lại nhiều lần
        for f in person_dir.glob("*.jpg"):
            try:
                f.unlink()
            except:
                pass
    person_dir.mkdir(exist_ok=True)

    new_encs = []
    saved = 0
    for i, img_b64 in enumerate(req.images):
        try:
            img_arr = decode_image(img_b64)
            # upsample=1 đủ vì lúc đăng ký mặt đã to/rõ (MIN_FACE_RATIO=15%)
            locs = get_face_locations_fast(img_arr, upsample=1)
            if not locs:
                continue
            encs = face_recognition.face_encodings(img_arr, locs)
            if not encs:
                continue  # Không detect được mặt trong ảnh này
            
            new_encs.append(encs[0])
            
            # Lưu ảnh
            img_pil = Image.fromarray(img_arr)
            img_pil.save(str(person_dir / f"photo_{i+1}.jpg"))
            saved += 1
        except Exception as e:
            print(f"[Face] Skip image {i}: {e}")

    if saved == 0:
        raise HTTPException(400, "Không tìm thấy khuôn mặt trong ảnh nào")

    # Tối ưu: Không dùng rebuild_encodings() vì nó sẽ scan và compute lại TOÀN BỘ ảnh cũ của TOÀN BỘ người
    global known_encodings
    # LUÔN ghi đè (replace) thay vì extend. 
    # Nếu dùng extend, những ảnh lỗi từ lần đăng ký test trước đây sẽ bị lưu mãi mãi (ví dụ Phương đăng ký nhầm vào tên Trường thì Trường sẽ cứ bị nhận thành Phương)
    known_encodings[req.face_id] = new_encs
        
    _save_encodings_atomic()

    return {"ok": True, "face_id": req.face_id, "saved": saved}


@app.delete("/profile/{face_id}")
def delete_profile(face_id: str):
    """Xóa profile khuôn mặt."""
    import shutil

    # 1. Xóa khỏi memory ngay lập tức
    global known_encodings
    removed = known_encodings.pop(face_id, None)

    # 2. Xóa folder ảnh trên disk
    person_dir = FACES_DIR / face_id
    if person_dir.exists():
        shutil.rmtree(str(person_dir))

    # 3. Lưu encodings mới (KHÔNG rebuild toàn bộ — tránh race condition xóa sạch memory)
    _save_encodings_atomic()
    
    print(f"[Face] Deleted '{face_id}' (had {len(removed) if removed else 0} encs), {len(known_encodings)} profiles remain")
    return {"ok": True, "deleted": face_id}


@app.get("/profiles")
def list_profiles():
    """Danh sách profiles đã đăng ký."""
    profiles = []
    for face_id, encs in known_encodings.items():
        profiles.append({"face_id": face_id, "photo_count": len(encs)})
    return {"profiles": profiles}


@app.get("/debug")
def debug_info():
    """DEBUG: Kiểm tra trạng thái chi tiết."""
    import sys
    return {
        "python_version": sys.version,
        "face_data_dir": str(BASE_DIR),
        "faces_dir": str(FACES_DIR),
        "faces_dir_exists": FACES_DIR.exists(),
        "encodings_file": str(ENCODINGS_FILE),
        "encodings_file_exists": ENCODINGS_FILE.exists(),
        "encodings_file_size": ENCODINGS_FILE.stat().st_size if ENCODINGS_FILE.exists() else 0,
        "profiles_in_memory": len(known_encodings),
        "profile_details": {fid: len(encs) for fid, encs in known_encodings.items()},
        "disk_folders": [d.name for d in FACES_DIR.iterdir() if d.is_dir()] if FACES_DIR.exists() else [],
        "disk_photos": {d.name: len(list(d.glob('*.jpg'))) for d in FACES_DIR.iterdir() if d.is_dir()} if FACES_DIR.exists() else {},
    }


@app.post("/shutdown")
def shutdown():
    """Electron gọi để tắt service an toàn."""
    import signal
    os.kill(os.getpid(), signal.SIGTERM)
    return {"ok": True}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=5001, log_level="warning")

