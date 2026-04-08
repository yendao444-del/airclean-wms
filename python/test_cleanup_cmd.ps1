$port = 5001

Write-Host "========================================"
Write-Host "TEST: Cleanup command (PS vs CMD)"
Write-Host "Listener chay trong background job tach biet"
Write-Host "========================================"

# --- Chay listener trong Background Job (process rieng) ---
$job = Start-Job -ScriptBlock {
    param($p)
    $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
    $l.Start()
    Write-Output "LISTENING"
    Start-Sleep -Seconds 30   # Giu 30 giay
    $l.Stop()
    Write-Output "STOPPED"
} -ArgumentList $port

Start-Sleep -Milliseconds 800   # Doi listener bat dau

# Verify port dang bi giu
$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    Write-Host "[OK] Port $port dang bi giu boi PID: $($conn.OwningProcess)"
} else {
    Write-Host "[WARN] Khong xac nhan duoc listener tren port $port"
    Stop-Job $job | Out-Null; Remove-Job $job | Out-Null
    exit
}

# ==============================
# TEST A: PowerShell cleanup
# ==============================
Write-Host ""
Write-Host "[PS Cleanup] Chay PowerShell cleanup command..."
$t1 = Get-Date
$pids = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess
if ($pids) {
    foreach ($p in $pids) {
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 300
    $elapsed = [int](New-TimeSpan -Start $t1 -End (Get-Date)).TotalMilliseconds
    $after = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($after) {
        Write-Host "[PS Cleanup] RESULT: FAILED (${elapsed}ms) - port van bi giu"
        $psResult = "FAILED"
    } else {
        Write-Host "[PS Cleanup] RESULT: SUCCESS (${elapsed}ms) - port da free"
        $psResult = "SUCCESS"
    }
} else {
    Write-Host "[PS Cleanup] Khong tim thay PID - port co the da free"
    $psResult = "PORT_ALREADY_FREE"
}

Stop-Job $job -ErrorAction SilentlyContinue | Out-Null
Remove-Job $job -ErrorAction SilentlyContinue | Out-Null
Start-Sleep -Milliseconds 800

# ==============================
# TEST B: cmd.exe FOR loop (giong ipc-handlers.js)
# ==============================
Write-Host ""

# Giu lai port bang job moi
$job2 = Start-Job -ScriptBlock {
    param($p)
    $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
    $l.Start()
    Write-Output "LISTENING"
    Start-Sleep -Seconds 30
    $l.Stop()
} -ArgumentList $port

Start-Sleep -Milliseconds 800

$conn2 = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($conn2) {
    Write-Host "[CMD Cleanup] Port $port bi giu boi PID: $($conn2.OwningProcess)"
    Write-Host "[CMD Cleanup] Chay: FOR /F tokens=5 netstat | taskkill..."
    $t2 = Get-Date
    $cmdOut = cmd /c 'FOR /F "tokens=5" %a IN (''netstat -ano ^| findstr :5001 ^| findstr LISTENING'') DO taskkill /PID %a /F' 2>&1
    Start-Sleep -Milliseconds 300
    $elapsed2 = [int](New-TimeSpan -Start $t2 -End (Get-Date)).TotalMilliseconds
    Write-Host "[CMD Cleanup] CMD output: $cmdOut"
    $after2 = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($after2) {
        Write-Host "[CMD Cleanup] RESULT: FAILED (${elapsed2}ms) - port van bi giu"
        $cmdResult = "FAILED"
    } else {
        Write-Host "[CMD Cleanup] RESULT: SUCCESS (${elapsed2}ms) - port da free"
        $cmdResult = "SUCCESS"
    }
} else {
    Write-Host "[CMD Cleanup] Port khong bi giu - skip"
    $cmdResult = "SKIP"
}

Stop-Job $job2 -ErrorAction SilentlyContinue | Out-Null
Remove-Job $job2 -ErrorAction SilentlyContinue | Out-Null

# ==============================
# TONG KET
# ==============================
Write-Host ""
Write-Host "========================================"
Write-Host "KET QUA:"
Write-Host "  PowerShell cleanup: $psResult"
Write-Host "  cmd.exe FOR cleanup: $cmdResult"
Write-Host ""
Write-Host "DIEN VAO TEST_RESULTS.md:"
Write-Host "  test: port_conflict"
Write-Host "  ps_cleanup: $psResult"
Write-Host "  cmd_cleanup: $cmdResult"
Write-Host "  frontend_hien_thi: [dien tay - ban vao tab binh thuong = khong loi]"
Write-Host "========================================"
