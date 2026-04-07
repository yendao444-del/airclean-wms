const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

async function testAuth() {
    const p = path.join(__dirname, 'electron', 'gdrive-credentials.json');
    console.log("Reading from:", p);
    const credentials = JSON.parse(fs.readFileSync(p, 'utf-8'));
    console.log("Email:", credentials.client_email);
    console.log("Includes \\n?:", credentials.private_key.includes('\n'));
    console.log("Includes \\r\\n?:", credentials.private_key.includes('\r\n'));

    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive'],
    });

    const drive = google.drive({ version: 'v3', auth });

    try {
        console.log("Requesting files list...");
        const res = await drive.files.list({
            pageSize: 1,
            fields: 'files(id, name)',
            spaces: 'drive',
        });
        console.log("Success! Files found:", res.data.files.length);
    } catch (err) {
        console.error("Error:", err.message);
    }
}
testAuth();
