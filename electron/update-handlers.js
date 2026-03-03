// ========================================
// AUTO UPDATE - GITHUB RELEASES
// ========================================

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app, ipcMain, shell } = require('electron');

// Prisma được truyền vào từ ipc-handlers.js
let prisma = null;
module.exports = function(prismaInstance) {
    prisma = prismaInstance;
};

// GitHub repository info
const GITHUB_OWNER = 'yendao444-del';
const GITHUB_REPO = 'airclean-wms';

/**
 * Kiểm tra phiên bản mới nhất từ GitHub Releases
 */
ipcMain.handle('update:check', async () => {
    try {
        console.log('🔍 Checking for updates from GitHub...');

        // Lấy version hiện tại từ package.json
        const packageJson = require('../package.json');
        const currentVersion = packageJson.version;

        console.log(`   Current version: v${currentVersion}`);

        // Gọi GitHub API để lấy latest release
        const latestRelease = await fetchLatestRelease();

        if (!latestRelease) {
            return {
                success: false,
                error: 'Không thể kết nối đến GitHub'
            };
        }

        const latestVersion = latestRelease.tag_name.replace('v', ''); // "v1.0.9" -> "1.0.9"
        const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

        console.log(`   Latest version: v${latestVersion}`);
        console.log(`   Has update: ${hasUpdate}`);

        // Lấy thông tin download
        const zipAsset = latestRelease.assets.find(asset =>
            asset.name.endsWith('.zip') && asset.name.includes('QuanLyPOS')
        );

        const updateInfo = {
            currentVersion,
            latestVersion,
            hasUpdate,
            releaseNotes: latestRelease.body || 'Không có ghi chú',
            publishedAt: latestRelease.published_at,
            downloadUrl: zipAsset ? zipAsset.browser_download_url : null,
            downloadSize: zipAsset ? zipAsset.size : 0
        };

        return { success: true, data: updateInfo };

    } catch (error) {
        console.error('❌ Error checking update:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
});

// Cache để tránh bị rate limit
let releaseCache = null;
let releaseCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 phút

/**
 * Fetch latest release từ GitHub API
 */
function fetchLatestRelease() {
    // Trả cache nếu còn hạn
    if (releaseCache && (Date.now() - releaseCacheTime < CACHE_DURATION)) {
        console.log('   Using cached release data');
        return Promise.resolve(releaseCache);
    }

    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
            method: 'GET',
            headers: {
                'User-Agent': 'QuanLyPOS-Desktop-App',
                'Accept': 'application/vnd.github.v3+json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const release = JSON.parse(data);
                        // Lưu cache
                        releaseCache = release;
                        releaseCacheTime = Date.now();
                        resolve(release);
                    } catch (err) {
                        reject(new Error('Invalid JSON response'));
                    }
                } else if (res.statusCode === 404) {
                    reject(new Error('Không tìm thấy release nào. Kiểm tra repo có public và có release không.'));
                } else if (res.statusCode === 403) {
                    reject(new Error('GitHub API bị giới hạn (rate limit). Vui lòng thử lại sau vài phút.'));
                } else {
                    reject(new Error(`GitHub API lỗi: ${res.statusCode}`));
                }
            });
        });

        req.on('error', (err) => {
            reject(new Error(`Lỗi kết nối mạng: ${err.message}`));
        });

        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('Hết thời gian kết nối. Kiểm tra mạng internet.'));
        });

        req.end();
    });
}

/**
 * So sánh 2 version strings (semantic versioning)
 * @returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const num1 = parts1[i] || 0;
        const num2 = parts2[i] || 0;

        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }

    return 0;
}

/**
 * Download file với hỗ trợ redirect (GitHub dùng 302)
 */
function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        const makeRequest = (currentUrl, redirectCount = 0) => {
            if (redirectCount > 10) {
                reject(new Error('Quá nhiều redirect'));
                return;
            }

            const protocol = currentUrl.startsWith('https') ? https : http;

            protocol.get(currentUrl, {
                headers: { 'User-Agent': 'QuanLyPOS-Desktop-App' }
            }, (res) => {
                // Handle redirects
                if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
                    const redirectUrl = res.headers.location;
                    console.log(`   ↪ Redirect ${redirectCount + 1}`);
                    makeRequest(redirectUrl, redirectCount + 1);
                    return;
                }

                if (res.statusCode !== 200) {
                    reject(new Error(`Download thất bại: HTTP ${res.statusCode}`));
                    return;
                }

                const totalBytes = parseInt(res.headers['content-length'], 10);
                let downloadedBytes = 0;
                let lastPercent = -1;

                const file = fs.createWriteStream(destPath);

                res.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    if (onProgress && totalBytes) {
                        const percent = Math.round((downloadedBytes / totalBytes) * 100);
                        if (percent !== lastPercent && percent % 5 === 0) {
                            lastPercent = percent;
                            onProgress(downloadedBytes, totalBytes, percent);
                        }
                    }
                });

                res.pipe(file);

                file.on('finish', () => {
                    file.close(() => resolve(destPath));
                });

                file.on('error', (err) => {
                    fs.unlink(destPath, () => { });
                    reject(err);
                });
            }).on('error', (err) => {
                reject(new Error(`Lỗi kết nối: ${err.message}`));
            });
        };

        makeRequest(url);
    });
}

/**
 * Download + cài đặt bản cập nhật tự động
 */
ipcMain.handle('update:download', async (event, downloadUrl) => {
    try {
        console.log('📥 ========================================');
        console.log('📥 BẮT ĐẦU CẬP NHẬT TỰ ĐỘNG');
        console.log('📥 ========================================');
        console.log('   URL:', downloadUrl);

        // 1. Tạo thư mục tạm
        const tempDir = path.join(os.tmpdir(), `QuanLyPOS-update-${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });

        const zipPath = path.join(tempDir, 'update.zip');
        const extractDir = path.join(tempDir, 'extracted');

        console.log('📁 Thư mục tạm:', tempDir);

        // 2. Tải file ZIP từ GitHub
        console.log('⬇️  Đang tải bản cập nhật...');

        await downloadFile(downloadUrl, zipPath, (downloaded, total, percent) => {
            const dlMB = (downloaded / 1024 / 1024).toFixed(1);
            const totalMB = (total / 1024 / 1024).toFixed(1);
            console.log(`   ⏳ ${percent}% (${dlMB}/${totalMB} MB)`);
        });

        const zipStats = fs.statSync(zipPath);
        console.log(`✅ Tải xong: ${(zipStats.size / 1024 / 1024).toFixed(1)} MB`);

        // 3. Giải nén ZIP
        console.log('📦 Đang giải nén...');
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(zipPath);
        fs.mkdirSync(extractDir, { recursive: true });
        zip.extractAllTo(extractDir, true);
        console.log('✅ Giải nén xong');

        // 4. Xác định thư mục gốc ứng dụng
        //    ZIP chứa nội dung của win-unpacked/ (QuanLyPOS.exe, resources/, ...)
        //    → cần copy vào thư mục chứa QuanLyPOS.exe
        const appRoot = path.dirname(process.execPath);
        console.log('📂 App install dir:', appRoot);
        console.log('📂 __dirname:', __dirname);
        console.log('📂 execPath:', process.execPath);

        // 5. Tìm thư mục nội dung thực trong ZIP
        //    (ZIP có thể chứa 1 folder cấp cao hoặc files trực tiếp)
        let sourceDir = extractDir;
        const extractedItems = fs.readdirSync(extractDir);
        if (extractedItems.length === 1) {
            const singleItem = path.join(extractDir, extractedItems[0]);
            if (fs.statSync(singleItem).isDirectory()) {
                if (fs.existsSync(path.join(singleItem, 'package.json'))) {
                    sourceDir = singleItem;
                }
            }
        }

        console.log('📂 Nguồn:', sourceDir);
        console.log('📂 Đích: ', appRoot);

        // 6. Đọc version mới
        //    Trong ZIP, package.json nằm tại resources/app/package.json
        let newVersion = 'unknown';
        const pkgPaths = [
            path.join(sourceDir, 'resources', 'app', 'package.json'),
            path.join(sourceDir, 'package.json')
        ];
        for (const pkgPath of pkgPaths) {
            if (fs.existsSync(pkgPath)) {
                try {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                    newVersion = pkg.version || 'unknown';
                    console.log('📦 Tìm thấy package.json tại:', pkgPath);
                    break;
                } catch (e) { }
            }
        }
        console.log('🏷️  Version mới:', newVersion);

        // 7. Tạo script cập nhật (.bat)
        //    Script chạy sau khi app đóng: copy files mới → khởi động lại
        const batPath = path.join(tempDir, 'update.bat');
        const exePath = process.execPath;

        const batContent = `@echo off
chcp 65001 >nul
title QuanLyPOS - Cap nhat v${newVersion}
echo.
echo ========================================
echo   QuanLyPOS - Dang cap nhat v${newVersion}
echo ========================================
echo.
echo [1/4] Doi ung dung dong...
timeout /t 3 /nobreak >nul
echo [2/4] Dang cap nhat files...
xcopy "${sourceDir.replace(/\\/g, '\\')}\\*" "${appRoot.replace(/\\/g, '\\')}\\" /E /Y /I /Q >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo LOI: Khong the cap nhat files!
    echo Vui long thu lai hoac cap nhat thu cong.
    pause
    exit /b 1
)
echo [3/4] Cap nhat thanh cong!
echo.
echo ========================================
echo   Da cap nhat len v${newVersion}
echo ========================================
echo.
echo [4/4] Dang khoi dong lai...
timeout /t 2 /nobreak >nul
start "" "${exePath.replace(/\\/g, '\\')}"
timeout /t 10 /nobreak >nul
rmdir /S /Q "${tempDir.replace(/\\/g, '\\')}" 2>nul
exit
`;

        fs.writeFileSync(batPath, batContent);
        console.log('📝 Tạo script cập nhật:', batPath);

        // 8. Chạy script cập nhật (chạy độc lập, tách khỏi process chính)
        console.log('🚀 Chạy script cập nhật...');
        const { spawn } = require('child_process');
        const child = spawn('cmd.exe', ['/c', 'start', '""', batPath], {
            detached: true,
            stdio: 'ignore',
            shell: true
        });
        child.unref();

        // Trả kết quả cho frontend trước khi thoát
        const result = {
            success: true,
            data: {
                version: newVersion,
                message: `Đang cập nhật lên v${newVersion}...`
            }
        };

        // 9. Lưu lịch sử cập nhật vào DB
        try {
            const packageJson = require('../package.json');
            if (prisma) {
                await prisma.updateHistory.create({
                    data: {
                        fromVersion: packageJson.version,
                        toVersion: newVersion,
                        machine: os.hostname(),
                        notes: `Cập nhật từ v${packageJson.version} lên v${newVersion}`
                    }
                });
                console.log('✅ Đã lưu lịch sử cập nhật vào DB');
            }
        } catch (histErr) {
            console.warn('⚠️ Không thể lưu lịch sử cập nhật:', histErr.message);
        }

        // 10. Thoát app sau 2 giây (đợi IPC response gửi xong)
        setTimeout(() => {
            console.log('👋 Đóng ứng dụng để cập nhật...');
            app.quit();
        }, 2000);

        return result;

    } catch (error) {
        console.error('❌ Lỗi cập nhật tự động:', error);
        console.error('   Stack:', error.stack);
        return { success: false, error: error.message };
    }
});

/**
 * Get current version
 */
ipcMain.handle('update:getCurrentVersion', async () => {
    try {
        const packageJson = require('../package.json');
        return { success: true, data: packageJson.version };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

/**
 * Restart app
 */
ipcMain.handle('update:restart', async () => {
    app.relaunch();
    app.exit(0);
});

/**
 * Get update history
 */
ipcMain.handle('update:getHistory', async () => {
    try {
        if (!prisma) return { success: true, data: [] };
        const history = await prisma.updateHistory.findMany({
            orderBy: { updatedAt: 'desc' },
            take: 20
        });
        return { success: true, data: history };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

