const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

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
let pythonProcess = null;

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

function createWindow() {
    // Tạo Menu với Edit + View actions để Ctrl+C/V và Ctrl+R hoạt động
    const template = [
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
            ],
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { role: 'resetZoom' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
        },
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path.join(__dirname, 'preload.js'),
            autoplayPolicy: 'no-user-gesture-required',
            backgroundThrottling: false,  // Giữ timers chạy đúng tốc độ khi mất focus
        },
        title: 'DBY POS - Quản lý bán hàng',
        icon: app.isPackaged
            ? path.join(__dirname, '../dist/app_icon.ico')
            : path.join(__dirname, '../public/app_icon.ico'),
        backgroundColor: '#1f1f1f',
    });

    // Show full màn hình ngay khi render xong, không flash cửa sổ nhỏ
    mainWindow.once('ready-to-show', () => {
        mainWindow.maximize();
        mainWindow.show();
    });

    // Load React app - auto-detect dev server
    const VITE_DEV_SERVER = 'http://localhost:5173';
    const isDev = !app.isPackaged;

    console.log('isDev:', isDev, '| isPackaged:', app.isPackaged);

    if (isDev) {
        const http = require('http');
        const indexPath = path.join(__dirname, '../dist/index.html');
        // Retry nhiều lần chờ Vite sẵn sàng
        const tryLoad = (retriesLeft) => {
            http.get(VITE_DEV_SERVER, () => {
                console.log('✅ Vite dev server detected → loading', VITE_DEV_SERVER);
                mainWindow.loadURL(VITE_DEV_SERVER);
            }).on('error', () => {
                if (retriesLeft > 0) {
                    console.log(`⏳ Vite not ready, retrying... (${retriesLeft} left)`);
                    setTimeout(() => tryLoad(retriesLeft - 1), 500);
                } else {
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
    // Tạo cửa sổ TRƯỚC để luôn hiển thị app
    createWindow();
    // NOTE: Python service được quản lý bởi ipc-handlers.js (ensureFaceService)
    // KHÔNG gọi startPythonService() ở đây — sẽ conflict với kill-port logic của ipc-handlers
    // startPythonService();

    // Import IPC handlers SAU - bọc try-catch để không crash app
    try {
        console.time('⚡ ipc-handlers load');
        require('./ipc-handlers');
        console.timeEnd('⚡ ipc-handlers load');
        console.log('✅ IPC handlers loaded');
    } catch (err) {
        console.error('❌ IPC handlers failed:', err.message);
        console.error(err.stack);
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    stopPythonService();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
