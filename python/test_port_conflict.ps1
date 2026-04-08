param([int]$HoldSeconds = 20)

$PORT = 5001
Write-Host ""
Write-Host "========================================================"
Write-Host "TEST: port_conflict"
Write-Host "Giu port $PORT trong ${HoldSeconds}s - mo Electron TRONG THOI GIAN NAY"
Write-Host "========================================================"

# Kill neu dang co ai giu port roi
$existing = Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "[Pre] Port $PORT dang bi giu boi PID $($existing.OwningProcess) - dang kill..."
    $existing | ForEach-Object {
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
}

# Giu port bang TCP listener
Write-Host "[Listener] Bat dau giu port $PORT..."
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $PORT)
$listener.Start()
Write-Host "[Listener] OK - Port $PORT dang bi giu (LISTENING)"
Write-Host ""
Write-Host ">>> MO ELECTRON APP NGAY BAY GIO <<<"
Write-Host ">>> Vao tab Bang cong > Diem danh"
Write-Host ">>> Quan sat frontend hien thi gi"
Write-Host ">>> Ghi lai: co thong bao loi khong? Sau bao lau?"
Write-Host ""

# Dem nguoc
for ($i = 1; $i -le $HoldSeconds; $i++) {
    Start-Sleep -Seconds 1
    $still = Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue
    if ($still) {
        Write-Host "  [t+${i}s] Port van bi giu (LISTENING)"
    } else {
        Write-Host "  [t+${i}s] Port da duoc giai phong (co the do Electron kill)"
        break
    }
}

# Nha port
$listener.Stop()
Write-Host ""
Write-Host "[Listener] Da nha port $PORT"
Write-Host ""

# Doi 1s roi test PS cleanup command
Write-Host "========================================================"
Write-Host "TEST CLEANUP: Kiem tra PowerShell cleanup command"
Write-Host "========================================================"

# Giu lai port de test cleanup
$t2 = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $PORT)
$t2.Start()
Write-Host "[Cleanup Test] Giu port $PORT de test cleanup command..."
Start-Sleep -Milliseconds 300

# Chay cleanup command (day la command se dung thay the cmd.exe FOR)
$pids = (Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue).OwningProcess
if ($pids) {
    Write-Host "[Cleanup Test] Tim thay PID: $pids - dang kill..."
    foreach ($p in $pids) {
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 300
    $check = Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue
    if ($check) {
        Write-Host "[Cleanup Test] FAILED - Port van con bi giu"
        $cleanupOk = "FAILED"
    } else {
        Write-Host "[Cleanup Test] SUCCESS - Port da duoc giai phong"
        $cleanupOk = "SUCCESS"
    }
} else {
    Write-Host "[Cleanup Test] Khong tim thay process tren port $PORT"
    $cleanupOk = "PORT_ALREADY_FREE"
    $t2.Stop()
}

Write-Host ""
Write-Host "========================================================"
Write-Host "KET QUA - DIEN VAO TEST_RESULTS.md:"
Write-Host "  test: port_conflict"
Write-Host "  powershell_cleanup: $cleanupOk"
Write-Host "  [DIEN TAY] frontend_hien_thi: ???"
Write-Host "  [DIEN TAY] co_tu_recover_khong: YES / NO"
Write-Host "  [DIEN TAY] phai_bam_gi: Lam moi / Chuyen tab / Tu het"
Write-Host "========================================================"
