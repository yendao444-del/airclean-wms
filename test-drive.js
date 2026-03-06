const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { Readable } = require('stream');

const OAUTH_CLIENT_ID = '470025984975-s63vgvnb1ds58fmagk9iqq0f9ufhkktr.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '***REDACTED_OAUTH_SECRET***';
const FOLDER_ID = '1pEblyEPQjwluSEHIAS-kOkSohrw_Efsv';
const TG_TOKEN = '***REDACTED_TELEGRAM_TOKEN***';
const TG_CHAT = '1397184795';

async function test() {
    const imgPath = 'c:\\Users\\NCPC\\Downloads\\unnamed.jpg';
    if (!fs.existsSync(imgPath)) {
        console.error('File not found:', imgPath);
        return;
    }
    const fileBuffer = fs.readFileSync(imgPath);
    console.log(`📷 File: ${imgPath} (${fileBuffer.length} bytes)`);

    // === 1. GOOGLE DRIVE ===
    console.log('\n--- GOOGLE DRIVE ---');
    const tokenPath = path.join(__dirname, 'electron', 'gdrive-token.json');
    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
    const oauth2 = new google.auth.OAuth2(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
    oauth2.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: oauth2 });

    const stream = new Readable();
    stream.push(fileBuffer);
    stream.push(null);

    const driveFile = await drive.files.create({
        requestBody: { name: 'test-upload-unnamed.jpg', parents: [FOLDER_ID] },
        media: { mimeType: 'image/jpeg', body: stream },
        fields: 'id, webViewLink',
    });
    console.log('✅ Drive upload OK!');
    console.log('   ID:', driveFile.data.id);
    console.log('   Link:', driveFile.data.webViewLink);

    // === 2. TELEGRAM ===
    console.log('\n--- TELEGRAM ---');
    await new Promise((resolve) => {
        const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
        const parts = [];
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TG_CHAT}`);
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n🧪 TEST: Upload ảnh unnamed.jpg\n📅 ${new Date().toLocaleString('vi-VN')}\n☁️ Drive: ${driveFile.data.webViewLink}`);
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="unnamed.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`);

        const header = Buffer.from(parts.join('\r\n') + '\r\n', 'utf-8');
        const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
        const body = Buffer.concat([header, fileBuffer, footer]);

        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TG_TOKEN}/sendDocument`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
            },
            timeout: 30000,
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    console.log('✅ Telegram sent OK!');
                } else {
                    console.error('❌ Telegram error:', res.statusCode, data.substring(0, 300));
                }
                resolve();
            });
        });
        req.on('error', e => { console.error('❌ Telegram error:', e.message); resolve(); });
        req.write(body);
        req.end();
    });

    console.log('\n🎉 ALL DONE!');
}

test().catch(e => console.error('❌ ERROR:', e.message));
