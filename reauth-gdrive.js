/**
 * Re-authenticate Google Drive/Gmail — chạy 1 lần khi token hết hạn hoặc cần quyền gửi Gmail
 * node reauth-gdrive.js
 */
const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

const { OAUTH_CLIENT_ID: CLIENT_ID, OAUTH_CLIENT_SECRET: CLIENT_SECRET } = require('./electron/config');
const REDIRECT_URI  = 'http://localhost:3456/callback';
const TOKEN_PATH    = path.join(__dirname, 'electron', 'gdrive-token.json');

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
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
    if (!parsed.pathname.startsWith('/callback')) return;

    const code = parsed.query.code;
    if (!code) {
        res.end('<h2>Lỗi: Không có code</h2>');
        return;
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
        console.log('✅ Token mới đã lưu vào:', TOKEN_PATH);
        console.log('   access_token:', tokens.access_token?.substring(0, 30) + '...');
        console.log('   refresh_token:', tokens.refresh_token ? '✅ Có' : '⚠️ Không có');

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h2>✅ Xác thực thành công! Bạn có thể đóng tab này.</h2>');
        server.close();
        console.log('\nXong! Chạy lại RELEASE.bat là được.');
    } catch (err) {
        console.error('❌ Lỗi lấy token:', err.message);
        res.end('<h2>❌ Lỗi: ' + err.message + '</h2>');
        server.close();
    }
});

server.listen(3456);
