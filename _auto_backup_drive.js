const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { google } = require('googleapis');

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
    
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    const oauth2Client = new google.auth.OAuth2(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
    oauth2Client.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[new Date().getDay()];
    const zipName = `AIRCLEAN_WMS_Backup_${dayName}.zip`;

    console.log(`\n[1/3] Dang nen Source Code bang archiver thanh: ${zipName}`);
    console.log("      (Tu dong loai bo dist, node_modules, .git, release4...)");
    
    if (fs.existsSync(zipName)) fs.unlinkSync(zipName);

    // ZIP CREATION WITH ARCHIVER
    await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipName);
        const archive = archiver('zip', {
            zlib: { level: 9 } // Muc do nen toi da
        });

        output.on('close', function() {
            console.log(`      ✅ Xong! Do lon ZIP: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`);
            resolve();
        });

        archive.on('error', function(err) {
            reject(err);
        });

        archive.pipe(output);

        // Append all files except ignored heavy folders
        archive.glob('**/*', {
            cwd: __dirname,
            ignore: ['node_modules/**', 'dist/**', 'release4/**', '.git/**', '_patch_temp/**', zipName]
        });

        archive.finalize();
    });

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

    console.log(`\n[3/3] Tai file ZIP len Drive vao thu muc vua roi...`);
    const fileRes = await drive.files.list({
        q: `name='${zipName}' and '${folderId}' in parents and trashed=false`,
        spaces: 'drive',
    });

    const fileMetadata = { name: zipName, parents: [folderId] };
    const media = { mimeType: 'application/zip', body: fs.createReadStream(zipName) };

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
    
    // Clean up
    if (fs.existsSync(zipName)) fs.unlinkSync(zipName);
    console.log("\n✅ AUTO BACKUP HOAN TAT. Da xoa file zip tam tren may.");
}

main();
