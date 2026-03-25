const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');

const OAUTH_CLIENT_ID = '470025984975-s63vgvnb1ds58fmagk9iqq0f9ufhkktr.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '***REDACTED_OAUTH_SECRET***';
const TOKEN_PATH = path.join(__dirname, 'electron', 'gdrive-token.json');

async function main() {
    console.log("=========================================");
    console.log("    AIRCLEAN WMS - AUTO BACKUP (THEP)    ");
    console.log("=========================================");

    if (!fs.existsSync(TOKEN_PATH)) {
        console.error("❌ LOI: Khong tim thay gdrive-token.json (Chua co key dang nhap GDrive).");
        process.exit(1);
    }
    
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    const oauth2Client = new google.auth.OAuth2(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
    oauth2Client.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[new Date().getDay()];
    const bundleName = `AIRCLEAN_WMS_Backup_${dayName}.bundle`;

    console.log(`\n[1/3] Tao git bundle: ${bundleName}`);
    console.log("      (Chua toan bo source code + lich su commit, khong co node_modules)");

    if (fs.existsSync(bundleName)) fs.unlinkSync(bundleName);

    try {
        execSync(`git bundle create ${bundleName} --all`, { stdio: 'inherit' });
    } catch (err) {
        console.error("LOI: git bundle that bai!");
        process.exit(1);
    }

    const stats = fs.statSync(bundleName);
    console.log(`      OK! Kich thuoc bundle: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    console.log(`\n[2/3] Kiem tra thu muc sao luu tren Google Drive...`);
    let folderId = null;
    try {
        const folderRes = await drive.files.list({
            q: "name='AIRCLEAN_WMS_SOURCE_BACKUP' and mimeType='application/vnd.google-apps.folder' and trashed=false",
            spaces: 'drive',
        });
        if (folderRes.data.files.length > 0) {
            folderId = folderRes.data.files[0].id;
        } else {
            console.log("      Tao moi thu muc: AIRCLEAN_WMS_SOURCE_BACKUP");
            const newFolder = await drive.files.create({
                resource: { name: 'AIRCLEAN_WMS_SOURCE_BACKUP', mimeType: 'application/vnd.google-apps.folder' },
                fields: 'id'
            });
            folderId = newFolder.data.id;
        }
    } catch (err) {
        console.error("❌ LOI API:", err.message);
        process.exit(1);
    }

    const uploadFile = async (localPath, remoteName, mimeType) => {
        const fileSize = fs.statSync(localPath).size;
        let lastPercent = -1;
        const onUploadProgress = (evt) => {
            const percent = Math.floor((evt.bytesRead / fileSize) * 100);
            if (percent !== lastPercent && percent % 5 === 0) {
                const filled = Math.floor(percent / 5);
                const bar = '#'.repeat(filled) + '-'.repeat(20 - filled);
                process.stdout.write(`\r      [${bar}] ${percent}% (${(evt.bytesRead/1024/1024).toFixed(1)}MB / ${(fileSize/1024/1024).toFixed(1)}MB)`);
                lastPercent = percent;
            }
        };
        const existing = await drive.files.list({
            q: `name='${remoteName}' and '${folderId}' in parents and trashed=false`,
            spaces: 'drive',
        });
        const media = { mimeType, body: fs.createReadStream(localPath) };
        try {
            if (existing.data.files.length > 0) {
                console.log(`      Ghi de: ${remoteName}`);
                await drive.files.update({ fileId: existing.data.files[0].id, media, supportsAllDrives: true }, { onUploadProgress });
            } else {
                console.log(`      Tao moi: ${remoteName}`);
                await drive.files.create({ resource: { name: remoteName, parents: [folderId] }, media, fields: 'id' }, { onUploadProgress });
            }
            process.stdout.write('\n');
            console.log(`      OK! ${remoteName} upload xong.`);
        } catch (err) {
            process.stdout.write('\n');
            console.error(`LOI upload ${remoteName}:`, err.message);
        }
    };

    console.log(`\n[3/4] Upload bundle len Google Drive...`);
    await uploadFile(bundleName, bundleName, 'application/octet-stream');

    console.log(`\n[4/4] Upload RESTORE.bat len Google Drive...`);
    const restoreBat = path.join(__dirname, 'RESTORE.bat');
    await uploadFile(restoreBat, 'RESTORE.bat', 'text/plain');

    // Don rac
    if (fs.existsSync(bundleName)) fs.unlinkSync(bundleName);
    console.log("\nAUTO BACKUP HOAN TAT! Drive co du: bundle + RESTORE.bat");
}

main().catch(console.error);
