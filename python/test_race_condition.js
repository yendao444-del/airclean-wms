/**
 * TEST #3: Race Condition Simulation
 * ====================================
 * Gọi attendance:status (= ensureFaceService) nhiều lần gần như đồng thời
 * để kiểm tra xem có spawn 2 Python process không.
 *
 * CÁCH CHẠY:
 *   Dán vào DevTools Console của Electron (F12) khi đang ở tab Điểm danh
 *   HOẶC bấm nút "Test Race Condition" nếu đã mount button vào UI
 *
 * KẾT QUẢ CẦN GHI:
 *   - Có lỗi gì không?
 *   - Task Manager có thấy >1 Python process không?
 *   - Tất cả 3 lần gọi đều success hay có lần fail?
 *   - Elapsed time tổng bao nhiêu?
 */

async function testRaceCondition() {
    console.group('%c[TEST] Race Condition — attendance:status × 3', 'color: #1677ff; font-weight: bold');
    console.log('Goi 3 lan cach nhau 200ms — kiem tra Promise deduplication...');
    console.time('race_total');

    const api = window.electronAPI?.attendance;
    if (!api) {
        console.error('❌ window.electronAPI.attendance KHONG CO — Electron API chua duoc expose');
        console.groupEnd();
        return;
    }

    // ── TRƯỚC khi test: Check xem Python đã chạy chưa ──
    console.log('[Pre] Tat Python service truoc khi test (de bao dam test start sach)...');
    // Gọi 1 lần để trigger ensureFaceService, sau đó đo
    // (Nếu muốn test từ trạng thái "Python chưa chạy", hãy đợi idle timeout hoặc restart app)

    const spawnStart = performance.now();

    // ── Gọi 3 lần với delay 0ms, 200ms, 400ms ──
    const results = await Promise.allSettled([
        // t=0ms: Gọi ngay
        api.status().then(r => ({ call: 1, t: Math.round(performance.now() - spawnStart), result: r })),

        // t=200ms: Gọi sau 200ms (trong khi Python đang spawn)
        new Promise(r => setTimeout(r, 200))
            .then(() => api.status())
            .then(r => ({ call: 2, t: Math.round(performance.now() - spawnStart), result: r })),

        // t=400ms: Gọi sau 400ms
        new Promise(r => setTimeout(r, 400))
            .then(() => api.status())
            .then(r => ({ call: 3, t: Math.round(performance.now() - spawnStart), result: r })),
    ]);

    console.timeEnd('race_total');
    console.log('');
    console.log('%c📊 KẾT QUẢ:', 'font-weight: bold');

    let allSuccess = true;
    results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
            const { call, t, result } = r.value;
            const ok = result?.success === true;
            if (!ok) allSuccess = false;
            console.log(
                `  Call #${call} [t+${t}ms]: %c${ok ? '✅ SUCCESS' : '❌ FAILED'}%c — ${JSON.stringify(result).slice(0, 100)}`,
                ok ? 'color: green' : 'color: red', ''
            );
        } else {
            allSuccess = false;
            console.log(`  Call #${i + 1}: %c❌ REJECTED — ${r.reason}`, 'color: red');
        }
    });

    console.log('');
    console.log('%c📋 GHI LẠI THEO MẪU:', 'font-weight: bold');
    console.log('  test: race_condition');
    console.log('  dieu_kien: goi attendance:status 3 lan cach 200ms, Python chua chay');
    console.log(`  ket_qua: ${allSuccess ? 'TAT CA THANH CONG' : 'CO LAM THAT BAI'}`);
    console.log('  so_python_process: [Mo Task Manager kiem tra — phai chi co 1]');
    console.log('  promise_dedup_hoat_dong: [Yes neu 1 spawn / No neu >1 spawn]');
    console.log('  frontend_hien_thi: [Ghi tay]');
    console.log('');
    console.log('%c⚠️  QUAN TRỌNG: Mở Task Manager → Details → đếm số "python.exe" hoặc "attendance_service.exe"', 'color: orange; font-weight: bold');
    console.log('  Nếu > 1 → Race condition BUG đã reproduce được!');
    console.log('  Nếu = 1 → Promise dedup đang hoạt động đúng');

    console.groupEnd();

    return {
        test: 'race_condition',
        all_success: allSuccess,
        results: results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message }),
    };
}

// ── Button UI để dễ chạy lặp lại ──
function mountRaceTestButton() {
    const existing = document.getElementById('__raceTestBtn');
    if (existing) { existing.click(); return; }

    const btn = document.createElement('button');
    btn.id = '__raceTestBtn';
    btn.textContent = '🧪 Test Race Condition';
    btn.style.cssText = [
        'position: fixed',
        'bottom: 20px',
        'right: 20px',
        'z-index: 99999',
        'padding: 10px 16px',
        'background: #1677ff',
        'color: white',
        'border: none',
        'border-radius: 8px',
        'font-size: 14px',
        'font-weight: 600',
        'cursor: pointer',
        'box-shadow: 0 4px 12px rgba(22,119,255,0.4)',
    ].join('; ');

    btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = '⏳ Đang test...';
        try {
            await testRaceCondition();
        } finally {
            btn.disabled = false;
            btn.textContent = '🧪 Test Race Condition';
        }
    };

    document.body.appendChild(btn);
    console.log('[RaceTest] Button mounted ở góc phải bên dưới màn hình');
    console.log('[RaceTest] Bấm để chạy test — kết quả hiển thị trong Console này');
}

// ── Chạy ngay ──
mountRaceTestButton();

/**
 * HƯỚNG DẪN SAU KHI CHẠY:
 * ========================
 * 1. Mở Task Manager (Ctrl+Shift+Esc) → Tab Details
 * 2. Bấm nút "Test Race Condition" trên màn hình
 * 3. Quan sát:
 *    - Console: Có bao nhiêu call thành công?
 *    - Task Manager: Có bao nhiêu python.exe/attendance_service.exe xuất hiện?
 * 4. Ghi kết quả vào bảng theo mẫu ở trên
 *
 * ĐỂ TEST TỪ TRẠNG THÁI "PYTHON CHƯA CHẠY":
 *   Option A: Đợi 10 phút idle (Python tự tắt)
 *   Option B: Restart Electron app
 *   Option C: Dùng Task Manager kill python.exe thủ công
 */
