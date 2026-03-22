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

    // Load React app
    const fs = require('fs');
    const indexPath = path.join(__dirname, '../dist/index.html');
    const isDev = !app.isPackaged && !fs.existsSync(indexPath);

    console.log('app.isPackaged:', app.isPackaged);
    console.log('indexPath:', indexPath);
    console.log('indexPath exists:', fs.existsSync(indexPath));
    console.log('isDev:', isDev);

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    } else {
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
