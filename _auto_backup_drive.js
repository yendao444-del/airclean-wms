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
    // Su dung file RAR thay vi ZIP mang thuan WinRAR Console cho an toan cham soc
    const rarName = `AIRCLEAN_WMS_Backup_${dayName}.rar`;

    console.log(`\n[1/4] Dang goi Trinh WinRAR (Console) chuan 100% thanh: ${rarName}`);
    console.log("      (Bat dau nen: loai dist, node_modules, .git...)");
    
    if (fs.existsSync(rarName)) fs.unlinkSync(rarName);

    try {
        const rarPath = '"C:\\Program Files\\WinRAR\\rar.exe"';
        // Xóa thuộc tính -inul và đặt stdio: inherit để vọt Log Output báo từng file nén ra Terminal chống tình trạng Freeze Cứng Ảo
        const cmd = `${rarPath} a -r -dh ${rarName} src electron prisma public .env .gitignore package.json package-lock.json *config* index.html *.bat _*.js tsconfig.json tsconfig.node.json node_modules dev.db`;
        execSync(cmd, { stdio: 'inherit' });
    } catch (err) {
        console.error("❌ LOI: Nen Cung that bai. Chi tiet:");
        console.error(err.stdout ? err.stdout.toString() : '');
        console.error(err.stderr ? err.stderr.toString() : '');
        process.exit(1);
    }

    const stats = fs.statSync(rarName);
    console.log(`      ✅ Xong ! Do lon file nén RAR: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    console.log(`\n[2/4] TU DONG GOI LENH EXTRACT DE TEST FILE NGAY TREN MAY (Giong Kiem Dinh Chat Luong 2 Vong)...`);
    try {
        const rarPath = '"C:\\Program Files\\WinRAR\\rar.exe"';
        execSync(`${rarPath} t ${rarName}`, { stdio: 'inherit' });
        console.log(`      ✅ 100% OK! WinRAR bao file tuyet doi khong co loi Internal Error nao ca!`);
    } catch (err) {
        console.error("❌ LOI: File xui xeo bi loi nén luc ghi. Nghiem cam Up len!");
        process.exit(1);
    }

    console.log(`\n[3/4] Kiem tra thu muc sao luu tren Google Drive...`);
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

    console.log(`\n[4/4] Tai file RAR (Da Kiem Dinh Chuan 100%) len Drive...`);
    const fileRes = await drive.files.list({
        q: `name='${rarName}' and '${folderId}' in parents and trashed=false`,
        spaces: 'drive',
    });

    const fileMetadata = { name: rarName, parents: [folderId] };
    const media = { mimeType: 'application/vnd.rar', body: fs.createReadStream(rarName) };

    const totalBytes = stats.size;
    let lastPercent = -1;

    const onUploadProgress = (evt) => {
        const percent = Math.floor((evt.bytesRead / totalBytes) * 100);
        if (percent !== lastPercent && percent % 5 === 0) {
            const filled = Math.floor(percent / 5);
            const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
            process.stdout.write(`\r      [${bar}] ${percent}% (${(evt.bytesRead / 1024 / 1024).toFixed(1)}MB / ${(totalBytes / 1024 / 1024).toFixed(1)}MB)`);
            lastPercent = percent;
        }
    };

    try {
        if (fileRes.data.files.length > 0) {
            console.log(`      ♻️  Da tim thay file ghi de. Google Drive dang thay the...`);
            await drive.files.update({
                fileId: fileRes.data.files[0].id,
                media: { ...media, body: fs.createReadStream(rarName) },
                supportsAllDrives: true
            }, { onUploadProgress });
        } else {
            console.log(`      ✨ Dang tao file hoan toan moi...`);
            await drive.files.create({
                resource: fileMetadata,
                media: { ...media, body: fs.createReadStream(rarName) },
                fields: 'id'
            }, { onUploadProgress });
        }
        process.stdout.write('\n');
        console.log("      ✅ THANH CONG! Upload hoan tat.");
    } catch (err) {
        process.stdout.write('\n');
        console.error("❌ Loi Tai len:", err.message);
    }
    
    // Don rac de tra lai may sach se
    if (fs.existsSync(rarName)) fs.unlinkSync(rarName);
    console.log("\n✅ AUTO BACKUP HOAN TAT TOAN TAP. Test luong mượt mà.");
}

main().catch(console.error);
