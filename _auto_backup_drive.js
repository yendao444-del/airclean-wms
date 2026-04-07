const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');
const { backupDatabase } = require('./_backup_db');

const OAUTH_CLIENT_ID = '470025984975-s63vgvnb1ds58fmagk9iqq0f9ufhkktr.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '***REDACTED_OAUTH_SECRET***';
const TOKEN_PATH = path.join(__dirname, 'electron', 'gdrive-token.json');
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'electron', 'gdrive-credentials.json');

function createDriveCandidates() {
    const candidates = [];

    if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
        const credentials = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8'));
        if (credentials.type === 'service_account') {
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ['https://www.googleapis.com/auth/drive'],
            });
            candidates.push({
                drive: google.drive({ version: 'v3', auth }),
                authMode: 'service_account',
            });
        }
    }

    if (fs.existsSync(TOKEN_PATH)) {
        const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
        const oauth2Client = new google.auth.OAuth2(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
        oauth2Client.setCredentials(tokens);
        candidates.push({
            drive: google.drive({ version: 'v3', auth: oauth2Client }),
            authMode: 'oauth_token',
        });
    }

    if (candidates.length === 0) {
        throw new Error('Khong tim thay Google Drive credentials. Can electron/gdrive-credentials.json hoac electron/gdrive-token.json');
    }

    return candidates;
}

async function getWorkingDriveClient() {
    const candidates = createDriveCandidates();
    const errors = [];

    for (const candidate of candidates) {
        try {
            await candidate.drive.files.list({
                pageSize: 1,
                fields: 'files(id, name)',
                spaces: 'drive',
            });
            return candidate;
        } catch (err) {
            errors.push(`${candidate.authMode}: ${err.message}`);
        }
    }

    throw new Error(`Khong the xac thuc Google Drive. ${errors.join(' | ')}`);
}

async function uploadToFolder(drive, localPath, remoteName, mimeType, targetFolderId) {
    const fileSize = fs.statSync(localPath).size;
    let lastPercent = -1;

    const onUploadProgress = (evt) => {
        const percent = Math.floor((evt.bytesRead / fileSize) * 100);
        if (percent !== lastPercent && percent % 5 === 0) {
            const filled = Math.floor(percent / 5);
            const bar = '#'.repeat(filled) + '-'.repeat(20 - filled);
            process.stdout.write(`\r      [${bar}] ${percent}% (${(evt.bytesRead / 1024 / 1024).toFixed(1)}MB / ${(fileSize / 1024 / 1024).toFixed(1)}MB)`);
            lastPercent = percent;
        }
    };

    const media = { mimeType, body: fs.createReadStream(localPath) };
    await drive.files.create(
        { resource: { name: remoteName, parents: [targetFolderId] }, media, fields: 'id' },
        { onUploadProgress }
    );
    process.stdout.write('\n');
    console.log(`      OK! ${remoteName} upload xong.`);
}

async function main() {
    console.log('=========================================');
    console.log('    AIRCLEAN WMS - AUTO BACKUP (THEP)    ');
    console.log('=========================================');

    const { drive, authMode } = await getWorkingDriveClient();
    console.log(`Su dung xac thuc Google Drive: ${authMode}`);

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[new Date().getDay()];
    const bundleName = `AIRCLEAN_WMS_Backup_${dayName}.bundle`;

    console.log('\n[0/5] Backup database ra JSON...');
    let dbBackupPath = null;
    try {
        dbBackupPath = await backupDatabase(__dirname);
    } catch (err) {
        console.error('Canh bao: Backup DB that bai:', err.message);
        console.error('   Tiep tuc backup source code...');
    }

    console.log(`\n[1/5] Tao git bundle: ${bundleName}`);
    console.log('      (Chua toan bo source code + lich su commit, khong co node_modules)');

    if (fs.existsSync(bundleName)) {
        fs.unlinkSync(bundleName);
    }

    try {
        execSync(`git bundle create ${bundleName} --all`, { stdio: 'inherit' });
    } catch (err) {
        console.error('LOI: git bundle that bai!');
        process.exit(1);
    }

    const stats = fs.statSync(bundleName);
    console.log(`      OK! Kich thuoc bundle: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    console.log('\n[2/5] Kiem tra thu muc sao luu tren Google Drive...');
    let folderId = null;
    try {
        const folderRes = await drive.files.list({
            q: "name='AIRCLEAN_WMS_SOURCE_BACKUP' and mimeType='application/vnd.google-apps.folder' and trashed=false",
            spaces: 'drive',
            fields: 'files(id, name)',
        });
        if (folderRes.data.files.length > 0) {
            folderId = folderRes.data.files[0].id;
        } else {
            console.log('      Tao moi thu muc: AIRCLEAN_WMS_SOURCE_BACKUP');
            const newFolder = await drive.files.create({
                resource: { name: 'AIRCLEAN_WMS_SOURCE_BACKUP', mimeType: 'application/vnd.google-apps.folder' },
                fields: 'id',
            });
            folderId = newFolder.data.id;
        }
    } catch (err) {
        console.error('LOI API:', err.message);
        process.exit(1);
    }

    const MAX_BACKUPS = 20;
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

    console.log(`\n[3/5] Tao thu muc backup: ${dateStr}`);
    const dayFolder = await drive.files.create({
        resource: { name: dateStr, mimeType: 'application/vnd.google-apps.folder', parents: [folderId] },
        fields: 'id',
    });
    const dayFolderId = dayFolder.data.id;

    console.log('\n[4/5] Upload bundle...');
    await uploadToFolder(drive, bundleName, bundleName, 'application/octet-stream', dayFolderId);

    if (dbBackupPath && fs.existsSync(dbBackupPath)) {
        const dbFilename = path.basename(dbBackupPath);
        console.log(`\n      Upload DB backup: ${dbFilename}...`);
        await uploadToFolder(drive, dbBackupPath, dbFilename, 'application/json', dayFolderId);
    }

    console.log('\n      Kiem tra so luong backup...');
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

    if (fs.existsSync(bundleName)) {
        fs.unlinkSync(bundleName);
    }
    if (dbBackupPath && fs.existsSync(dbBackupPath)) {
        fs.unlinkSync(dbBackupPath);
    }

    console.log('\nAUTO BACKUP HOAN TAT! (Code + Database)');
}

main().catch((err) => {
    console.error('LOI:', err.message);
    process.exit(1);
});
