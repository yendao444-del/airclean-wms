const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
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
        title: 'QuanLyPOS - Quản lý bán hàng',
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
    // mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    // Tạo cửa sổ TRƯỚC để luôn hiển thị app
    createWindow();

    // Import IPC handlers SAU - bọc try-catch để không crash app
    try {
        require('./ipc-handlers');
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
