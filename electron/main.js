const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

let mainWindow;

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
        // Thử kết nối Vite dev server trước (HMR - không cần rebuild)
        const http = require('http');
        http.get(VITE_DEV_SERVER, () => {
            console.log('✅ Vite dev server detected → loading', VITE_DEV_SERVER);
            mainWindow.loadURL(VITE_DEV_SERVER);
        }).on('error', () => {
            // Không có dev server → dùng dist (build tĩnh)
            const indexPath = path.join(__dirname, '../dist/index.html');
            console.log('📦 No dev server → loading dist:', indexPath);
            mainWindow.loadFile(indexPath);
        });
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
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
