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

def get_face_locations_fast(img_np):
    """Tìm mặt bằng HOG, fallback sang Haar Cascade nếu HOG trượt (do mặt quá to/gần)"""
    # 1. HOG
    locs = face_recognition.face_locations(img_np, model="hog")
    if locs:
        return locs
    
    # 2. Haar Cascade (rất nhạy với mặt to/gần/nhỏ, tốc độ cao)
    try:
        # face_recognition load ảnh RGB, OpenCV dùng BGR/Gray
        img_bgr = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        # Giảm scaleFactor xuống 1.1 để quét kỹ hơn
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(30, 30))
        if len(faces) > 0:
            x, y, w, h = faces[0] # Lấy mặt đầu tiên
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

# ─── In-memory encodings ──────────────────────────────────────────────────────
# { "nguyen_van_a": [ encoding1, encoding2, ... ] }
known_encodings: dict[str, list] = {}


def load_encodings():
    """Load encodings từ file cache hoặc tính lại từ ảnh."""
    global known_encodings
    if ENCODINGS_FILE.exists() and ENCODINGS_FILE.stat().st_size > 10:
        try:
            with open(ENCODINGS_FILE, "rb") as f:
                known_encodings = pickle.load(f)
            print(f"[Face] Loaded {len(known_encodings)} profiles from cache")
        except Exception as e:
            print(f"[Face] Cache corrupted, rebuilding: {e}")
            rebuild_encodings()
    else:
        rebuild_encodings()


def rebuild_encodings():
    """Tính lại encodings từ toàn bộ ảnh trong FACES_DIR."""
    global known_encodings
    known_encodings = {}
    for person_dir in FACES_DIR.iterdir():
        if not person_dir.is_dir():
            continue
        face_id = person_dir.name
        encodings = []
        for img_file in person_dir.glob("*.jpg"):
            img = face_recognition.load_image_file(str(img_file))
            encs = face_recognition.face_encodings(img)
            if encs:
                encodings.append(encs[0])
        if encodings:
            known_encodings[face_id] = encodings
            print(f"[Face] Registered '{face_id}': {len(encodings)} photos")

    with open(ENCODINGS_FILE, "wb") as f:
        pickle.dump(known_encodings, f)
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

    # So khớp với known_encodings
    best_match = None
    best_confidence = 0.0
    best_dist = 1.0
    second_best_dist = 1.0  # khoảng cách tốt nhì — dùng để kiểm tra margin

    # THRESHOLD: khoảng cách tối đa để chấp nhận (càng nhỏ = càng chặt)
    # 0.45 tương đương conf >= 55% — loại bỏ trường hợp nhận nhầm
    THRESHOLD = 0.45
    # MARGIN: winner phải cách runner-up ít nhất X — tránh nhầm khi 2 người giống nhau
    MIN_MARGIN = 0.08

    for face_enc in face_encs:
        for face_id, encs in known_encodings.items():
            distances = face_recognition.face_distance(encs, face_enc)
            min_dist = float(np.min(distances))
            confidence = float(1.0 - min_dist)

            if min_dist < best_dist:
                second_best_dist = best_dist
                best_dist = min_dist
                best_confidence = confidence
                best_match = face_id
            elif min_dist < second_best_dist:
                second_best_dist = min_dist

    # Điều kiện chấp nhận:
    # 1. Khoảng cách tốt nhất phải < THRESHOLD
    # 2. Winner phải cách runner-up đủ xa (MIN_MARGIN) → tránh nhầm khi 2 người giống nhau
    margin = second_best_dist - best_dist
    match_accepted = (
        best_match is not None
        and best_dist < THRESHOLD
        and (len(known_encodings) == 1 or margin >= MIN_MARGIN)
    )

    # Luôn trả về face_box của mặt đầu tiên phát hiện được (dù match hay không)
    top, right, bottom, left = face_locations[0]
    face_box = {"top": top, "right": right, "bottom": bottom, "left": left}
    img_h, img_w = img.shape[:2]

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
        }

    return {
        "found": False,
        "reason": "no_match",
        "confidence": round(best_confidence, 3),
        "dist": round(best_dist, 3),
        "face_box": face_box,
        "img_width": img_w,
        "img_height": img_h,
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
            # Dùng custom locations để bắt được ảnh to
            locs = get_face_locations_fast(img_arr)
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
        
    try:
        with open(ENCODINGS_FILE, "wb") as f:
            pickle.dump(known_encodings, f)
    except Exception as e:
        print(f"[Face] Failed to save encodings: {e}")

    return {"ok": True, "face_id": req.face_id, "saved": saved}


@app.delete("/profile/{face_id}")
def delete_profile(face_id: str):
    """Xóa profile khuôn mặt."""
    person_dir = FACES_DIR / face_id
    if person_dir.exists():
        import shutil
        shutil.rmtree(str(person_dir))
    rebuild_encodings()
    return {"ok": True, "deleted": face_id}


@app.get("/profiles")
def list_profiles():
    """Danh sách profiles đã đăng ký."""
    profiles = []
    for face_id, encs in known_encodings.items():
        profiles.append({"face_id": face_id, "photo_count": len(encs)})
    return {"profiles": profiles}


@app.post("/shutdown")
def shutdown():
    """Electron gọi để tắt service an toàn."""
    import signal
    os.kill(os.getpid(), signal.SIGTERM)
    return {"ok": True}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=5001, log_level="warning")

