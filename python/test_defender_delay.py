"""
TEST #1: Defender Delay Simulation
====================================
Mô phỏng Windows Defender scan delay bằng cách sleep trước khi bind port.
attendance_service.py bình thường nhưng thêm sleep vào ngay đầu file
khi chạy test này.

CÁCH CHẠY:
  Thay thế tạm thời dòng đầu tiên của attendance_service.py:
  1. Mở python/attendance_service.py
  2. Thêm dòng sau vào SAU import, TRƯỚC load_encodings():
     >>> import time; time.sleep(DELAY)  # TEST ONLY
  Hoặc chạy test này trực tiếp — nó sẽ tự patch và unpatch file.

KẾT QUẢ CẦN GHI:
  - Giao diện hiển thị gì trong lúc chờ?
  - Bao nhiêu giây thì "Làm mới" hoạt động?
  - Có thông báo lỗi gì không?
"""

import subprocess
import sys
import time
import os
import re
import urllib.request
from pathlib import Path

SERVICE_URL = "http://127.0.0.1:5001/status"
SCRIPT_PATH = Path(__file__).parent / "attendance_service.py"

SLEEP_DURATIONS = [5, 10, 15, 20, 25]  # giây — test từng mức


def patch_sleep(script_path: Path, delay: int) -> str:
    """Chèn time.sleep(delay) vào trước dòng 'lifespan' (trước khi app sẵn sàng)."""
    content = script_path.read_text(encoding="utf-8")
    MARKER = "# PATCH_SLEEP_MARKER"

    # Xóa patch cũ nếu có
    content = re.sub(r"import time; time\.sleep\(\d+\)  # TEST ONLY\n", "", content)

    # Chèn sau dòng `print("[Face] Service ready on port 5001")`
    inject = f'import time; time.sleep({delay})  # TEST ONLY\n'
    content = content.replace(
        '    print("[Face] Service ready on port 5001")',
        f'    {inject}    print("[Face] Service ready on port 5001")'
    )
    return content


def unpatch(script_path: Path):
    content = script_path.read_text(encoding="utf-8")
    content = re.sub(r"    import time; time\.sleep\(\d+\)  # TEST ONLY\n", "", content)
    script_path.write_text(content, encoding="utf-8")
    print(f"[Unpatch] Đã xóa patch khỏi {script_path.name}")


def kill_port_5001():
    """Kill process đang giữ port 5001 nếu có."""
    try:
        result = subprocess.run(
            ['powershell', '-Command',
             'Get-NetTCPConnection -LocalPort 5001 -ErrorAction SilentlyContinue | '
             'Select-Object -ExpandProperty OwningProcess | '
             'ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }'],
            capture_output=True, timeout=5
        )
    except Exception:
        pass


def wait_for_service(max_wait_sec: int = 35, poll_interval: float = 0.5):
    """Poll /status, trả về (elapsed_ms, success)."""
    start = time.time()
    attempt = 0
    while True:
        attempt += 1
        elapsed_ms = int((time.time() - start) * 1000)
        try:
            with urllib.request.urlopen(SERVICE_URL, timeout=2) as r:
                data = r.read().decode()
                print(f"  [Poll #{attempt:02d}] elapsed={elapsed_ms:5d}ms → ✅ READY: {data[:80]}")
                return elapsed_ms, True
        except Exception as e:
            print(f"  [Poll #{attempt:02d}] elapsed={elapsed_ms:5d}ms → pending ({str(e)[:40]})")
            if elapsed_ms >= max_wait_sec * 1000:
                print(f"  [Poll] ❌ TIMEOUT sau {elapsed_ms}ms")
                return elapsed_ms, False
        time.sleep(poll_interval)


def run_test(delay_sec: int):
    print(f"\n{'='*60}")
    print(f"TEST: defender_delay | sleep={delay_sec}s")
    print(f"Điều kiện: sleep={delay_sec}s trước khi service bind port")
    print(f"{'='*60}")

    # Patch script
    patched = patch_sleep(SCRIPT_PATH, delay_sec)
    SCRIPT_PATH.write_text(patched, encoding="utf-8")
    print(f"[Patch] Đã thêm sleep({delay_sec}s) vào {SCRIPT_PATH.name}")

    # Kill port sạch
    kill_port_5001()
    time.sleep(0.5)

    spawn_start = time.time()
    proc = subprocess.Popen(
        [sys.executable, str(SCRIPT_PATH)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
        env={**os.environ, "FACE_DATA_DIR": str(Path(__file__).parent)}
    )
    print(f"[Spawn] PID={proc.pid}, đang spawn...")

    elapsed_ms, success = wait_for_service(max_wait_sec=35)

    # Kill service
    proc.terminate()
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()

    # Unpatch
    unpatch(SCRIPT_PATH)

    # Ghi kết quả theo mẫu chuẩn
    result = {
        "test": "defender_delay",
        "dieu_kien": f"sleep={delay_sec}s, Python.exe spawned directly",
        "ket_qua": f"{'READY' if success else 'TIMEOUT'} sau {elapsed_ms}ms ({elapsed_ms/1000:.1f}s)",
        "frontend_hien_thi": "N/A (test backend only) — chạy trong Electron để test frontend",
        "can_bam_gi": "N/A",
        "timeout_default_15s": "❌ LỖI" if elapsed_ms > 15000 else "✅ OK",
        "timeout_de_xuat_30s": "❌ LỖI" if elapsed_ms > 30000 else "✅ OK",
    }

    print(f"\n📊 KẾT QUẢ:")
    for k, v in result.items():
        print(f"   {k}: {v}")
    return result


if __name__ == "__main__":
    all_results = []
    for delay in SLEEP_DURATIONS:
        r = run_test(delay)
        all_results.append(r)
        time.sleep(2)

    print(f"\n{'='*60}")
    print("📋 BẢNG TỔNG HỢP — GHI LẠI TRƯỚC KHI CODE FIX:")
    print(f"{'='*60}")
    print(f"{'Sleep':>6} | {'Elapsed':>10} | {'15s default':>12} | {'30s proposed':>13}")
    print("-" * 50)
    for r in all_results:
        sleep = r['dieu_kien'].split('=')[1].split('s')[0]
        elapsed = r['ket_qua'].split('sau ')[1].split('ms')[0] + 'ms'
        t15 = r['timeout_default_15s']
        t30 = r['timeout_de_xuat_30s']
        print(f"{sleep:>6}s | {elapsed:>10} | {t15:>12} | {t30:>13}")
