const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OAUTH_CLIENT_ID = '470025984975-s63vgvnb1ds58fmagk9iqq0f9ufhkktr.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '***REDACTED_OAUTH_SECRET***';
const TOKEN_PATH = path.join(__dirname, 'electron', 'gdrive-token.json');

async function main() {
    console.log("=========================================");
    console.log("    AIRCLEAN WMS - AUTO BACKUP DRIVE     ");
    console.log("=========================================");

    if (!fs.existsSync(TOKEN_PATH)) {
        console.error("❌ LOI: Khong tim thay gdrive-token.json (Chua co key dang nhap GDrive).");
        process.exit(1);
    }
    
    // Lazy load googleapis
    const { google } = require('googleapis');
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    const oauth2Client = new google.auth.OAuth2(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
    oauth2Client.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[new Date().getDay()];
    const rarName = `AIRCLEAN_WMS_Backup_${dayName}.rar`;

    console.log(`\n[1/3] Dang nen Source Code thanh: ${rarName}`);
    console.log("      (Tu dong loai bo dist, node_modules, .git, release4...)");
    
    if (fs.existsSync(rarName)) fs.unlinkSync(rarName);

    try {
        const rarPath = '"C:\\Program Files\\WinRAR\\rar.exe"';
        // -r -> Đưa cả thư mục con vào 
        // -x -> Loại trừ
        const cmd = `${rarPath} a -r -x*\\node_modules\\* -x*\\dist\\* -x*\\release4\\* -x*\\.git\\* -x*\\_patch_temp\\* ${rarName} *`;
        execSync(cmd, { stdio: 'pipe' });
    } catch (err) {
        console.error("❌ LOI: Nen RAR that bai. Chi tiet loi WinRAR: ", err.message);
        console.error(err.stdout ? err.stdout.toString() : '');
        console.error(err.stderr ? err.stderr.toString() : '');
        process.exit(1);
    }

    const stats = fs.statSync(rarName);
    console.log(`      ✅ Xong! Do lon file nén: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

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

    console.log(`\n[3/3] Tai file RAR len Drive vao thu muc vua roi...`);
    const fileRes = await drive.files.list({
        // Chi tim trong folder nay
        q: `name='${rarName}' and '${folderId}' in parents and trashed=false`,
        spaces: 'drive',
    });

    const fileMetadata = { name: rarName, parents: [folderId] };
    const media = { mimeType: 'application/vnd.rar', body: fs.createReadStream(rarName) };

    try {
        if (fileRes.data.files.length > 0) {
            console.log(`      ♻️  Da tim thay file ghi de. Google Drive dang tich hop thay the...`);
            await drive.files.update({
                fileId: fileRes.data.files[0].id,
                media: media,
                supportsAllDrives: true
            });
        } else {
            console.log(`      ✨ Dang tao file hoan toan moi...`);
            await drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id'
            });
        }
        console.log("      ✅ THANH CONG! DUYET!");
    } catch (err) {
        console.error("❌ Lỗi Tải lên:", err.message);
    }
    
    // Don rac
    if (fs.existsSync(rarName)) fs.unlinkSync(rarName);
    console.log("\n✅ AUTO BACKUP HOAN TAT. Da xoa file nén tam tren may.");
}

main();
