const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');
const { backupDatabase } = require('./_backup_db');

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

    // === BƯỚC 0: Backup Database → JSON ===
    console.log(`\n[0/5] Backup database ra JSON...`);
    let dbBackupPath = null;
    try {
        dbBackupPath = await backupDatabase(__dirname);
    } catch (err) {
        console.error('⚠️  CẢNH BÁO: Backup DB thất bại:', err.message);
        console.error('   Tiếp tục backup source code...');
    }

    console.log(`\n[1/5] Tao git bundle: ${bundleName}`);
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

    console.log(`\n[2/5] Kiem tra thu muc sao luu tren Google Drive...`);
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

    const MAX_BACKUPS = 20;
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;

    // Tao subfolder theo ngay: AIRCLEAN_WMS_SOURCE_BACKUP/2026-03-25_2010/
    console.log(`\n[3/5] Tao thu muc backup: ${dateStr}`);
    const dayFolder = await drive.files.create({
        resource: { name: dateStr, mimeType: 'application/vnd.google-apps.folder', parents: [folderId] },
        fields: 'id'
    });
    const dayFolderId = dayFolder.data.id;

    // Upload file vao subfolder
    const uploadToFolder = async (localPath, remoteName, mimeType, targetFolderId) => {
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
        const media = { mimeType, body: fs.createReadStream(localPath) };
        await drive.files.create({ resource: { name: remoteName, parents: [targetFolderId] }, media, fields: 'id' }, { onUploadProgress });
        process.stdout.write('\n');
        console.log(`      OK! ${remoteName} upload xong.`);
    };

    console.log(`\n[4/5] Upload bundle...`);
    await uploadToFolder(bundleName, bundleName, 'application/octet-stream', dayFolderId);

    if (dbBackupPath && fs.existsSync(dbBackupPath)) {
        const dbFilename = path.basename(dbBackupPath);
        console.log(`\n      Upload DB backup: ${dbFilename}...`);
        await uploadToFolder(dbBackupPath, dbFilename, 'application/json', dayFolderId);
    }

    console.log(`\n[5/5] Upload restore scripts...`);
    const filesToUpload = [
        'RESTORE.bat',
        'RESTORE_DATABASE.bat',
        '_restore_db.js',
        '_backup_db.js',
    ];
    for (const fname of filesToUpload) {
        const fpath = path.join(__dirname, fname);
        if (fs.existsSync(fpath)) {
            await uploadToFolder(fpath, fname, 'text/plain', dayFolderId);
        }
    }

    // Xoa ban cu neu qua 20 ban
    console.log(`\n      Kiem tra so luong backup...`);
    const allFolders = await drive.files.list({
        q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        orderBy: 'createdTime asc',
        fields: 'files(id, name)',
        spaces: 'drive',
    });
    const folders = allFolders.data.files;
    if (folders.length > MAX_BACKUPS) {
        const toDelete = folders.slice(0, folders.length - MAX_BACKUPS);
        for (const f of toDelete) {
            await drive.files.delete({ fileId: f.id });
            console.log(`      Xoa ban cu: ${f.name}`);
        }
    }
    console.log(`      Hien co ${Math.min(folders.length, MAX_BACKUPS)} / ${MAX_BACKUPS} ban backup.`);

    // Don rac
    if (fs.existsSync(bundleName)) fs.unlinkSync(bundleName);
    if (dbBackupPath && fs.existsSync(dbBackupPath)) fs.unlinkSync(dbBackupPath);
    console.log("\nAUTO BACKUP HOAN TAT! (Code + Database)");
}

main().catch(console.error);
