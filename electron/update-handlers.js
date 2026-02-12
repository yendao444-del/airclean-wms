// ========================================
// AUTO UPDATE - GITHUB RELEASES
// ========================================

const https = require('https');
const { app } = require('electron');

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

/**
 * Fetch latest release từ GitHub API
 */
function fetchLatestRelease() {
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
                        resolve(release);
                    } catch (err) {
                        reject(new Error('Invalid JSON response'));
                    }
                } else if (res.statusCode === 404) {
                    reject(new Error('Không tìm thấy release nào trên GitHub'));
                } else {
                    reject(new Error(`GitHub API error: ${res.statusCode}`));
                }
            });
        });

        req.on('error', (err) => {
            reject(new Error(`Network error: ${err.message}`));
        });

        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
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
 * Download update file
 */
ipcMain.handle('update:download', async (event, downloadUrl) => {
    try {
        console.log('📥 Downloading update from:', downloadUrl);

        // TODO: Implement download logic
        // For now, just open the download URL in browser
        shell.openExternal(downloadUrl);

        return { success: true };

    } catch (error) {
        console.error('❌ Error downloading update:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
});
