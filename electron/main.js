const { app, BrowserWindow, Menu, ipcMain, shell, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const startupStartedAt = Date.now();
const startupMark = (label) => {
    const elapsed = Date.now() - startupStartedAt;
    console.log(`[perf] ${label}: ${elapsed}ms`);
    return elapsed;
};
startupMark('main module loaded');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

function getDevelopmentServerUrl() {
    const fallback = 'http://127.0.0.1:5173';
    try {
        const parsed = new URL(process.env.DBYPOS_VITE_DEV_SERVER_URL || fallback);
        const trustedHost = ['localhost', '127.0.0.1'].includes(parsed.hostname);
        const validPort = Number(parsed.port) >= 5173 && Number(parsed.port) <= 5190;
        return parsed.protocol === 'http:' && trustedHost && validPort ? parsed.origin : fallback;
    } catch {
        return fallback;
    }
}

const DEVELOPMENT_SERVER_URL = getDevelopmentServerUrl();
const USE_BUILT_RENDERER = process.env.DBYPOS_USE_DIST === '1';

// The packaged app can be started by an updater/launcher whose stdout and
// stderr pipes are closed immediately afterwards. Any later console.* call
// would otherwise emit an unhandled EPIPE and Electron would show a fatal
// "JavaScript error occurred in the main process" dialog.
function installBrokenPipeGuard(stream) {
    if (!stream || typeof stream.on !== 'function') return;
    stream.on('error', (error) => {
        if (error?.code === 'EPIPE') return;
        // Preserve the normal crash behaviour for genuine stream failures.
        setImmediate(() => { throw error; });
    });
}

installBrokenPipeGuard(process.stdout);
installBrokenPipeGuard(process.stderr);

// ✅ FIX: Electron v40 resolve module từ node_modules/electron/dist/resources/app/
// → tất cả require() (prisma, xlsx, bcryptjs...) đều fail vì tìm sai thư mục
// Monkey-patch Module._resolveFilename để fallback về project root thật
const Module = require('module');
const originalResolve = Module._resolveFilename;
const realNodeModules = path.join(process.cwd(), 'node_modules');
Module._resolveFilename = function (request, parent, isMain, options) {
    try {
        return originalResolve.call(this, request, parent, isMain, options);
    } catch (err) {
        // Nếu resolve fail → thử từ project root
        if (!request.startsWith('.') && !request.startsWith('/') && !request.startsWith('node:')) {
            const absPath = path.join(realNodeModules, request);
            try {
                return originalResolve.call(this, absPath, parent, isMain, options);
            } catch { }
        }
        throw err;
    }
};

let mainWindow;
let mobileScanServer = null;
let mobileScanSession = null;
let mobileScanSockets = new Map();
let mobileScanTunnel = null;
let mobileEvidenceSession = null;
let mobileEvidenceTunnel = null;

const MOBILE_EVIDENCE_MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MOBILE_EVIDENCE_MAX_IMAGES = 5;

function writeJson(response, statusCode, payload, headers = {}) {
    response.writeHead(statusCode, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload));
}

function getLanAddress() {
    const interfaces = os.networkInterfaces();
    for (const entries of Object.values(interfaces)) {
        for (const entry of entries || []) {
            if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.')) return entry.address;
        }
    }
    return '127.0.0.1';
}

function startMobileScanServer() {
    if (mobileScanServer) return;
    mobileScanServer = http.createServer((request, response) => {
        const url = new URL(request.url || '/', 'http://localhost');
        const headers = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
        if (request.method === 'GET' && url.pathname === '/') {
            response.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
            response.end(fs.readFileSync(path.join(__dirname, 'mobile-scanner-test.html')));
            return;
        }
        if (request.method === 'GET' && url.pathname === '/evidence') {
            response.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
            response.end(fs.readFileSync(path.join(__dirname, 'mobile-evidence-test.html')));
            return;
        }
        if (request.method === 'GET' && url.pathname === '/evidence-session') {
            const sessionToken = url.searchParams.get('session');
            if (!mobileEvidenceSession || sessionToken !== mobileEvidenceSession.token || mobileEvidenceSession.expiresAt <= Date.now()) {
                writeJson(response, 401, { success: false, error: 'Phiên QR không hợp lệ hoặc đã hết hạn.' }, headers);
                return;
            }
            writeJson(response, 200, {
                success: true,
                employee: mobileEvidenceSession.employee,
                tasks: mobileEvidenceSession.tasks.map((task) => ({
                    ...task,
                    receivedCount: mobileEvidenceSession.receivedCounts.get(task.id) || 0,
                })),
                expiresAt: mobileEvidenceSession.expiresAt,
            }, headers);
            return;
        }
        if (request.method === 'POST' && url.pathname === '/evidence-upload') {
            const sessionToken = url.searchParams.get('session');
            if (!mobileEvidenceSession || sessionToken !== mobileEvidenceSession.token || mobileEvidenceSession.expiresAt <= Date.now()) {
                request.resume();
                writeJson(response, 401, { success: false, error: 'Phiên QR không hợp lệ hoặc đã hết hạn.' }, headers);
                return;
            }
            const evidenceSessionAtStart = mobileEvidenceSession;
            const taskId = String(url.searchParams.get('task') || '');
            const selectedTask = evidenceSessionAtStart.tasks.find((task) => task.id === taskId);
            if (!selectedTask) {
                request.resume();
                writeJson(response, 404, { success: false, error: 'Công việc không thuộc phiên điện thoại này.' }, headers);
                return;
            }
            const currentTaskCount = evidenceSessionAtStart.receivedCounts.get(taskId) || 0;
            if (currentTaskCount >= MOBILE_EVIDENCE_MAX_IMAGES) {
                request.resume();
                writeJson(response, 409, { success: false, error: `Mỗi công việc thử chỉ nhận tối đa ${MOBILE_EVIDENCE_MAX_IMAGES} ảnh.` }, headers);
                return;
            }
            const mimeType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
            const contentLength = Number(request.headers['content-length'] || 0);
            if (mimeType !== 'image/jpeg') {
                request.resume();
                writeJson(response, 415, { success: false, error: 'Chỉ nhận ảnh JPG/JPEG chụp từ camera.' }, headers);
                return;
            }
            if (contentLength > MOBILE_EVIDENCE_MAX_SOURCE_BYTES) {
                request.resume();
                writeJson(response, 413, { success: false, error: 'Ảnh không được vượt quá 15 MB.' }, headers);
                return;
            }
            const chunks = [];
            let receivedBytes = 0;
            let tooLarge = false;
            request.on('data', (chunk) => {
                receivedBytes += chunk.length;
                if (receivedBytes > MOBILE_EVIDENCE_MAX_SOURCE_BYTES) {
                    tooLarge = true;
                    chunks.length = 0;
                    return;
                }
                if (!tooLarge) chunks.push(chunk);
            });
            request.on('end', () => {
                if (mobileEvidenceSession !== evidenceSessionAtStart || evidenceSessionAtStart.expiresAt <= Date.now()) {
                    writeJson(response, 409, { success: false, error: 'Phiên điện thoại đã thay đổi hoặc hết hạn trong lúc tải ảnh.' }, headers);
                    return;
                }
                if (tooLarge) {
                    writeJson(response, 413, { success: false, error: 'Ảnh không được vượt quá 15 MB.' }, headers);
                    return;
                }
                const buffer = Buffer.concat(chunks);
                const isJpeg = buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
                if (!isJpeg) {
                    writeJson(response, 400, { success: false, error: 'Dữ liệu gửi lên không phải ảnh JPEG hợp lệ.' }, headers);
                    return;
                }
                const latestTaskCount = evidenceSessionAtStart.receivedCounts.get(taskId) || 0;
                if (latestTaskCount >= MOBILE_EVIDENCE_MAX_IMAGES) {
                    writeJson(response, 409, { success: false, error: `Mỗi công việc thử chỉ nhận tối đa ${MOBILE_EVIDENCE_MAX_IMAGES} ảnh.` }, headers);
                    return;
                }
                let fileName = 'camera-evidence.jpg';
                try { fileName = decodeURIComponent(String(request.headers['x-file-name'] || fileName)); } catch { }
                const receivedCount = latestTaskCount + 1;
                evidenceSessionAtStart.receivedCounts.set(taskId, receivedCount);
                const receipt = {
                    id: crypto.randomBytes(8).toString('hex'),
                    taskId: selectedTask.id,
                    taskTitle: selectedTask.title,
                    requiredCount: selectedTask.requiredCount,
                    name: fileName.slice(0, 160),
                    mimeType,
                    size: buffer.length,
                    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
                    at: new Date().toISOString(),
                };
                mainWindow?.webContents.send('mobileEvidence:received', receipt);
                writeJson(response, 200, {
                    success: true,
                    taskId,
                    receivedCount,
                    requiredCount: selectedTask.requiredCount,
                    completed: receivedCount >= selectedTask.requiredCount,
                }, headers);
            });
            request.on('error', () => {
                if (!response.headersSent) writeJson(response, 400, { success: false, error: 'Kết nối tải ảnh bị gián đoạn.' }, headers);
            });
            return;
        }
        if (request.method === 'GET' && url.pathname === '/zxing.js') {
            response.writeHead(200, { ...headers, 'Content-Type': 'application/javascript; charset=utf-8' });
            response.end(fs.readFileSync(path.join(__dirname, '..', 'node_modules/@zxing/browser/umd/zxing-browser.min.js')));
            return;
        }
        response.writeHead(404, headers); response.end('Not found');
    });
    const socketServer = new WebSocketServer({ server: mobileScanServer, path: '/socket' });
    socketServer.on('connection', (socket, request) => {
        const query = new URL(request.url || '/', 'http://localhost');
        if (!mobileScanSession || query.searchParams.get('session') !== mobileScanSession.token) { socket.close(1008, 'Phiên không hợp lệ'); return; }
        let deviceId;
        socket.on('message', raw => { try { const payload = JSON.parse(raw.toString()); if (payload.type === 'hello') { deviceId = String(payload.deviceId || crypto.randomBytes(8).toString('hex')); mobileScanSockets.set(deviceId, socket); mainWindow?.webContents.send('mobileScan:device', { deviceId, employee: String(payload.employee || 'Nhân viên'), connected: true }); return; } if (payload.type !== 'scan' || !deviceId) return; const code = String(payload.code || '').trim(); if (!code) return; const duplicate = mobileScanSession.recentCodes.has(code); const status = /^fail/i.test(code) || duplicate ? 'fail' : 'success'; if (!duplicate) mobileScanSession.recentCodes.set(code, Date.now()); const message = duplicate ? 'Mã đã được quét trong phiên này' : status === 'success' ? 'Quét thành công' : 'Mã lỗi mô phỏng'; const result = { type:'result', code, status, message, sentAt: Number(payload.sentAt) || Date.now() }; socket.send(JSON.stringify(result)); mainWindow?.webContents.send('mobileScan:received', { code, employee: String(payload.employee || 'Nhân viên'), deviceId, status, message, at: new Date().toISOString() }); } catch {} });
        socket.on('close', () => { if (deviceId) { mobileScanSockets.delete(deviceId); mainWindow?.webContents.send('mobileScan:device', { deviceId, connected: false }); } });
    });
    mobileScanServer.listen(47821, '0.0.0.0');
}

ipcMain.handle('mobileScan:start', async () => {
    startMobileScanServer();
    if (mobileScanTunnel) { mobileScanTunnel.kill(); mobileScanTunnel = null; }
    for (const socket of mobileScanSockets.values()) socket.close(1000, 'Phiên mới');
    mobileScanSockets = new Map();
    mobileScanSession = { token: crypto.randomBytes(12).toString('hex'), recentCodes: new Map() };
    const sessionToken = mobileScanSession.token;
    const localOrigin = `http://${getLanAddress()}:47821`;
    const cloudflaredPath = path.join(__dirname, '..', 'node_modules', 'cloudflared', 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
    if (!fs.existsSync(cloudflaredPath)) return { success: true, url: `${localOrigin}/?session=${sessionToken}`, token: sessionToken, address: getLanAddress(), secure: false };
    return await new Promise((resolve) => {
        let settled = false;
        let tunnelOrigin = '';
        let tunnelConnected = false;
        const finish = (origin, secure) => { if (settled) return; settled = true; resolve({ success: true, url: `${origin}/?session=${sessionToken}`, token: sessionToken, address: getLanAddress(), secure }); };
        mobileScanTunnel = spawn(cloudflaredPath, ['tunnel', '--protocol', 'http2', '--url', 'http://127.0.0.1:47821', '--no-autoupdate'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const inspect = (chunk) => {
            const output = String(chunk);
            const match = output.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/i);
            if (match) tunnelOrigin = match[0];
            if (/Registered tunnel connection/i.test(output)) tunnelConnected = true;
            if (tunnelOrigin && tunnelConnected) setTimeout(() => finish(tunnelOrigin, true), 5000);
        };
        mobileScanTunnel.stdout.on('data', inspect); mobileScanTunnel.stderr.on('data', inspect);
        mobileScanTunnel.on('error', () => finish(localOrigin, false));
        mobileScanTunnel.on('exit', () => { mobileScanTunnel = null; if (!settled) finish(localOrigin, false); });
        setTimeout(() => { if (!settled) { mobileScanTunnel?.kill(); mobileScanTunnel = null; finish(localOrigin, false); } }, 20000);
    });
});
ipcMain.handle('mobileScan:stop', () => { mobileScanSession = null; for (const socket of mobileScanSockets.values()) socket.close(1000, 'Phiên đã dừng'); mobileScanSockets.clear(); if (mobileScanTunnel) { mobileScanTunnel.kill(); mobileScanTunnel = null; } return { success: true }; });
ipcMain.handle('mobileEvidence:start', async (_event, sessionPayload = {}) => {
    startMobileScanServer();
    if (mobileEvidenceTunnel) { mobileEvidenceTunnel.kill(); mobileEvidenceTunnel = null; }
    const employee = String(sessionPayload.employee || 'Nhân viên kiểm thử').slice(0, 80);
    const sourceTasks = Array.isArray(sessionPayload.tasks) ? sessionPayload.tasks.slice(0, 30) : [];
    const seenTaskIds = new Set();
    const testTasks = sourceTasks.map((taskPayload, index) => {
        const fallbackId = `test-task-${index + 1}`;
        const id = String(taskPayload?.id || fallbackId).slice(0, 80);
        if (seenTaskIds.has(id)) throw new Error('Danh sách công việc có mã bị trùng.');
        seenTaskIds.add(id);
        return {
            id,
            title: String(taskPayload?.title || `Công việc ${index + 1}`).slice(0, 160),
            category: String(taskPayload?.category || 'Công việc hàng ngày').slice(0, 80),
            dueTime: String(taskPayload?.dueTime || '20:00').slice(0, 20),
            requiredCount: Math.max(1, Math.min(MOBILE_EVIDENCE_MAX_IMAGES, Math.floor(Number(taskPayload?.requiredCount) || 1))),
        };
    });
    if (testTasks.length === 0) throw new Error('Phiên điện thoại phải có ít nhất một công việc.');
    mobileEvidenceSession = {
        token: crypto.randomBytes(24).toString('base64url'),
        expiresAt: Date.now() + 8 * 60 * 60 * 1000,
        employee,
        tasks: testTasks,
        receivedCounts: new Map(),
    };
    const sessionToken = mobileEvidenceSession.token;
    const pagePath = `/evidence?session=${encodeURIComponent(sessionToken)}`;
    const localOrigin = `http://${getLanAddress()}:47821`;
    const cloudflaredPath = path.join(__dirname, '..', 'node_modules', 'cloudflared', 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
    const sessionInfo = { employee, tasks: testTasks };
    if (!fs.existsSync(cloudflaredPath)) return { success: true, url: `${localOrigin}${pagePath}`, address: getLanAddress(), secure: false, expiresAt: mobileEvidenceSession.expiresAt, ...sessionInfo };
    return await new Promise((resolve) => {
        let settled = false;
        let tunnelOrigin = '';
        let tunnelConnected = false;
        const finish = (origin, secure) => {
            if (settled) return;
            settled = true;
            resolve({ success: true, url: `${origin}${pagePath}`, address: getLanAddress(), secure, expiresAt: mobileEvidenceSession?.expiresAt || Date.now(), ...sessionInfo });
        };
        mobileEvidenceTunnel = spawn(cloudflaredPath, ['tunnel', '--protocol', 'http2', '--url', 'http://127.0.0.1:47821', '--no-autoupdate'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const inspect = (chunk) => {
            const output = String(chunk);
            const match = output.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/i);
            if (match) tunnelOrigin = match[0];
            if (/Registered tunnel connection/i.test(output)) tunnelConnected = true;
            if (tunnelOrigin && tunnelConnected) setTimeout(() => finish(tunnelOrigin, true), 5000);
        };
        mobileEvidenceTunnel.stdout.on('data', inspect); mobileEvidenceTunnel.stderr.on('data', inspect);
        mobileEvidenceTunnel.on('error', () => finish(localOrigin, false));
        mobileEvidenceTunnel.on('exit', () => { mobileEvidenceTunnel = null; if (!settled) finish(localOrigin, false); });
        setTimeout(() => { if (!settled) { mobileEvidenceTunnel?.kill(); mobileEvidenceTunnel = null; finish(localOrigin, false); } }, 20000);
    });
});
ipcMain.handle('mobileEvidence:stop', () => {
    mobileEvidenceSession = null;
    if (mobileEvidenceTunnel) { mobileEvidenceTunnel.kill(); mobileEvidenceTunnel = null; }
    return { success: true };
});
let pythonProcess = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

// Keep the first paint independent from the large IPC module. Renderer calls
// are held by preload until this promise resolves, so delaying registration
// cannot create a race where an API is called before its handler exists.
let resolveBackendReady;
let rejectBackendReady;
const backendReadyPromise = new Promise((resolve, reject) => {
    resolveBackendReady = resolve;
    rejectBackendReady = reject;
});
let backendLoadStarted = false;
let backendFallbackTimer = null;

ipcMain.handle('app:waitBackendReady', async () => {
    try {
        await backendReadyPromise;
        return { success: true };
    } catch (error) {
        return { success: false, error: error?.message || String(error) };
    }
});

function loadBackendHandlers() {
    if (backendLoadStarted) return;
    backendLoadStarted = true;
    if (backendFallbackTimer) {
        clearTimeout(backendFallbackTimer);
        backendFallbackTimer = null;
    }
    try {
        startupMark('backend load start');
        console.time('⚡ ipc-handlers load');
        require('./ipc-handlers');
        console.timeEnd('⚡ ipc-handlers load');
        console.log('✅ IPC handlers loaded');
        startupMark('backend ready');
        resolveBackendReady({ success: true });
    } catch (err) {
        console.error('❌ IPC handlers failed:', err.message);
        console.error(err.stack);
        rejectBackendReady(err);
    }
}

if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    });
}

function findPythonExe() {
    const { spawnSync } = require('child_process');
    // Quét nhiều user phổ biến + user hiện tại
    const usernames = [...new Set(['Admin', 'NCPC', process.env.USERNAME || ''].filter(Boolean))];
    const candidates = [];
    // 1. Đường dẫn per-user (ưu tiên cao nhất)
    for (const uname of usernames) {
        for (const ver of ['Python311', 'Python310', 'Python39', 'Python312']) {
            candidates.push({ cmd: `C:\\Users\\${uname}\\AppData\\Local\\Programs\\Python\\${ver}\\python.exe`, args: [] });
        }
    }
    // 2. Program Files
    for (const ver of ['Python311', 'Python310', 'Python39', 'Python312']) {
        candidates.push({ cmd: `C:\\Program Files\\${ver}\\python.exe`, args: [] });
    }
    // 3. PATH-based (cuối cùng)
    candidates.push(
        { cmd: 'py', args: ['-3.11'] },
        { cmd: 'py', args: ['-3.10'] },
        { cmd: 'py', args: ['-3'] },
        { cmd: 'python', args: [] },
        { cmd: 'python3', args: [] },
    );

    for (const c of candidates) {
        try {
            if (c.cmd.includes('\\') && !fs.existsSync(c.cmd)) continue;
            if (!c.cmd.includes('\\')) {
                const res = spawnSync(c.cmd, [...c.args, '--version'], { windowsHide: true, timeout: 5000, stdio: 'pipe' });
                if (res.error || res.status !== 0) continue;
            }
            // Verify face_recognition module
            const verify = spawnSync(c.cmd, [...c.args, '-c', 'import face_recognition; print("OK")'], {
                windowsHide: true, timeout: 15000, stdio: 'pipe'
            });
            if (verify.error || verify.status !== 0) {
                console.log(`[Python] ❌ ${c.cmd} → thiếu face_recognition`);
                continue;
            }
            console.log(`[Python] ✅ CHỌN: ${c.cmd} ${c.args.join(' ')}`);
            return { exe: c.cmd, extraArgs: c.args };
        } catch { }
    }
    return null;
}

function startPythonService() {
    const userDataPath = app.getPath('userData');

    // ── Ưu tiên EXE standalone (PyInstaller) — không cần Python trên máy ──────
    const exePath = path.join(__dirname, '..', 'python', 'dist', 'attendance_service.exe');
    const scriptPath = path.join(__dirname, '..', 'python', 'attendance_service.py');

    let spawnCmd, spawnArgs;

    if (app.isPackaged && fs.existsSync(exePath)) {
        console.log('🚀 Dùng attendance_service.exe (standalone)');
        spawnCmd = exePath;
        spawnArgs = [];
    } else if (fs.existsSync(scriptPath)) {
        if (!app.isPackaged && fs.existsSync(exePath)) {
            console.log('🛠 Dev mode → bỏ qua attendance_service.exe, dùng Python script');
        }
        const found = findPythonExe();
        if (!found) {
            console.warn('⚠️ Không tìm thấy Python — chức năng chấm công khuôn mặt sẽ không hoạt động');
            return;
        }
        console.log('🐍 Fallback Python:', found.exe, found.extraArgs.join(' '));
        spawnCmd = found.exe;
        spawnArgs = [...found.extraArgs, scriptPath];
    } else {
        console.warn('⚠️ Không tìm thấy attendance_service.exe hoặc .py — chức năng chấm công không khả dụng');
        return;
    }

    try {
        pythonProcess = spawn(spawnCmd, spawnArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: {
                ...process.env,
                FACE_DATA_DIR: userDataPath,
                PYTHONIOENCODING: 'utf-8',
            },
        });
        pythonProcess.stdout.on('data', d => console.log('[Python]', d.toString().trim()));
        pythonProcess.stderr.on('data', d => console.error('[Python ERR]', d.toString().trim()));
        pythonProcess.on('error', (err) => {
            console.warn('⚠️ Python service error (chức năng nhận diện không khả dụng):', err.message);
            pythonProcess = null;
        });
        pythonProcess.on('exit', (code) => {
            console.log(`[Python] exited: ${code}`);
            pythonProcess = null;
        });
        console.log('🐍 Python face service started (PID:', pythonProcess.pid, ')');
    } catch (err) {
        console.warn('⚠️ Không thể khởi động Python service:', err.message);
        pythonProcess = null;
    }
}

function stopPythonService() {
    if (pythonProcess) { pythonProcess.kill(); pythonProcess = null; }
}

// Menu templates — dùng cho popup khi click Edit/View trong React header
const EDIT_MENU_TEMPLATE = [
    { role: 'undo' },
    { role: 'redo' },
    { type: 'separator' },
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { role: 'selectAll' },
];
const VIEW_MENU_TEMPLATE = [
    { role: 'reload' },
    { role: 'forceReload' },
    ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : []),
    { type: 'separator' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { role: 'resetZoom' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
];

function isTrustedAppUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        const isTrustedFilePage = parsed.protocol === 'file:' &&
            decodeURIComponent(parsed.pathname)
                .replace(/\\/g, '/')
                .toLowerCase()
                .endsWith('/dist/index.html');
        if (!app.isPackaged) {
            const isTrustedDevServer = parsed.origin === DEVELOPMENT_SERVER_URL;
            return isTrustedDevServer || isTrustedFilePage;
        }
        return isTrustedFilePage;
    } catch {
        return false;
    }
}

function isSafeExternalUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
        const host = parsed.hostname.toLowerCase();
        if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return false;
        if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false;
        const private172 = host.match(/^172\.(\d{1,3})\./);
        if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
        return true;
    } catch {
        return false;
    }
}

function configureSessionSecurity() {
    // Vite injects an inline React Refresh preamble in development. Blocking it
    // makes @vitejs/plugin-react abort before React can mount, leaving #root empty.
    // Keep production strict: packaged builds never receive unsafe-inline/eval.
    const developmentScriptSources = app.isPackaged ? '' : " 'unsafe-inline' 'unsafe-eval'";
    const csp = [
        "default-src 'self'",
        `script-src 'self'${developmentScriptSources}`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https:",
        "media-src 'self' data: blob:",
        "worker-src 'self' blob:",
        "connect-src 'self' http://127.0.0.1:* http://localhost:* https://api.github.com https://github.com https://*.supabase.co https://*.workers.dev ws://127.0.0.1:* ws://localhost:*",
        "frame-src 'self' data: blob: https://drive.google.com https://docs.google.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ].join('; ');
    const urls = app.isPackaged
        ? ['file://*/*']
        : ['file://*/*', `${DEVELOPMENT_SERVER_URL}/*`];
    session.defaultSession.webRequest.onHeadersReceived({ urls }, (details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [csp],
            },
        });
    });
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
        const requestingUrl = details?.requestingUrl || webContents.getURL();
        const allowed = isTrustedAppUrl(requestingUrl) && ['media', 'notifications'].includes(permission);
        callback(allowed);
    });
}

// Popup native context menu khi click Edit/View từ React
ipcMain.handle('menu:popup', (event, menuName) => {
    if (!isTrustedAppUrl(event.senderFrame?.url || event.sender.getURL())) {
        throw new Error('IPC sender không hợp lệ');
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    const template = menuName === 'edit' ? EDIT_MENU_TEMPLATE : VIEW_MENU_TEMPLATE;
    const contextMenu = Menu.buildFromTemplate(template);
    contextMenu.popup({ window: win });
});

function createWindow() {
    startupMark('createWindow start');
    // Ẩn native menu bar — Edit/View được đưa vào React header
    Menu.setApplicationMenu(null);

    const { width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workAreaSize;
    const defaultWidth = Math.max(760, Math.min(1400, Math.round(workWidth * 0.82)));
    const defaultHeight = Math.max(560, Math.min(900, Math.round(workHeight * 0.84)));

    mainWindow = new BrowserWindow({
        width: defaultWidth,
        height: defaultHeight,
        minWidth: 760,
        minHeight: 560,
        show: false,
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#ffffff',
            symbolColor: '#374151',
            height: 40,
        },
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            devTools: !app.isPackaged,
            preload: path.join(__dirname, 'preload.js'),
            autoplayPolicy: 'no-user-gesture-required',
            backgroundThrottling: true,
        },
        title: 'DBY POS',
        icon: app.isPackaged
            ? path.join(__dirname, '../dist/app_icon.ico')
            : path.join(__dirname, '../public/app_icon.ico'),
        backgroundColor: '#ffffff',
    });

    if (!app.isPackaged) {
        const diagnosticPath = path.join(process.cwd(), 'tmp', 'renderer-diagnostics.log');
        const writeDiagnostic = (eventName, detail) => {
            try {
                fs.mkdirSync(path.dirname(diagnosticPath), { recursive: true });
                fs.appendFileSync(
                    diagnosticPath,
                    `${new Date().toISOString()} [${eventName}] ${String(detail || '')}\n`,
                    'utf8',
                );
            } catch {}
        };
        mainWindow.webContents.on('did-finish-load', () =>
            writeDiagnostic('did-finish-load', mainWindow?.webContents?.getURL()),
        );
        mainWindow.webContents.on('did-fail-load', (_event, code, description, url) =>
            writeDiagnostic('did-fail-load', `${code} ${description} ${url}`),
        );
        mainWindow.webContents.on('preload-error', (_event, preloadPath, error) =>
            writeDiagnostic('preload-error', `${preloadPath}: ${error?.stack || error}`),
        );
        mainWindow.webContents.on('render-process-gone', (_event, details) =>
            writeDiagnostic('render-process-gone', JSON.stringify(details)),
        );
        mainWindow.webContents.on('console-message', (details) => {
            writeDiagnostic('console', JSON.stringify({
                level: details.level,
                message: details.message,
                lineNumber: details.lineNumber,
                sourceId: details.sourceId,
            }));
        });
    }

    // Open as a centered resizable window; users can maximize when needed.
    mainWindow.once('ready-to-show', () => {
        startupMark('ready-to-show');
        mainWindow.center();
        mainWindow.show();
        mainWindow.setTitleBarOverlay({
            color: '#ffffff',
            symbolColor: '#374151',
            height: 40,
        });
        // Let Chromium paint the login/shell before parsing the 1.3 MB IPC
        // registry and initializing Prisma/network services.
        setImmediate(loadBackendHandlers);
    });

    // `ready-to-show` is normally emitted after the first paint, but it is
    // not guaranteed when the renderer or dev server reports a load error.
    // Keep the deferred startup optimization bounded so preload IPC cannot
    // wait forever on a broken page.
    mainWindow.webContents.once('did-finish-load', () => {
        startupMark('renderer did-finish-load');
        if (backendLoadStarted) return;
        if (backendFallbackTimer) clearTimeout(backendFallbackTimer);
        backendFallbackTimer = setTimeout(loadBackendHandlers, 2500);
        backendFallbackTimer.unref?.();
    });
    backendFallbackTimer = setTimeout(loadBackendHandlers, 8000);
    backendFallbackTimer.unref?.();

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isSafeExternalUrl(url)) void shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (isTrustedAppUrl(url)) return;
        event.preventDefault();
        if (isSafeExternalUrl(url)) void shell.openExternal(url);
    });

    // Native menu is hidden, so Electron does not wire reload shortcuts for us.
    // Keep dev reload available from the keyboard even when the React header is focused.
    mainWindow.webContents.on('before-input-event', (event, input) => {
        const key = String(input.key || '').toLowerCase();
        const isReload = key === 'f5' || (input.control && key === 'r');
        if (!isReload) return;

        event.preventDefault();
        if (input.shift || key === 'f5') {
            mainWindow.webContents.reloadIgnoringCache();
        } else {
            mainWindow.webContents.reload();
        }
    });

    // Load React app - auto-detect dev server
    const VITE_DEV_SERVER = DEVELOPMENT_SERVER_URL;
    const isDev = !app.isPackaged && !USE_BUILT_RENDERER;

    console.log('isDev:', isDev, '| isPackaged:', app.isPackaged);

    if (isDev) {
        const http = require('http');
        const indexPath = path.join(__dirname, '../dist/index.html');
        // Retry nhiều lần chờ Vite sẵn sàng
        const tryLoad = (retriesLeft) => {
            const request = http.get(VITE_DEV_SERVER, (response) => {
                request.setTimeout(0);
                response.resume();
                console.log('✅ Vite dev server detected → loading', VITE_DEV_SERVER);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.loadURL(VITE_DEV_SERVER);
                }
            });
            request.setTimeout(1000, () => {
                request.destroy(new Error('Vite probe timeout'));
            });
            request.on('error', () => {
                if (retriesLeft > 0) {
                    console.log(`⏳ Vite not ready, retrying... (${retriesLeft} left)`);
                    setTimeout(() => tryLoad(retriesLeft - 1), 500);
                } else if (mainWindow && !mainWindow.isDestroyed()) {
                    console.log('📦 No dev server → loading dist:', indexPath);
                    mainWindow.loadFile(indexPath);
                }
            });
        };
        tryLoad(20); // thử tối đa 20 lần × 500ms = 10 giây
    } else {
        const indexPath = path.join(__dirname, '../dist/index.html');
        mainWindow.loadFile(indexPath);
    }
    // DevTools có thể mở bằng Ctrl+Shift+I (không tự động mở, không bị khóa)

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    if (!hasSingleInstanceLock) return;
    startupMark('app ready');
    configureSessionSecurity();
    // Tạo cửa sổ TRƯỚC để luôn hiển thị app
    createWindow();
    // NOTE: Python service được quản lý bởi ipc-handlers.js (ensureFaceService)
    // KHÔNG gọi startPythonService() ở đây — sẽ conflict với kill-port logic của ipc-handlers
    // startPythonService();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    mobileScanSession = null;
    mobileEvidenceSession = null;
    for (const socket of mobileScanSockets.values()) socket.close(1000, 'Ứng dụng đã đóng');
    mobileScanSockets.clear();
    if (mobileScanTunnel) { mobileScanTunnel.kill(); mobileScanTunnel = null; }
    if (mobileEvidenceTunnel) { mobileEvidenceTunnel.kill(); mobileEvidenceTunnel = null; }
    mobileScanServer?.close();
    mobileScanServer = null;
    stopPythonService();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
