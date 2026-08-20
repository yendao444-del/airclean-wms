/**
 * offline-queue.js
 * Hàng đợi offline cho Xuất hàng TMĐT.
 * Mỗi item = 1 file JSON riêng trong thư mục offline-queue/
 * Atomic write (tmp → rename) — không bao giờ corrupt file đang ghi.
 */

const fs = require('fs');
const path = require('path');

let queueDir = null;

/**
 * Khởi tạo queue — gọi 1 lần khi app start
 * @param {string} userDataPath - app.getPath('userData')
 */
function init(userDataPath) {
    queueDir = path.join(userDataPath, 'offline-queue');
    if (!fs.existsSync(queueDir)) {
        fs.mkdirSync(queueDir, { recursive: true });
    }
    // Dọn .tmp còn sót từ lần crash trước
    try {
        fs.readdirSync(queueDir)
            .filter(f => f.endsWith('.tmp'))
            .forEach(f => { try { fs.unlinkSync(path.join(queueDir, f)); } catch {} });
    } catch {}
    console.log(`[OfflineQueue] Initialized at: ${queueDir} | Pending: ${count()}`);
}

/**
 * Thêm item vào queue
 * @param {string} type  - loại operation, vd: 'ecommerceExports:update'
 * @param {object} payload - dữ liệu cần replay
 * @returns {string} filename
 */
function enqueue(type, payload) {
    if (!queueDir) throw new Error('[OfflineQueue] Not initialized');
    if (type !== 'ecommerceExports:update') throw new Error('[OfflineQueue] Unsupported operation');
    if (!payload || typeof payload !== 'object') throw new Error('[OfflineQueue] Invalid payload');

    // Coalesce repeated updates: retain the newest payload instead of silently
    // dropping it, while preserving the original queue position.
    const existingId = payload.id;
    if (existingId) {
        const existing = fs.readdirSync(queueDir)
            .filter(f => f.endsWith('.json'))
            .find(f => {
                try {
                    const item = JSON.parse(fs.readFileSync(path.join(queueDir, f), 'utf8'));
                    return item.type === type && item.payload.id === existingId;
                } catch { return false; }
            });
        if (existing) {
            const finalPath = path.join(queueDir, existing);
            const previous = JSON.parse(fs.readFileSync(finalPath, 'utf8'));
            const next = {
                ...previous,
                payload,
                updatedAt: new Date().toISOString(),
                attempts: 0,
                lastError: null,
                nextAttemptAt: null,
            };
            const tmpPath = `${finalPath}.tmp`;
            fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf8');
            fs.renameSync(tmpPath, finalPath);
            console.log(`[OfflineQueue] Coalesced latest update: ${type} id=${existingId}`);
            return existing;
        }
    }

    const ts = Date.now();
    const safeId = String(existingId || Math.random().toString(36).slice(2))
        .replace(/[^A-Za-z0-9_-]/g, '_')
        .slice(0, 80);
    const filename = `${ts}_${safeId}.json`;
    const item = {
        type,
        payload,
        idempotencyKey: cryptoRandomId(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        attempts: 0,
        lastError: null,
        nextAttemptAt: null,
    };

    const tmpPath   = path.join(queueDir, filename + '.tmp');
    const finalPath = path.join(queueDir, filename);

    fs.writeFileSync(tmpPath, JSON.stringify(item, null, 2), 'utf8');
    fs.renameSync(tmpPath, finalPath); // atomic on all OSes

    console.log(`[OfflineQueue] Enqueued: ${type} id=${safeId} → ${filename}`);
    return filename;
}

/**
 * Đọc toàn bộ queue, sắp xếp theo thứ tự thời gian
 * @returns {Array<{type, payload, createdAt, _filename}>}
 */
function dequeueAll() {
    if (!queueDir) return [];
    try {
        return fs.readdirSync(queueDir)
            .filter(f => f.endsWith('.json'))
            .sort() // tên file bắt đầu bằng timestamp → đúng thứ tự
            .map(f => {
                try {
                    const raw = fs.readFileSync(path.join(queueDir, f), 'utf8');
                    return { ...JSON.parse(raw), _filename: f };
                } catch { return null; }
            })
            .filter(item => item && (!item.nextAttemptAt || new Date(item.nextAttemptAt).getTime() <= Date.now()));
    } catch { return []; }
}

/**
 * Xóa item đã sync thành công
 */
function remove(filename) {
    if (typeof filename !== 'string' || path.basename(filename) !== filename || !filename.endsWith('.json')) return;
    try { fs.unlinkSync(path.join(queueDir, filename)); } catch {}
}

function markFailure(filename, errorMessage) {
    if (typeof filename !== 'string' || path.basename(filename) !== filename || !filename.endsWith('.json')) return;
    const finalPath = path.join(queueDir, filename);
    try {
        const item = JSON.parse(fs.readFileSync(finalPath, 'utf8'));
        const attempts = Math.min(20, Number(item.attempts || 0) + 1);
        const delayMs = Math.min(30 * 60 * 1000, 1000 * (2 ** Math.min(attempts, 10)));
        const next = {
            ...item,
            attempts,
            lastError: String(errorMessage || 'Unknown sync error').slice(0, 500),
            nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
        };
        const tmpPath = `${finalPath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf8');
        fs.renameSync(tmpPath, finalPath);
    } catch {}
}

function cryptoRandomId() {
    return require('crypto').randomUUID();
}

/**
 * Số lượng item đang chờ sync
 */
function count() {
    if (!queueDir) return 0;
    try {
        return fs.readdirSync(queueDir).filter(f => f.endsWith('.json')).length;
    } catch { return 0; }
}

module.exports = { init, enqueue, dequeueAll, remove, markFailure, count };
