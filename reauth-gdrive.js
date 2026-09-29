/**
 * Re-authenticate Google Drive/Gmail — chạy 1 lần khi token hết hạn hoặc cần quyền gửi Gmail
 * node reauth-gdrive.js
 */
const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { OAUTH_CLIENT_ID: CLIENT_ID, OAUTH_CLIENT_SECRET: CLIENT_SECRET } = require('./electron/config');
const REDIRECT_URI  = 'http://localhost:3456/callback';
const APP_NAME = 'quan-ly-ban-hang-desktop';
const USER_DATA_DIR = path.join(
    process.env.APPDATA || path.join(process.env.USERPROFILE || __dirname, 'AppData', 'Roaming'),
    APP_NAME
);
const TOKEN_PATH = process.env.GDRIVE_TOKEN_PATH || path.join(USER_DATA_DIR, 'gdrive-token.json');
const ENCRYPTED_TOKEN_PATH = path.join(USER_DATA_DIR, 'gdrive-token.bin');
const state = crypto.randomBytes(32).toString('hex');

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    state,
    scope: [
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/gmail.send',
    ],
});

console.log('\n=========================================');
console.log('  Google Drive/Gmail Re-Authentication');
console.log('=========================================');
console.log('\nMở trình duyệt và truy cập URL sau:\n');
console.log(authUrl);
console.log('\nĐang chờ callback trên http://localhost:3456 ...\n');

// Mở browser tự động
try {
    const { execSync } = require('child_process');
    execSync(`start "" "${authUrl}"`);
} catch (e) { /* ignore */ }

// Local server nhận callback
const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    if (parsed.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
    if (parsed.query.state !== state) { res.writeHead(400); res.end('Invalid OAuth state'); return; }

    const code = parsed.query.code;
    if (!code) {
        res.end('<h2>Lỗi: Không có code</h2>');
        return;
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);
        if (!tokens.refresh_token) throw new Error('Google khong tra refresh_token; hay cap lai quyen.');
        fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
        // The Electron app prefers the encrypted .bin token. Remove the stale
        // encrypted token so the next launch migrates this freshly authorized
        // JSON token into Windows safeStorage instead of reusing the old one.
        if (fs.existsSync(ENCRYPTED_TOKEN_PATH)) {
            fs.rmSync(ENCRYPTED_TOKEN_PATH, { force: true });
        }
        await require('./scripts/sync-drive-backend.cjs').syncDriveBackend();
        console.log('✅ Token mới đã lưu vào:', TOKEN_PATH);
        console.log('✅ Production sẽ dùng token mới qua backend Cloudflare.');
        console.log('   refresh_token:', tokens.refresh_token ? '✅ Có' : '⚠️ Không có');

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>✅ Xác thực thành công! Bạn có thể đóng tab này.</h2>');
        server.close();
        console.log('\nXong! May da cap nhat backend upload chi can thu upload lai.');
    } catch (err) {
        console.error('Google authentication or Cloudflare sync failed. Retry node scripts/sync-drive-backend.cjs after checking access.');
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>Chua dong bo duoc Google len backend. Kiem tra cua so lenh tren may dev.</h2>');
        server.close();
    }
});

server.listen(3456);
