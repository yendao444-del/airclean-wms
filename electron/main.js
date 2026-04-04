const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let pythonProcess = null;

function findPythonExe() {
    const fs = require('fs');
    // Thứ tự ưu tiên tìm Python có face_recognition
    const candidates = [
        // Python Launcher (Windows) — thử trước
        { cmd: 'py', args: ['-3.10'] },
        { cmd: 'py', args: ['-3'] },
        // Đường dẫn cố định phổ biến
        { cmd: 'C:\\Program Files\\Python310\\python.exe', args: [] },
        { cmd: 'C:\\Program Files\\Python39\\python.exe', args: [] },
        { cmd: 'C:\\Program Files\\Python311\\python.exe', args: [] },
        { cmd: 'C:\\Users\\' + (process.env.USERNAME || '') + '\\AppData\\Local\\Programs\\Python\\Python310\\python.exe', args: [] },
        { cmd: 'C:\\Users\\' + (process.env.USERNAME || '') + '\\AppData\\Local\\Programs\\Python\\Python39\\python.exe', args: [] },
        // PATH fallback
        { cmd: 'python', args: [] },
        { cmd: 'python3', args: [] },
    ];
    for (const c of candidates) {
        try {
            // Kiểm tra file tồn tại (với exe cụ thể)
            if (c.cmd.includes('\\') && !fs.existsSync(c.cmd)) continue;
            return { exe: c.cmd, extraArgs: c.args };
        } catch {}
    }
    return null;
}

function startPythonService() {
    const pythonScript = path.join(__dirname, '..', 'python', 'attendance_service.py');
    const userDataPath = app.getPath('userData');

    const found = findPythonExe();
    if (!found) {
        console.warn('⚠️ Không tìm thấy Python — chức năng chấm công khuôn mặt sẽ không hoạt động');
        return;
    }

    const { exe, extraArgs } = found;
    console.log('🐍 Dùng Python:', exe, extraArgs.join(' '));

    try {
        pythonProcess = spawn(exe, [...extraArgs, pythonScript], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: { ...process.env, FACE_DATA_DIR: userDataPath },
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
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path.join(__dirname, 'preload.js'),
            autoplayPolicy: 'no-user-gesture-required',
        },
        title: 'DBY POS - Quản lý bán hàng',
        icon: app.isPackaged
            ? path.join(__dirname, '../dist/app_icon.ico')
            : path.join(__dirname, '../public/app_icon.ico'),
        backgroundColor: '#1f1f1f',
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
    // 🔒 SECURITY: DevTools control based on packaging
    if (app.isPackaged) {
        // PRODUCTION (.exe) → khóa DevTools để nhân viên không mở được
        mainWindow.webContents.on('devtools-opened', () => {
            mainWindow.webContents.closeDevTools();
        });
    } else {
        // DEV (chạy từ source) → mở DevTools để debug
        // mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    // Tạo cửa sổ TRƯỚC để luôn hiển thị app
    createWindow();
    startPythonService();

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
