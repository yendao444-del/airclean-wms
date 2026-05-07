// ========================================
// AUTO UPDATE - GITHUB RELEASES
// ========================================

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { app, ipcMain, shell, BrowserWindow } = require('electron');

/**
 * Gửi event tới tất cả renderer windows
 */
function sendToRenderer(channel, data) {
    try {
        const wins = BrowserWindow.getAllWindows();
        wins.forEach(win => {
            if (win && win.webContents && !win.isDestroyed()) {
                win.webContents.send(channel, data);
            }
        });
    } catch (e) { }
}

// Prisma được truyền vào từ ipc-handlers.js
let prisma = null;
let requireRoleGuard = null;
module.exports = function (prismaInstance, options = {}) {
    prisma = prismaInstance;
    requireRoleGuard = typeof options.requireRole === 'function' ? options.requireRole : null;
};

function requireUpdateAdmin() {
    if (!requireRoleGuard) {
        throw new Error('Không thể xác thực quyền admin cho cập nhật');
    }
    requireRoleGuard('admin');
}

// GitHub repository info
const GITHUB_OWNER = 'yendao444-del';
const GITHUB_REPO = 'airclean-wms';
const GITHUB_RELEASE_HOST = 'github.com';

function isTrustedGitHubDownloadUrl(downloadUrl) {
    try {
        const parsed = new URL(downloadUrl);
        return parsed.protocol === 'https:' &&
            parsed.hostname === GITHUB_RELEASE_HOST &&
            parsed.pathname.includes(`/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/`);
    } catch {
        return false;
    }
}

function getTrustedZipAssets(release) {
    return (release?.assets || []).filter(asset =>
        asset &&
        typeof asset.name === 'string' &&
        asset.name.toLowerCase().endsWith('.zip') &&
        typeof asset.browser_download_url === 'string' &&
        isTrustedGitHubDownloadUrl(asset.browser_download_url)
    );
}

function pickPreferredZipAsset(release) {
    const allZips = getTrustedZipAssets(release);
    const patchZip = allZips.find(a => a.name.toUpperCase().includes('PATCH'));
    const fullZip = allZips.find(a => a.name.toUpperCase().includes('DBYPOS') || a.name.toUpperCase().includes('DBY'));
    return patchZip || fullZip || allZips[0] || null;
}

function findSha256Asset(release, zipAsset) {
    const candidates = release?.assets || [];
    const expectedNames = [
        `${zipAsset.name}.sha256`,
        `${zipAsset.name}.sha256sum`,
        `${zipAsset.name}.sha256.txt`,
        'SHA256SUMS',
        'sha256sums.txt'
    ].map(name => name.toLowerCase());
    return candidates.find(asset =>
        asset &&
        typeof asset.name === 'string' &&
        typeof asset.browser_download_url === 'string' &&
        isTrustedGitHubDownloadUrl(asset.browser_download_url) &&
        expectedNames.includes(asset.name.toLowerCase())
    ) || null;
}

async function assertTrustedDownloadUrl(downloadUrl) {
    let parsed;
    try {
        parsed = new URL(downloadUrl);
    } catch {
        throw new Error('URL cập nhật không hợp lệ');
    }

    if (parsed.protocol !== 'https:') {
        throw new Error('URL cập nhật phải dùng HTTPS');
    }
    if (parsed.hostname !== GITHUB_RELEASE_HOST) {
        throw new Error('URL cập nhật phải là GitHub release asset chính thức');
    }

    const release = await fetchLatestRelease();
    const assets = getTrustedZipAssets(release);
    const asset = assets.find(a => a.browser_download_url === downloadUrl);
    if (!asset) {
        throw new Error('URL cập nhật không khớp asset ZIP của latest GitHub release');
    }
    return { asset, checksumAsset: findSha256Asset(release, asset) };
}

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

        // Lấy thông tin download - ưu tiên PATCH zip (nhỏ ~4MB), fallback FULL zip
        const allZips = getTrustedZipAssets(latestRelease);
        const zipAsset = pickPreferredZipAsset(latestRelease);
        console.log(`   Available zips: ${allZips.map(a => a.name).join(', ') || 'NONE'}`);
        console.log(`   Selected zip: ${zipAsset ? zipAsset.name : 'NULL'}`);

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
                'User-Agent': 'DBYPOS-Desktop-App',
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
 * Fetch release theo tag để khôi phục một phiên bản cụ thể từ GitHub.
 */
function fetchReleaseByTag(version) {
    const normalizedVersion = String(version || '').trim().replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalizedVersion)) {
        return Promise.reject(new Error('Phiên bản khôi phục không hợp lệ'));
    }

    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/v${normalizedVersion}`,
            method: 'GET',
            headers: {
                'User-Agent': 'DBYPOS-Desktop-App',
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
                        resolve(JSON.parse(data));
                    } catch (err) {
                        reject(new Error('Invalid JSON response'));
                    }
                } else if (res.statusCode === 404) {
                    reject(new Error(`Không tìm thấy release v${normalizedVersion} trên GitHub`));
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
 * Đếm số files trong thư mục (đệ quy)
 */
function countFiles(dir) {
    let count = 0;
    if (!fs.existsSync(dir)) return 0;
    const items = fs.readdirSync(dir);
    for (const item of items) {
        const fullPath = path.join(dir, item);
        if (fs.statSync(fullPath).isDirectory()) {
            count += countFiles(fullPath);
        } else {
            count++;
        }
    }
    return count;
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

            let parsedUrl;
            try {
                parsedUrl = new URL(currentUrl);
            } catch {
                reject(new Error('URL tải cập nhật không hợp lệ'));
                return;
            }
            if (parsedUrl.protocol !== 'https:') {
                reject(new Error('Không cho phép tải cập nhật qua HTTP'));
                return;
            }

            https.get(parsedUrl, {
                headers: { 'User-Agent': 'DBYPOS-Desktop-App' }
            }, (res) => {
                // Handle redirects
                if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
                    if (!res.headers.location) {
                        reject(new Error('Redirect cập nhật thiếu Location header'));
                        return;
                    }
                    const redirectUrl = new URL(res.headers.location, parsedUrl).toString();
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

function downloadText(url) {
    return new Promise((resolve, reject) => {
        downloadFile(url, path.join(os.tmpdir(), `DBYPOS-checksum-${Date.now()}.txt`), null)
            .then(filePath => {
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    fs.rmSync(filePath, { force: true });
                    resolve(content);
                } catch (err) {
                    reject(err);
                }
            })
            .catch(reject);
    });
}

function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

async function verifyChecksumIfAvailable(zipPath, zipAsset, checksumAsset) {
    if (!checksumAsset) {
        console.warn('⚠️ Release chưa có SHA256 asset; bỏ qua checksum để giữ tương thích update hiện tại');
        return;
    }
    const checksumText = await downloadText(checksumAsset.browser_download_url);
    const expected = (checksumText.match(/[a-fA-F0-9]{64}/) || [])[0]?.toLowerCase();
    if (!expected) {
        throw new Error('File SHA256 không chứa checksum hợp lệ');
    }
    const actual = await sha256File(zipPath);
    if (actual !== expected) {
        throw new Error(`Checksum cập nhật không khớp cho ${zipAsset.name}`);
    }
    console.log('✅ SHA256 verified:', actual);
}

/**
 * Download + cài đặt bản cập nhật tự động
 */
async function installTrustedUpdate({ downloadUrl, trustedAsset, checksumAsset, operation = 'Cập nhật' }) {
    try {
        console.log('📥 ========================================');
        console.log('📥 BẮT ĐẦU CẬP NHẬT TỰ ĐỘNG');
        console.log('📥 ========================================');
        console.log('   URL:', downloadUrl);
        if (!trustedAsset) {
            throw new Error('Thiếu asset cập nhật hợp lệ');
        }
        console.log('   Trusted asset:', trustedAsset.name);

        sendToRenderer('update:step', { step: 'downloading', message: 'Đang tải bản cập nhật...' });

        // 1. Tạo thư mục tạm
        const tempDir = path.join(os.tmpdir(), `DBYPOS-update-${Date.now()}`);
        fs.mkdirSync(tempDir, { recursive: true });

        const zipPath = path.join(tempDir, 'update.zip');
        const extractDir = path.join(tempDir, 'extracted');

        console.log('📁 Thư mục tạm:', tempDir);

        // 2. Tải file ZIP từ GitHub
        console.log('⬇️  Đang tải bản cập nhật...');
        const dlStartTime = Date.now();

        await downloadFile(downloadUrl, zipPath, (downloaded, total, percent) => {
            const dlMB = (downloaded / 1024 / 1024).toFixed(1);
            const totalMB = (total / 1024 / 1024).toFixed(1);
            const elapsedSec = Math.max(1, (Date.now() - dlStartTime) / 1000);
            const speedKBs = Math.round(downloaded / 1024 / elapsedSec);
            const etaSec = speedKBs > 0 ? Math.round((total - downloaded) / 1024 / speedKBs) : 0;
            console.log(`   ⏳ ${percent}% (${dlMB}/${totalMB} MB)`);
            sendToRenderer('update:progress', {
                percent, downloaded, total,
                dlMB, totalMB, speedKBs, etaSec,
                elapsed: Math.round(elapsedSec),
            });
        });

        const zipStats = fs.statSync(zipPath);
        console.log(`✅ Tải xong: ${(zipStats.size / 1024 / 1024).toFixed(1)} MB`);
        await verifyChecksumIfAvailable(zipPath, trustedAsset, checksumAsset);
        sendToRenderer('update:step', { step: 'extracting', message: 'Đang giải nén...' });

        // 3. Giải nén ZIP
        console.log('📦 Đang giải nén...');
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(zipPath);
        fs.mkdirSync(extractDir, { recursive: true });
        zip.extractAllTo(extractDir, true);
        console.log('✅ Giải nén xong');
        sendToRenderer('update:step', { step: 'installing', message: 'Đang cài đặt...' });

        // 4. Xác định thư mục gốc ứng dụng
        //    ZIP chứa nội dung của win-unpacked/ (DBY POS.exe, resources/, ...)
        //    → cần copy vào thư mục chứa DBY POS.exe
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

        // 7. Copy files trực tiếp bằng Node.js (KHÔNG dùng .bat, KHÔNG hiện CMD)
        console.log('📋 Đang copy files...');
        const copyErrors = [];

        function copyRecursive(src, dest) {
            if (!fs.existsSync(src)) return;

            const stat = fs.statSync(src);
            if (stat.isDirectory()) {
                fs.mkdirSync(dest, { recursive: true });
                const items = fs.readdirSync(src);
                for (const item of items) {
                    copyRecursive(path.join(src, item), path.join(dest, item));
                }
            } else {
                try {
                    fs.copyFileSync(src, dest);
                } catch (err) {
                    // File có thể bị khóa (ví dụ: .exe đang chạy)
                    copyErrors.push({ file: dest, error: err.message });
                    console.warn(`   ⚠️ Không thể copy: ${path.basename(dest)} (${err.code})`);
                }
            }
        }

        copyRecursive(sourceDir, appRoot);

        const successCount = countFiles(sourceDir) - copyErrors.length;
        console.log(`✅ Copy xong: ${successCount} files thành công`);

        if (copyErrors.length > 0) {
            console.log(`⚠️ ${copyErrors.length} files bị khóa (sẽ được cập nhật sau khi restart):`);

            // Tạo script ẩn để copy các file bị khóa sau khi app tắt
            const batPath = path.join(tempDir, 'update-locked.bat');
            const exePath = process.execPath;

            let copyCommands = copyErrors.map(e => {
                const relPath = e.file.replace(appRoot + '\\', '');
                const srcFile = path.join(sourceDir, relPath);
                return `copy /Y "${srcFile}" "${e.file}" >nul 2>&1`;
            }).join('\r\n');

            const batContent = `@echo off
chcp 65001 >nul
timeout /t 3 /nobreak >nul
${copyCommands}
start "" "${exePath}"
timeout /t 5 /nobreak >nul
rmdir /S /Q "${tempDir}" 2>nul
exit
`;
            fs.writeFileSync(batPath, batContent);

            // Chạy .bat ẨN hoàn toàn qua VBScript YÊU CẦU QUYỀN ADMIN (runas)
            const vbsPath = path.join(tempDir, 'update-silent.vbs');
            const vbsContent = `Set UAC = CreateObject("Shell.Application")\r\nUAC.ShellExecute """${batPath}""", "", "", "runas", 0`;
            fs.writeFileSync(vbsPath, vbsContent);

            const { spawn } = require('child_process');
            const child = spawn('wscript.exe', [vbsPath], {
                detached: true,
                stdio: 'ignore'
            });
            child.unref();
            console.log('🔇 Script cập nhật ẩn đã khởi chạy (không hiện CMD)');
        } else {
            // Tất cả files đã copy xong → dọn thư mục tạm
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (e) { }
        }

        // 8. Lưu lịch sử cập nhật vào DB
        try {
            const packageJson = require('../package.json');
            if (prisma) {
                await prisma.updateHistory.create({
                    data: {
                        fromVersion: packageJson.version,
                        toVersion: newVersion,
                        machine: os.hostname(),
                        notes: `${operation} từ v${packageJson.version} lên v${newVersion}`
                    }
                });
                console.log('✅ Đã lưu lịch sử cập nhật vào DB');
            }
        } catch (histErr) {
            console.warn('⚠️ Không thể lưu lịch sử cập nhật:', histErr.message);
        }

        // 9. Restart app mượt mà (giống VS Code)
        const result = {
            success: true,
            data: {
                version: newVersion,
                message: `Đã ${operation.toLowerCase()} lên v${newVersion}. Đang khởi động lại...`,
                lockedFiles: copyErrors.length
            }
        };

        setTimeout(() => {
            console.log('🔄 Đang khởi động lại ứng dụng...');
            sendToRenderer('update:step', { step: 'restarting', message: 'Đang khởi động lại...' });
            if (copyErrors.length > 0) {
                // Có file bị khóa → .bat ẩn sẽ lo restart
                app.quit();
            } else {
                // Tất cả OK → restart ngay bằng app.relaunch()
                app.relaunch();
                app.exit(0);
            }
        }, 1500);

        return result;

    } catch (error) {
        console.error('❌ Lỗi cập nhật tự động:', error);
        console.error('   Stack:', error.stack);
        return { success: false, error: error.message };
    }
}

ipcMain.handle('update:download', async (event, downloadUrl) => {
    try {
        const { asset: trustedAsset, checksumAsset } = await assertTrustedDownloadUrl(downloadUrl);
        return await installTrustedUpdate({
            downloadUrl,
            trustedAsset,
            checksumAsset,
            operation: 'Cập nhật'
        });
    } catch (error) {
        console.error('❌ Lỗi cập nhật phiên bản:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('update:restoreVersion', async (event, version) => {
    try {
        requireUpdateAdmin();
        const normalizedVersion = String(version || '').trim().replace(/^v/i, '');
        const release = await fetchReleaseByTag(normalizedVersion);
        const trustedAsset = pickPreferredZipAsset(release);
        if (!trustedAsset) {
            throw new Error(`Release v${normalizedVersion} không có file ZIP`);
        }
        return await installTrustedUpdate({
            downloadUrl: trustedAsset.browser_download_url,
            trustedAsset,
            checksumAsset: findSha256Asset(release, trustedAsset),
            operation: 'Khôi phục'
        });
    } catch (error) {
        console.error('❌ Lỗi khôi phục phiên bản:', error);
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

