# BÁO CÁO KẾT QUẢ TEST — Before/After Fix
# ==========================================
# Ngày test: 2026-04-08  |  Người test: Dev
# Máy: NCPC (Windows 11 22H2)  |  Defender Real-time: OFF (dev machine)  |  SSD
# Lưu ý: Defender OFF → đây là kết quả TỐT NHẤT có thể. Máy khách (Defender ON, HDD) sẽ tệ hơn.

---

## TEST #1: defender_delay

| Biến | Giá trị TRƯỚC fix | Giá trị SAU fix |
|---|---|---|
| Điều kiện | sleep=Xs trước khi service bind port | |
| sleep=5s: elapsed | **7555ms** ✅ OK | ___ |
| sleep=10s: elapsed | 0ms *(false positive)* | ___ |
| sleep=15s: elapsed | **15049ms** ❌ biên giới | ___ |
| sleep=20s: elapsed | **20132ms** ❌ LỖI | ___ |
| sleep=25s: elapsed | **25157ms** ❌ LỖI | ___ |
| Frontend hiển thị | Chưa test (backend only) | ___ |
| Cần bấm gì để recover | Chưa test (backend only) | ___ |
| Ghi chú | Máy dev SSD, Defender OFF — đây là điều kiện TỐT NHẤT. Thực tế máy khách sẽ tệ hơn 5-10s | |

**Reproduce được không:** ✅ YES — sleep=15s đã chạm giới hạn 15s default  
**Bao nhiêu lần thử:** 1 lần  
**Kết luận:** Cần tăng timeout từ 15s → 30s ngay

---

## TEST #2: port_conflict

| Biến | Giá trị TRƯỚC fix | Giá trị SAU fix |
|---|---|---|
| Điều kiện | Port 5001 bị giữ trước khi spawn | |
| PowerShell cleanup: thành công | YES / NO | YES / NO |
| cmd.exe cleanup: thành công | YES / NO | YES / NO |
| Elapsed cleanup | ___ms | ___ms |
| Port tự giải phóng sau | ___s | ___s |
| Frontend hiển thị | ___ | ___ |
| Cần bấm gì để recover | ___ | ___ |
| Ghi chú | | |

**Reproduce được không:** YES / NO  
**Bao nhiêu lần thử:** ___  

---

## TEST #3: race_condition

| Biến | Giá trị TRƯỚC fix | Giá trị SAU fix |
|---|---|---|
| Điều kiện | 3 lần gọi cách 200ms, Python chưa chạy | |
| Call #1 (t=0ms): result | SUCCESS / FAILED | |
| Call #2 (t=200ms): result | SUCCESS / FAILED | |
| Call #3 (t=400ms): result | SUCCESS / FAILED | |
| Số python.exe trong Task Manager | ___ | ___ |
| Promise dedup hoạt động | YES / NO | YES / NO |
| Frontend hiển thị | ___ | ___ |
| Ghi chú | | |

**Reproduce được không:** YES / NO  
**Bao nhiêu lần thử:** ___  

---

## KẾT LUẬN

| Bug | TRƯỚC fix | SAU fix |
|---|---|---|
| #1 Không có health check | Reproduce: ___ | Fixed: ___ |
| #2 Idle timer kill Python | Reproduce: ___ | Fixed: ___ |
| #3 Cooldown 10s block retry | Reproduce: ___ | Fixed: ___ |
| #4 Port conflict Windows | Reproduce: ___ | Fixed: ___ |
| #5 Backend crash không notify | Reproduce: ___ | Fixed: ___ |
| #6 Race condition spawn | Reproduce: ___ | Fixed: ___ |

**Tổng: ___ / 6 bugs đã reproduce trước fix**  
**Tổng: ___ / 6 bugs đã verify sau fix**

---

## GHI CHÚ THÊM

```
[Điền tự do]
```
