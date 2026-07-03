const { ipcMain, dialog, shell, app } = require('electron');
const path = require('path');

// ✅ PRODUCTION CONFIG - Không cần .env nữa
const config = require('./config');

// 📦 Offline Queue — lưu scan khi mất mạng, sync lại khi có mạng
const offlineQueue = require('./offline-queue');
try { offlineQueue.init(app.getPath('userData')); } catch (e) { console.error('[OfflineQueue] Init failed:', e.message); }

// Set environment variables từ config
process.env.DATABASE_URL = config.DATABASE_URL;
process.env.DIRECT_URL = config.DIRECT_URL;

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

// ========================================
// 🔒 STOCK MUTEX — Serialize stock operations
// Ngăn race condition khi nhiều scan/import chạy đồng thời
// Đảm bảo Tồn đầu/Tồn cuối trong Thẻ Kho luôn đúng
// ========================================
const _stockQueue = [];
let _stockLocked = false;

function acquireStockLock() {
    return new Promise(resolve => {
        if (!_stockLocked) {
            _stockLocked = true;
            resolve();
        } else {
            _stockQueue.push(resolve);
        }
    });
}

function releaseStockLock() {
    if (_stockQueue.length > 0) {
        const next = _stockQueue.shift();
        next();
    } else {
        _stockLocked = false;
    }
}

async function withStockLock(fn) {
    await acquireStockLock();
    try {
        return await fn();
    } finally {
        releaseStockLock();
    }
}

// ⚡ LAZY LOADING — Module nặng chỉ load khi cần, không block startup
// googleapis (~3-5s), xlsx (~1-2s), bcryptjs (~0.5s) → tiết kiệm ~5-7s
function lazyRequire(moduleName) {
    let mod = null;
    return new Proxy({}, {
        get(_, prop) {
            if (!mod) {
                console.time(`âš¡ lazy-load ${moduleName}`);
                mod = require(moduleName);
                console.timeEnd(`âš¡ lazy-load ${moduleName}`);
            }
            return mod[prop];
        }
    });
}

const XLSX = lazyRequire('xlsx');
const bcrypt = lazyRequire('bcryptjs');

// ========================================
// GOOGLE DRIVE + TELEGRAM — HĐĐT BACKUP
// ========================================

const GDRIVE_FOLDER_ID = config.GDRIVE_FOLDER_ID;
const TELEGRAM_BOT_TOKEN = config.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = config.TELEGRAM_CHAT_ID;

// OAuth2 Client credentials
const OAUTH_CLIENT_ID = config.OAUTH_CLIENT_ID;
const OAUTH_CLIENT_SECRET = config.OAUTH_CLIENT_SECRET;

// Google Drive auth (OAuth2 — dùng storage của user, không bị quota limit)
let driveClient = null;
let driveClientTokenMtime = 0;

function getGoogleTokenPath() {
    return path.join(app.getPath('userData'), 'gdrive-token.json');
}

function getLegacyGoogleTokenPath() {
    return path.join(__dirname, 'gdrive-token.json');
}

function ensureGoogleTokenPath() {
    const tokenPath = getGoogleTokenPath();
    const legacyPath = getLegacyGoogleTokenPath();

    const appDataExists = fs.existsSync(tokenPath);
    const legacyExists = fs.existsSync(legacyPath);

    // Nếu token bundle mới hơn token AppData → dùng token bundle (deploy mới)
    if (appDataExists && legacyExists) {
        const appDataMtime = fs.statSync(tokenPath).mtimeMs;
        const legacyMtime = fs.statSync(legacyPath).mtimeMs;
        if (legacyMtime > appDataMtime) {
            fs.copyFileSync(legacyPath, tokenPath);
            console.log('[Drive] Token bundle moi hon AppData - cap nhat token moi.');
        }
        return tokenPath;
    }

    if (appDataExists) return tokenPath;

    if (legacyExists) {
        fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
        fs.copyFileSync(legacyPath, tokenPath);
        console.warn('[Drive] Migrated Google token from app source to userData. Remove legacy token before building:', legacyPath);
        return tokenPath;
    }

    return tokenPath;
}

function getDriveClient() {
    try {
        const tokenPath = ensureGoogleTokenPath();
        if (!fs.existsSync(tokenPath)) {
            console.warn('[Drive] Token not found:', tokenPath);
            driveClient = null;
            return null;
        }
        // Force reinit neáu token file thay doi (sau reauth)
        const tokenMtime = fs.statSync(tokenPath).mtimeMs;
        if (driveClient && tokenMtime === driveClientTokenMtime) {
            return driveClient;
        }
        if (tokenMtime !== driveClientTokenMtime) {
            console.log('[Drive] Token file changed, reinit client...');
            driveClient = null;
        }
        const { google } = require('googleapis');
        const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
        const oauth2Client = new google.auth.OAuth2(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
        oauth2Client.setCredentials(tokens);
        oauth2Client.on('tokens', (newTokens) => {
            try {
                const saved = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
                const updated = { ...saved, ...newTokens };
                fs.writeFileSync(tokenPath, JSON.stringify(updated, null, 2));
                driveClientTokenMtime = fs.statSync(tokenPath).mtimeMs;
                console.log('[Drive] Token refreshed & saved');
            } catch (saveErr) {
                console.error('[Drive] Failed to save refreshed token:', saveErr.message);
            }
        });
        driveClient = google.drive({ version: 'v3', auth: oauth2Client });
        driveClientTokenMtime = tokenMtime;
        console.log('[Drive] Client initialized (OAuth2)');
        return driveClient;
    } catch (err) {
        console.error('[Drive] Init error:', err.message);
        driveClient = null;
        driveClientTokenMtime = 0;
        return null;
    }
}

function resetDriveClient() {
    driveClient = null;
    driveClientTokenMtime = 0;
    console.log('[Drive] Client reset - se tai khoi tao voi token moi nhat');
}

// Tìm hoặc tạo subfolder theo tháng: HDDT-AIRCLEAN/2026-03/
async function getOrCreateMonthFolder(drive, parentFolderId, monthStr) {
    try {
        // Tìm folder đã có
        const res = await drive.files.list({
            q: `'${parentFolderId}' in parents and name='${monthStr}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id, name)',
        });
        if (res.data.files.length > 0) {
            return res.data.files[0].id;
        }
        // Tạo mới
        const folder = await drive.files.create({
            requestBody: {
                name: monthStr,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parentFolderId],
            },
            fields: 'id',
        });
        console.log(`📁 Created Drive folder: ${monthStr}`);
        return folder.data.id;
    } catch (err) {
        console.error('❌ Create month folder error:', err.message);
        return parentFolderId; // Fallback: upload vào root folder
    }
}

// Upload file lên Google Drive
async function uploadToDrive(drive, folderId, fileName, content, mimeType) {
    try {
        const { Readable } = require('stream');
        const bufferStream = new Readable();
        bufferStream.push(Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8'));
        bufferStream.push(null);

        const file = await drive.files.create({
            requestBody: {
                name: fileName,
                parents: [folderId],
            },
            media: {
                mimeType: mimeType,
                body: bufferStream,
            },
            fields: 'id, webViewLink',
        });

        // Set quyền "Anyone with link can view" — fire-and-forget, không block upload
        drive.permissions.create({
            fileId: file.data.id,
            requestBody: { role: 'reader', type: 'anyone' },
        }).catch(permErr => console.warn(`⚠️ Could not set public permission for ${fileName}:`, permErr.message));

        console.log(`☁️ Uploaded to Drive: ${fileName} (${file.data.id}) [public]`);
        return { fileId: file.data.id, webViewLink: file.data.webViewLink };
    } catch (err) {
        console.error(`❌ Drive upload error (${fileName}):`, err.message);
        return null;
    }
}

// Gá»­i file qua Telegram
async function sendTelegramDocument(buffer, fileName, caption) {
    return new Promise((resolve) => {
        try {
            const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
            const parts = [];

            // chat_id
            parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TELEGRAM_CHAT_ID}`);
            // caption
            if (caption) {
                parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}`);
            }
            // document
            parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`);

            const header = Buffer.from(parts.join('\r\n') + '\r\n', 'utf-8');
            const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
            const fileBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, 'utf-8');
            const body = Buffer.concat([header, fileBuffer, footer]);

            const options = {
                hostname: 'api.telegram.org',
                path: `/bot${TELEGRAM_BOT_TOKEN}/sendDocument`,
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': body.length,
                },
                timeout: 15000,
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        console.log(`📱 Telegram sent: ${fileName}`);
                        resolve({ success: true });
                    } else {
                        console.error(`❌ Telegram error ${res.statusCode}:`, data.substring(0, 200));
                        resolve({ success: false, error: `HTTP ${res.statusCode}` });
                    }
                });
            });

            req.on('error', (e) => resolve({ success: false, error: e.message }));
            req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
            req.write(body);
            req.end();
        } catch (err) {
            resolve({ success: false, error: err.message });
        }
    });
}

// Gửi tin nhắn text qua Telegram
async function sendTelegramMessage(text) {
    return new Promise((resolve) => {
        const postData = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' });
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
            timeout: 5000,
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ success: res.statusCode === 200 }));
        });
        req.on('error', (e) => resolve({ success: false, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
        req.write(postData);
        req.end();
    });
}

// Tạo XML hóa đơn (chuẩn bị — khi tích hợp MISA sẽ lấy từ API)
function generateInvoiceXML(order, invoiceNumber, taxCode) {
    const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
    const itemsXml = items.map((item, idx) => `
        <Item>
            <LineNumber>${idx + 1}</LineNumber>
            <ItemName>${escapeXml(item.productName || '')}</ItemName>
            <Quantity>${item.quantity || 1}</Quantity>
            <UnitPrice>${item.unitPrice || 0}</UnitPrice>
            <Amount>${item.total || 0}</Amount>
        </Item>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
    <InvoiceNumber>${invoiceNumber}</InvoiceNumber>
    <InvoiceDate>${new Date().toISOString().split('T')[0]}</InvoiceDate>
    <TaxCode>${taxCode}</TaxCode>
    <Seller>
        <Name>AIRCLEAN</Name>
        <TaxID>MST_COMPANY</TaxID>
    </Seller>
    <Buyer>
        <Name>${escapeXml(order.customerName || '')}</Name>
        <Phone>${order.customerPhone || ''}</Phone>
    </Buyer>
    <Platform>${order.platform}</Platform>
    <OrderId>${order.orderId}</OrderId>
    <TotalAmount>${order.totalAmount}</TotalAmount>
    <Items>${itemsXml}
    </Items>
    <DigitalSignature>PENDING_MISA_INTEGRATION</DigitalSignature>
    <Note>File XML này được tạo tự động. Khi tích hợp MISA MeInvoice, file XML có chữ ký số hợp lệ sẽ thay thế file này.</Note>
</Invoice>`;
}

function escapeXml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Upload + gửi 1 hóa đơn lên Drive & Telegram (chạy ngầm, không block)
async function backupInvoiceToCloudAndTelegram(order, invoiceNumber, taxCode) {
    const results = { drive: { xml: null, pdf: null }, telegram: { xml: false, pdf: false } };

    try {
        const xmlContent = generateInvoiceXML(order, invoiceNumber, taxCode);
        const xmlFileName = `${invoiceNumber}_${order.orderId}.xml`;

        // Tạo nội dung text đơn giản thay cho PDF (vì chưa có MISA API trả PDF thật)
        const pdfContent = `HÓA ĐƠN ĐIỆN TỬ - BẢN THỂ HIỆN\n` +
            `========================================\n` +
            `Số HĐ: ${invoiceNumber}\n` +
            `Ngày: ${new Date().toLocaleDateString('vi-VN')}\n` +
            `Mã tra cứu: ${taxCode}\n` +
            `\nNGƯỜI BÁN: AIRCLEAN\n` +
            `\nNGƯỜI MUA: ${order.customerName}\n` +
            `SĐT: ${order.customerPhone || 'N/A'}\n` +
            `Sàn: ${order.platform}\n` +
            `Mã đơn: ${order.orderId}\n` +
            `\nTỔNG TIỀN: ${Number(order.totalAmount).toLocaleString('vi-VN')}đ\n` +
            `========================================\n` +
            `✅ Đã ký số điện tử\n` +
            `📋 Lưu ý: Đây là bản thể hiện. File XML gốc có giá trị pháp lý.`;
        const pdfFileName = `${invoiceNumber}_${order.orderId}.txt`; // .txt vì chưa có PDF thật

        const monthStr = new Date().toISOString().slice(0, 7); // 2026-03

        // === GOOGLE DRIVE ===
        const drive = getDriveClient();
        if (drive) {
            const monthFolderId = await getOrCreateMonthFolder(drive, GDRIVE_FOLDER_ID, monthStr);

            const [xmlResult, pdfResult] = await Promise.all([
                uploadToDrive(drive, monthFolderId, xmlFileName, xmlContent, 'application/xml'),
                uploadToDrive(drive, monthFolderId, pdfFileName, pdfContent, 'text/plain'),
            ]);
            results.drive.xml = xmlResult;
            results.drive.pdf = pdfResult;
        }

        // === TELEGRAM ===
        const caption = `🧾 ${invoiceNumber}\n` +
            `👤 ${order.customerName}\n` +
            `💰 ${Number(order.totalAmount).toLocaleString('vi-VN')}đ\n` +
            `🛒 ${order.platform} | ${order.orderId}\n` +
            `📅 ${new Date().toLocaleDateString('vi-VN')}`;

        const [tgXml, tgPdf] = await Promise.all([
            sendTelegramDocument(Buffer.from(xmlContent, 'utf-8'), xmlFileName, `📎 XML gốc — ${caption}`),
            sendTelegramDocument(Buffer.from(pdfContent, 'utf-8'), pdfFileName, `📄 Bản thể hiện — ${caption}`),
        ]);
        results.telegram.xml = tgXml.success;
        results.telegram.pdf = tgPdf.success;

    } catch (err) {
        console.error(`❌ Backup invoice ${invoiceNumber} error:`, err.message);
    }

    return results;
}

// ========================================
// PRISMA CLIENT - BẮT BUỘC SUPABASE
// ========================================

let prisma;
let prismaDirectTx; // Dùng DIRECT_URL cho transactions nặng (bypass PgBouncer)

// ⚡ LAZY INIT — chỉ tạo khi lần đầu cần (tiết kiệm ~500ms startup)
function getPrismaDirectTx() {
    if (!prismaDirectTx) {
        console.time('âš¡ lazy-init prismaDirectTx');
        prismaDirectTx = new PrismaClient({
            log: ['error', 'warn'],
            datasources: { db: { url: config.DIRECT_URL } }
        });
        prismaDirectTx.$connect()
            .then(() => console.log('✅ Connected Prisma Direct (for transactions)'))
            .catch(err => console.error('⚠️ Prisma Direct connect failed:', err.message));
        console.timeEnd('âš¡ lazy-init prismaDirectTx');
    }
    return prismaDirectTx;
}

try {
    console.log('🔄 Initializing Prisma Client...');
    console.log('   🆕 CODE VERSION: 3.0 (Production with embedded config)');
    console.log('   APP:', config.APP_NAME, config.APP_VERSION);
    console.log('   ENVIRONMENT:', config.ENVIRONMENT);
    console.log('   DATABASE_URL:', config.DATABASE_URL.split('@')[1] || 'Invalid'); // Chỉ log domain, không log password

    prisma = new PrismaClient({
        log: ['error', 'warn'],
        datasources: {
            db: {
                url: config.DATABASE_URL
            }
        }
    });
    console.log('✅ Prisma Client initialized successfully');

    // Test connection - REQUIRED
    prisma.$connect()
        .then(() => {
            console.log('✅ Connected to Supabase PostgreSQL');
        })
        .catch(err => {
            console.error('❌ CRITICAL: Database connection failed!');
            console.error('   Error:', err.message);
            console.error('   Stack:', err.stack);

            // Show error dialog to user
            const { dialog } = require('electron');
            dialog.showErrorBox(
                'Lỗi kết nối Database',
                `Không thể kết nối đến database.\n\nChi tiết: ${err.message}\n\nVui lòng kiểm tra kết nối internet và thử lại.`
            );

            // Exit app if can't connect to database
            app.quit();
        });
} catch (error) {
    console.error('❌ CRITICAL: Prisma Client initialization failed!');
    console.error('   Error:', error.message);
    console.error('   Stack:', error.stack);

    // Show error dialog
    const { dialog } = require('electron');
    dialog.showErrorBox(
        'Lỗi khởi tạo Database',
        `Không thể khởi tạo kết nối database.\n\nChi tiết: ${error.message}\n\nỨng dụng sẽ thoát.`
    );

    // Exit app
    app.quit();
}

// ========================================
// NO MOCK DATA - 100% ONLINE DATABASE
// ========================================
// All data MUST come from Supabase. No fallback mock data.

// ========================================
// SESSION STORE - Backend role enforcement
// ========================================
let currentSession = null; // { id, username, role }
const REMEMBER_TOKENS_KEY = 'authRememberTokensV1';
const REMEMBER_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function requireRole(...roles) {
    if (!currentSession) {
        throw new Error('Chưa đăng nhập');
    }
    if (roles.length > 0 && !roles.includes(currentSession.role)) {
        throw new Error(`Không có quyền thực hiện thao tác này (yêu cầu: ${roles.join('/')})`);
    }
}

function sanitizeUserForClient(user) {
    if (!user) return null;
    const { password, ...safeUser } = user;
    return { ...safeUser, isActive: user.status === 'active' };
}

function hashRememberToken(token) {
    return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

async function readRememberTokens() {
    if (!prisma) return [];
    const config = await prisma.appConfig.findUnique({ where: { key: REMEMBER_TOKENS_KEY } });
    if (!config) return [];
    try {
        const parsed = JSON.parse(config.value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function writeRememberTokens(tokens) {
    if (!prisma) return;
    await prisma.appConfig.upsert({
        where: { key: REMEMBER_TOKENS_KEY },
        update: { value: JSON.stringify(tokens) },
        create: { key: REMEMBER_TOKENS_KEY, value: JSON.stringify(tokens) }
    });
}

async function issueRememberToken(userId) {
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    const expiresAt = new Date(now + REMEMBER_TOKEN_TTL_MS).toISOString();
    const tokenHash = hashRememberToken(rawToken);
    const tokens = (await readRememberTokens())
        .filter(t => t && t.expiresAt && new Date(t.expiresAt).getTime() > now && t.userId !== userId);
    tokens.push({
        id: crypto.randomUUID(),
        userId,
        tokenHash,
        createdAt: new Date(now).toISOString(),
        expiresAt
    });
    await writeRememberTokens(tokens.slice(-50));
    return rawToken;
}

async function revokeRememberToken(rawToken) {
    if (!rawToken) return;
    const tokenHash = hashRememberToken(rawToken);
    const tokens = await readRememberTokens();
    await writeRememberTokens(tokens.filter(t => t?.tokenHash !== tokenHash));
}

// ========================================
// ACTIVITY LOG HELPER
// ========================================
async function logActivity({ module, action, description, recordId, recordName, changes, userName, severity }) {
    try {
        if (!prisma) return;
        await prisma.activityLog.create({
            data: {
                module: module || 'system',
                action: action || 'UPDATE',
                description: description || '',
                recordId: recordId != null ? (Number.isInteger(recordId) ? recordId : parseInt(recordId, 10) || null) : null,
                recordName: recordName || null,
                changes: changes ? (typeof changes === 'string' ? changes : JSON.stringify(changes)) : null,
                userName: userName || currentSession?.username || 'System',
                severity: severity || 'INFO',
            }
        });
    } catch (err) {
        console.error('⚠️ Activity log failed:', err.message);
    }
}

// ========================================
// AUTO CLEANUP - Xóa log cũ hơn 7 ngày
// ========================================
async function cleanupOldLogs() {
    try {
        if (!prisma) return;

        // 1. Xóa ActivityLog cũ hơn 30 ngày
        const logCutoff = new Date();
        logCutoff.setDate(logCutoff.getDate() - 30);
        const logResult = await prisma.activityLog.deleteMany({
            where: { timestamp: { lt: logCutoff } }
        });
        if (logResult.count > 0) {
            console.log(`🧹 Cleanup: Đã xóa ${logResult.count} activity log cũ hơn 30 ngày`);
        }

        // 2. Xóa EcommerceExport đã hoàn thành cũ hơn 2 tháng
        const exportCutoff = new Date();
        exportCutoff.setMonth(exportCutoff.getMonth() - 2);
        const exportResult = await prisma.ecommerceExport.deleteMany({
            where: {
                status: 'completed',
                ecommerceExportDate: { lt: exportCutoff }
            }
        });
        if (exportResult.count > 0) {
            console.log(`🧹 Cleanup: Đã xóa ${exportResult.count} đơn TMDT hoàn thành cũ hơn 2 tháng`);
        }

    } catch (err) {
        console.error('⚠️ Cleanup failed:', err.message);
    }
}

// Chạy cleanup khi app khởi động (delay 10s để DB sẵn sàng)
setTimeout(cleanupOldLogs, 10000);

// Lặp lại mỗi 24 tiếng
setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);

// ========================================
// SYSTEM INFO
// ========================================

const os = require('os');

ipcMain.handle('system:getInfo', async () => {
    try {
        let dbStatus = 'disconnected';
        try {
            if (prisma) {
                await prisma.$queryRawUnsafe('SELECT 1');
                dbStatus = 'connected';
            }
        } catch { }

        const packageJson = require('../package.json');

        return {
            success: true,
            data: {
                dbStatus,
                machineName: os.hostname(),
                environment: app.isPackaged ? 'production' : 'development',
                platform: `${os.type()} ${os.release()}`,
                appVersion: packageJson.version,
                nodeVersion: process.version,
                electronVersion: process.versions.electron || 'N/A',
            }
        };
    } catch (error) {
        console.error('❌ system:getInfo error:', error.message);
        return { success: false, error: error.message };
    }
});

// ========================================
// DASHBOARD SUMMARY
// ========================================

ipcMain.handle('dashboard:getSummary', async (event, params = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        const startedAt = Date.now();
        const toDate = (value, fallback) => {
            const d = value ? new Date(value) : fallback;
            return Number.isNaN(d.getTime()) ? fallback : d;
        };
        const now = new Date();
        const from = toDate(params.from, new Date(now.getFullYear(), now.getMonth(), now.getDate()));
        const to = toDate(params.to, now);
        const prevFrom = toDate(params.prevFrom, from);
        const prevTo = toDate(params.prevTo, to);
        const chartFrom = toDate(params.chartFrom, from);
        const chartTo = toDate(params.chartTo, to);

        const parseItems = (value) => {
            try { return typeof value === 'string' ? JSON.parse(value || '[]') : (value || []); } catch { return []; }
        };
        const dateIn = (date, start, end) => date >= start && date <= end;
        const dayKey = (date) => {
            const d = new Date(date);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };
        const pickSku = (item) => item?.sku || item?.variantSku || item?.productSku || '';
        const pickName = (item) => item?.productName || item?.name || item?.product || 'N/A';
        const pickQty = (item) => Number(item?.quantity ?? item?.qty ?? 0) || 0;
        const pickPrice = (item) => Number(item?.price ?? item?.unitPrice ?? 0) || 0;

        const [products, exportOrders, ecommerceExports, prevExportSummary, prevEcommerceSummary, chartExportRows, chartEcommerceRows, purchases, recentPurchases] = await Promise.all([
            prisma.product.findMany({
                select: { sku: true, stock: true, minStock: true, cost: true, variants: true },
                where: { status: { not: 'inactive' } },
            }),
            prisma.exportOrder.findMany({
                where: { exportDate: { gte: from, lte: to } },
                select: { exportDate: true, totalAmount: true, items: true },
            }),
            prisma.ecommerceExport.findMany({
                where: { status: 'completed', ecommerceExportDate: { gte: from, lte: to } },
                select: { ecommerceExportDate: true, totalAmount: true, items: true },
            }),
            prisma.exportOrder.aggregate({
                where: { exportDate: { gte: prevFrom, lte: prevTo } },
                _count: { _all: true },
                _sum: { totalAmount: true },
            }),
            prisma.ecommerceExport.aggregate({
                where: { status: 'completed', ecommerceExportDate: { gte: prevFrom, lte: prevTo } },
                _count: { _all: true },
                _sum: { totalAmount: true },
            }),
            prisma.$queryRaw`
                SELECT to_char(date_trunc('day', "exportDate"), 'YYYY-MM-DD') AS day,
                       COALESCE(SUM("totalAmount"), 0)::float AS revenue
                FROM "ExportOrder"
                WHERE "exportDate" >= ${chartFrom} AND "exportDate" <= ${chartTo}
                GROUP BY 1
            `,
            prisma.$queryRaw`
                SELECT to_char(date_trunc('day', "ecommerceExportDate"), 'YYYY-MM-DD') AS day,
                       COALESCE(SUM("totalAmount"), 0)::float AS revenue
                FROM "EcommerceExport"
                WHERE "status" = 'completed'
                  AND "ecommerceExportDate" >= ${chartFrom}
                  AND "ecommerceExportDate" <= ${chartTo}
                GROUP BY 1
            `,
            prisma.purchaseOrder.findMany({
                where: {
                    status: { not: 'cancelled' },
                    createdAt: { gte: from, lte: to },
                },
                select: {
                    id: true,
                    total: true,
                    createdAt: true,
                    receivedAt: true,
                    supplier: { select: { name: true } },
                },
                orderBy: { createdAt: 'desc' },
            }),
            prisma.purchaseOrder.findMany({
                where: { status: { not: 'cancelled' } },
                select: {
                    id: true,
                    total: true,
                    createdAt: true,
                    receivedAt: true,
                    supplier: { select: { name: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: 4,
            }),
        ]);

        const costMap = {};
        let totalStock = 0;
        let lowStockCount = 0;
        for (const product of products) {
            if (product.sku) costMap[product.sku] = product.cost || 0;
            let productStock = product.stock || 0;
            let lowStock = productStock <= (product.minStock || 10);
            const variants = parseItems(product.variants);
            if (variants.length > 0) {
                productStock = variants.reduce((sum, v) => sum + (Number(v?.stock) || 0), 0);
                lowStock = variants.some(v => (Number(v?.stock) || 0) <= (product.minStock || 10));
                for (const variant of variants) {
                    if (variant?.sku) {
                        costMap[variant.sku] = (variant.cost != null && Number(variant.cost) > 0)
                            ? Number(variant.cost)
                            : (product.cost || 0);
                    }
                }
            }
            totalStock += productStock;
            if (lowStock) lowStockCount += 1;
        }

        const emptyTotals = () => ({ revenue: 0, count: 0, posRevenue: 0, posCount: 0, ecomRevenue: 0, ecomCount: 0, cogs: 0 });
        const current = emptyTotals();
        const previous = emptyTotals();
        const dailyRevenueByDate = {};
        const topMap = new Map();

        const addSalesRow = (row, source, date, bucket) => {
            const amount = Number(row.totalAmount || 0);
            bucket.revenue += amount;
            bucket.count += 1;
            if (source === 'pos') {
                bucket.posRevenue += amount;
                bucket.posCount += 1;
            } else {
                bucket.ecomRevenue += amount;
                bucket.ecomCount += 1;
            }
            for (const item of parseItems(row.items)) {
                const sku = pickSku(item);
                const qty = pickQty(item);
                const price = pickPrice(item);
                const cost = costMap[sku] ?? Number(item?.cost || 0);
                bucket.cogs += cost * qty;
                if (dateIn(date, from, to)) {
                    const name = pickName(item);
                    const existing = topMap.get(name) || { name, qty: 0, revenue: 0 };
                    existing.qty += qty || 1;
                    existing.revenue += price * (qty || 1);
                    topMap.set(name, existing);
                }
            }
        };

        const salesRows = [
            ...exportOrders.map(row => ({ row, source: 'pos', date: row.exportDate })),
            ...ecommerceExports.map(row => ({ row, source: 'ecom', date: row.ecommerceExportDate })),
        ];
        for (const { row, source, date } of salesRows) {
            if (dateIn(date, from, to)) addSalesRow(row, source, date, current);
        }
        previous.posRevenue = Number(prevExportSummary._sum?.totalAmount || 0);
        previous.posCount = Number(prevExportSummary._count?._all || 0);
        previous.ecomRevenue = Number(prevEcommerceSummary._sum?.totalAmount || 0);
        previous.ecomCount = Number(prevEcommerceSummary._count?._all || 0);
        previous.revenue = previous.posRevenue + previous.ecomRevenue;
        previous.count = previous.posCount + previous.ecomCount;

        const chartRows = [...chartExportRows, ...chartEcommerceRows];
        for (const row of chartRows) {
            const key = String(row.day || '');
            if (key) dailyRevenueByDate[key] = (dailyRevenueByDate[key] || 0) + Number(row.revenue || 0);
        }

        const rangePurchases = purchases.filter(p => dateIn(p.receivedAt || p.createdAt, from, to));
        const purchaseAmount = rangePurchases.reduce((sum, p) => sum + Number(p.total || 0), 0);
        const formatPurchase = (p) => ({
            id: p.id,
            supplierName: p.supplier?.name || '',
            totalAmount: p.total || 0,
            purchaseDate: (p.receivedAt || p.createdAt).toISOString(),
            createdAt: p.createdAt.toISOString(),
        });

        const data = {
            revenue: current.revenue,
            prevRevenue: previous.revenue,
            orderCount: current.count,
            prevOrders: previous.count,
            posRevenue: current.posRevenue,
            posCount: current.posCount,
            ecomRevenue: current.ecomRevenue,
            ecomCount: current.ecomCount,
            grossProfit: current.revenue - current.cogs,
            totalStock,
            productCount: products.length,
            lowStockCount,
            purchaseCount: rangePurchases.length,
            purchaseAmount,
            purchases: rangePurchases.slice(0, 4).map(formatPurchase),
            recentPurchases: recentPurchases.map(formatPurchase),
            dailyRevenueByDate,
            topProducts: Array.from(topMap.values()).sort((a, b) => b.qty - a.qty).slice(0, 10),
        };

        console.log(`[Perf] dashboard:getSummary sales=${salesRows.length} chart=${chartRows.length} products=${products.length} ms=${Date.now() - startedAt}`);
        return { success: true, data };
    } catch (error) {
        console.error('dashboard:getSummary error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// PRODUCTS
// ========================================

ipcMain.handle('products:getAll', async () => {
    try {
        if (!prisma) {
            throw new Error('Database chưa được khởi tạo. Vui lòng khởi động lại ứng dụng.');
        }

        const products = await prisma.product.findMany({
            select: {
                id: true,
                name: true,
                sku: true,
                unit: true,
                variants: true,
                cost: true,
                price: true,
                stock: true,
                minStock: true,
                maxStock: true,
                status: true,
                barcode: true,
                description: true,
                categoryId: true,
                createdAt: true,
                updatedAt: true,
                category: { select: { id: true, name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        console.log(`✅ Loaded ${products.length} products from Supabase`);
        return { success: true, data: products };
    } catch (error) {
        console.error('❌ Error loading products:', error.message);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('products:getTopSelling', async (event, { limit = 10 } = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        const parseItems = (value) => {
            try { return typeof value === 'string' ? JSON.parse(value) : (value || []); } catch { return []; }
        };
        const pickSku = (item) => item?.sku || item?.variantSku || item?.productSku || item?.code || item?.SKU || '';
        const pickName = (item) => item?.productName || item?.name || item?.product || item?.product_name || '';
        const pickQty = (item) => Number(item?.quantity ?? item?.qty ?? item?.count ?? item?.soLuong ?? 0) || 0;
        const pickProductId = (item) => item?.productId ?? item?.product_id ?? item?.productID ?? null;

        const since90Days = new Date();
        since90Days.setDate(since90Days.getDate() - 90);

        const [products, combos, posOrders, ecommerceExports, exportOrders] = await Promise.all([
            prisma.product.findMany({ select: { id: true, sku: true, name: true, variants: true, isCombo: true, comboItems: true } }),
            prisma.comboProduct.findMany({ select: { sku: true, items: true } }),
            prisma.order.findMany({
                where: { source: 'pos', status: 'completed', createdAt: { gte: since90Days } },
                include: { items: true },
            }),
            prisma.ecommerceExport.findMany({ where: { status: 'completed', createdAt: { gte: since90Days } } }),
            prisma.exportOrder.findMany({ where: { status: 'completed', createdAt: { gte: since90Days } } }),
        ]);

        const productById = new Map();
        const productBySku = new Map();
        const comboBySku = new Map();
        for (const product of products) {
            productById.set(String(product.id), { id: product.id, name: product.name });
            if (product.sku) productBySku.set(product.sku, { id: product.id, name: product.name });
            for (const variant of parseItems(product.variants)) {
                if (variant?.sku) productBySku.set(variant.sku, { id: product.id, name: product.name });
            }
            if (product.isCombo && product.sku && product.comboItems) {
                comboBySku.set(product.sku, parseItems(product.comboItems));
            }
        }

        for (const combo of combos) {
            if (combo.sku) comboBySku.set(combo.sku, parseItems(combo.items));
        }

        const totals = new Map();
        const addProductSale = (product, quantity) => {
            if (!product || !quantity) return;
            const current = totals.get(product.id) || { productId: product.id, productName: product.name, soldQty: 0 };
            current.soldQty += quantity;
            totals.set(product.id, current);
        };
        const addSale = (sku, fallbackName, quantity, productId = null) => {
            if (!quantity) return;
            const comboItems = comboBySku.get(sku);
            if (comboItems?.length) {
                for (const component of comboItems) {
                    const componentSku = pickSku(component);
                    const componentProductId = pickProductId(component);
                    const componentQty = Number(component?.quantity ?? component?.qty ?? 1) || 1;
                    addProductSale(
                        productBySku.get(componentSku) || (componentProductId ? productById.get(String(componentProductId)) : null),
                        quantity * componentQty
                    );
                }
                return;
            }

            const product = productBySku.get(sku) || (productId ? productById.get(String(productId)) : null);
            if (product) addProductSale(product, quantity);
            else if (fallbackName) addProductSale({ id: `unknown:${sku || fallbackName}`, name: fallbackName }, quantity);
        };

        for (const order of posOrders) {
            for (const item of order.items || []) addSale(item.sku, item.productName, item.quantity, item.productId);
        }
        for (const doc of ecommerceExports) {
            for (const item of parseItems(doc.items)) addSale(pickSku(item), pickName(item), pickQty(item), pickProductId(item));
        }
        for (const doc of exportOrders) {
            for (const item of parseItems(doc.items)) addSale(pickSku(item), pickName(item), pickQty(item), pickProductId(item));
        }

        const ranked = Array.from(totals.values())
            .sort((a, b) => b.soldQty - a.soldQty || String(a.productName).localeCompare(String(b.productName), 'vi'))
            .slice(0, limit);

        return { success: true, data: ranked };
    } catch (error) {
        console.error('❌ Get top selling products error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('products:getById', async (event, id) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const product = await prisma.product.findUnique({
            where: { id },
            include: { category: true }
        });
        return { success: true, data: product };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('products:create', async (event, data) => {
    try {
        requireRole('admin', 'manager');
        console.log('📝 Create product called with:', JSON.stringify(data, null, 2));
        if (!prisma) throw new Error('Prisma not available');

        const product = await prisma.product.create({
            data: {
                sku: data.sku,
                barcode: data.barcode || null,
                name: data.name,
                categoryId: data.categoryId,
                price: data.price !== undefined ? data.price : 0,
                cost: data.cost !== undefined ? data.cost : 0,
                stock: data.stock || 0,
                minStock: data.minStock || 10,
                unit: data.unit || 'Cái',
                status: data.status || 'active',
                variants: data.variants || null
            },
            include: { category: true }
        });
        console.log(`✅ Created product: ${product.name} (ID: ${product.id})`);
        void logActivity({ module: 'products', action: 'CREATE', description: `Tạo sản phẩm "${product.name}" (SKU: ${product.sku})`, recordId: product.id, recordName: product.name, userName: data.userName || 'Admin' });
        return { success: true, data: product };
    } catch (error) {
        console.error('❌ Create product ERROR:', error.code, error.message);

        // Prisma unique constraint error
        if (error.code === 'P2002') {
            const field = error.meta?.target?.[0] || 'unknown';
            if (field === 'sku') {
                return { success: false, error: `Mã SKU "${data.sku}" đã tồn tại. Vui lòng sử dụng mã khác.` };
            }
            if (field === 'barcode') {
                return { success: false, error: `Mã vạch "${data.barcode}" đã tồn tại. Vui lòng sử dụng mã khác.` };
            }
            return { success: false, error: `Dữ liệu trùng lặp (${field})` };
        }

        return { success: false, error: error.message || 'Lỗi khi tạo sản phẩm' };
    }
});

ipcMain.handle('products:update', async (event, id, data) => {
    try {
        requireRole('admin', 'manager');
        if (!prisma) throw new Error('Prisma not available');
        const product = await prisma.product.update({
            where: { id },
            data: {
                ...(data.sku && { sku: data.sku }),
                ...(data.barcode && { barcode: data.barcode }),
                ...(data.name && { name: data.name }),
                ...(data.categoryId && { categoryId: data.categoryId }),
                ...(data.price !== undefined && { price: data.price }),
                ...(data.cost !== undefined && { cost: data.cost }),
                ...(data.stock !== undefined && { stock: data.stock }),
                ...(data.minStock !== undefined && { minStock: data.minStock }),
                ...(data.unit && { unit: data.unit }),
                ...(data.status && { status: data.status }),
                ...(data.variants !== undefined && { variants: data.variants })
            },
            include: { category: true }
        });
        console.log(`✅ Updated product: ${product.name}`);
        void logActivity({ module: 'products', action: 'UPDATE', description: `Cập nhật sản phẩm "${product.name}"`, recordId: product.id, recordName: product.name, changes: data, userName: data.userName || 'Admin' });
        return { success: true, data: product };
    } catch (error) {
        console.error('❌ Update product error:', error.code, error.message);

        if (error.code === 'P2002') {
            const field = error.meta?.target?.[0] || 'unknown';
            if (field === 'sku') {
                return { success: false, error: `Mã SKU "${data.sku}" đã tồn tại. Vui lòng sử dụng mã khác.` };
            }
            if (field === 'barcode') {
                return { success: false, error: `Mã vạch "${data.barcode}" đã tồn tại. Vui lòng sử dụng mã khác.` };
            }
        }

        return { success: false, error: error.message || 'Lỗi khi cập nhật sản phẩm' };
    }
});

ipcMain.handle('products:delete', async (event, id) => {
    try {
        requireRole('admin');
        if (!prisma) throw new Error('Prisma not available');
        const product = await prisma.product.findUnique({ where: { id } });
        await prisma.product.delete({ where: { id } });
        console.log(`✅ Deleted product ID: ${id}`);
        void logActivity({ module: 'products', action: 'DELETE', description: `Xóa sản phẩm "${product?.name || id}"`, recordId: id, recordName: product?.name });
        return { success: true };
    } catch (error) {
        console.error('❌ Delete product error:', error.message);
        return { success: false, error: error.message };
    }
});

// ========================================
// CATEGORIES - Danh mục sản phẩm (PRISMA)
// ========================================

ipcMain.handle('categories:getAll', async () => {
    try {
        if (!prisma) {
            throw new Error('Database chưa được khởi tạo.');
        }

        const categories = await prisma.category.findMany({
            orderBy: { name: 'asc' }
        });
        return { success: true, data: categories };
    } catch (error) {
        console.error('❌ Error getting categories:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('categories:create', async (event, data) => {
    try {
        if (!prisma) {
            throw new Error('Database chưa được khởi tạo.');
        }

        const newCategory = await prisma.category.create({
            data: {
                name: data.name,
            }
        });

        console.log('✅ Category created:', newCategory);
        void logActivity({ module: 'products', action: 'CREATE', description: `Tạo danh mục "${newCategory.name}"`, recordName: newCategory.name });
        return { success: true, data: newCategory };
    } catch (error) {
        console.error('❌ Error creating category:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('categories:update', async (event, id, data) => {
    try {
        if (!prisma) {
            throw new Error('Database chưa được khởi tạo.');
        }

        const updatedCategory = await prisma.category.update({
            where: { id: parseInt(id) },
            data: {
                name: data.name,
            }
        });

        console.log('✅ Category updated:', updatedCategory);
        void logActivity({ module: 'products', action: 'UPDATE', description: `Cập nhật danh mục "${updatedCategory.name}"`, recordName: updatedCategory.name });
        return { success: true, data: updatedCategory };
    } catch (error) {
        console.error('❌ Error updating category:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('categories:delete', async (event, id) => {
    try {
        if (!prisma) {
            throw new Error('Database chưa được khởi tạo.');
        }

        // Check if category is being used by any products
        const productsCount = await prisma.product.count({
            where: { categoryId: parseInt(id) }
        });

        if (productsCount > 0) {
            return {
                success: false,
                error: `Không thể xóa danh mục này vì đang có ${productsCount} sản phẩm sử dụng!`
            };
        }

        await prisma.category.delete({
            where: { id: parseInt(id) }
        });

        console.log('✅ Category deleted:', id);
        void logActivity({ module: 'products', action: 'DELETE', description: `Xóa danh mục #${id}` });
        return { success: true };
    } catch (error) {
        console.error('❌ Error deleting category:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// PICKUP - Quét mã vận đơn
// ========================================

// In-memory state
let pickupTrackingData = [];  // { trackingNumber, source, file }
let pickupHistory = [];       // { trackingNumber, source, file, scannedAt }
let pickupDataFolder = '';
let pickupLogFile = '';

const HEADER_FILTER_REGEX = /tracking|order|number|the |description|seller|sku|vận chuyển/i;

function normalizeStr(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

function normalizeHeaderKey(value) {
    return normalizeSearchText(value).replace(/[^a-z0-9]+/g, '');
}

function getPickupRowValue(row, candidates) {
    if (!row || typeof row !== 'object') return '';
    const keys = Object.keys(row);
    const normalizedCandidates = candidates.map(normalizeHeaderKey);
    const key = keys.find(k => normalizedCandidates.includes(normalizeHeaderKey(k)));
    return key ? row[key] : '';
}

function extractTrackingNumbers(folderPath) {
    const combined = [];
    const files = fs.readdirSync(folderPath).filter(f => {
        const ext = path.extname(f).toLowerCase();
        return ['.xlsx', '.xls', '.csv'].includes(ext) && !f.startsWith('~$');
    });

    if (files.length === 0) return { data: [], fileCount: 0 };

    for (const file of files) {
        const filePath = path.join(folderPath, file);
        let workbook;
        try {
            workbook = XLSX.readFile(filePath);
        } catch (e) {
            console.error(`[Pickup] Failed to read ${file}:`, e.message);
            continue;
        }

        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet);
        const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        if (jsonData.length === 0) continue;

        // 🔍 Phát hiện nguồn (TikTok vs Shopee)
        const firstRow = jsonData[0] || {};
        const isTikTok = getPickupRowValue(firstRow, ['Order ID', 'Tracking ID']) !== '';
        const firstRawRow = rawRows[0] || [];
        const isShopee = normalizeHeaderKey(firstRawRow[0]) === 'madonhang'
            && normalizeHeaderKey(firstRawRow[7]) === 'mavandon'
            && normalizeHeaderKey(firstRawRow[20]) === 'skuphanloaihang';

        console.log(`[Pickup] Processing ${file}: TikTok=${isTikTok}, Shopee=${isShopee}`);

        if (isTikTok) {
            // ===== PARSE TIKTOK =====
            jsonData.forEach((row) => {
                const trackingId = normalizeStr(getPickupRowValue(row, ['Tracking ID', 'Tracking Number']));
                const orderId = normalizeStr(getPickupRowValue(row, ['Order ID']));
                const productName = normalizeStr(getPickupRowValue(row, ['Product Name']));
                const variation = normalizeStr(getPickupRowValue(row, ['Variation']));
                const sku = normalizeStr(getPickupRowValue(row, ['SKU', 'Sku']));
                const quantity = parseInt(getPickupRowValue(row, ['Quantity', 'Quantity of return']) || '1');
                const shippingProvider = normalizeStr(getPickupRowValue(row, ['Shipping Provider Name']));
                const orderRefundAmount = parseFloat(getPickupRowValue(row, ['Order Refund Amount', 'Total Amount']) || '0');
                const unitPrice = parseFloat(getPickupRowValue(row, ['SKU Unit Original Price', 'Product Price']) || '0');

                if (!trackingId || HEADER_FILTER_REGEX.test(trackingId)) return;

                combined.push({
                    trackingNumber: trackingId,
                    orderNumber: orderId,
                    source: 'TikTok',
                    file,
                    items: JSON.stringify([{
                        sku: sku,
                        variantSku: sku,
                        productName: productName,
                        color: variation || '',
                        quantity: quantity,
                        unitPrice: unitPrice,
                        total: quantity * unitPrice
                    }]),
                    shippingProvider: shippingProvider,
                    totalAmount: orderRefundAmount,
                    status: 'pending'
                });
            });
        } else if (isShopee) {
            // ===== PARSE SHOPEE =====
            // Shopee: column U is the only source of truth for SKU phan loai hang.
            rawRows.slice(1).forEach((row) => {
                const trackingId = normalizeStr(row[7] || '');       // H - Ma van don
                const orderId = normalizeStr(row[0] || '');          // A - Ma don hang
                const productName = normalizeStr(row[16] || '');     // Q - Ten san pham
                const sku = normalizeStr(row[20] || '');             // U - SKU phan loai hang
                const variation = normalizeStr(row[21] || '');       // V - Ten phan loai hang
                const quantity = parseInt(row[27] || '1');           // AB - So luong
                const shippingProvider = normalizeStr(row[8] || ''); // I - Don vi van chuyen
                const totalAmount = parseFloat(row[29] || row[30] || '0');
                const unitPrice = parseFloat(row[26] || row[22] || '0');

                if (!trackingId || HEADER_FILTER_REGEX.test(trackingId)) return;
                if (!sku) {
                    console.warn(`[Pickup] Skip Shopee row without column U SKU: order=${orderId}, tracking=${trackingId}`);
                    return;
                }

                combined.push({
                    trackingNumber: trackingId,
                    orderNumber: orderId,
                    source: 'Shopee',
                    file,
                    items: JSON.stringify([{
                        sku: sku,
                        variantSku: sku,
                        productName: productName,
                        color: variation || '',
                        quantity: quantity,
                        unitPrice: unitPrice,
                        total: unitPrice * quantity
                    }]),
                    shippingProvider: shippingProvider,
                    totalAmount: totalAmount,
                    status: 'pending'
                });
            });
        }
    }

    console.log(`[Pickup] Extracted ${combined.length} orders from ${files.length} files`);
    return { data: combined, fileCount: files.length };
}

function loadPickupLog(logFilePath) {
    if (!fs.existsSync(logFilePath)) return [];
    try {
        const wb = XLSX.readFile(logFilePath);
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet);
        return rows.map(row => ({
            trackingNumber: normalizeStr(row['Mã vận đơn'] || ''),
            orderNumber: normalizeStr(row['Order ID'] || ''),
            source: normalizeStr(row['Nguồn'] || row['Cột nguồn'] || ''),
            file: normalizeStr(row['File'] || ''),
            scannedAt: normalizeStr(row['Thời gian quét'] || ''),
            items: normalizeStr(row['Items'] || '[]'),
            shippingProvider: normalizeStr(row['Shipping Provider'] || ''),
            totalAmount: parseFloat(row['Tổng tiền'] || '0'),
            status: normalizeStr(row['Trạng thái'] || 'scanned'),
        }));
    } catch (e) {
        console.error('[Pickup] Error reading pickup log:', e.message);
        return [];
    }
}

function savePickupLog(logFilePath, history) {
    const wsData = history.map(item => ({
        'Mã vận đơn': item.trackingNumber,
        'Order ID': item.orderNumber || '',
        'Nguồn': item.source,
        'File': item.file,
        'Thời gian quét': item.scannedAt,
        'Items': item.items || '[]',
        'Shipping Provider': item.shippingProvider || '',
        'Tổng tiền': item.totalAmount || 0,
        'Trạng thái': item.status || 'scanned',
    }));
    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pickup');
    XLSX.writeFile(wb, logFilePath);
}

// Chọn thư mục
ipcMain.handle('pickup:selectFolder', async () => {
    try {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Chọn thư mục chứa file đơn hàng',
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: 'Không có thư mục được chọn' };
        }
        return { success: true, data: result.filePaths[0] };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Tải dữ liệu từ thư mục
ipcMain.handle('pickup:loadData', async (event, folderPath) => {
    try {
        if (!folderPath || !fs.existsSync(folderPath)) {
            return { success: false, error: 'Thư mục không tồn tại' };
        }

        pickupDataFolder = folderPath;
        pickupLogFile = path.join(folderPath, 'Pickup.xlsx');

        const { data, fileCount } = extractTrackingNumbers(folderPath);
        pickupTrackingData = data;
        pickupHistory = loadPickupLog(pickupLogFile);

        const shopeeCount = data.filter(d => d.source === 'Shopee').length;
        const tiktokCount = data.filter(d => d.source.includes('TikTok')).length;

        console.log(`[Pickup] Loaded ${data.length} tracking numbers from ${fileCount} files`);

        return {
            success: true,
            data: {
                totalOrders: data.length,
                shopeeCount,
                tiktokCount,
                scannedCount: pickupHistory.length,
                remaining: data.length - pickupHistory.length,
                fileCount,
            },
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Quét mã vận đơn
ipcMain.handle('pickup:scan', async (event, trackingNumber) => {
    try {
        const trimmed = normalizeStr(trackingNumber);
        if (!trimmed) {
            return { success: false, error: 'Vui lòng nhập mã vận đơn', errorType: 'empty' };
        }

        if (pickupTrackingData.length === 0) {
            return { success: false, error: 'Chưa có dữ liệu. Vui lòng chọn thư mục và tải dữ liệu', errorType: 'no_data' };
        }

        // Kiểm tra đã quét chưa
        const alreadyScanned = pickupHistory.some(h => h.trackingNumber === trimmed);
        if (alreadyScanned) {
            return { success: false, error: `Mã ${trimmed} đã pickup rồi!`, errorType: 'duplicate' };
        }

        // Tìm kiếm
        const matches = pickupTrackingData.filter(d => d.trackingNumber === trimmed);
        if (matches.length === 0) {
            return { success: false, error: `Không tìm thấy: ${trimmed}`, errorType: 'not_found' };
        }

        // Ưu tiên Shopee
        const shopeeMatch = matches.find(m => m.source === 'Shopee');
        const match = shopeeMatch || matches[0];

        const scannedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);

        const historyEntry = {
            trackingNumber: trimmed,
            orderNumber: match.orderNumber || '',
            source: match.source,
            file: match.file,
            scannedAt,
            items: match.items || '[]',
            shippingProvider: match.shippingProvider || '',
            totalAmount: match.totalAmount || 0,
            status: 'scanned',
        };

        pickupHistory.push(historyEntry);

        // Lưu vào Pickup.xlsx
        try {
            savePickupLog(pickupLogFile, pickupHistory);
        } catch (e) {
            console.error('[Pickup] Error saving:', e.message);
        }

        return {
            success: true,
            data: {
                trackingNumber: trimmed,
                source: match.source,
                sourceRaw: match.source,
                file: match.file,
                scannedAt,
                orderNumber: match.orderNumber || String(pickupHistory.length),
            },
        };
    } catch (error) {
        return { success: false, error: error.message, errorType: 'system' };
    }
});

// Lấy lịch sử quét
ipcMain.handle('pickup:getHistory', async (event, limit = 10) => {
    try {
        const recent = [...pickupHistory].reverse().slice(0, limit);
        return { success: true, data: recent };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Lấy thống kê
ipcMain.handle('pickup:getStats', async () => {
    try {
        const shopeeCount = pickupTrackingData.filter(d => d.source === 'Shopee').length;
        const tiktokCount = pickupTrackingData.filter(d => d.source.includes('TikTok')).length;

        return {
            success: true,
            data: {
                totalOrders: pickupTrackingData.length,
                shopeeCount,
                tiktokCount,
                scannedCount: pickupHistory.length,
                remaining: pickupTrackingData.length - pickupHistory.length,
            },
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Gửi thông báo Telegram
ipcMain.handle('pickup:sendTelegram', async (event, { token, chatId, message }) => {
    try {
        if (!token || !chatId || !message) {
            return { success: false, error: 'Thiếu thông tin Telegram' };
        }

        return new Promise((resolve) => {
            const postData = JSON.stringify({ chat_id: chatId, text: message });
            const options = {
                hostname: 'api.telegram.org',
                path: `/bot${token}/sendMessage`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                },
                timeout: 5000,
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ success: res.statusCode === 200 }));
            });

            req.on('error', (e) => resolve({ success: false, error: e.message }));
            req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Timeout' }); });
            req.write(postData);
            req.end();
        });
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Xuất file Pickup
ipcMain.handle('pickup:exportPickup', async () => {
    try {
        const result = await dialog.showSaveDialog({
            title: 'Xuất file Pickup',
            defaultPath: `Pickup_${new Date().toISOString().slice(0, 10)}.xlsx`,
            filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        });

        if (result.canceled || !result.filePath) {
            return { success: false, error: 'Đã hủy xuất file' };
        }

        savePickupLog(result.filePath, pickupHistory);
        return { success: true, data: result.filePath };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ========================================
// PICKUP - AUTO WATCH THƯ MỤC
// ========================================

let pickupWatcher = null;
let pickupWatchFolder = '';
let pickupKnownFiles = new Set();

// Chọn thư mục + bắt đầu theo dõi
ipcMain.handle('pickup:selectAndWatch', async () => {
    try {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Chọn thư mục chứa file đơn hàng (sẽ tự động import)',
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: 'Không có thư mục được chọn' };
        }

        const folderPath = result.filePaths[0];

        // Lấy danh sách file hiện có
        const existingFiles = fs.readdirSync(folderPath).filter(f => {
            const ext = path.extname(f).toLowerCase();
            return ['.xlsx', '.xls', '.csv'].includes(ext) && !f.startsWith('~$');
        });

        pickupKnownFiles = new Set(existingFiles);
        pickupWatchFolder = folderPath;

        // Dừng watcher cũ nếu có
        if (pickupWatcher) {
            pickupWatcher.close();
            pickupWatcher = null;
        }

        // Bắt đầu theo dõi thư mục
        let debounceTimer = null;
        pickupWatcher = fs.watch(folderPath, (eventType, filename) => {
            if (!filename) return;
            const ext = path.extname(filename).toLowerCase();
            if (!['.xlsx', '.xls', '.csv'].includes(ext)) return;
            if (filename.startsWith('~$')) return; // File tạm Excel

            // Debounce 2 giây (file có thể đang copy)
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const filePath = path.join(folderPath, filename);

                // Chỉ xử lý file MỚI (chưa có trong danh sách)
                if (!pickupKnownFiles.has(filename) && fs.existsSync(filePath)) {
                    console.log(`📁 [AutoWatch] File mới: ${filename}`);
                    pickupKnownFiles.add(filename);

                    // Đọc file và gửi về frontend
                    try {
                        const fileBuffer = fs.readFileSync(filePath);
                        const base64 = fileBuffer.toString('base64');

                        // Gửi event về tất cả cửa sổ
                        const { BrowserWindow } = require('electron');
                        const windows = BrowserWindow.getAllWindows();
                        for (const win of windows) {
                            win.webContents.send('pickup:newFile', {
                                name: filename,
                                base64: base64,
                                path: filePath
                            });
                        }
                        console.log(`✅ [AutoWatch] Đã gửi ${filename} về frontend`);
                    } catch (readErr) {
                        console.error(`❌ [AutoWatch] Lỗi đọc file ${filename}:`, readErr.message);
                    }
                }
            }, 2000);
        });

        console.log(`👁️ [AutoWatch] Đang theo dõi: ${folderPath} (${existingFiles.length} file có sẵn)`);

        return {
            success: true,
            data: {
                folderPath,
                existingFiles: existingFiles.length
            }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Dừng theo dõi
ipcMain.handle('pickup:stopWatch', async () => {
    if (pickupWatcher) {
        pickupWatcher.close();
        pickupWatcher = null;
        pickupWatchFolder = '';
        pickupKnownFiles.clear();
        console.log('🛑 [AutoWatch] Đã dừng theo dõi');
        return { success: true };
    }
    return { success: false, error: 'Không có watcher nào đang chạy' };
});

// Đọc tất cả file Excel trong thư mục (trả về base64, không mở dialog)
ipcMain.handle('pickup:readFolderFiles', async (event, folderPath) => {
    try {
        if (!folderPath || !fs.existsSync(folderPath)) {
            return { success: false, error: 'Thư mục không tồn tại' };
        }

        const excelFiles = fs.readdirSync(folderPath).filter(f => {
            const ext = path.extname(f).toLowerCase();
            return ['.xlsx', '.xls', '.csv'].includes(ext) && !f.startsWith('~$');
        });

        const files = [];
        for (const filename of excelFiles) {
            try {
                const filePath = path.join(folderPath, filename);
                const buffer = fs.readFileSync(filePath);
                files.push({
                    name: filename,
                    base64: buffer.toString('base64')
                });
            } catch (e) {
                console.warn(`⚠️ Không đọc được ${filename}:`, e.message);
            }
        }

        console.log(`📂 [ReadFolder] Đọc ${files.length}/${excelFiles.length} files từ ${folderPath}`);
        return { success: true, data: files };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Bắt đầu theo dõi trực tiếp (không dialog — dùng khi auto-restore)
ipcMain.handle('pickup:startWatch', async (event, folderPath) => {
    try {
        if (!folderPath || !fs.existsSync(folderPath)) {
            return { success: false, error: 'Thư mục không tồn tại' };
        }

        // Lấy danh sách file hiện có
        const existingFiles = fs.readdirSync(folderPath).filter(f => {
            const ext = path.extname(f).toLowerCase();
            return ['.xlsx', '.xls', '.csv'].includes(ext) && !f.startsWith('~$');
        });

        pickupKnownFiles = new Set(existingFiles);
        pickupWatchFolder = folderPath;

        // Dừng watcher cũ nếu có
        if (pickupWatcher) {
            pickupWatcher.close();
            pickupWatcher = null;
        }

        // Bắt đầu theo dõi
        let debounceTimer = null;
        pickupWatcher = fs.watch(folderPath, (eventType, filename) => {
            if (!filename) return;
            const ext = path.extname(filename).toLowerCase();
            if (!['.xlsx', '.xls', '.csv'].includes(ext)) return;
            if (filename.startsWith('~$')) return;

            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const filePath = path.join(folderPath, filename);
                if (!pickupKnownFiles.has(filename) && fs.existsSync(filePath)) {
                    console.log(`📁 [AutoWatch] File mới: ${filename}`);
                    pickupKnownFiles.add(filename);
                    try {
                        const fileBuffer = fs.readFileSync(filePath);
                        const base64 = fileBuffer.toString('base64');
                        const { BrowserWindow } = require('electron');
                        const windows = BrowserWindow.getAllWindows();
                        for (const win of windows) {
                            win.webContents.send('pickup:newFile', {
                                name: filename, base64, path: filePath
                            });
                        }
                        console.log(`✅ [AutoWatch] Đã gửi ${filename} về frontend`);
                    } catch (readErr) {
                        console.error(`❌ [AutoWatch] Lỗi đọc file ${filename}:`, readErr.message);
                    }
                }
            }, 2000);
        });

        console.log(`👁️ [AutoWatch-Restore] Đang theo dõi: ${folderPath} (${existingFiles.length} file có sẵn)`);

        return {
            success: true,
            data: { folderPath, existingFiles: existingFiles.length }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ========================================
// INVENTORY - UPDATE STOCK
// ========================================

// Update stock khi export hoặc cân bằng kho
function emitStockChanged(payload = {}) {
    try {
        const { BrowserWindow } = require('electron');
        const eventPayload = { ...payload, at: new Date().toISOString() };
        BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) win.webContents.send('products:stockChanged', eventPayload);
        });
    } catch (error) {
        console.warn('[stock-sync] emit failed:', error.message);
    }
}

ipcMain.handle('products:updateStock', async (event, { sku, quantity, isAdd = false, logContext = null, allowMissing = false }) => {
    try {
        requireRole('admin', 'manager', 'staff');
        console.log(`📦 Update stock: SKU=${sku}, Qty=${quantity}, Add=${isAdd}`);

        if (!prisma) {
            throw new Error('Database chưa được khởi tạo.');
        }

        const delta = isAdd ? quantity : -quantity;

        // Bọc toàn bộ vào 1 Transaction duy nhất
        // 🔒 StockMutex: serialize stock operations — tránh race condition
        const response = await withStockLock(() => getPrismaDirectTx().$transaction(async (tx) => {
            // 🎁 CHECK IF SKU IS A COMBO
            const combo = await tx.comboProduct.findUnique({
                where: { sku }
            });

            if (combo) {
                // ⭐ THIS IS A COMBO - Update stock for components
                const action = isAdd ? 'Adding' : 'Deducting';
                console.log(`🎁 Detected COMBO (${action}): ${combo.name}`);
                const items = JSON.parse(combo.items || '[]');

                const updateResults = [];
                for (const item of items) {
                    const componentQty = item.quantity * quantity; // Qty per combo × combos sold
                    const componentDelta = isAdd ? componentQty : -componentQty;
                    console.log(`  → ${action} ${componentQty} ${isAdd ? 'to' : 'from'} ${item.sku}`);

                    const updateResult = await updateProductStockInTx(tx, item.sku, componentDelta, logContext, { allowMissing });
                    updateResults.push(updateResult);
                }

                console.log(`✅ Combo ${sku}: ${action} ${quantity} combo(s)`);
                return { success: true, isCombo: true, deductResults: updateResults };
            }

            // Regular product/variant stock update
            const result = await updateProductStockInTx(tx, sku, delta, logContext, { allowMissing });
            if (result === false) {
                // allowMissing=true và không tìm thấy SKU
                return { success: false, skipped: true, error: `SKU "${sku}" không tìm thấy trong kho` };
            }
            return { success: true, data: result };
        }, { timeout: 30000, maxWait: 10000 }));
        if (response?.success) {
            emitStockChanged({
                sku,
                quantity,
                isAdd,
                referenceType: logContext?.referenceType || null,
                reference: logContext?.reference || null,
            });
        }
        return response;
    } catch (error) {
        console.error('❌ Update stock error:', error);
        return { success: false, error: error.message };
    }
});

/**
 * 🚀 BATCH OPTIMIZATION HELPERS — tối ưu import/delete hàng loạt
 */

/**
 * Xây cache SKU → Product/Variant 1 lần duy nhất cho cả batch.
 * Thay vì full table scan mỗi lần tìm variant, cache O(1) lookup.
 */
async function buildSkuCache(tx) {
    const allProducts = await tx.product.findMany({
        select: { id: true, sku: true, name: true, stock: true, unit: true, cost: true, variants: true }
    });
    const allCombos = await tx.comboProduct.findMany({
        select: { id: true, sku: true, name: true, items: true }
    });

    const productMap = new Map(); // sku → { product, isVariant, variantIndex }
    const comboMap = new Map();   // sku → { combo, items[] }

    for (const p of allProducts) {
        productMap.set(p.sku, { product: p, isVariant: false, variantIndex: -1 });
        if (p.variants) {
            try {
                const variants = JSON.parse(p.variants);
                for (let i = 0; i < variants.length; i++) {
                    if (variants[i].sku) {
                        productMap.set(variants[i].sku, { product: p, isVariant: true, variantIndex: i });
                    }
                }
            } catch { }
        }
    }

    for (const c of allCombos) {
        let items = [];
        try { items = typeof c.items === 'string' ? JSON.parse(c.items) : (c.items || []); } catch { }
        comboMap.set(c.sku, { combo: c, items });
    }

    return { productMap, comboMap };
}

/**
 * Batch stock update: gom tất cả SKU thay đổi → nhóm theo SKU → 1 lần update/SKU.
 * @param {object} tx - Prisma transaction
 * @param {Array<{sku: string, quantity: number}>} skuChanges - Danh sách {sku, quantity} (quantity < 0 = trừ kho)
 * @param {object} logContext - Context log cho inventory
 * @param {object} skuCache - Cache từ buildSkuCache()
 */
async function batchStockUpdate(tx, skuChanges, logContext, skuCache) {
    const { productMap, comboMap } = skuCache;

    // Bước 1: Resolve combo → flat list of actual SKU changes
    const flatChanges = new Map(); // sku → tổng quantity
    for (const { sku, quantity } of skuChanges) {
        const combo = comboMap.get(sku);
        if (combo) {
            for (const ci of combo.items) {
                const componentQty = ci.quantity * Math.abs(quantity);
                const delta = quantity < 0 ? -componentQty : componentQty;
                flatChanges.set(ci.sku, (flatChanges.get(ci.sku) || 0) + delta);
            }
        } else {
            flatChanges.set(sku, (flatChanges.get(sku) || 0) + quantity);
        }
    }

    // Bước 2: Lookup user ID 1 lần
    let createdById = null;
    if (logContext.createdBy) {
        if (typeof logContext.createdBy === 'string') {
            const user = await tx.user.findUnique({ where: { username: logContext.createdBy } });
            createdById = user ? user.id : null;
        } else if (typeof logContext.createdBy === 'number') {
            createdById = logContext.createdBy;
        }
    }

    // Bước 3: Update stock + create log cho mỗi SKU (đã gom)
    for (const [sku, totalQty] of flatChanges) {
        const info = productMap.get(sku);
        if (!info) {
            console.warn(`⚠️ [Batch] Bỏ qua SKU ${sku} — không tìm thấy sản phẩm`);
            continue;
        }

        const { product, isVariant, variantIndex } = info;
        let oldStock = 0, newStock = 0, variantColor = null;

        if (isVariant) {
            // ⚠️ Đọc variants MỚI NHẤT từ cache (có thể đã bị update bởi variant khác cùng product)
            let variants = JSON.parse(product.variants);
            oldStock = variants[variantIndex].stock || 0;
            newStock = oldStock + totalQty;
            variants[variantIndex].stock = newStock;
            variantColor = variants[variantIndex].color || variants[variantIndex].name || null;

            const updatedVariantsStr = JSON.stringify(variants);
            await tx.product.update({
                where: { id: product.id },
                data: { variants: updatedVariantsStr }
            });
            // 🔧 SYNC CACHE: cập nhật product.variants trong cache
            // để variant khác cùng product đọc đúng data mới nhất
            product.variants = updatedVariantsStr;
        } else {
            oldStock = product.stock || 0;
            const op = totalQty >= 0 ? { increment: totalQty } : { decrement: Math.abs(totalQty) };
            const updated = await tx.product.update({
                where: { id: product.id },
                data: { stock: op }
            });
            newStock = updated.stock;
            // 🔧 SYNC CACHE cho non-variant
            product.stock = newStock;
        }

        await tx.inventoryLog.create({
            data: {
                productId: product.id, productName: product.name,
                variantColor, sku, type: logContext.type,
                referenceType: logContext.referenceType, reference: logContext.reference,
                quantity: totalQty, oldStock, newStock,
                note: logContext.note || '', createdBy: createdById
            }
        });
    }

    return flatChanges.size;
}

/**
 * Deduct/restore stock cho 1 item — tự động expand nếu là ComboProduct.
 * Dùng thay cho updateProductStockInTx khi xử lý TMDT/POS items.
 */
async function deductItemOrCombo(tx, variantSku, quantity, logContext, options = {}) {
    const combo = await tx.comboProduct.findUnique({ where: { sku: variantSku } });
    if (combo) {
        let comboItems = [];
        try { comboItems = typeof combo.items === 'string' ? JSON.parse(combo.items) : (combo.items || []); } catch { }
        for (const ci of comboItems) {
            const componentQty = ci.quantity * Math.abs(quantity);
            const delta = quantity < 0 ? -componentQty : componentQty;
            await updateProductStockInTx(tx, ci.sku, delta, logContext, options);
        }
    } else {
        await updateProductStockInTx(tx, variantSku, quantity, logContext, options);
    }
}

/**
 * Hàm lõi do AI Agent cập nhật theo "Mệnh lệnh tối cao":
 * Bắt buộc 100% chạy trong Prisma Transaction, kèm logContext.
 */
async function updateProductStockInTx(tx, sku, quantity, logContext, options = {}) {
    if (!logContext || !logContext.type || !logContext.referenceType || !logContext.reference) {
        throw new Error(`[Inventory Error] Thiếu logContext cho SKU: ${sku}. Không thể cập nhật kho mà không có lý do.`);
    }

    let product = await tx.product.findUnique({ where: { sku } });
    let isVariant = false;

    if (!product) {
        const products = await tx.product.findMany({
            where: { variants: { contains: sku } }
        });
        for (const p of products) {
            if (p.variants) {
                try {
                    const variants = JSON.parse(p.variants);
                    if (variants.some(v => v.sku === sku)) {
                        product = p;
                        isVariant = true;
                        break;
                    }
                } catch { }
            }
        }
    }

    if (!product) {
        if (options.allowMissing) {
            console.warn(`⚠️ [Inventory Warning] Bỏ qua trừ kho - Sản phẩm với SKU ${sku} không tồn tại.`);
            return false;
        }
        throw new Error(`Sản phẩm với SKU ${sku} không tồn tại.`);
    }

    let oldStock = 0;
    let newStock = 0;
    let variantColor = null;

    if (isVariant) {
        let variants = JSON.parse(product.variants);
        const variantIndex = variants.findIndex(v => v.sku === sku);
        if (variantIndex < 0) throw new Error(`Variant ${sku} không tìm thấy`);

        oldStock = variants[variantIndex].stock || 0;
        newStock = oldStock + quantity;
        variants[variantIndex].stock = newStock;
        variantColor = variants[variantIndex].color || variants[variantIndex].name || null;

        // Lưu biến thể: Bắt buộc serialize xuống JSON, phó thác cho Transaction Sequential của SQLite
        await tx.product.update({
            where: { id: product.id },
            data: { variants: JSON.stringify(variants) }
        });
    } else {
        // [VÁ LỖI RACE CONDITION] Dùng cơ chế Atomic Increment của Database cho trường Integer Native
        oldStock = product.stock || 0;
        const op = quantity >= 0 ? { increment: quantity } : { decrement: Math.abs(quantity) };
        const updatedProduct = await tx.product.update({
            where: { id: product.id },
            data: { stock: op }
        });
        newStock = updatedProduct.stock;
    }

    // Tạo bản ghi Thẻ kho NẰM TRONG TRANSACTION
    let createdById = null;
    if (logContext.createdBy) {
        if (typeof logContext.createdBy === 'string') {
            const user = await tx.user.findUnique({ where: { username: logContext.createdBy } });
            createdById = user ? user.id : null;
        } else if (typeof logContext.createdBy === 'number') {
            createdById = logContext.createdBy;
        }
    }

    await tx.inventoryLog.create({
        data: {
            productId: product.id,
            productName: product.name,
            variantColor: variantColor,
            sku: sku,
            type: logContext.type,
            referenceType: logContext.referenceType,
            reference: logContext.reference,
            quantity: quantity,
            oldStock: oldStock,
            newStock: newStock,
            note: logContext.note || '',
            createdBy: createdById
        }
    });

    return { oldStock, newStock };
}

// ========================================
// POS ORDER - BÁN HÀNG TẠI QUẦY
// ========================================

// Tạo đơn hàng POS (thanh toán)
ipcMain.handle('posOrder:create', async (event, data) => {
    try {
        if (!prisma) throw new Error('Database chưa được khởi tạo.');
        console.log('💰 [POS] Creating order...', JSON.stringify(data, null, 2));

        // 1. Generate order number: POS-YYYYMMDD-XXX (unique)
        const today = new Date();
        const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
        const prefix = `POS-${dateStr}-`;

        // Find the highest existing order number for today
        const lastOrder = await prisma.order.findFirst({
            where: {
                orderNumber: { startsWith: prefix }
            },
            orderBy: { orderNumber: 'desc' },
            select: { orderNumber: true }
        });

        let nextNum = 1;
        if (lastOrder && lastOrder.orderNumber) {
            const lastNumStr = lastOrder.orderNumber.replace(prefix, '');
            const lastNum = parseInt(lastNumStr, 10);
            if (!isNaN(lastNum)) nextNum = lastNum + 1;
        }
        const orderNumber = `${prefix}${String(nextNum).padStart(3, '0')}`;

        // 2. Calculate totals
        const items = data.items || [];
        const subtotal = items.reduce((sum, item) => sum + (item.price * item.qty), 0);
        const totalCost = items.reduce((sum, item) => sum + (item.cost * item.qty), 0);
        const discount = data.discount || 0;
        const total = subtotal - discount;
        const profit = total - totalCost;

        // 3. Create Order + OrderItems + Payment in transaction
        // Lookup userId from userName for createdBy
        let createdByUserId = null;
        if (data.userName) {
            try {
                const user = await prisma.user.findFirst({
                    where: {
                        OR: [
                            { username: data.userName },
                            { fullName: data.userName }
                        ]
                    },
                    select: { id: true }
                });
                if (user) createdByUserId = user.id;
            } catch (e) {
                console.log('  ⚠️ Could not find user:', data.userName);
            }
        }

        const paidAmount = data.paidAmount || 0;
        const paymentStatus = paidAmount >= total ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

        // 🔒 StockMutex: serialize stock operations — tránh race condition Thẻ Kho
        const order = await withStockLock(() => getPrismaDirectTx().$transaction(async (tx) => {
            // Create Order
            const newOrder = await tx.order.create({
                data: {
                    orderNumber,
                    customerId: data.customerId || null,
                    source: 'pos',
                    status: 'completed',
                    paymentStatus,
                    paymentMethod: data.paymentMethod || 'cash',
                    subtotal,
                    discount,
                    total,
                    profit,
                    note: data.note || null,
                    createdBy: createdByUserId,
                }
            });

            // Create OrderItems
            for (const item of items) {
                await tx.orderItem.create({
                    data: {
                        orderId: newOrder.id,
                        productId: item.productId,
                        sku: item.sku,
                        productName: item.name,
                        variant: item.variant || null,
                        quantity: item.qty,
                        price: item.price,
                        cost: item.cost,
                        subtotal: item.price * item.qty,
                    }
                });
            }

            // Create Payment
            await tx.payment.create({
                data: {
                    orderId: newOrder.id,
                    method: data.paymentMethod || 'cash',
                    amount: data.paidAmount || total,
                    note: data.paymentNote || null,
                }
            });

            // 4. Deduct stock and log inside transaction (atomic)
            for (const item of items) {
                try {
                    await updateProductStockInTx(tx, item.sku, -item.qty, {
                        type: 'pos_sale',
                        referenceType: 'POS',
                        reference: orderNumber,
                        note: `Bán POS: ${item.name} x${item.qty}`,
                        createdBy: createdByUserId
                    });
                } catch (stockErr) {
                    throw new Error(`Lỗi kho SKU ${item.sku}: ${stockErr.message}`);
                }
            }

            return newOrder;
        }, { timeout: 30000, maxWait: 10000 }));

        // 5. Activity Log
        try {
            await prisma.activityLog.create({
                data: {
                    module: 'sales',
                    action: 'CREATE',
                    description: `Bán hàng POS: ${orderNumber} - ${items.length} SP - ${new Intl.NumberFormat('vi-VN').format(total)}đ (${data.paymentMethod || 'cash'})`,
                    userName: data.userName || 'System',
                    severity: 'INFO',
                    details: JSON.stringify({
                        orderNumber,
                        itemCount: items.length,
                        total,
                        profit,
                        paymentMethod: data.paymentMethod,
                    }),
                }
            });
        } catch (logErr) {
            console.error('  ⚠️ Activity log failed:', logErr.message);
        }

        console.log(`✅ [POS] Order created: ${orderNumber}, Total: ${total}`);
        return { success: true, data: { ...order, orderNumber } };
    } catch (error) {
        console.error('❌ [POS] Create order error:', error.message);
        return { success: false, error: error.message };
    }
});

// Lấy danh sách đơn hàng POS
ipcMain.handle('posOrder:getAll', async (event, filters = {}) => {
    try {
        if (!prisma) throw new Error('Database chưa được khởi tạo.');

        const where = { source: 'pos' };

        // Mặc định ẩn đơn đã hủy — trừ khi explicitly yêu cầu status cụ thể
        if (filters.status) {
            where.status = filters.status;
        } else {
            where.status = { not: 'cancelled' };
        }

        // Filter by date
        if (filters.startDate || filters.endDate) {
            where.createdAt = {};
            if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
            if (filters.endDate) {
                const end = new Date(filters.endDate);
                end.setHours(23, 59, 59, 999);
                where.createdAt.lte = end;
            }
        }

        // Filter by payment method
        if (filters.paymentMethod) {
            where.paymentMethod = filters.paymentMethod;
        }

        // Search mode: bỏ qua date filter, tìm theo mã đơn/khách hàng
        if (filters.search) {
            const trimmedSearch = String(filters.search).trim();
            const syntheticIdMatch = trimmedSearch.match(/^#?POS-(\d+)$/i);
            const numericId = syntheticIdMatch ? Number(syntheticIdMatch[1]) : null;
            delete where.createdAt;
            where.OR = [
                { orderNumber: { contains: filters.search, mode: 'insensitive' } },
                { customerName: { contains: filters.search, mode: 'insensitive' } },
                { trackingNumber: { contains: filters.search, mode: 'insensitive' } },
                ...(numericId ? [{ id: numericId }] : []),
            ];
        }

        const orders = await prisma.order.findMany({
            where,
            select: {
                id: true, orderNumber: true, source: true, status: true,
                total: true, subtotal: true, discount: true, note: true,
                trackingNumber: true, paymentMethod: true,
                createdAt: true, updatedAt: true,
                customer: { select: { name: true } },
                user: { select: { username: true, fullName: true } },
                items: { select: { productId: true, productName: true, sku: true, variant: true, quantity: true, price: true, subtotal: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: filters.search ? 50 : (filters.limit || 200),
        });

        // Map userName from user relation for frontend
        const ordersWithUser = orders.map(o => ({
            ...o,
            userName: o.user?.username || o.user?.fullName || null,
        }));

        console.log(`✅ [POS] Loaded ${orders.length} POS orders`);
        return { success: true, data: ordersWithUser };
    } catch (error) {
        console.error('❌ [POS] Get orders error:', error.message);
        return { success: false, error: error.message };
    }
});

// Xem chi tiết đơn hàng POS
ipcMain.handle('posOrder:getById', async (event, id) => {
    try {
        if (!prisma) throw new Error('Database chưa được khởi tạo.');
        const order = await prisma.order.findUnique({
            where: { id },
            include: { items: true, payments: true, customer: true },
        });
        return { success: true, data: order };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Sửa đơn hàng POS (note, discount, items)
ipcMain.handle('posOrder:update', async (event, { id, note, discount, items, paymentMethod, userName }) => {
    try {
        if (!prisma) throw new Error('Database chưa được khởi tạo.');

        // Lấy đơn cũ
        const oldOrder = await prisma.order.findUnique({
            where: { id },
            include: { items: true },
        });
        if (!oldOrder) throw new Error('Không tìm thấy đơn hàng.');
        if (oldOrder.status === 'cancelled') throw new Error('Đơn hàng đã hủy, không thể sửa.');

        // Tính lại tổng tiền
        const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
        const disc = discount ?? 0;
        const total = subtotal - disc;
        const totalCost = items.reduce((s, it) => s + (it.cost || 0) * it.qty, 0);
        const profit = total - totalCost;

        // Resolve user ID before transaction to avoid tx.user.findUnique inside tx
        let resolvedCreatedById = null;
        if (userName) {
            const resolvedUser = await prisma.user.findFirst({
                where: { OR: [{ username: userName }, { fullName: userName }] },
                select: { id: true }
            });
            resolvedCreatedById = resolvedUser ? resolvedUser.id : null;
        }


        // 🔒 StockMutex: serialize stock operations — tránh race condition Thẻ Kho
        await withStockLock(() => getPrismaDirectTx().$transaction(async (tx) => {
            // 1. Hoàn lại kho theo items cũ
            for (const oldItem of oldOrder.items) {
                await updateProductStockInTx(tx, oldItem.sku, oldItem.quantity, {
                    type: 'adjustment',
                    referenceType: 'POS_EDIT',
                    reference: oldOrder.orderNumber,
                    note: `Hoàn tồn (sửa đơn POS #${oldOrder.orderNumber})`,
                    createdBy: resolvedCreatedById
                });
            }

            // 2. Cập nhật order
            await tx.order.update({
                where: { id },
                data: { note: note ?? null, discount: disc, subtotal, total, profit, paymentMethod: paymentMethod || oldOrder.paymentMethod },
            });

            // 3. Xóa items cũ, thêm items mới
            await tx.orderItem.deleteMany({ where: { orderId: id } });
            for (const it of items) {
                await tx.orderItem.create({
                    data: {
                        orderId: id,
                        productId: it.productId || null,
                        sku: it.sku,
                        productName: it.name,
                        variant: it.variant || null,
                        quantity: it.qty,
                        price: it.price,
                        cost: it.cost || 0,
                        subtotal: it.price * it.qty,
                    },
                });

                // 4. Trừ kho theo items mới
                await updateProductStockInTx(tx, it.sku, -it.qty, {
                    type: 'pos_sale',
                    referenceType: 'POS_EDIT',
                    reference: oldOrder.orderNumber,
                    note: `Trừ tồn mới (sửa đơn POS #${oldOrder.orderNumber})`,
                    createdBy: resolvedCreatedById
                });
            }

            // 5. Cập nhật payment
            await tx.payment.updateMany({
                where: { orderId: id },
                data: { method: paymentMethod || oldOrder.paymentMethod, amount: total },
            });
        }, { timeout: 30000, maxWait: 10000 }));

        void logActivity({ module: 'sales', action: 'UPDATE', description: `Sửa đơn POS #${oldOrder.orderNumber}`, userName: userName || 'System' });
        return { success: true };
    } catch (error) {
        console.error('❌ [POS] Update order error:', error.message);
        return { success: false, error: error.message };
    }
});

// Xóa đơn hàng POS (hoàn kho) - KHÔNG XÓA CỨNG (Soft Cancel)
ipcMain.handle('posOrder:delete', async (event, { id, userName }) => {
    console.log(`🗑️ [DELETE] posOrder:delete called, id=${id}, type=${typeof id}`);
    try {
        if (!prisma) throw new Error('Database chưa được khởi tạo.');

        const order = await prisma.order.findUnique({
            where: { id },
            include: { items: true },
        });
        console.log(`🗑️ [DELETE] order found:`, order ? `#${order.orderNumber} status=${order.status} items=${order.items.length}` : 'NOT FOUND');
        if (!order) throw new Error('Không tìm thấy đơn hàng.');
        if (order.status === 'cancelled') return { success: true };

        // 🔒 StockMutex: serialize stock operations — tránh race condition Thẻ Kho
        await withStockLock(() => getPrismaDirectTx().$transaction(async (tx) => {
            // Hoàn kho — dùng deductItemOrCombo để xử lý cả combo SKU
            const logCtx = {
                type: 'adjustment',
                referenceType: 'POS_CANCEL',
                reference: order.orderNumber,
                note: `Hoàn tồn do hủy đơn POS ${order.orderNumber}`,
                createdBy: userName || 'System'
            };
            for (const item of order.items) {
                // +quantity = cộng lại kho (vì đang hủy đơn bán)
                await deductItemOrCombo(tx, item.sku, item.quantity, logCtx, { allowMissing: true });
            }
            // Cập nhật trạng thái phiếu thay vì xóa cứng
            await tx.order.update({ where: { id }, data: { status: 'cancelled' } });

            // Xóa payment liên quan nếu cần thiết hoặc đánh dấu hủy (tạm comment delete payment)
            // await tx.payment.deleteMany({ where: { orderId: id } });
        }, { timeout: 30000, maxWait: 10000 }));

        void logActivity({ module: 'sales', action: 'DELETE', description: `Hủy đơn POS #${order.orderNumber}`, userName: userName || 'System' });
        return { success: true };
    } catch (error) {
        console.error('❌ [POS] Cancel order error:', error.message);
        return { success: false, error: error.message };
    }
});

// ========================================
// ACTIVITY LOG HANDLERS
// ========================================

// Get all activity logs with filters
ipcMain.handle('activityLog:getAll', async (event, filters = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        const { module, action, startDate, endDate, limit = 100 } = filters;

        const where = {};
        if (module) where.module = module;
        if (action) where.action = action;
        if (startDate || endDate) {
            where.timestamp = {};
            if (startDate) where.timestamp.gte = new Date(startDate);
            if (endDate) where.timestamp.lte = new Date(endDate);
        }

        const logs = await prisma.activityLog.findMany({
            where,
            orderBy: { timestamp: 'desc' },
            take: limit
        });

        return { success: true, data: logs };
    } catch (error) {
        console.error('❌ Get activity logs error:', error);
        return { success: false, error: error.message };
    }
});

// Create activity log
ipcMain.handle('activityLog:create', async (event, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        const log = await prisma.activityLog.create({
            data: {
                module: data.module,
                action: data.action,
                recordId: data.recordId,
                recordName: data.recordName,
                changes: data.changes ? (typeof data.changes === 'string' ? data.changes : JSON.stringify(data.changes)) : null,
                description: data.description,
                userName: data.userName || 'Admin',
                userId: data.userId,
                severity: data.severity || 'INFO',
                ipAddress: data.ipAddress,
                deviceInfo: data.deviceInfo
            }
        });

        console.log(`✅ Created activity log: ${data.description}`);
        return { success: true, data: log };
    } catch (error) {
        console.error('❌ Create activity log error:', error);
        return { success: false, error: error.message };
    }
});

// Get logs for specific record
ipcMain.handle('activityLog:getByRecord', async (event, { module, recordId }) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        const logs = await prisma.activityLog.findMany({
            where: {
                module,
                recordId
            },
            orderBy: { timestamp: 'desc' }
        });

        return { success: true, data: logs };
    } catch (error) {
        console.error('❌ Get record logs error:', error);
        return { success: false, error: error.message };
    }
});

// Get stats
ipcMain.handle('activityLog:getStats', async () => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        const [total, byModule, byAction, recent] = await Promise.all([
            prisma.activityLog.count(),
            prisma.activityLog.groupBy({
                by: ['module'],
                _count: true
            }),
            prisma.activityLog.groupBy({
                by: ['action'],
                _count: true
            }),
            prisma.activityLog.findMany({
                orderBy: { timestamp: 'desc' },
                take: 10
            })
        ]);

        return {
            success: true,
            data: {
                total,
                byModule,
                byAction,
                recent
            }
        };
    } catch (error) {
        console.error('❌ Get activity stats error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// PURCHASES HANDLERS
// ========================================

const PURCHASE_VAT_GROUPS_KEY = 'purchaseVatGroups_v1';
const PURCHASE_VAT_FILE_META_KEY = 'purchaseVatFileMeta_v1';

async function getPurchaseVatGroups() {
    if (!prisma) return {};
    const config = await prisma.appConfig.findUnique({ where: { key: PURCHASE_VAT_GROUPS_KEY } });
    if (!config?.value) return {};
    try {
        return JSON.parse(config.value) || {};
    } catch {
        return {};
    }
}

async function savePurchaseVatGroups(groups) {
    if (!prisma) throw new Error('Prisma not available');
    await prisma.appConfig.upsert({
        where: { key: PURCHASE_VAT_GROUPS_KEY },
        update: { value: JSON.stringify(groups) },
        create: { key: PURCHASE_VAT_GROUPS_KEY, value: JSON.stringify(groups) }
    });
}

async function getPurchaseVatFileMeta() {
    if (!prisma) return {};
    const config = await prisma.appConfig.findUnique({ where: { key: PURCHASE_VAT_FILE_META_KEY } });
    if (!config?.value) return {};
    try {
        return JSON.parse(config.value) || {};
    } catch {
        return {};
    }
}

async function savePurchaseVatFileMeta(meta) {
    if (!prisma) throw new Error('Prisma not available');
    await prisma.appConfig.upsert({
        where: { key: PURCHASE_VAT_FILE_META_KEY },
        update: { value: JSON.stringify(meta) },
        create: { key: PURCHASE_VAT_FILE_META_KEY, value: JSON.stringify(meta) }
    });
}

function generatePurchaseVatGroupId(existingGroups = {}) {
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
    const sameDayCount = Object.keys(existingGroups).filter(id => String(id).startsWith(`VATG-${datePart}-`)).length;
    return `VATG-${datePart}-${String(sameDayCount + 1).padStart(3, '0')}`;
}

function generateVatIdFromFile(fileName = '', fileSize = 0) {
    const normalizedName = String(fileName || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    const raw = `${normalizedName}|${Number(fileSize) || 0}`;
    const digest = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 8).toUpperCase();
    return `VAT-${digest}`;
}

// Get all purchases
ipcMain.handle('purchases:getAll', async (event, { since } = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const vatGroups = await getPurchaseVatGroups();
        const vatFileMeta = await getPurchaseVatFileMeta();

        const purchases = await prisma.purchaseOrder.findMany({
            where: {
                status: { not: 'cancelled' },
                ...(since ? { createdAt: { gte: new Date(since) } } : {})
            },
            select: {
                id: true,
                poNumber: true,
                status: true,
                subtotal: true,
                total: true,
                note: true,
                createdBy: true,
                receivedAt: true,
                createdAt: true,
                vatInvoiceStatus: true,
                vatInvoiceNumber: true,
                vatInvoiceDate: true,
                vatInvoiceFile: true,
                vatInvoiceDriveUrl: true,
                importReceiptStatus: true,
                importReceiptFile: true,
                importReceiptDriveUrl: true,
                supplier: { select: { id: true, name: true, code: true } },
                items: {
                    select: {
                        id: true,
                        productId: true,
                        quantity: true,
                        price: true,
                        subtotal: true,
                        color: true,
                        variantSku: true,
                        product: { select: { name: true, sku: true, unit: true } }
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 100 // ⚡ Giảm từ 300 → 100 phiếu gần nhất
        });

        const purchaseMap = new Map(purchases.map(p => [p.id, p]));
        const purchaseGroupMeta = new Map();

        // Detect purchases cùng vatId (chỉ để hiển thị, không ảnh hưởng logic VAT)
        const sameVatIdMap = new Map(); // purchaseId → [other purchase IDs]
        const vatIdGroups = new Map();
        purchases.forEach(p => {
            if (p.vatInvoiceStatus !== 'uploaded') return; // chỉ xét phiếu đang có VAT thực sự
            const fileMeta = vatFileMeta[String(p.id)];
            if (!fileMeta?.vatId) return;
            const key = `${p.supplierId || 'x'}::${fileMeta.vatId}`;
            if (!vatIdGroups.has(key)) vatIdGroups.set(key, []);
            vatIdGroups.get(key).push(p.id);
        });
        vatIdGroups.forEach(ids => {
            if (ids.length < 2) return;
            ids.forEach(id => sameVatIdMap.set(id, ids.filter(pid => pid !== id)));
        });

        Object.entries(vatGroups || {}).forEach(([groupId, group]) => {
            const purchaseIds = Array.isArray(group?.purchaseIds)
                ? group.purchaseIds.map(id => Number(id)).filter(id => purchaseMap.has(id))
                : [];
            if (purchaseIds.length === 0) return;

            purchaseIds.forEach(id => {
                purchaseGroupMeta.set(id, {
                    vatGroupId: groupId,
                    vatGroupNote: group?.note || '',
                    vatGroupPurchaseIds: purchaseIds,
                    vatGroupHasVat: !!group?.vatInvoiceFile,
                    vatGroupSourcePurchaseId: null,
                    vatGroupInvoiceNumber: group?.vatInvoiceNumber || null,
                    vatGroupInvoiceDate: group?.vatInvoiceDate || null,
                    vatGroupDriveUrl: group?.vatInvoiceDriveUrl || null,
                });
            });
        });

        // Format data for frontend
        const formatted = purchases.map(p => {
            // Convert PurchaseItem[] to frontend format
            const itemsFormatted = p.items.map(item => ({
                productId: item.productId,
                productName: item.product.name,
                sku: item.product.sku,
                quantity: item.quantity,
                unitPrice: item.price,
                total: item.subtotal,
                color: item.color || null, // 🎨 Đọc từ database
                variantSku: item.variantSku || null, // 🎨 Đọc từ database
                unit: item.product.unit || 'Cái' // Thêm unit
            }));

            const vatGroupMeta = purchaseGroupMeta.get(p.id) || {};
            const fileMeta = vatFileMeta[String(p.id)] || {};

            return {
                ...p,
                supplierName: p.supplier?.name,
                purchaseDate: p.receivedAt || p.createdAt,
                totalAmount: p.total, // Frontend expects 'totalAmount', DB has 'total'
                items: JSON.stringify(itemsFormatted), // Convert to JSON string for frontend
                notes: p.note,
                // HĐ VAT
                vatInvoiceNumber: p.vatInvoiceNumber,
                vatInvoiceDate: p.vatInvoiceDate,
                vatInvoiceFile: p.vatInvoiceFile,
                vatInvoiceDriveUrl: p.vatInvoiceDriveUrl,
                vatInvoiceStatus: p.vatInvoiceStatus,
                vatId: p.vatInvoiceStatus === 'uploaded' ? (fileMeta.vatId || null) : null,
                vatFileName: p.vatInvoiceStatus === 'uploaded' ? (fileMeta.fileName || null) : null,
                vatFileSize: p.vatInvoiceStatus === 'uploaded' ? (fileMeta.fileSize || null) : null,
                vatGroupId: vatGroupMeta.vatGroupId || null,
                vatGroupNote: vatGroupMeta.vatGroupNote || '',
                vatGroupPurchaseIds: vatGroupMeta.vatGroupPurchaseIds || [],
                vatGroupHasVat: !!vatGroupMeta.vatGroupHasVat,
                vatGroupSourcePurchaseId: vatGroupMeta.vatGroupSourcePurchaseId || null,
                vatGroupStatus: vatGroupMeta.vatGroupHasVat ? 'uploaded' : 'pending',
                vatGroupInvoiceNumber: vatGroupMeta.vatGroupInvoiceNumber || null,
                vatGroupInvoiceDate: vatGroupMeta.vatGroupInvoiceDate || null,
                vatGroupDriveUrl: vatGroupMeta.vatGroupDriveUrl || null,
                vatGroupVatId: vatGroups[vatGroupMeta.vatGroupId]?.vatId || null,
                vatGroupVatFileName: vatGroups[vatGroupMeta.vatGroupId]?.vatFileName || null,
                vatGroupVatFileSize: vatGroups[vatGroupMeta.vatGroupId]?.vatFileSize || null,
                sharedVatPurchaseIds: sameVatIdMap.get(p.id) || [],
                // Phiếu nhập kho
                importReceiptStatus: p.importReceiptStatus,
                importReceiptFile: p.importReceiptFile,
                importReceiptDriveUrl: p.importReceiptDriveUrl,
            };
        });

        return { success: true, data: formatted };
    } catch (error) {
        console.error('❌ Get purchases error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('purchases:createVatGroup', async (event, { purchaseIds = [], note = '' } = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        requireRole('admin', 'manager', 'staff');

        const normalizedIds = [...new Set((purchaseIds || []).map(id => Number(id)).filter(Boolean))];
        if (normalizedIds.length < 2) throw new Error('Cần chọn ít nhất 2 phiếu để gộp hóa đơn');

        const purchases = await prisma.purchaseOrder.findMany({
            where: { id: { in: normalizedIds }, status: { not: 'cancelled' } },
            select: { id: true, poNumber: true }
        });
        if (purchases.length !== normalizedIds.length) {
            throw new Error('Có phiếu nhập không hợp lệ hoặc đã bị hủy');
        }

        const vatGroups = await getPurchaseVatGroups();
        Object.keys(vatGroups).forEach(groupId => {
            const currentIds = Array.isArray(vatGroups[groupId]?.purchaseIds) ? vatGroups[groupId].purchaseIds.map(Number) : [];
            const remainingIds = currentIds.filter(id => !normalizedIds.includes(id));
            if (remainingIds.length >= 2) {
                vatGroups[groupId].purchaseIds = remainingIds;
            } else {
                delete vatGroups[groupId];
            }
        });

        const newGroupId = generatePurchaseVatGroupId(vatGroups);
        vatGroups[newGroupId] = {
            purchaseIds: normalizedIds,
            note: note || '',
            createdAt: new Date().toISOString(),
            vatInvoiceStatus: 'pending',
            vatInvoiceNumber: null,
            vatInvoiceDate: null,
            vatInvoiceFile: null,
            vatInvoiceDriveUrl: null,
            vatId: null,
            vatFileName: null,
            vatFileSize: null,
        };
        await savePurchaseVatGroups(vatGroups);

        void logActivity({
            module: 'purchases',
            action: 'VAT_GROUP_CREATE',
            description: `Tạo nhóm HĐ gộp ${newGroupId} cho ${purchases.map(p => p.poNumber || `#${p.id}`).join(', ')}`,
            userName: 'System',
        });

        return { success: true, data: { vatGroupId: newGroupId, purchaseIds: normalizedIds, note: note || '' } };
    } catch (error) {
        console.error('❌ Create VAT group error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('purchases:uploadVatGroupInvoice', async (event, { vatGroupId, invoiceNumber, invoiceDate, files = [], fileBase64, fileName }) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        requireRole('admin', 'manager', 'staff');

        const vatGroups = await getPurchaseVatGroups();
        const group = vatGroups[String(vatGroupId)];
        if (!group) throw new Error(`Không tìm thấy nhóm HĐ VAT ${vatGroupId}`);

        const purchaseIds = Array.isArray(group.purchaseIds) ? group.purchaseIds.map(Number).filter(Boolean) : [];
        if (purchaseIds.length < 2) throw new Error('Nhóm HĐ VAT không hợp lệ');

        const purchases = await prisma.purchaseOrder.findMany({
            where: { id: { in: purchaseIds }, status: { not: 'cancelled' } },
            include: { supplier: true },
        });
        if (purchases.length === 0) throw new Error('Không tìm thấy phiếu nhập trong nhóm VAT');

        const filesList = files.length > 0 ? files : (fileBase64 ? [{ fileBase64, fileName }] : []);
        if (filesList.length === 0) throw new Error('Vui lòng chọn ít nhất 1 file HĐ VAT cho nhóm');

        const userDataPath = app.getPath('userData');
        const vatDir = path.join(userDataPath, 'vat-invoices');
        if (!fs.existsSync(vatDir)) fs.mkdirSync(vatDir, { recursive: true });

        const localPaths = [];
        const driveUrls = [];
        const savedBuffers = [];
        const savedFileNames = [];
        let primaryVatMeta = null;

        for (let i = 0; i < filesList.length; i++) {
            const { fileBase64: b64, fileName: fn } = filesList[i];
            const ext = (fn || 'jpg').split('.').pop() || 'jpg';
            const suffix = filesList.length > 1 ? `_${i + 1}` : '';
            const localFileName = `VAT_GROUP_${vatGroupId}_${Date.now()}${suffix}.${ext}`;
            const localPath = path.join(vatDir, localFileName);

            const fileBuffer = Buffer.from(b64, 'base64');
            fs.writeFileSync(localPath, fileBuffer);
            localPaths.push(localPath);
            savedBuffers.push(fileBuffer);
            savedFileNames.push(localFileName);

            if (i === 0) {
                primaryVatMeta = {
                    fileName: fn || localFileName,
                    fileSize: fileBuffer.length,
                    vatId: generateVatIdFromFile(fn || localFileName, fileBuffer.length),
                };
            }

            try {
                const drive = getDriveClient();
                if (drive) {
                    const folderId = await getOrCreateVatDriveFolder();
                    if (folderId) {
                        const supplierName = purchases[0]?.supplier?.name || 'NCC';
                        const driveFileName = `HĐ_VAT_${supplierName}_${vatGroupId}_${invoiceNumber}${suffix}.${ext}`;
                        const result = await uploadToDrive(drive, folderId, driveFileName, fileBuffer, ext === 'pdf' ? 'application/pdf' : 'image/jpeg');
                        if (result) {
                            driveUrls.push(result.webViewLink);
                        }
                    }
                }
            } catch (driveErr) {
                console.error(`⚠️ Drive upload group VAT failed for file ${i + 1}:`, driveErr.message);
            }
        }

        vatGroups[String(vatGroupId)] = {
            ...group,
            vatInvoiceStatus: 'uploaded',
            vatInvoiceNumber: invoiceNumber,
            vatInvoiceDate: new Date(invoiceDate).toISOString(),
            vatInvoiceFile: localPaths.length === 1 ? localPaths[0] : JSON.stringify(localPaths),
            vatInvoiceDriveUrl: driveUrls.length === 0 ? null : (driveUrls.length === 1 ? driveUrls[0] : driveUrls.join('\n')),
            vatId: primaryVatMeta?.vatId || null,
            vatFileName: primaryVatMeta?.fileName || null,
            vatFileSize: primaryVatMeta?.fileSize || null,
            updatedAt: new Date().toISOString(),
        };
        await savePurchaseVatGroups(vatGroups);

        const purchaseNames = purchases.map(p => p.poNumber || `#${p.id}`).join(', ');
        const supplierName = purchases[0]?.supplier?.name || 'NCC';
        const telegramMsg = [
            `🧾 <b>HĐ VAT gộp mới</b>`,
            ``,
            `🔗 Nhóm VAT: <b>${vatGroupId}</b>`,
            `🏢 NCC: <b>${supplierName}</b>`,
            `📋 Phiếu nhập: <b>${purchaseNames}</b>`,
            `🔢 Số HĐ: <b>${invoiceNumber}</b>`,
            `📅 Ngày HĐ: <b>${new Date(invoiceDate).toLocaleDateString('vi-VN')}</b>`,
            filesList.length > 1 ? `📎 <b>${filesList.length} files đính kèm</b>` : '',
            driveUrls[0] ? `\n📎 <a href="${driveUrls[0]}">Xem trên Drive</a>` : '',
        ].filter(Boolean).join('\n');

        sendVatTelegramMessage(telegramMsg).catch(err => console.error('Telegram group VAT error:', err));
        for (let i = 0; i < savedBuffers.length; i++) {
            sendVatTelegramDocument(savedBuffers[i], savedFileNames[i],
                `HĐ VAT nhóm ${vatGroupId} #${invoiceNumber}${savedBuffers.length > 1 ? ` [${i + 1}/${savedBuffers.length}]` : ''}`
            ).catch(err => console.error('Telegram group VAT doc error:', err));
        }

        if (savedBuffers.length > 0) {
            sendVatEmail({
                purchaseId: purchaseIds[0],
                supplierName,
                invoiceNumber,
                invoiceDate: new Date(invoiceDate).toLocaleDateString('vi-VN'),
                totalAmount: purchases.reduce((sum, p) => sum + Number(p.total || 0), 0).toLocaleString('vi-VN') + 'đ',
                driveUrl: driveUrls[0] || null,
                fileBuffer: savedBuffers[0],
                fileName: savedFileNames[0],
            }).catch(err => console.error('Group VAT email error:', err));
        }

        void logActivity({
            module: 'purchases',
            action: 'VAT_GROUP_UPLOAD',
            description: `Upload ${filesList.length} file HĐ VAT cho nhóm ${vatGroupId} (${purchaseNames})`,
            userName: 'System',
        });

        const driveWarning = driveUrls.length === 0
            ? '⚠️ File nhóm đã lưu local + Telegram, nhưng Google Drive upload thất bại. Kiểm tra lại Google Drive.'
            : null;

        return {
            success: true,
            data: {
                vatGroupId,
                localPaths,
                driveUrls,
                invoiceNumber,
                vatId: primaryVatMeta?.vatId || null,
            },
            driveWarning,
        };
    } catch (error) {
        console.error('❌ Upload group VAT invoice error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('purchases:removeVatGroup', async (event, { purchaseId } = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        requireRole('admin', 'manager', 'staff');
        const targetId = Number(purchaseId);
        if (!targetId) throw new Error('Thiếu purchaseId');

        const vatGroups = await getPurchaseVatGroups();
        let removedGroupId = null;

        Object.keys(vatGroups).forEach(groupId => {
            const currentIds = Array.isArray(vatGroups[groupId]?.purchaseIds) ? vatGroups[groupId].purchaseIds.map(Number) : [];
            if (!currentIds.includes(targetId)) return;
            removedGroupId = groupId;
            const remainingIds = currentIds.filter(id => id !== targetId);
            if (remainingIds.length >= 2) {
                vatGroups[groupId].purchaseIds = remainingIds;
            } else {
                delete vatGroups[groupId];
            }
        });

        if (!removedGroupId) throw new Error('Phiếu này chưa nằm trong nhóm HĐ gộp');
        await savePurchaseVatGroups(vatGroups);

        void logActivity({
            module: 'purchases',
            action: 'VAT_GROUP_REMOVE',
            description: `Tách phiếu nhập #${targetId} khỏi nhóm HĐ gộp ${removedGroupId}`,
            userName: 'System',
        });

        return { success: true, data: { purchaseId: targetId, removedGroupId } };
    } catch (error) {
        console.error('❌ Remove VAT group error:', error);
        return { success: false, error: error.message };
    }
});

// Create purchase
ipcMain.handle('purchases:create', async (event, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        console.log('📦 Creating purchase order with data:', data);

        // Parse items and validate productIds
        const items = JSON.parse(data.items);
        console.log('📦 Items to create:', items);

        // Validate all productIds exist (single batch query)
        const productIds = items.map(i => i.productId);
        const existingProducts = await prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true }
        });
        const existingIds = new Set(existingProducts.map(p => p.id));
        for (const item of items) {
            if (!existingIds.has(item.productId)) {
                throw new Error(`Product ID ${item.productId} not found. Item: ${item.productName}`);
            }
        }
        // 🔒 StockMutex: serialize stock operations — tránh race condition Thẻ Kho
        const purchase = await withStockLock(() => getPrismaDirectTx().$transaction(async (tx) => {
            // Generate standard PN-YYMMDD-XXX
            const today = new Date();
            const dateStr = today.toISOString().slice(2, 10).replace(/-/g, '');
            const prefix = `PN-${dateStr}-`;

            const lastOrder = await tx.purchaseOrder.findFirst({
                where: { poNumber: { startsWith: prefix } },
                orderBy: { poNumber: 'desc' },
                select: { poNumber: true }
            });

            let nextNum = 1;
            if (lastOrder && lastOrder.poNumber) {
                const lastNumStr = lastOrder.poNumber.replace(prefix, '');
                const lastNum = parseInt(lastNumStr, 10);
                if (!isNaN(lastNum)) nextNum = lastNum + 1;
            }
            const generatedPoNumber = `${prefix}${String(nextNum).padStart(3, '0')}`;

            const newOrder = await tx.purchaseOrder.create({
                data: {
                    poNumber: generatedPoNumber,
                    supplierId: data.supplierId,
                    status: data.status || 'completed',
                    subtotal: data.totalAmount,
                    total: data.totalAmount,
                    note: data.notes,
                    receivedAt: new Date(data.purchaseDate),
                    createdBy: data.createdBy || 'Admin',
                    vatInvoiceStatus: data.isThht ? 'thht' : (data.isNoVat ? 'no_vat' : 'pending'), // 📦 THHT / Không VAT flag
                    items: {
                        create: items.map(item => ({
                            productId: item.productId,
                            quantity: item.quantity,
                            price: item.unitPrice,
                            subtotal: item.total,
                            variantSku: item.variantSku || null,
                            color: item.color || null
                        }))
                    }
                },
                include: { supplier: true, items: true }
            });

            // 🌟 Lấy map Product SKU để cập nhật tồn
            const purchaseProducts = await tx.product.findMany({
                where: { id: { in: productIds } }
            });
            const productMap = new Map(purchaseProducts.map(p => [p.id, p]));

            for (const item of items) {
                const product = productMap.get(item.productId);
                if (!product) continue;

                const skuToUpdate = item.variantSku || product.sku;
                if (!skuToUpdate) continue;

                // 🌟 Gọi hàm Mệnh lệnh tối cao để tăng tồn kho an toàn & sinh thẻ kho
                await updateProductStockInTx(tx, skuToUpdate, item.quantity, {
                    type: 'purchase',
                    referenceType: 'NHAP',
                    reference: newOrder.poNumber,
                    note: `Nhập hàng: ${item.productName || product.name} x${item.quantity}`,
                    createdBy: data.createdBy || 'Admin'
                });
            }

            return newOrder;
        }, { timeout: 60000, maxWait: 10000 }));

        console.log(`✅ Created purchase order: ${purchase.poNumber}`);
        void logActivity({ module: 'purchases', action: 'CREATE', description: `Tạo phiếu nhập ${purchase.poNumber} - ${new Intl.NumberFormat('vi-VN').format(data.totalAmount)}đ`, recordName: purchase.poNumber, userName: data.createdBy || 'Admin' });

        return { success: true, data: purchase };
    } catch (error) {
        console.error('❌ Create purchase error:', error);
        return { success: false, error: error.message };
    }
});

// Update purchase
ipcMain.handle('purchases:update', async (event, { id, data }) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        const purchase = await prisma.purchaseOrder.update({
            where: { id },
            data: {
                supplierId: data.supplierId,
                status: data.status,
                subtotal: data.totalAmount,
                total: data.totalAmount,
                note: data.notes,
                receivedAt: new Date(data.purchaseDate),
                ...(data.isThht !== undefined || data.isNoVat !== undefined ? {
                    vatInvoiceStatus: data.isThht ? 'thht' : (data.isNoVat ? 'no_vat' : 'pending')
                } : {}), // 📦 THHT / Không VAT
            }
        });

        console.log(`✅ Updated purchase order: ${purchase.poNumber}`);
        void logActivity({ module: 'purchases', action: 'UPDATE', description: `Cập nhật phiếu nhập ${purchase.poNumber}`, recordName: purchase.poNumber });
        return { success: true, data: purchase };
    } catch (error) {
        console.error('❌ Update purchase error:', error);
        return { success: false, error: error.message };
    }
});

// Delete purchase (Soft-delete & Hoàn kho)
ipcMain.handle('purchases:delete', async (event, id) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        console.log(`🗑️  Soft-deleting purchase order #${id}...`);

        const order = await prisma.purchaseOrder.findUnique({
            where: { id },
            include: { items: true }
        });
        if (!order) throw new Error(`Không tìm thấy phiếu nhập #${id}`);
        if (order.status === 'cancelled') return { success: true };

        // 🔒 StockMutex: serialize stock operations — tránh race condition Thẻ Kho
        await withStockLock(() => getPrismaDirectTx().$transaction(async (tx) => {
            const productIds = [...new Set(order.items.map(i => i.productId))];
            const products = await tx.product.findMany({
                where: { id: { in: productIds } }
            });
            const productMap = new Map(products.map(p => [p.id, p]));

            // 1. Hoàn lượng tồn kho đã nhập (âm quantity) - ghi thẻ kho Reversal
            for (const item of order.items) {
                const product = productMap.get(item.productId);
                if (!product) continue;

                const skuToRevert = item.variantSku || product.sku;
                if (!skuToRevert) continue;

                await updateProductStockInTx(tx, skuToRevert, -item.quantity, {
                    type: 'adjustment',
                    referenceType: 'NHAP_CANCEL',
                    reference: order.poNumber,
                    note: `Hoàn tồn do hủy phiếu nhập ${order.poNumber}`,
                    createdBy: 'System'
                });
            }

            // 2. Chuyển trạng thái sang cancelled thay vì xóa vật lý khối item
            await tx.purchaseOrder.update({
                where: { id },
                data: { status: 'cancelled' }
            });
        }));

        console.log(`✅ Successfully cancelled purchase order #${id}`);
        void logActivity({ module: 'purchases', action: 'DELETE', description: `Hủy phiếu nhập #${id}`, recordName: order.poNumber });
        return { success: true };
    } catch (error) {
        console.error('❌ Delete purchase error:', error);
        console.error('   Error code:', error.code);
        console.error('   Error meta:', error.meta);
        return { success: false, error: error.message };
    }
});

// ========================================
// UPLOAD HĐ VAT NHÀ CUNG CẤP
// Bot Telegram: tool HĐ cũ (8091...)
// Google Drive: folder LUUTRU-HOADONVAT
// Email: Nodemailer + Gmail OAuth2
// ========================================

// Config riêng cho module HĐ VAT nhập hàng
const VAT_TELEGRAM_BOT = config.VAT_TELEGRAM_BOT;
const VAT_TELEGRAM_CHAT = config.VAT_TELEGRAM_CHAT;
const VAT_DRIVE_FOLDER_NAME = 'LUUTRU-HOADONVAT';
let vatDriveFolderId = null; // Cache folder ID

// Tìm hoặc tạo folder LUUTRU-HOADONVAT trên Drive
async function getOrCreateVatDriveFolder() {
    if (vatDriveFolderId) return vatDriveFolderId;
    const drive = getDriveClient();
    if (!drive) return null;

    try {
        // Tìm folder đã tồn tại
        const search = await drive.files.list({
            q: `name='${VAT_DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id)',
        });
        if (search.data.files && search.data.files.length > 0) {
            vatDriveFolderId = search.data.files[0].id;
            console.log(`📁 Found Drive folder ${VAT_DRIVE_FOLDER_NAME}: ${vatDriveFolderId}`);
            return vatDriveFolderId;
        }

        // Tạo mới
        const folder = await drive.files.create({
            requestBody: {
                name: VAT_DRIVE_FOLDER_NAME,
                mimeType: 'application/vnd.google-apps.folder',
            },
            fields: 'id',
        });
        vatDriveFolderId = folder.data.id;
        console.log(`📁 Created Drive folder ${VAT_DRIVE_FOLDER_NAME}: ${vatDriveFolderId}`);
        return vatDriveFolderId;
    } catch (err) {
        console.error('❌ VAT Drive folder error:', err.message);
        if (err.response) {
            console.error('❌ Drive API response:', err.response.status, JSON.stringify(err.response.data));
        }
        if (err.code) {
            console.error('❌ Drive error code:', err.code);
        }
        return null;
    }
}

const IMPORT_RECEIPT_DRIVE_FOLDER_NAME = 'LUUTRU-PHIEUNHAPKHO';
let importReceiptDriveFolderId = null;

async function getOrCreateImportReceiptDriveFolder() {
    if (importReceiptDriveFolderId) return importReceiptDriveFolderId;
    const drive = getDriveClient();
    if (!drive) return null;

    try {
        const search = await drive.files.list({
            q: `name='${IMPORT_RECEIPT_DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id)',
        });
        if (search.data.files && search.data.files.length > 0) {
            importReceiptDriveFolderId = search.data.files[0].id;
            console.log(`📁 Found Drive folder ${IMPORT_RECEIPT_DRIVE_FOLDER_NAME}: ${importReceiptDriveFolderId}`);
            return importReceiptDriveFolderId;
        }

        const folder = await drive.files.create({
            requestBody: {
                name: IMPORT_RECEIPT_DRIVE_FOLDER_NAME,
                mimeType: 'application/vnd.google-apps.folder',
            },
            fields: 'id',
        });
        importReceiptDriveFolderId = folder.data.id;
        console.log(`📁 Created Drive folder ${IMPORT_RECEIPT_DRIVE_FOLDER_NAME}: ${importReceiptDriveFolderId}`);
        return importReceiptDriveFolderId;
    } catch (err) {
        console.error('❌ Import Receipt Drive folder error:', err.message);
        return null;
    }
}

// Gửi Telegram bằng bot HĐ cũ
function sendVatTelegramMessage(text) {
    return new Promise((resolve) => {
        const postData = JSON.stringify({ chat_id: VAT_TELEGRAM_CHAT, text, parse_mode: 'HTML' });
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${VAT_TELEGRAM_BOT}/sendMessage`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
            timeout: 5000,
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(res.statusCode === 200 ? { success: true } : { success: false }));
        });
        req.on('error', () => resolve({ success: false }));
        req.on('timeout', () => { req.destroy(); resolve({ success: false }); });
        req.write(postData);
        req.end();
    });
}

// Gửi file qua Telegram bot HĐ cũ
function sendVatTelegramDocument(buffer, fileName, caption) {
    return new Promise((resolve) => {
        try {
            const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
            const parts = [];
            parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${VAT_TELEGRAM_CHAT}`);
            if (caption) parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}`);
            parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`);

            const header = Buffer.from(parts.join('\r\n') + '\r\n', 'utf-8');
            const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
            const fileBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, 'utf-8');
            const body = Buffer.concat([header, fileBuffer, footer]);

            const options = {
                hostname: 'api.telegram.org',
                path: `/bot${VAT_TELEGRAM_BOT}/sendDocument`,
                method: 'POST',
                headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
                timeout: 15000,
            };
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(res.statusCode === 200 ? { success: true } : { success: false }));
            });
            req.on('error', () => resolve({ success: false }));
            req.on('timeout', () => { req.destroy(); resolve({ success: false }); });
            req.write(body);
            req.end();
        } catch { resolve({ success: false }); }
    });
}

// Gửi email thông báo HĐ VAT qua Gmail (Nodemailer + OAuth2)
async function sendVatEmail(invoiceData) {
    try {
        const nodemailer = require('nodemailer');
        const tokenPath = ensureGoogleTokenPath();
        if (!fs.existsSync(tokenPath)) {
            console.warn('⚠️ No OAuth2 token — skip email');
            return { success: false };
        }
        const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
        const oauth2Client = new google.auth.OAuth2(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
        oauth2Client.setCredentials(tokens);

        // Lấy access token mới
        const { token } = await oauth2Client.getAccessToken();

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                type: 'OAuth2',
                user: 'yendao444@gmail.com',
                clientId: OAUTH_CLIENT_ID,
                clientSecret: OAUTH_CLIENT_SECRET,
                refreshToken: tokens.refresh_token,
                accessToken: token,
            },
        });

        const mailOptions = {
            from: '"Hệ thống Quản lý" <yendao444@gmail.com>',
            to: 'yendao444@gmail.com',
            subject: `🧾 HĐ VAT mới: ${invoiceData.invoiceNumber} — ${invoiceData.supplierName}`,
            html: `
                <h2>🧾 Hóa đơn VAT nhà cung cấp</h2>
                <table style="border-collapse:collapse; font-size:14px;">
                    <tr><td style="padding:6px 12px;"><b>📋 Phiếu nhập:</b></td><td>#${invoiceData.purchaseId}</td></tr>
                    <tr><td style="padding:6px 12px;"><b>🏢 NCC:</b></td><td>${invoiceData.supplierName}</td></tr>
                    <tr><td style="padding:6px 12px;"><b>🔢 Số HĐ:</b></td><td>${invoiceData.invoiceNumber}</td></tr>
                    <tr><td style="padding:6px 12px;"><b>📅 Ngày:</b></td><td>${invoiceData.invoiceDate}</td></tr>
                    <tr><td style="padding:6px 12px;"><b>💰 Tổng tiền:</b></td><td>${invoiceData.totalAmount}</td></tr>
                    ${invoiceData.driveUrl ? `<tr><td style="padding:6px 12px;"><b>📎 Drive:</b></td><td><a href="${invoiceData.driveUrl}">Xem file</a></td></tr>` : ''}
                </table>
            `,
        };

        if (invoiceData.fileBuffer) {
            mailOptions.attachments = [{
                filename: invoiceData.fileName,
                content: invoiceData.fileBuffer,
            }];
        }

        await transporter.sendMail(mailOptions);
        console.log('📧 VAT email sent successfully');
        return { success: true };
    } catch (err) {
        console.error('⚠️ VAT email error (non-blocking):', err.message);
        return { success: false, error: err.message };
    }
}

ipcMain.handle('purchases:uploadVATInvoice', async (event, { purchaseId, invoiceNumber, invoiceDate, files = [], fileBase64, fileName }) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const vatFileMeta = await getPurchaseVatFileMeta();

        // 1. Lấy thông tin phiếu nhập
        const purchase = await prisma.purchaseOrder.findUnique({
            where: { id: purchaseId },
            include: { supplier: true },
        });
        if (!purchase) throw new Error(`Không tìm thấy phiếu nhập #${purchaseId}`);

        // Normalize: hỗ trợ cả nhiều file (files[]) và 1 file (fileBase64/fileName)
        const filesList = files.length > 0 ? files : (fileBase64 ? [{ fileBase64, fileName }] : []);

        const userDataPath = app.getPath('userData');
        const vatDir = path.join(userDataPath, 'vat-invoices');
        if (!fs.existsSync(vatDir)) fs.mkdirSync(vatDir, { recursive: true });

        const localPaths = [];
        const driveUrls = [];
        const savedBuffers = [];
        const savedFileNames = [];
        let primaryVatMeta = null;

        // 2. Lưu từng file local + upload Drive
        for (let i = 0; i < filesList.length; i++) {
            const { fileBase64: b64, fileName: fn } = filesList[i];
            const ext = (fn || 'jpg').split('.').pop() || 'jpg';
            const suffix = filesList.length > 1 ? `_${i + 1}` : '';
            const localFileName = `VAT_PO${purchaseId}_${Date.now()}${suffix}.${ext}`;
            const localPath = path.join(vatDir, localFileName);

            const fileBuffer = Buffer.from(b64, 'base64');
            fs.writeFileSync(localPath, fileBuffer);
            console.log(`📁 Saved VAT invoice [${i + 1}/${filesList.length}]: ${localPath}`);
            localPaths.push(localPath);
            savedBuffers.push(fileBuffer);
            savedFileNames.push(localFileName);
            if (i === 0) {
                primaryVatMeta = {
                    fileName: fn || localFileName,
                    fileSize: fileBuffer.length,
                    vatId: generateVatIdFromFile(fn || localFileName, fileBuffer.length),
                    updatedAt: new Date().toISOString(),
                };
            }

            // Upload lên Google Drive
            try {
                const drive = getDriveClient();
                if (drive) {
                    const folderId = await getOrCreateVatDriveFolder();
                    if (folderId) {
                        const driveFileName = `HĐ_VAT_${purchase.supplier?.name || 'NCC'}_PO${purchaseId}_${invoiceNumber}${suffix}.${ext}`;
                        const result = await uploadToDrive(drive, folderId, driveFileName, fileBuffer, ext === 'pdf' ? 'application/pdf' : 'image/jpeg');
                        if (result) {
                            driveUrls.push(result.webViewLink);
                            console.log(`☁️ Uploaded to Drive [${i + 1}]: ${result.webViewLink}`);
                        } else {
                            console.error(`⚠️ Drive upload returned null for file ${i + 1}`);
                        }
                    } else {
                        console.error('⚠️ Drive folder creation failed - folderId is null');
                    }
                } else {
                    console.error('⚠️ Google Drive client not available (token missing or expired)');
                }
            } catch (driveErr) {
                console.error(`⚠️ Drive upload failed for file ${i + 1}:`, driveErr.message);
            }
        }

        if (primaryVatMeta) {
            vatFileMeta[String(purchaseId)] = primaryVatMeta;
            await savePurchaseVatFileMeta(vatFileMeta);
        }

        // 3. Cập nhật DB
        const dbUpdate = {
            vatInvoiceNumber: invoiceNumber,
            vatInvoiceDate: new Date(invoiceDate),
            vatInvoiceStatus: 'uploaded',
        };
        if (localPaths.length > 0) {
            dbUpdate.vatInvoiceFile = localPaths.length === 1 ? localPaths[0] : JSON.stringify(localPaths);
        }
        if (driveUrls.length > 0) {
            dbUpdate.vatInvoiceDriveUrl = driveUrls.length === 1 ? driveUrls[0] : driveUrls.join('\n');
        }
        await prisma.purchaseOrder.update({ where: { id: purchaseId }, data: dbUpdate });

        // 4. Gá»­i Telegram
        const telegramMsg = [
            `🧾 <b>HĐ VAT mới — Nhập hàng</b>`,
            ``,
            `📋 Phiếu nhập: <b>#${purchaseId}</b>`,
            `🏢 NCC: <b>${purchase.supplier?.name || 'N/A'}</b>`,
            `🔢 Số HĐ: <b>${invoiceNumber}</b>`,
            `📅 Ngày HĐ: <b>${new Date(invoiceDate).toLocaleDateString('vi-VN')}</b>`,
            `💰 Tổng tiền: <b>${purchase.total.toLocaleString('vi-VN')}đ</b>`,
            filesList.length > 1 ? `📎 <b>${filesList.length} files đính kèm</b>` : '',
            driveUrls[0] ? `\n📎 <a href="${driveUrls[0]}">Xem trên Drive</a>` : '',
        ].filter(Boolean).join('\n');

        sendVatTelegramMessage(telegramMsg).catch(err => console.error('Telegram error:', err));
        for (let i = 0; i < savedBuffers.length; i++) {
            sendVatTelegramDocument(savedBuffers[i], savedFileNames[i],
                `HĐ VAT #${invoiceNumber}${savedBuffers.length > 1 ? ` [${i + 1}/${savedBuffers.length}]` : ''} — ${purchase.supplier?.name || 'NCC'}`
            ).catch(err => console.error('Telegram doc error:', err));
        }

        // 5. Gửi Email (file đầu tiên)
        if (savedBuffers.length > 0) {
            sendVatEmail({
                purchaseId,
                supplierName: purchase.supplier?.name || 'N/A',
                invoiceNumber,
                invoiceDate: new Date(invoiceDate).toLocaleDateString('vi-VN'),
                totalAmount: purchase.total.toLocaleString('vi-VN') + 'đ',
                driveUrl: driveUrls[0] || null,
                fileBuffer: savedBuffers[0],
                fileName: savedFileNames[0],
            }).catch(err => console.error('Email error:', err));
        }

        void logActivity({
            module: 'purchases', action: 'VAT_UPLOAD',
            description: `Upload ${filesList.length} file HĐ VAT #${invoiceNumber} cho phiếu nhập #${purchaseId} (${purchase.supplier?.name})`,
            userName: 'System',
        });

        const driveWarning = driveUrls.length === 0 && filesList.length > 0
            ? '⚠️ File đã lưu local + Telegram, nhưng Google Drive upload THẤT BẠI. Kiểm tra kết nối Google Drive.'
            : null;
        if (driveWarning) console.warn(driveWarning);
        console.log(`✅ VAT invoice uploaded for PO#${purchaseId}: ${invoiceNumber} (${filesList.length} files, Drive: ${driveUrls.length > 0 ? 'OK' : 'FAILED'})`);
        return { success: true, data: { localPaths, driveUrls, invoiceNumber, vatId: primaryVatMeta?.vatId || null }, driveWarning };
    } catch (error) {
        console.error('❌ Upload VAT invoice error:', error);
        return { success: false, error: error.message };
    }
});

// Upload Phiếu Nhập Kho
ipcMain.handle('purchases:uploadImportReceipt', async (event, { purchaseId, files = [], fileBase64, fileName }) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        // 1. Lấy thông tin phiếu nhập
        const purchase = await prisma.purchaseOrder.findUnique({
            where: { id: purchaseId },
            include: { supplier: true },
        });
        if (!purchase) throw new Error(`Không tìm thấy phiếu nhập #${purchaseId}`);

        // Normalize: hỗ trợ cả nhiều file (files[]) và 1 file (fileBase64/fileName)
        const filesList = files.length > 0 ? files : (fileBase64 ? [{ fileBase64, fileName }] : []);

        const userDataPath = app.getPath('userData');
        const receiptDir = path.join(userDataPath, 'import-receipts');
        if (!fs.existsSync(receiptDir)) fs.mkdirSync(receiptDir, { recursive: true });

        const localPaths = [];
        const driveUrls = [];

        // 2. Lưu từng file local + upload Drive
        for (let i = 0; i < filesList.length; i++) {
            const { fileBase64: b64, fileName: fn } = filesList[i];
            const ext = (fn || 'jpg').split('.').pop() || 'jpg';
            const suffix = filesList.length > 1 ? `_${i + 1}` : '';
            const localFileName = `PN_PO${purchaseId}_${Date.now()}${suffix}.${ext}`;
            const localPath = path.join(receiptDir, localFileName);

            const fileBuffer = Buffer.from(b64, 'base64');
            fs.writeFileSync(localPath, fileBuffer);
            console.log(`📁 Saved Import Receipt [${i + 1}/${filesList.length}]: ${localPath}`);
            localPaths.push(localPath);

            // Upload lên Google Drive
            try {
                const drive = getDriveClient();
                if (drive) {
                    const folderId = await getOrCreateImportReceiptDriveFolder(); // Separated folder
                    if (folderId) {
                        const driveFileName = `Phiếu_Nhập_${purchase.supplier?.name || 'NCC'}_PO${purchaseId}${suffix}.${ext}`;
                        const result = await uploadToDrive(drive, folderId, driveFileName, fileBuffer, ext === 'pdf' ? 'application/pdf' : 'image/jpeg');
                        if (result) {
                            driveUrls.push(result.webViewLink);
                            console.log(`☁️ Uploaded Receipt to Drive [${i + 1}]: ${result.webViewLink}`);
                        }
                    }
                }
            } catch (driveErr) {
                console.error(`⚠️ Drive upload failed for Receipt file ${i + 1}:`, driveErr.message);
            }
        }

        // 3. Cập nhật DB
        const dbUpdate = {
            importReceiptStatus: 'uploaded',
        };
        if (localPaths.length > 0) {
            dbUpdate.importReceiptFile = localPaths.length === 1 ? localPaths[0] : JSON.stringify(localPaths);
        }
        if (driveUrls.length > 0) {
            dbUpdate.importReceiptDriveUrl = driveUrls.length === 1 ? driveUrls[0] : driveUrls.join('\n');
        }
        await prisma.purchaseOrder.update({ where: { id: purchaseId }, data: dbUpdate });

        void logActivity({
            module: 'purchases', action: 'RECEIPT_UPLOAD',
            description: `Upload Phiếu Nhập của phiếu #${purchaseId} (${purchase.supplier?.name})`,
            userName: 'System',
        });

        return { success: true, data: { localPaths, driveUrls } };
    } catch (error) {
        console.error('❌ Upload Import Receipt error:', error);
        return { success: false, error: error.message };
    }
});

// Xóa Phiếu Nhập Kho
ipcMain.handle('purchases:deleteImportReceipt', async (event, purchaseId) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const purchase = await prisma.purchaseOrder.findUnique({
            where: { id: purchaseId },
            include: { supplier: true },
        });
        if (!purchase) throw new Error(`Không tìm thấy phiếu nhập #${purchaseId}`);

        // Chỉ cập nhật DB để bỏ mapping
        await prisma.purchaseOrder.update({
            where: { id: purchaseId },
            data: {
                importReceiptStatus: 'pending',
                importReceiptFile: null,
                importReceiptDriveUrl: null
            }
        });

        void logActivity({
            module: 'purchases', action: 'RECEIPT_DELETE',
            description: `Xóa Phiếu Nhập của phiếu #${purchaseId} (${purchase.supplier?.name})`,
            userName: 'System',
        });

        return { success: true };
    } catch (error) {
        console.error('❌ Delete Import Receipt error:', error);
        return { success: false, error: error.message };
    }
});
// Đánh dấu phiếu nhập là "Đơn THHT" (không cần HĐ VAT)
// Xóa HĐ VAT của phiếu nhập (đơn lẻ, không thuộc nhóm gộp)
ipcMain.handle('purchases:deleteVatInvoice', async (event, purchaseId) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const purchase = await prisma.purchaseOrder.findUnique({
            where: { id: purchaseId },
            include: { supplier: true },
        });
        if (!purchase) throw new Error(`Không tìm thấy phiếu nhập #${purchaseId}`);

        await prisma.purchaseOrder.update({
            where: { id: purchaseId },
            data: {
                vatInvoiceStatus: 'pending',
                vatInvoiceNumber: null,
                vatInvoiceDate: null,
                vatInvoiceFile: null,
                vatInvoiceDriveUrl: null,
            }
        });

        // Xóa vatFileMeta để VAT ID không còn hiển thị
        const vatFileMeta = await getPurchaseVatFileMeta();
        if (vatFileMeta[String(purchaseId)]) {
            delete vatFileMeta[String(purchaseId)];
            await savePurchaseVatFileMeta(vatFileMeta);
        }

        void logActivity({
            module: 'purchases', action: 'VAT_DELETE',
            description: `Xóa HĐ VAT của phiếu #${purchaseId} (${purchase.supplier?.name})`,
            userName: 'System',
        });

        return { success: true };
    } catch (error) {
        console.error('❌ Delete VAT Invoice error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('purchases:markAsThht', async (event, { purchaseId, revert }) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        requireRole('admin', 'manager', 'staff');
        await prisma.purchaseOrder.update({
            where: { id: purchaseId },
            data: { vatInvoiceStatus: revert ? 'pending' : 'thht' },
        });
        void logActivity({
            module: 'purchases', action: revert ? 'THHT_REVERT' : 'THHT_MARK',
            description: `${revert ? 'Hoàn tác' : 'Đánh dấu'} phiếu nhập #${purchaseId} là Đơn THHT`,
            userName: 'System',
        });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// 👁️ Đọc file HĐ VAT local → trả về base64 data URL để hiển thị trong app
ipcMain.handle('purchases:getVATFileData', async (event, { purchaseId }) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const purchase = await prisma.purchaseOrder.findUnique({ where: { id: purchaseId } });
        if (!purchase || !purchase.vatInvoiceFile) {
            return { success: false, error: 'Không tìm thấy file HĐ VAT' };
        }

        // vatInvoiceFile có thể là 1 path hoặc JSON array nhiều paths
        let filePaths = [];
        try {
            filePaths = JSON.parse(purchase.vatInvoiceFile);
        } catch {
            filePaths = [purchase.vatInvoiceFile];
        }

        // Đọc từng file → trả về array data URLs
        const filesData = [];
        for (const fp of filePaths) {
            if (!fs.existsSync(fp)) continue;
            const buffer = fs.readFileSync(fp);
            const ext = path.extname(fp).toLowerCase().replace('.', '');
            const mimeType = ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
            const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
            filesData.push({ dataUrl, fileName: path.basename(fp), mimeType, ext });
        }

        if (filesData.length === 0) {
            return { success: false, error: 'File không tồn tại trên máy' };
        }

        return { success: true, data: filesData };
    } catch (error) {
        console.error('❌ Get VAT file data error:', error);
        return { success: false, error: error.message };
    }
});

// 👁️ Đọc file Phiếu Nhập Kho local → trả về base64 data URL để hiển thị trong app
ipcMain.handle('purchases:getImportReceiptFileData', async (event, { purchaseId }) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const purchase = await prisma.purchaseOrder.findUnique({ where: { id: purchaseId } });
        if (!purchase || !purchase.importReceiptFile) {
            return { success: false, error: 'Không tìm thấy file Phiếu Nhập Kho' };
        }

        // importReceiptFile có thể là 1 path hoặc JSON array nhiều paths
        let filePaths = [];
        try {
            filePaths = JSON.parse(purchase.importReceiptFile);
        } catch {
            filePaths = [purchase.importReceiptFile];
        }

        // Đọc từng file → trả về array data URLs
        const filesData = [];
        for (const fp of filePaths) {
            if (!fs.existsSync(fp)) continue;
            const buffer = fs.readFileSync(fp);
            const ext = path.extname(fp).toLowerCase().replace('.', '');
            const mimeType = ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
            const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
            filesData.push({ dataUrl, fileName: path.basename(fp), mimeType, ext });
        }

        if (filesData.length === 0) {
            return { success: false, error: 'File không tồn tại trên máy' };
        }

        return { success: true, data: filesData };
    } catch (error) {
        console.error('❌ Get Import Receipt file data error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// SUPPLIERS HANDLERS
// ========================================

// Get all suppliers
ipcMain.handle('suppliers:getAll', async () => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        const suppliers = await prisma.supplier.findMany({
            orderBy: { name: 'asc' }
        });

        return { success: true, data: suppliers };
    } catch (error) {
        console.error('❌ Get suppliers error:', error);
        return { success: false, error: error.message };
    }
});

// Create supplier
ipcMain.handle('suppliers:create', async (event, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        const supplier = await prisma.supplier.create({
            data: {
                code: data.code || `SUP${Date.now()}`,
                name: data.name,
                phone: data.phone || null,
                email: data.email || null,
                address: data.address || null,
                taxCode: data.taxCode || null,
                status: data.status || 'active'
            }
        });

        console.log(`✅ Created supplier: ${supplier.name}`);
        void logActivity({ module: 'purchases', action: 'CREATE', description: `Tạo NCC "${supplier.name}"`, recordName: supplier.name });
        return { success: true, data: supplier };
    } catch (error) {
        console.error('❌ Create supplier error:', error);
        return { success: false, error: error.message };
    }
});

// Update supplier
ipcMain.handle('suppliers:update', async (event, id, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        const supplier = await prisma.supplier.update({
            where: { id },
            data: {
                code: data.code,
                name: data.name,
                phone: data.phone || null,
                email: data.email || null,
                address: data.address || null,
                taxCode: data.taxCode || null,
                status: data.status || 'active'
            }
        });

        console.log(`✅ Updated supplier: ${supplier.name}`);
        void logActivity({ module: 'purchases', action: 'UPDATE', description: `Cập nhật NCC "${supplier.name}"`, recordName: supplier.name });
        return { success: true, data: supplier };
    } catch (error) {
        console.error('❌ Update supplier error:', error);
        return { success: false, error: error.message };
    }
});

// Delete supplier
ipcMain.handle('suppliers:delete', async (event, id) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        // Kiểm tra xem có phiếu nhập nào đang dùng supplier này không
        const purchaseCount = await prisma.purchaseOrder.count({
            where: { supplierId: id }
        });

        if (purchaseCount > 0) {
            return {
                success: false,
                error: `Không thể xóa! Nhà cung cấp này đang được sử dụng trong ${purchaseCount} phiếu nhập.`
            };
        }

        await prisma.supplier.delete({
            where: { id }
        });

        console.log(`✅ Deleted supplier #${id}`);
        void logActivity({ module: 'purchases', action: 'DELETE', description: `Xóa nhà cung cấp #${id}` });
        return { success: true };
    } catch (error) {
        console.error('❌ Delete supplier error:', error);

        // Xử lý lỗi foreign key constraint
        if (error.code === 'P2003') {
            return { success: false, error: 'Không thể xóa! Nhà cung cấp đang được sử dụng trong các phiếu nhập.' };
        }

        return { success: false, error: error.message };
    }
});

// ========================================
// DATABASE EXPORT/IMPORT HANDLERS
// ========================================

// Export all database to Excel
ipcMain.handle('database:exportAll', async () => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        console.log('📤 Starting database export...');

        // Query all data from Prisma
        const [categories, products, suppliers, purchaseOrders, purchaseItems, customers, orders, orderItems, payments, users, expenses, inventoryLogs, activityLogs] = await Promise.all([
            prisma.category.findMany({ orderBy: { id: 'asc' } }),
            prisma.product.findMany({ orderBy: { id: 'asc' } }),
            prisma.supplier.findMany({ orderBy: { id: 'asc' } }),
            prisma.purchaseOrder.findMany({ orderBy: { id: 'desc' }, take: 2000 }),
            prisma.purchaseItem.findMany({ orderBy: { id: 'desc' }, take: 5000 }),
            prisma.customer.findMany({ orderBy: { id: 'asc' } }),
            prisma.order.findMany({ orderBy: { id: 'desc' }, take: 5000 }),
            prisma.orderItem.findMany({ orderBy: { id: 'desc' }, take: 10000 }),
            prisma.payment.findMany({ orderBy: { id: 'desc' }, take: 5000 }),
            prisma.user.findMany({ orderBy: { id: 'asc' } }),
            prisma.expense.findMany({ orderBy: { id: 'desc' }, take: 2000 }),
            prisma.inventoryLog.findMany({ orderBy: { id: 'desc' }, take: 1000 }),
            prisma.activityLog.findMany({ orderBy: { id: 'desc' }, take: 1000 })
        ]);

        console.log(`  ✅ Queried data: ${categories.length} categories, ${products.length} products, ${suppliers.length} suppliers`);

        // Remove passwords from users for security
        const usersWithoutPasswords = users.map(user => {
            const { password, ...userWithoutPassword } = user;
            return userWithoutPassword;
        });

        // Create Excel workbook
        const wb = XLSX.utils.book_new();

        // Helper function to convert Date objects to ISO strings for Excel
        const sanitizeForExcel = (data) => {
            return data.map(row => {
                const sanitized = {};
                for (const [key, value] of Object.entries(row)) {
                    if (value instanceof Date) {
                        sanitized[key] = value.toISOString();
                    } else if (value === null) {
                        sanitized[key] = '';
                    } else {
                        sanitized[key] = value;
                    }
                }
                return sanitized;
            });
        };

        // Add sheets with sanitized data
        const wsCategories = XLSX.utils.json_to_sheet(sanitizeForExcel(categories));
        XLSX.utils.book_append_sheet(wb, wsCategories, 'Categories');

        const wsProducts = XLSX.utils.json_to_sheet(sanitizeForExcel(products));
        XLSX.utils.book_append_sheet(wb, wsProducts, 'Products');

        const wsSuppliers = XLSX.utils.json_to_sheet(sanitizeForExcel(suppliers));
        XLSX.utils.book_append_sheet(wb, wsSuppliers, 'Suppliers');

        const wsPurchaseOrders = XLSX.utils.json_to_sheet(sanitizeForExcel(purchaseOrders));
        XLSX.utils.book_append_sheet(wb, wsPurchaseOrders, 'PurchaseOrders');

        const wsPurchaseItems = XLSX.utils.json_to_sheet(sanitizeForExcel(purchaseItems));
        XLSX.utils.book_append_sheet(wb, wsPurchaseItems, 'PurchaseItems');

        const wsCustomers = XLSX.utils.json_to_sheet(sanitizeForExcel(customers));
        XLSX.utils.book_append_sheet(wb, wsCustomers, 'Customers');

        const wsOrders = XLSX.utils.json_to_sheet(sanitizeForExcel(orders));
        XLSX.utils.book_append_sheet(wb, wsOrders, 'Orders');

        const wsOrderItems = XLSX.utils.json_to_sheet(sanitizeForExcel(orderItems));
        XLSX.utils.book_append_sheet(wb, wsOrderItems, 'OrderItems');

        const wsPayments = XLSX.utils.json_to_sheet(sanitizeForExcel(payments));
        XLSX.utils.book_append_sheet(wb, wsPayments, 'Payments');

        const wsUsers = XLSX.utils.json_to_sheet(sanitizeForExcel(usersWithoutPasswords));
        XLSX.utils.book_append_sheet(wb, wsUsers, 'Users');

        const wsExpenses = XLSX.utils.json_to_sheet(sanitizeForExcel(expenses));
        XLSX.utils.book_append_sheet(wb, wsExpenses, 'Expenses');

        const wsInventoryLogs = XLSX.utils.json_to_sheet(sanitizeForExcel(inventoryLogs));
        XLSX.utils.book_append_sheet(wb, wsInventoryLogs, 'InventoryLogs');

        const wsActivityLogs = XLSX.utils.json_to_sheet(sanitizeForExcel(activityLogs));
        XLSX.utils.book_append_sheet(wb, wsActivityLogs, 'ActivityLogs');

        // Show save dialog
        const { filePath } = await dialog.showSaveDialog({
            title: 'Lưu file sao lưu dữ liệu',
            defaultPath: `DataBackup_${new Date().toISOString().split('T')[0]}.xlsx`,
            filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
        });

        if (!filePath) {
            console.log('❌ User cancelled save dialog');
            return { success: false, error: 'User cancelled' };
        }

        // Write file
        XLSX.writeFile(wb, filePath);
        console.log(`✅ Database exported successfully to: ${filePath}`);

        // Log activity
        await prisma.activityLog.create({
            data: {
                module: 'database',
                action: 'EXPORT',
                description: `Exported database to ${path.basename(filePath)}`,
                userName: 'System',
                severity: 'INFO',
                timestamp: new Date()
            }
        });

        return { success: true, data: filePath };
    } catch (error) {
        console.error('❌ Database export error:', error);
        return { success: false, error: error.message };
    }
});

// Import all database from Excel
ipcMain.handle('database:importAll', async () => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        console.log('📥 Starting database import...');

        // Show open dialog
        const { filePaths } = await dialog.showOpenDialog({
            title: 'Chọn file sao lưu để nhập',
            filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
            properties: ['openFile']
        });

        if (!filePaths || filePaths.length === 0) {
            console.log('❌ User cancelled open dialog');
            return { success: false, error: 'No file selected' };
        }

        const filePath = filePaths[0];
        console.log(`📂 Reading file: ${filePath}`);

        // Read Excel file
        const wb = XLSX.readFile(filePath);

        // Parse sheets to JSON
        const categories = wb.Sheets['Categories'] ? XLSX.utils.sheet_to_json(wb.Sheets['Categories']) : [];
        const products = wb.Sheets['Products'] ? XLSX.utils.sheet_to_json(wb.Sheets['Products']) : [];
        const suppliers = wb.Sheets['Suppliers'] ? XLSX.utils.sheet_to_json(wb.Sheets['Suppliers']) : [];
        const purchaseOrders = wb.Sheets['PurchaseOrders'] ? XLSX.utils.sheet_to_json(wb.Sheets['PurchaseOrders']) : [];
        const purchaseItems = wb.Sheets['PurchaseItems'] ? XLSX.utils.sheet_to_json(wb.Sheets['PurchaseItems']) : [];
        const customers = wb.Sheets['Customers'] ? XLSX.utils.sheet_to_json(wb.Sheets['Customers']) : [];
        const orders = wb.Sheets['Orders'] ? XLSX.utils.sheet_to_json(wb.Sheets['Orders']) : [];
        const orderItems = wb.Sheets['OrderItems'] ? XLSX.utils.sheet_to_json(wb.Sheets['OrderItems']) : [];
        const payments = wb.Sheets['Payments'] ? XLSX.utils.sheet_to_json(wb.Sheets['Payments']) : [];
        const expenses = wb.Sheets['Expenses'] ? XLSX.utils.sheet_to_json(wb.Sheets['Expenses']) : [];

        console.log(`  ✅ Parsed data: ${categories.length} categories, ${products.length} products, ${suppliers.length} suppliers`);

        // Import with transaction
        const result = await prisma.$transaction(async (tx) => {
            const stats = { categories: 0, products: 0, suppliers: 0, purchases: 0, customers: 0, orders: 0, expenses: 0 };

            // 1. Import Categories (parent categories first, then children)
            const parentCategories = categories.filter(c => !c.parentId);
            const childCategories = categories.filter(c => c.parentId);

            for (const cat of parentCategories) {
                await tx.category.upsert({
                    where: { id: cat.id },
                    update: {
                        name: cat.name,
                        description: cat.description || null,
                        updatedAt: new Date()
                    },
                    create: {
                        id: cat.id,
                        name: cat.name,
                        description: cat.description || null,
                        createdAt: cat.createdAt ? new Date(cat.createdAt) : new Date(),
                        updatedAt: new Date()
                    }
                });
                stats.categories++;
            }

            for (const cat of childCategories) {
                await tx.category.upsert({
                    where: { id: cat.id },
                    update: {
                        name: cat.name,
                        description: cat.description || null,
                        parentId: cat.parentId || null,
                        updatedAt: new Date()
                    },
                    create: {
                        id: cat.id,
                        name: cat.name,
                        description: cat.description || null,
                        parentId: cat.parentId || null,
                        createdAt: cat.createdAt ? new Date(cat.createdAt) : new Date(),
                        updatedAt: new Date()
                    }
                });
                stats.categories++;
            }

            // 2. Import Suppliers
            for (const sup of suppliers) {
                await tx.supplier.upsert({
                    where: { id: sup.id },
                    update: {
                        code: sup.code,
                        name: sup.name,
                        phone: sup.phone || null,
                        email: sup.email || null,
                        address: sup.address || null,
                        taxCode: sup.taxCode || null,
                        debt: sup.debt || 0,
                        status: sup.status || 'active',
                        updatedAt: new Date()
                    },
                    create: {
                        id: sup.id,
                        code: sup.code,
                        name: sup.name,
                        phone: sup.phone || null,
                        email: sup.email || null,
                        address: sup.address || null,
                        taxCode: sup.taxCode || null,
                        debt: sup.debt || 0,
                        status: sup.status || 'active',
                        createdAt: sup.createdAt ? new Date(sup.createdAt) : new Date(),
                        updatedAt: new Date()
                    }
                });
                stats.suppliers++;
            }

            // 3. Import Products
            for (const prod of products) {
                await tx.product.upsert({
                    where: { id: prod.id },
                    update: {
                        sku: prod.sku,
                        barcode: prod.barcode || null,
                        name: prod.name,
                        description: prod.description || null,
                        categoryId: prod.categoryId || null,
                        price: prod.price || 0,
                        cost: prod.cost || 0,
                        stock: prod.stock || 0,
                        minStock: prod.minStock || 0,
                        maxStock: prod.maxStock || null,
                        unit: prod.unit || 'Cái',
                        weight: prod.weight || null,
                        images: prod.images || null,
                        variants: prod.variants || null,
                        status: prod.status || 'active',
                        updatedAt: new Date()
                    },
                    create: {
                        id: prod.id,
                        sku: prod.sku,
                        barcode: prod.barcode || null,
                        name: prod.name,
                        description: prod.description || null,
                        categoryId: prod.categoryId || null,
                        price: prod.price || 0,
                        cost: prod.cost || 0,
                        stock: prod.stock || 0,
                        minStock: prod.minStock || 0,
                        maxStock: prod.maxStock || null,
                        unit: prod.unit || 'Cái',
                        weight: prod.weight || null,
                        images: prod.images || null,
                        variants: prod.variants || null,
                        status: prod.status || 'active',
                        createdAt: prod.createdAt ? new Date(prod.createdAt) : new Date(),
                        updatedAt: new Date()
                    }
                });
                stats.products++;
            }

            // 4. Import Customers
            for (const cust of customers) {
                await tx.customer.upsert({
                    where: { id: cust.id },
                    update: {
                        code: cust.code,
                        name: cust.name,
                        phone: cust.phone || null,
                        email: cust.email || null,
                        address: cust.address || null,
                        loyaltyPoints: cust.loyaltyPoints || 0,
                        totalSpent: cust.totalSpent || 0,
                        totalOrders: cust.totalOrders || 0,
                        debt: cust.debt || 0,
                        tags: cust.tags || null,
                        notes: cust.notes || null,
                        updatedAt: new Date()
                    },
                    create: {
                        id: cust.id,
                        code: cust.code,
                        name: cust.name,
                        phone: cust.phone || null,
                        email: cust.email || null,
                        address: cust.address || null,
                        loyaltyPoints: cust.loyaltyPoints || 0,
                        totalSpent: cust.totalSpent || 0,
                        totalOrders: cust.totalOrders || 0,
                        debt: cust.debt || 0,
                        tags: cust.tags || null,
                        notes: cust.notes || null,
                        createdAt: cust.createdAt ? new Date(cust.createdAt) : new Date(),
                        updatedAt: new Date()
                    }
                });
                stats.customers++;
            }

            // 5. Import PurchaseOrders
            for (const po of purchaseOrders) {
                await tx.purchaseOrder.upsert({
                    where: { id: po.id },
                    update: {
                        poNumber: po.poNumber,
                        supplierId: po.supplierId,
                        status: po.status || 'pending',
                        subtotal: po.subtotal || 0,
                        discount: po.discount || 0,
                        tax: po.tax || 0,
                        total: po.total || 0,
                        paidAmount: po.paidAmount || 0,
                        note: po.note || null,
                        receivedAt: po.receivedAt ? new Date(po.receivedAt) : null,
                        createdBy: po.createdBy || null,
                        updatedAt: new Date()
                    },
                    create: {
                        id: po.id,
                        poNumber: po.poNumber,
                        supplierId: po.supplierId,
                        status: po.status || 'pending',
                        subtotal: po.subtotal || 0,
                        discount: po.discount || 0,
                        tax: po.tax || 0,
                        total: po.total || 0,
                        paidAmount: po.paidAmount || 0,
                        note: po.note || null,
                        receivedAt: po.receivedAt ? new Date(po.receivedAt) : null,
                        createdBy: po.createdBy || null,
                        createdAt: po.createdAt ? new Date(po.createdAt) : new Date(),
                        updatedAt: new Date()
                    }
                });
                stats.purchases++;
            }

            // 6. Import PurchaseItems
            for (const item of purchaseItems) {
                await tx.purchaseItem.upsert({
                    where: { id: item.id },
                    update: {
                        purchaseOrderId: item.purchaseOrderId,
                        productId: item.productId,
                        quantity: item.quantity || 0,
                        price: item.price || 0,
                        subtotal: item.subtotal || 0
                    },
                    create: {
                        id: item.id,
                        purchaseOrderId: item.purchaseOrderId,
                        productId: item.productId,
                        quantity: item.quantity || 0,
                        price: item.price || 0,
                        subtotal: item.subtotal || 0
                    }
                });
            }

            // 7. Import Orders
            for (const order of orders) {
                await tx.order.upsert({
                    where: { id: order.id },
                    update: {
                        orderNumber: order.orderNumber,
                        customerId: order.customerId || null,
                        createdBy: order.createdBy || null,
                        source: order.source || 'pos',
                        status: order.status || 'pending',
                        paymentStatus: order.paymentStatus || 'unpaid',
                        paymentMethod: order.paymentMethod || null,
                        subtotal: order.subtotal || 0,
                        discount: order.discount || 0,
                        tax: order.tax || 0,
                        shippingFee: order.shippingFee || 0,
                        total: order.total || 0,
                        profit: order.profit || 0,
                        trackingNumber: order.trackingNumber || null,
                        note: order.note || null,
                        updatedAt: new Date()
                    },
                    create: {
                        id: order.id,
                        orderNumber: order.orderNumber,
                        customerId: order.customerId || null,
                        createdBy: order.createdBy || null,
                        source: order.source || 'pos',
                        status: order.status || 'pending',
                        paymentStatus: order.paymentStatus || 'unpaid',
                        paymentMethod: order.paymentMethod || null,
                        subtotal: order.subtotal || 0,
                        discount: order.discount || 0,
                        tax: order.tax || 0,
                        shippingFee: order.shippingFee || 0,
                        total: order.total || 0,
                        profit: order.profit || 0,
                        trackingNumber: order.trackingNumber || null,
                        note: order.note || null,
                        createdAt: order.createdAt ? new Date(order.createdAt) : new Date(),
                        updatedAt: new Date()
                    }
                });
                stats.orders++;
            }

            // 8. Import OrderItems
            for (const item of orderItems) {
                // Skip if productId is missing (required field)
                if (!item.productId) {
                    console.warn(`⚠️  Skipping OrderItem ${item.id}: missing productId`);
                    continue;
                }

                await tx.orderItem.upsert({
                    where: { id: item.id },
                    update: {
                        orderId: item.orderId,
                        productId: item.productId,
                        sku: item.sku,
                        productName: item.productName,
                        variant: item.variant || null,
                        quantity: item.quantity || 0,
                        price: item.price || 0,
                        cost: item.cost || 0,
                        discount: item.discount || 0,
                        subtotal: item.subtotal || 0
                    },
                    create: {
                        id: item.id,
                        orderId: item.orderId,
                        productId: item.productId,
                        sku: item.sku,
                        productName: item.productName,
                        variant: item.variant || null,
                        quantity: item.quantity || 0,
                        price: item.price || 0,
                        cost: item.cost || 0,
                        discount: item.discount || 0,
                        subtotal: item.subtotal || 0
                    }
                });
            }

            // 9. Import Payments
            for (const payment of payments) {
                await tx.payment.upsert({
                    where: { id: payment.id },
                    update: {
                        orderId: payment.orderId,
                        method: payment.method,
                        amount: payment.amount || 0,
                        transactionId: payment.transactionId || null,
                        note: payment.note || null,
                        paidAt: payment.paidAt ? new Date(payment.paidAt) : new Date()
                    },
                    create: {
                        id: payment.id,
                        orderId: payment.orderId,
                        method: payment.method,
                        amount: payment.amount || 0,
                        transactionId: payment.transactionId || null,
                        note: payment.note || null,
                        paidAt: payment.paidAt ? new Date(payment.paidAt) : new Date()
                    }
                });
            }

            // 10. Import Expenses
            for (const expense of expenses) {
                await tx.expense.upsert({
                    where: { id: expense.id },
                    update: {
                        category: expense.category,
                        description: expense.description,
                        amount: expense.amount || 0,
                        date: expense.date ? new Date(expense.date) : new Date(),
                        createdBy: expense.createdBy || null
                    },
                    create: {
                        id: expense.id,
                        category: expense.category,
                        description: expense.description,
                        amount: expense.amount || 0,
                        date: expense.date ? new Date(expense.date) : new Date(),
                        createdBy: expense.createdBy || null,
                        createdAt: expense.createdAt ? new Date(expense.createdAt) : new Date()
                    }
                });
                stats.expenses++;
            }

            console.log('  ✅ Import stats:', stats);
            return stats;
        });

        // Log activity
        await prisma.activityLog.create({
            data: {
                module: 'database',
                action: 'IMPORT',
                description: `Imported data from ${path.basename(filePath)}: ${JSON.stringify(result)}`,
                userName: 'System',
                severity: 'INFO',
                timestamp: new Date()
            }
        });

        console.log(`✅ Database imported successfully from: ${filePath}`);
        return { success: true, data: result };
    } catch (error) {
        console.error('❌ Database import error:', error);
        console.error('   Stack:', error.stack);
        return { success: false, error: error.message };
    }
});

// ========================================
// USER PASSWORD MANAGEMENT
// ========================================

// Change password (user changes their own password)
ipcMain.handle('users:changePassword', async (event, { userId, oldPassword, newPassword }) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return { success: false, error: 'Người dùng không tồn tại' };
        }

        // Verify old password (bcrypt compare — hỗ trợ cả plaintext legacy)
        let passwordValid = false;
        if (user.password && user.password.startsWith('$2')) {
            passwordValid = await bcrypt.compare(oldPassword, user.password);
        } else {
            passwordValid = user.password === oldPassword;
        }
        if (!passwordValid) {
            return { success: false, error: 'Mật khẩu hiện tại không đúng' };
        }

        // Hash new password before storing
        const hashedNew = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: userId },
            data: { password: hashedNew }
        });

        console.log(`✅ Changed password for user: ${user.username}`);
        void logActivity({ module: 'users', action: 'UPDATE', description: `Đổi mật khẩu: ${user.username}`, recordName: user.username, userName: user.username });
        return { success: true };
    } catch (error) {
        console.error('❌ Change password error:', error);
        return { success: false, error: error.message };
    }
});

// Reset password (admin resets another user's password)
ipcMain.handle('users:resetPassword', async (event, { userId, newPassword }) => {
    try {
        requireRole('admin');
        if (!prisma) throw new Error('Prisma not available');

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return { success: false, error: 'Người dùng không tồn tại' };
        }

        // Hash password before storing
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword }
        });

        console.log(`✅ Reset password for user: ${user.username}`);
        return { success: true };
    } catch (error) {
        console.error('❌ Reset password error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// BACKUP & RESTORE SYSTEM
// ========================================

const AdmZip = require('adm-zip');

// Backup toàn bộ folder desktop thành ZIP
ipcMain.handle('system:backup', async () => {
    try {
        console.log('🔄 Starting FULL system backup (including node_modules)...');

        // Sử dụng thư mục backup mặc định
        const backupDir = 'G:\\QUAN LY BAN HANG\\apps\\BACKUP';

        // Tạo thư mục backup nếu chưa tồn tại
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
            console.log('📁 Created backup directory:', backupDir);
        }

        console.log('📂 Backup directory:', backupDir);

        // Đường dẫn folder cần backup (toàn bộ desktop)
        const sourceFolder = path.join(__dirname, '..');
        console.log('📁 Source folder:', sourceFolder);

        // Tên file backup với format: BACKUP-MMDDYY-HHMMSS.zip
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const year = String(now.getFullYear()).slice(-2); // 2 chữ số cuối
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');

        const backupFileName = `BACKUP-${month}${day}${year}-${hours}${minutes}${seconds}.zip`;
        const backupFilePath = path.join(backupDir, backupFileName);

        console.log('📦 Creating ZIP file:', backupFilePath);
        console.log('⚠️  This will take several minutes due to large size...');

        // Sử dụng AdmZip để backup
        const zip = new AdmZip();

        // Đếm files để track progress
        let addedCount = 0;

        // Hàm đệ quy để thêm toàn bộ folder
        function addFolderToZip(folderPath, zipPath) {
            const items = fs.readdirSync(folderPath);

            for (const item of items) {
                const itemPath = path.join(folderPath, item);
                const itemZipPath = zipPath ? path.join(zipPath, item) : item;

                const stats = fs.statSync(itemPath);

                if (stats.isDirectory()) {
                    // Thêm folder đệ quy
                    addFolderToZip(itemPath, itemZipPath);
                } else if (stats.isFile()) {
                    // Thêm file
                    zip.addLocalFile(itemPath, path.dirname(itemZipPath), path.basename(itemPath));
                    addedCount++;

                    if (addedCount % 1000 === 0) {
                        console.log(`   ⏳ Added ${addedCount} files...`);
                    }
                }
            }
        }

        console.log('🔄 Adding all files (this may take 2-5 minutes)...');

        // Thêm TOÀN BỘ folder desktop
        addFolderToZip(sourceFolder, '');

        console.log(`✅ Total files added: ${addedCount}`);
        console.log('💾 Writing ZIP file (this may take another 1-2 minutes)...');

        // Lưu file ZIP
        zip.writeZip(backupFilePath);

        // Lấy kích thước file
        const stats = fs.statSync(backupFilePath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

        console.log(`✅ Backup completed: ${backupFilePath}`);
        console.log(`📊 Size: ${sizeMB} MB (${stats.size} bytes)`);
        console.log(`📁 Files: ${addedCount}`);

        return {
            success: true,
            data: {
                path: backupFilePath,
                size: stats.size,
                filename: backupFileName
            }
        };
    } catch (error) {
        console.error('❌ Backup error:', error);
        console.error('   Stack:', error.stack);
        return { success: false, error: error.message };
    }
});

// Lấy danh sách backups
ipcMain.handle('system:listBackups', async () => {
    try {
        const backupDir = path.join(__dirname, '..', '..', 'Backups');

        if (!fs.existsSync(backupDir)) {
            return { success: true, data: [] };
        }

        const files = fs.readdirSync(backupDir)
            .filter(file => file.endsWith('.zip'))
            .map(file => {
                const filePath = path.join(backupDir, file);
                const stats = fs.statSync(filePath);
                return {
                    filename: file,
                    path: filePath,
                    size: stats.size,
                    createdAt: stats.birthtime,
                    modifiedAt: stats.mtime
                };
            })
            .sort((a, b) => b.createdAt - a.createdAt); // Mới nhất ở đầu

        console.log(`📂 Found ${files.length} backup files`);
        return { success: true, data: files };
    } catch (error) {
        console.error('❌ List backups error:', error);
        return { success: false, error: error.message };
    }
});

// Restore từ backup (giải nén ZIP)
ipcMain.handle('system:restore', async (event, backupPath) => {
    try {
        requireRole('admin');
        console.log('🔄 Starting restore from:', backupPath);

        if (!fs.existsSync(backupPath)) {
            return { success: false, error: 'File backup không tồn tại!' };
        }

        // Thư mục restore
        const restoreDir = path.join(__dirname, '..');

        // Sử dụng adm-zip để giải nén
        const zip = new AdmZip(backupPath);

        // Tạo backup tạm của database trước khi restore
        const dbPath = path.join(restoreDir, 'prisma', 'dev.db');
        const dbBackupPath = path.join(restoreDir, 'prisma', `dev.backup.${Date.now()}.db`);
        if (fs.existsSync(dbPath)) {
            fs.copyFileSync(dbPath, dbBackupPath);
            console.log(`📦 Created database backup: ${dbBackupPath}`);
        }

        // Extract tất cả files
        zip.extractAllTo(restoreDir, true); // true = overwrite

        console.log(`✅ Restore completed to: ${restoreDir}`);

        return {
            success: true,
            data: {
                restoreDir,
                message: 'Khôi phục thành công! Vui lòng khởi động lại ứng dụng.'
            }
        };
    } catch (error) {
        console.error('❌ Restore error:', error);
        return { success: false, error: error.message };
    }
});

// Inspect/Preview backup - Xem thông tin chi tiết
ipcMain.handle('system:inspectBackup', async (event, backupPath) => {
    try {
        console.log('🔍 Inspecting backup:', backupPath);

        if (!fs.existsSync(backupPath)) {
            return { success: false, error: 'File backup không tồn tại!' };
        }

        // Lấy thông tin file
        const stats = fs.statSync(backupPath);
        const zip = new AdmZip(backupPath);
        const entries = zip.getEntries();

        // Phân loại entries
        const folders = new Set();
        const files = [];
        let totalSize = 0;

        entries.forEach(entry => {
            if (entry.isDirectory) {
                folders.add(entry.entryName);
            } else {
                files.push({
                    name: entry.entryName,
                    size: entry.header.size,
                    compressedSize: entry.header.compressedSize,
                    date: entry.header.time
                });
                totalSize += entry.header.size;
            }
        });

        // Kiểm tra các folder quan trọng
        const hasSrc = entries.some(e => e.entryName.startsWith('src/'));
        const hasElectron = entries.some(e => e.entryName.startsWith('electron/'));
        const hasPrisma = entries.some(e => e.entryName.startsWith('prisma/'));
        const hasNodeModules = entries.some(e => e.entryName.startsWith('node_modules/'));
        const hasPackageJson = entries.some(e => e.entryName === 'package.json');

        // Top 10 files lớn nhất
        const largestFiles = files
            .sort((a, b) => b.size - a.size)
            .slice(0, 10)
            .map(f => ({
                name: f.name,
                sizeMB: (f.size / 1024 / 1024).toFixed(2)
            }));

        const info = {
            filename: backupPath.split('\\').pop() || backupPath.split('/').pop(),
            path: backupPath,
            fileSize: stats.size,
            fileSizeMB: (stats.size / 1024 / 1024).toFixed(2),
            created: stats.birthtime,
            modified: stats.mtime,

            // Ná»™i dung ZIP
            totalEntries: entries.length,
            totalFiles: files.length,
            totalFolders: folders.size,
            uncompressedSize: totalSize,
            uncompressedSizeMB: (totalSize / 1024 / 1024).toFixed(2),
            compressionRatio: ((1 - stats.size / totalSize) * 100).toFixed(1),

            // Validation
            isValid: hasSrc && hasElectron && hasPrisma && hasPackageJson,
            validation: {
                hasSrc,
                hasElectron,
                hasPrisma,
                hasPackageJson,
                hasNodeModules
            },

            // Top files
            largestFiles,

            // Folder structure
            mainFolders: Array.from(folders)
                .filter(f => !f.includes('/'))
                .sort()
        };

        console.log('✅ Backup inspection complete');
        console.log(`   Files: ${info.totalFiles}, Folders: ${info.totalFolders}`);
        console.log(`   Size: ${info.fileSizeMB} MB (${info.compressionRatio}% compression)`);
        console.log(`   Valid: ${info.isValid}`);

        return { success: true, data: info };
    } catch (error) {
        console.error('❌ Inspect backup error:', error);
        return { success: false, error: error.message };
    }
});

// Browse và chọn file backup để restore
ipcMain.handle('system:browseAndRestore', async () => {
    try {
        console.log('📂 Opening file browser for backup selection...');

        // Cho user chọn file ZIP
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            title: 'Chọn file backup để khôi phục',
            filters: [
                { name: 'Backup Files', extensions: ['zip'] },
                { name: 'All Files', extensions: ['*'] }
            ],
            defaultPath: path.join(__dirname, '..', '..')
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: 'User cancelled' };
        }

        const selectedFile = result.filePaths[0];
        console.log('✅ Selected file:', selectedFile);

        // Trả về file path để UI xử lý tiếp
        return {
            success: true,
            data: {
                filePath: selectedFile,
                message: 'File đã được chọn. Nhấn OK để tiếp tục khôi phục.'
            }
        };
    } catch (error) {
        console.error('❌ Browse error:', error);
        return { success: false, error: error.message };
    }
});

// Xóa backup
ipcMain.handle('system:deleteBackup', async (event, backupPath) => {
    try {
        if (!fs.existsSync(backupPath)) {
            return { success: false, error: 'File backup không tồn tại!' };
        }

        fs.unlinkSync(backupPath);
        console.log(`✅ Deleted backup: ${backupPath}`);

        return { success: true };
    } catch (error) {
        console.error('❌ Delete backup error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// DAILY TASKS HANDLERS
// ========================================

// Get all tasks with filters
ipcMain.handle('dailyTasks:list', async (event, filters = {}) => {
    try {
        const { status, assignee, startDate, endDate, priority } = filters;

        const where = {};

        if (status && status !== 'all') {
            where.status = status;
        }

        if (assignee && assignee !== 'all') {
            where.assignee = assignee;
        }

        if (priority && priority !== 'all') {
            where.priority = priority;
        }

        if (startDate || endDate) {
            where.dueDate = {};
            if (startDate) where.dueDate.gte = new Date(startDate);
            if (endDate) where.dueDate.lte = new Date(endDate);
        }

        const tasks = await prisma.dailyTask.findMany({
            where,
            orderBy: [
                { status: 'asc' },
                { dueDate: 'asc' }
            ]
        });

        return { success: true, data: tasks };
    } catch (error) {
        console.error('Error listing tasks:', error);
        return { success: false, error: error.message };
    }
});

// Create new task
ipcMain.handle('dailyTasks:create', async (event, taskData) => {
    try {
        const task = await prisma.dailyTask.create({
            data: {
                ...taskData,
                dueDate: new Date(taskData.dueDate),
                tags: taskData.tags ? JSON.stringify(taskData.tags) : null,
                attachments: taskData.attachments ? JSON.stringify(taskData.attachments) : null,
            }
        });

        void logActivity({ module: 'system', action: 'CREATE', description: `Tạo công việc "${task.title}"`, recordName: task.title, userName: taskData.assignee || 'Chưa phân công' });
        return { success: true, data: task };
    } catch (error) {
        console.error('Error creating task:', error);
        return { success: false, error: error.message };
    }
});

// Update task
ipcMain.handle('dailyTasks:update', async (event, id, updates) => {
    try {
        const updateData = { ...updates };

        if (updates.dueDate) {
            updateData.dueDate = new Date(updates.dueDate);
        }

        if (updates.tags) {
            updateData.tags = JSON.stringify(updates.tags);
        }

        if (updates.attachments) {
            updateData.attachments = JSON.stringify(updates.attachments);
        }

        // Auto set completedAt khi status thay đổi
        if (updates.status === 'completed' && !updates.completedAt) {
            updateData.completedAt = new Date();
        } else if (updates.status === 'pending') {
            updateData.completedAt = null;
        }

        const task = await prisma.dailyTask.update({
            where: { id },
            data: updateData
        });

        void logActivity({ module: 'system', action: 'UPDATE', description: `Cập nhật công việc #${id}`, recordId: id });
        return { success: true, data: task };
    } catch (error) {
        console.error('Error updating task:', error);
        return { success: false, error: error.message };
    }
});

// Update task status
ipcMain.handle('dailyTasks:updateStatus', async (event, id, status) => {
    try {
        const updateData = { status };

        // Auto set completedAt when status is completed
        if (status === 'completed') {
            updateData.completedAt = new Date();
        } else if (status !== 'completed') {
            updateData.completedAt = null;
        }

        const task = await prisma.dailyTask.update({
            where: { id },
            data: updateData
        });

        return { success: true, data: task };
    } catch (error) {
        console.error('Error updating task status:', error);
        return { success: false, error: error.message };
    }
});

// Delete task
ipcMain.handle('dailyTasks:delete', async (event, id) => {
    try {
        await prisma.dailyTask.delete({
            where: { id }
        });

        void logActivity({ module: 'system', action: 'DELETE', description: `Xóa công việc #${id}` });
        return { success: true };
    } catch (error) {
        console.error('Error deleting task:', error);
        return { success: false, error: error.message };
    }
});

// Get statistics
ipcMain.handle('dailyTasks:stats', async (event, filters = {}) => {
    try {
        const { assignee, startDate, endDate } = filters;

        const where = {};

        if (assignee && assignee !== 'all') {
            where.assignee = assignee;
        }

        if (startDate || endDate) {
            where.dueDate = {};
            if (startDate) where.dueDate.gte = new Date(startDate);
            if (endDate) where.dueDate.lte = new Date(endDate);
        }

        const [total, completed, inProgress, pending, overdue] = await Promise.all([
            prisma.dailyTask.count({ where }),
            prisma.dailyTask.count({ where: { ...where, status: 'completed' } }),
            prisma.dailyTask.count({ where: { ...where, status: 'in_progress' } }),
            prisma.dailyTask.count({ where: { ...where, status: 'pending' } }),
            prisma.dailyTask.count({
                where: {
                    ...where,
                    status: { in: ['pending', 'in_progress'] },
                    dueDate: { lt: new Date() }
                }
            })
        ]);

        const completionRate = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;

        return {
            success: true,
            data: {
                total,
                completed,
                inProgress,
                pending,
                overdue,
                completionRate: parseFloat(completionRate)
            }
        };
    } catch (error) {
        console.error('Error getting task stats:', error);
        return { success: false, error: error.message };
    }
});

// Reset daily tasks - tự động reset khi sang ngày mới
ipcMain.handle('dailyTasks:resetDaily', async () => {
    try {
        if (!prisma) throw new Error('Database chưa được khởi tạo.');

        // Fix null assignee/verifier (tương thích Prisma client cũ)
        await prisma.$executeRawUnsafe(`UPDATE "DailyTask" SET assignee = '' WHERE assignee IS NULL`);
        await prisma.$executeRawUnsafe(`UPDATE "DailyTask" SET verifier = '' WHERE verifier IS NULL`);

        // Lấy ngày hôm nay (theo timezone local)
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        // Kiểm tra ngày reset cuối cùng
        const lastResetConfig = await prisma.appConfig.findUnique({
            where: { key: 'dailyTasksLastResetDate' }
        });

        const lastResetDate = lastResetConfig ? JSON.parse(lastResetConfig.value) : null;

        if (lastResetDate === today) {
            // Đã reset hôm nay rồi
            return { success: true, data: { reset: false, message: 'Đã reset hôm nay rồi' } };
        }

        // Fix dữ liệu cũ: Các task category='Bàn giao' nhưng type='daily' → sửa thành 'assignment'
        await prisma.dailyTask.updateMany({
            where: { category: 'Bàn giao', type: 'daily' },
            data: { type: 'assignment' }
        });

        // Lấy danh sách task HÀNG NGÀY đã completed để lưu history trước khi reset
        // Bàn giao (type: 'assignment') KHÔNG reset - chỉ reset daily tasks
        const completedTasks = await prisma.dailyTask.findMany({
            where: { status: 'completed', type: 'daily' }
        });

        // Lưu vào history trước khi reset
        if (completedTasks.length > 0) {
            // Đọc history cũ
            const historyConfig = await prisma.appConfig.findUnique({
                where: { key: 'dailyTasksHistory' }
            });
            const existingHistory = historyConfig ? JSON.parse(historyConfig.value) : [];

            // Thêm entry cho mỗi task đã hoàn thành
            const newEntries = completedTasks.map(task => ({
                taskId: task.id,
                taskTitle: task.title,
                category: task.category,
                assignee: task.assignee,
                verifier: task.verifier || '',
                action: 'daily_reset',
                timestamp: task.completedAt ? task.completedAt.toISOString() : lastResetDate || now.toISOString(),
                description: `✅ Đã hoàn thành: "${task.title}" (tự động reset sang ngày ${today})`
            }));

            const updatedHistory = [...newEntries, ...existingHistory].slice(0, 500); // Giữ tối đa 500 entries

            await prisma.appConfig.upsert({
                where: { key: 'dailyTasksHistory' },
                update: { value: JSON.stringify(updatedHistory) },
                create: { key: 'dailyTasksHistory', value: JSON.stringify(updatedHistory) }
            });

            // Reset chỉ daily tasks completed về pending (không reset bàn giao)
            await prisma.dailyTask.updateMany({
                where: { status: 'completed', type: 'daily' },
                data: {
                    status: 'pending',
                    completedAt: null,
                    verifier: '',
                    assignee: ''  // Xóa người thực hiện → ai rảnh nhận việc lại mỗi ngày
                }
            });

            console.log(`✅ [DAILY RESET] Ngày ${today}: Reset ${completedTasks.length} tasks completed → pending`);
        }

        // Reset assignee của TẤT CẢ daily tasks sang ngày mới (ai rảnh nhận việc lại)
        // Bàn giao (assignment) KHÔNG reset assignee
        const resetAssigneeResult = await prisma.dailyTask.updateMany({
            where: { type: 'daily' },
            data: { assignee: '', verifier: '' }
        });
        console.log(`✅ [DAILY RESET] Đã xóa assignee của ${resetAssigneeResult.count} daily tasks`);

        // Cập nhật dueDate của chỉ DAILY tasks sang ngày hôm nay (giữ nguyên giờ)
        // Fix bug: task vẫn mang dueDate cũ → calendar hiển thị sai ngày hoàn thành
        // Bàn giao (assignment) giữ nguyên deadline riêng, không cập nhật
        const allTasks = await prisma.dailyTask.findMany({ where: { type: 'daily' } });
        for (const task of allTasks) {
            const oldDueDate = new Date(task.dueDate);
            const newDueDate = new Date(now);
            newDueDate.setHours(oldDueDate.getHours(), oldDueDate.getMinutes(), 0, 0);
            await prisma.dailyTask.update({
                where: { id: task.id },
                data: { dueDate: newDueDate }
            });
        }
        console.log(`✅ [DAILY RESET] Đã cập nhật dueDate của ${allTasks.length} tasks sang ngày ${today}`);

        // Lưu ngày reset
        await prisma.appConfig.upsert({
            where: { key: 'dailyTasksLastResetDate' },
            update: { value: JSON.stringify(today) },
            create: { key: 'dailyTasksLastResetDate', value: JSON.stringify(today) }
        });

        return {
            success: true,
            data: {
                reset: completedTasks.length > 0,
                resetCount: completedTasks.length,
                message: completedTasks.length > 0
                    ? `Đã reset ${completedTasks.length} công việc sang ngày mới`
                    : 'Sang ngày mới, không có công việc cần reset'
            }
        };
    } catch (error) {
        console.error('Error resetting daily tasks:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// COMBO PRODUCTS
// ========================================

// Remove any existing handlers to prevent duplicate registration error
try { ipcMain.removeHandler('combos:getAll'); } catch (e) { }
try { ipcMain.removeHandler('combos:create'); } catch (e) { }
try { ipcMain.removeHandler('combos:update'); } catch (e) { }
try { ipcMain.removeHandler('combos:delete'); } catch (e) { }

ipcMain.handle('combos:getAll', async () => {
    try {
        if (!prisma) return { success: true, data: [] };
        const combos = await prisma.comboProduct.findMany({ orderBy: { createdAt: 'desc' } });
        const products = await prisma.product.findMany({
            select: { id: true, stock: true, cost: true, variants: true }
        });
        const productById = new Map(products.map(p => [p.id, p]));
        const combosWithStock = combos.map(combo => {
            const items = JSON.parse(combo.items || '[]');
            let availableStock = Infinity;
            let calculatedCost = 0;
            items.forEach(item => {
                const product = productById.get(item.productId);
                if (product && product.variants) {
                    let variants;
                    try { variants = JSON.parse(product.variants); } catch { variants = []; }
                    const variant = variants[item.variantIndex];
                    if (variant) {
                        const possibleCombos = Math.floor((variant.stock || 0) / item.quantity);
                        availableStock = Math.min(availableStock, possibleCombos);
                        calculatedCost += (variant.cost || 0) * item.quantity;
                    }
                } else if (product) {
                    const possibleCombos = Math.floor(product.stock / item.quantity);
                    availableStock = Math.min(availableStock, possibleCombos);
                    calculatedCost += (product.cost || 0) * item.quantity;
                }
            });
            return { ...combo, stock: availableStock === Infinity ? 0 : availableStock, cost: calculatedCost };
        });
        return { success: true, data: combosWithStock };
    } catch (error) {
        console.error('Error getting combos:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('combos:create', async (event, data) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        const comboData = { name: data.name, items: JSON.stringify(data.items), price: data.price, cost: data.cost, status: 'active' };
        const combo = await prisma.comboProduct.upsert({
            where: { sku: data.sku },
            create: { sku: data.sku, ...comboData },
            update: comboData,
        });
        void logActivity({ module: 'products', action: 'CREATE', description: `Tạo combo "${combo.name}" (SKU: ${combo.sku})`, recordName: combo.name });
        return { success: true, data: combo };
    } catch (error) {
        console.error('Error creating combo:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('combos:update', async (event, id, data) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        const updateData = { sku: data.sku, name: data.name, price: data.price, cost: data.cost };
        if (data.items !== undefined) updateData.items = JSON.stringify(data.items);
        const combo = await prisma.comboProduct.update({
            where: { id: parseInt(id) },
            data: updateData,
        });
        void logActivity({ module: 'products', action: 'UPDATE', description: `Cập nhật combo "${combo.name}"`, recordName: combo.name });
        return { success: true, data: combo };
    } catch (error) {
        console.error('Error updating combo:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('combos:delete', async (event, id) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        await prisma.comboProduct.delete({ where: { id: parseInt(id) } });
        void logActivity({ module: 'products', action: 'DELETE', description: `Xóa combo #${id}` });
        return { success: true };
    } catch (error) {
        console.error('Error deleting combo:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// ECOMMERCE EXPORT - FOLDER IMPORT & WATCHER
// ========================================

let ecommerceExportWatcher = null;
let ecommerceExportKnownFiles = new Set();
let ecommerceExportWatchFolder = '';

// Kích hoạt dialog chọn thư mục và tự động start watcher
ipcMain.handle('ecommerceExport:selectAndWatch', async () => {
    try {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Chọn thư mục theo dõi file Excel TMĐT (Realtime)',
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: 'Không có thư mục được chọn' };
        }

        const folderPath = result.filePaths[0];

        // Lấy danh sách file hiện có
        const existingFiles = fs.readdirSync(folderPath).filter(f => {
            const ext = path.extname(f).toLowerCase();
            return ['.xlsx', '.xls', '.csv'].includes(ext) && !f.startsWith('~$');
        });

        ecommerceExportKnownFiles = new Set(existingFiles);
        ecommerceExportWatchFolder = folderPath;

        // Dừng watcher cũ nếu có
        if (ecommerceExportWatcher) {
            ecommerceExportWatcher.close();
            ecommerceExportWatcher = null;
        }

        // Bắt đầu theo dõi thư mục
        let debounceTimer = null;
        ecommerceExportWatcher = fs.watch(folderPath, (eventType, filename) => {
            if (!filename) return;
            const ext = path.extname(filename).toLowerCase();
            if (!['.xlsx', '.xls', '.csv'].includes(ext)) return;
            if (filename.startsWith('~$')) return; // File tạm Excel

            // Debounce 2 giây (file có thể đang copy)
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const filePath = path.join(folderPath, filename);

                // Chỉ xử lý file MỚI (chưa có trong danh sách)
                if (!ecommerceExportKnownFiles.has(filename) && fs.existsSync(filePath)) {
                    console.log(`📁 [TMDT Watcher] File mới: ${filename}`);
                    ecommerceExportKnownFiles.add(filename);

                    // Đọc file và gửi về frontend
                    try {
                        const fileBuffer = fs.readFileSync(filePath);
                        const base64 = fileBuffer.toString('base64');

                        // Gửi event về tất cả cửa sổ
                        const { BrowserWindow } = require('electron');
                        const windows = BrowserWindow.getAllWindows();
                        for (const win of windows) {
                            win.webContents.send('ecommerceExport:newFile', {
                                name: filename,
                                base64: base64,
                                path: filePath
                            });
                        }
                        console.log(`✅ [TMDT Watcher] Đã gửi ${filename} về frontend`);
                    } catch (readErr) {
                        console.error(`❌ [TMDT Watcher] Lỗi đọc file ${filename}:`, readErr.message);
                    }
                }
            }, 2000);
        });

        console.log(`👁️ [TMDT Watcher] Đang theo dõi: ${folderPath} (${existingFiles.length} file có sẵn — chỉ watch file MỚI)`);

        // ⚡ KHÔNG đọc nội dung file cũ — chúng đã tồn tại trong DB hoặc user sẽ import thủ công
        // Chỉ track tên file để watcher biết đâu là file MỚI
        return {
            success: true,
            data: {
                folderPath,
                existingFiles: existingFiles.length,
                existingFileList: [] // ⚡ Trả rỗng — không load file cũ
            }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Bắt đầu theo dõi trực tiếp (không dialog — dùng khi auto-restore)
ipcMain.handle('ecommerceExport:startWatch', async (event, folderPath) => {
    try {
        if (!folderPath || !fs.existsSync(folderPath)) {
            return { success: false, error: 'Thư mục không tồn tại' };
        }

        // Lấy danh sách file hiện có (CHỈ ĐỂ TRACK — không đọc nội dung)
        const existingFiles = fs.readdirSync(folderPath).filter(f => {
            const ext = path.extname(f).toLowerCase();
            return ['.xlsx', '.xls', '.csv'].includes(ext) && !f.startsWith('~$');
        });

        ecommerceExportKnownFiles = new Set(existingFiles);
        ecommerceExportWatchFolder = folderPath;

        // Dừng watcher cũ nếu có
        if (ecommerceExportWatcher) {
            ecommerceExportWatcher.close();
            ecommerceExportWatcher = null;
        }

        // Bắt đầu theo dõi — CHỈ phát hiện file MỚI
        let debounceTimer = null;
        ecommerceExportWatcher = fs.watch(folderPath, (eventType, filename) => {
            if (!filename) return;
            const ext = path.extname(filename).toLowerCase();
            if (!['.xlsx', '.xls', '.csv'].includes(ext)) return;
            if (filename.startsWith('~$')) return;

            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const filePath = path.join(folderPath, filename);

                if (!ecommerceExportKnownFiles.has(filename) && fs.existsSync(filePath)) {
                    console.log(`📁 [TMDT Watcher] File mới: ${filename}`);
                    ecommerceExportKnownFiles.add(filename);

                    try {
                        const fileBuffer = fs.readFileSync(filePath);
                        const base64 = fileBuffer.toString('base64');

                        const { BrowserWindow } = require('electron');
                        const windows = BrowserWindow.getAllWindows();
                        for (const win of windows) {
                            win.webContents.send('ecommerceExport:newFile', {
                                name: filename,
                                base64: base64,
                                path: filePath
                            });
                        }
                    } catch (readErr) {
                        console.error(`❌ [TMDT Watcher] Lỗi đọc file ${filename}:`, readErr.message);
                    }
                }
            }, 2000);
        });

        // ⚡ KHÔNG ĐỌC NỘI DUNG FILE CŨ — chúng đã được import trước đó
        // Chỉ trả về số lượng file đã biết (để UI hiển thị)
        console.log(`👁️ [TMDT Watcher] Đã khôi phục session theo dõi: ${folderPath} (${existingFiles.length} file đã có)`);

        return {
            success: true,
            data: { folderPath, existingFiles: existingFiles.length, existingFileList: [] }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Dừng theo dõi
ipcMain.handle('ecommerceExport:stopWatch', async () => {
    if (ecommerceExportWatcher) {
        ecommerceExportWatcher.close();
        ecommerceExportWatcher = null;
        ecommerceExportWatchFolder = '';
        ecommerceExportKnownFiles.clear();
        console.log('🛑 [TMDT Watcher] Đã dừng theo dõi');
        return { success: true };
    }
    return { success: false, error: 'Không có watcher nào đang chạy' };
});

// Chon thu muc chua file Excel xuat hang TMDT
ipcMain.handle('ecommerceExport:selectFolder', async () => {
    try {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Chon thu muc chua file Excel xuat hang TMDT',
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: 'Khong co thu muc duoc chon' };
        }

        return { success: true, data: result.filePaths[0] };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Đọc tất cả file Excel từ thư mục
ipcMain.handle('ecommerceExport:loadExcelFiles', async (event, folderPath) => {
    try {
        if (!folderPath || !fs.existsSync(folderPath)) {
            return { success: false, error: 'Thư mục không tồn tại' };
        }

        // Đọc tất cả file trong thư mục
        const files = fs.readdirSync(folderPath);

        // Lọc chỉ lấy file Excel (.xlsx, .xls)
        const excelFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ext === '.xlsx' || ext === '.xls';
        });

        if (excelFiles.length === 0) {
            return { success: false, error: 'Không tìm thấy file Excel nào trong thư mục' };
        }

        // Đọc nội dung từng file
        const filesData = [];
        for (const fileName of excelFiles) {
            const filePath = path.join(folderPath, fileName);
            try {
                const fileBuffer = fs.readFileSync(filePath);
                // Convert buffer to base64 để gửi qua IPC
                const base64Data = fileBuffer.toString('base64');
                filesData.push({
                    name: fileName,
                    data: base64Data
                });
            } catch (err) {
                console.error(`Error reading file ${fileName}:`, err);
            }
        }

        console.log(`✅ Loaded ${filesData.length} Excel files from ${folderPath}`);
        return { success: true, data: filesData };
    } catch (error) {
        console.error('Error loading Excel files:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// SHELL - Open External Links
// ========================================
ipcMain.handle('shell:openExternal', async (event, url) => {
    try {
        if (!url || typeof url !== 'string') {
            return { success: false, error: 'Invalid URL' };
        }

        // Validate URL format
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return { success: false, error: 'URL must start with http:// or https://' };
        }

        await shell.openExternal(url);
        console.log(`✅ Opened external URL: ${url}`);
        return { success: true };
    } catch (error) {
        console.error('❌ Error opening external URL:', error);
        return { success: false, error: error.message };
    }
});

// ==================== AUTO UPDATE ====================

const GITHUB_REPO = 'yendao444-del/airclean-wms';
const UPDATE_HISTORY_FILE = path.join(app.getPath('userData'), 'update-history.json');

function getUpdateHistory() {
    try {
        if (fs.existsSync(UPDATE_HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(UPDATE_HISTORY_FILE, 'utf8'));
        }
    } catch { }
    return [];
}


// ========================================
// AUTO UPDATE HANDLERS
// ========================================
require('./update-handlers')(prisma, { requireRole });

// ========================================
// ECOMMERCE EXPORTS HANDLERS (XUẤT HÀNG TMDT)
// ========================================

ipcMain.handle('ecommerceExports:getAll', async (event, { since, sinceField, until, limit, search, statusIn, statusNotIn, skip } = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const startedAt = Date.now();
        const field = sinceField || 'ecommerceExportDate';
        const dateFilter = {};
        if (since && !search) dateFilter.gte = new Date(since);
        if (until && !search) dateFilter.lte = new Date(until);
        const trimmedSearch = search ? String(search).trim() : '';
        const syntheticIdMatch = trimmedSearch.match(/^#?(?:TMDT|TMDT-EX)-(\d+)$/i);
        const numericId = syntheticIdMatch ? Number(syntheticIdMatch[1]) : null;

        const statusFilter = {};
        if (Array.isArray(statusIn) && statusIn.length > 0) {
            statusFilter.in = statusIn.map(s => String(s));
        }
        if (Array.isArray(statusNotIn) && statusNotIn.length > 0) {
            statusFilter.notIn = statusNotIn.map(s => String(s));
        }

        const where = search ? {
            OR: [
                { orderNumber: { contains: trimmedSearch, mode: 'insensitive' } },
                { ecommerceExportCode: { contains: trimmedSearch, mode: 'insensitive' } },
                { customerName: { contains: trimmedSearch, mode: 'insensitive' } },
                { notes: { contains: trimmedSearch, mode: 'insensitive' } },
                ...(numericId ? [{ id: numericId }] : []),
            ],
            ...(Object.keys(statusFilter).length > 0 ? { status: statusFilter } : {}),
        } : {
            ...(Object.keys(dateFilter).length > 0 ? { [field]: dateFilter } : {}),
            ...(Object.keys(statusFilter).length > 0 ? { status: statusFilter } : {}),
        };

        const take = search ? 50 : (limit || 2000);

        const exports = await prisma.ecommerceExport.findMany({
            where: Object.keys(where).length > 0 ? where : undefined,
            orderBy: { ecommerceExportDate: 'desc' },
            skip: skip || 0,
            take: take + 1,
        });
        const hasMore = exports.length > take;
        const rows = hasMore ? exports.slice(0, take) : exports;
        // Format dates for frontend
        const formatted = rows.map(e => ({
            ...e,
            ecommerceExportDate: e.ecommerceExportDate.toISOString(),
            updatedAt: e.updatedAt ? e.updatedAt.toISOString() : null,
            items: e.items // Already JSON string
        }));
        console.log(`[Perf] ecommerceExports:getAll rows=${formatted.length} hasMore=${hasMore} search=${!!search} ms=${Date.now() - startedAt}`);
        return { success: true, data: formatted, hasMore };
    } catch (error) {
        console.error('❌ Get ecommerce exports error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('ecommerceExports:getPackersByOrderNumbers', async (event, orderNumbers) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const records = await prisma.ecommerceExport.findMany({
            where: { orderNumber: { in: orderNumbers } },
            select: { orderNumber: true, pickedBy: true },
        });
        const map = {};
        records.forEach(r => { if (r.pickedBy) map[r.orderNumber] = r.pickedBy; });
        return { success: true, data: map };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('ecommerceExports:checkExistingKeys', async (event, { orderNumbers = [], ecommerceExportCodes = [] } = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const normalizeKeys = (keys) => [...new Set((keys || []).map(k => String(k || '').trim()).filter(Boolean))];
        const normalizedOrderNumbers = normalizeKeys(orderNumbers);
        const normalizedExportCodes = normalizeKeys(ecommerceExportCodes);
        const totalKeys = normalizedOrderNumbers.length + normalizedExportCodes.length;
        if (totalKeys === 0) return { success: true, data: { orderNumbers: [], ecommerceExportCodes: [] } };
        if (totalKeys > 1000) throw new Error('Too many keys. Maximum 1000 keys per request.');

        const clauses = [];
        if (normalizedOrderNumbers.length > 0) clauses.push({ orderNumber: { in: normalizedOrderNumbers } });
        if (normalizedExportCodes.length > 0) clauses.push({ ecommerceExportCode: { in: normalizedExportCodes } });

        const [exports, marketplaceOrders] = await Promise.all([
            prisma.ecommerceExport.findMany({
                where: { OR: clauses },
                select: { orderNumber: true, ecommerceExportCode: true },
            }),
            normalizedOrderNumbers.length > 0 ? prisma.order.findMany({
                where: {
                    source: { in: ['tiktok', 'shopee', 'lazada', 'tmdt'] },
                    orderNumber: { in: normalizedOrderNumbers },
                },
                select: { orderNumber: true },
            }) : Promise.resolve([]),
        ]);

        const existingOrderNumbers = new Set();
        const existingExportCodes = new Set();
        for (const record of exports) {
            if (record.orderNumber) existingOrderNumbers.add(record.orderNumber.trim());
            if (record.ecommerceExportCode) existingExportCodes.add(record.ecommerceExportCode.trim());
        }
        for (const order of marketplaceOrders) {
            if (order.orderNumber) existingOrderNumbers.add(order.orderNumber.trim());
        }

        return {
            success: true,
            data: {
                orderNumbers: Array.from(existingOrderNumbers),
                ecommerceExportCodes: Array.from(existingExportCodes),
            }
        };
    } catch (error) {
        console.error('Check existing ecommerce keys error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('ecommerceExports:create', async (event, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const isCompleted = data.status === 'completed';
        const orderKey = (data.orderNumber || data.ecommerceExportCode || '').trim();

        // 🔒 StockMutex: serialize stock operations — tránh race condition Thẻ Kho
        const result = await withStockLock(() => prisma.$transaction(async (tx) => {
            if (orderKey) {
                const existing = await tx.ecommerceExport.findFirst({
                    where: {
                        OR: [
                            { orderNumber: orderKey },
                            { ecommerceExportCode: orderKey }
                        ]
                    },
                    select: { id: true, orderNumber: true, ecommerceExportCode: true, status: true }
                });
                if (existing) {
                    return { skipped: true, reason: 'duplicate', data: existing };
                }
                if (isCompleted) {
                    const existingOrder = await tx.order.findUnique({
                        where: { orderNumber: orderKey },
                        select: { id: true, orderNumber: true, status: true }
                    });
                    if (existingOrder) {
                        return { skipped: true, reason: 'existing_order', data: { ...existingOrder, status: 'completed' } };
                    }
                }
            }

            const resolvedItems = await resolveTmdtItemsSkus(tx, data.items);
            if (isCompleted) {
                assertTmdtItemsHaveSku(resolvedItems, data.orderNumber || data.ecommerceExportCode);
                await assertTmdtItemsSkusExist(tx, resolvedItems, data.orderNumber || data.ecommerceExportCode);
            }

            const newRecord = await tx.ecommerceExport.create({
                data: {
                    customerName: data.customerName,
                    ecommerceExportCode: data.ecommerceExportCode || null,
                    orderNumber: data.orderNumber || null,
                    ecommerceExportReason: data.ecommerceExportReason || null,
                    ecommerceExportDate: new Date(data.ecommerceExportDate),
                    items: JSON.stringify(resolvedItems),
                    totalAmount: data.totalAmount || 0,
                    notes: data.notes || null,
                    status: data.status || 'processing',
                    createdBy: data.createdBy || null,
                    pickedBy: data.pickedBy || null
                }
            });

            if (isCompleted) {
                for (const item of resolvedItems) {
                    if (item.variantSku) {
                        await deductItemOrCombo(tx, item.variantSku, -item.quantity, {
                            type: 'ecom_sale',
                            referenceType: 'TMDT',
                            reference: data.orderNumber || data.ecommerceExportCode || 'Lưu thủ công',
                            note: `Xuất hàng TMDT: ${data.customerName}`,
                            createdBy: data.createdBy || 'System'
                        }, { allowMissing: true });
                    }
                }
                await ensureMarketplaceOrderInTx(tx, newRecord, data.pickedBy || data.createdBy || null);
            }
            return { skipped: false, data: newRecord };
        }, { timeout: 30000, maxWait: 10000 }));

        if (result?.skipped) {
            return { success: true, skipped: true, reason: result.reason, data: result.data };
        }
        const record = result.data;
        console.log(`✅ Created ecommerce export #${record.id}`);
        void logActivity({ module: 'export', action: 'CREATE', description: `Tạo bàn giao TMDT #${record.id} - ${data.customerName}`, recordName: data.customerName, userName: data.createdBy });
        return { success: true, data: record };
    } catch (error) {
        console.error('❌ Create ecommerce export error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('ecommerceExports:getCompletedKeys', async () => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        const [completedExports, marketplaceOrders] = await Promise.all([
            prisma.ecommerceExport.findMany({
                where: { status: 'completed' },
                select: { orderNumber: true, ecommerceExportCode: true }
            }),
            prisma.order.findMany({
                where: {
                    source: { in: ['tiktok', 'shopee', 'lazada', 'tmdt'] }
                },
                select: { orderNumber: true }
            })
        ]);

        const keys = new Set();
        for (const record of completedExports) {
            if (record.orderNumber) keys.add(record.orderNumber.trim());
            if (record.ecommerceExportCode) keys.add(record.ecommerceExportCode.trim());
        }
        for (const order of marketplaceOrders) {
            if (order.orderNumber) keys.add(order.orderNumber.trim());
        }

        return { success: true, data: Array.from(keys) };
    } catch (error) {
        console.error('Get completed ecommerce keys error:', error);
        return { success: false, error: error.message };
    }
});

// ─── Helper: phân biệt lỗi mạng với lỗi logic ────────────────────────────────
function isNetworkError(err) {
    const msg = (err.message || '').toLowerCase();
    const code = err.code || '';
    return (
        msg.includes('enotfound') || msg.includes('econnrefused') ||
        msg.includes('etimedout') || msg.includes('econnreset') ||
        msg.includes('socket hang up') || msg.includes('network') ||
        msg.includes('connect') || msg.includes('fetch failed') ||
        code === 'P5010' || code === 'P5011' // Prisma connection errors
    );
}

function extractTrackingFromNotes(notes) {
    const match = notes?.match(/Tracking: ([^|]+)/);
    return match ? match[1].trim() : null;
}

function normalizeMarketplaceSource(name) {
    const value = String(name || '').toLowerCase();
    if (value.includes('tiktok')) return 'tiktok';
    if (value.includes('shopee')) return 'shopee';
    if (value.includes('lazada')) return 'lazada';
    return 'tmdt';
}

function normalizeSearchText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .trim();
}

async function resolveTmdtItemSku(tx, item) {
    const incomingSku = item?.variantSku || item?.sku || '';
    return incomingSku ? String(incomingSku).trim() : '';
}

async function resolveTmdtItemsSkus(tx, rawItems) {
    const items = typeof rawItems === 'string' ? JSON.parse(rawItems || '[]') : (rawItems || []);
    const resolved = [];
    for (const item of items) {
        const variantSku = await resolveTmdtItemSku(tx, item);
        if (!variantSku) {
            console.warn(`[TMDT] Không resolve được SKU cho item: ${item?.productName || ''} / ${item?.color || ''}`);
        }
        resolved.push({ ...item, variantSku: variantSku || '' });
    }
    return resolved;
}

function assertTmdtItemsHaveSku(items, refCode) {
    const missing = (items || []).filter(item => !item?.variantSku);
    if (missing.length > 0) {
        const first = missing[0] || {};
        throw new Error(`Không resolve được SKU TMDT cho ${refCode || 'đơn'}: ${first.productName || ''} / ${first.color || ''}`);
    }
}

async function assertTmdtItemsSkusExist(tx, items, refCode) {
    for (const item of items || []) {
        const sku = item?.variantSku || '';
        if (!sku) continue;
        const combo = await tx.comboProduct.findUnique({ where: { sku }, select: { sku: true } });
        if (combo) continue;
        const directProduct = await tx.product.findUnique({ where: { sku }, select: { sku: true } }).catch(() => null);
        if (directProduct) continue;
        const variantProduct = await tx.product.findFirst({
            where: { variants: { contains: sku } },
            select: { variants: true }
        });
        if (variantProduct) {
            try {
                const variants = JSON.parse(variantProduct.variants || '[]');
                if (variants.some(v => v?.sku === sku)) continue;
            } catch { }
        }
        throw new Error(`SKU TMDT không tồn tại trong kho cho ${refCode || 'đơn'}: ${sku}`);
    }
}

async function ensureMarketplaceOrderInTx(tx, record, actorName) {
    const orderNumber = (record.orderNumber || record.ecommerceExportCode || '').trim();
    if (!orderNumber) return;

    const existing = await tx.order.findUnique({
        where: { orderNumber },
        select: { id: true }
    });
    if (existing) return;

    let createdByUserId = null;
    if (actorName) {
        const user = await tx.user.findFirst({
            where: {
                OR: [
                    { username: actorName },
                    { fullName: actorName }
                ]
            },
            select: { id: true }
        });
        if (user) createdByUserId = user.id;
    }

    const items = typeof record.items === 'string' ? JSON.parse(record.items || '[]') : (record.items || []);
    const subtotal = items.reduce((sum, item) => sum + Number(item.total || (item.unitPrice || 0) * (item.quantity || 0) || 0), 0);
    const total = Number(record.totalAmount || subtotal || 0);
    const trackingNumber = extractTrackingFromNotes(record.notes || null);

    const order = await tx.order.create({
        data: {
            orderNumber,
            source: normalizeMarketplaceSource(record.customerName),
            status: 'completed',
            paymentStatus: 'paid',
            paymentMethod: 'platform',
            subtotal,
            shippingFee: 0,
            total,
            profit: 0,
            trackingNumber,
            note: record.notes || null,
            createdBy: createdByUserId,
            createdAt: record.updatedAt || new Date(),
        }
    });

    for (const item of items) {
        await tx.orderItem.create({
            data: {
                orderId: order.id,
                productId: item.productId || null,
                sku: item.variantSku || `TMDT-${orderNumber}`,
                productName: item.productName || 'Đơn TMDT',
                variant: item.color || null,
                quantity: Number(item.quantity || 0),
                price: Number(item.unitPrice || 0),
                cost: 0,
                discount: 0,
                subtotal: Number(item.total || (item.unitPrice || 0) * (item.quantity || 0) || 0),
            }
        });
    }
}

// --- Core logic tach rieng de dung lai khi sync queue ---
async function execEcommerceExportUpdate(id, data) {
    if (!prisma) throw new Error('Prisma not available');
    const result = await withStockLock(() => prisma.$transaction(async (tx) => {
        const oldRecord = await tx.ecommerceExport.findUnique({ where: { id } });
        if (!oldRecord) throw new Error('Khong tim thay phieu xuat.');
        const nextOrderKey = String(data.orderNumber || data.ecommerceExportCode || oldRecord.orderNumber || oldRecord.ecommerceExportCode || '').trim();

        if (data.status === 'completed' && oldRecord.status !== 'completed' && nextOrderKey) {
            const existingOrder = await tx.order.findUnique({
                where: { orderNumber: nextOrderKey },
                select: { id: true, orderNumber: true, status: true }
            });
            if (existingOrder) {
                return {
                    skipped: true,
                    reason: 'existing_order',
                    data: { ...existingOrder, status: 'completed' }
                };
            }
        }

        if (oldRecord.status === 'completed') {
            const oldItemsStr = oldRecord.items || '[]';
            const newItemsStr = data.items ? (typeof data.items === 'string' ? data.items : JSON.stringify(data.items)) : oldItemsStr;
            const itemsUnchanged = data.status === 'completed' && oldItemsStr === newItemsStr;
            if (!itemsUnchanged) {
                const oldItems = JSON.parse(oldItemsStr);
                for (const old of oldItems) {
                    if (old.variantSku) {
                        await deductItemOrCombo(tx, old.variantSku, old.quantity, {
                            type: 'adjustment',
                            referenceType: 'TMDT_EDIT',
                            reference: oldRecord.orderNumber || oldRecord.ecommerceExportCode || 'Sua thu cong',
                            note: 'Hoan ton (sua don TMDT #' + oldRecord.id + ')',
                            createdBy: data.createdBy || 'System'
                        }, { allowMissing: true });
                    }
                }
            }
        }

        const resolvedItems = data.items ? await resolveTmdtItemsSkus(tx, data.items) : null;
        if (data.status === 'completed' && resolvedItems) {
            assertTmdtItemsHaveSku(resolvedItems, data.orderNumber || data.ecommerceExportCode || oldRecord.orderNumber || oldRecord.ecommerceExportCode);
            await assertTmdtItemsSkusExist(tx, resolvedItems, data.orderNumber || data.ecommerceExportCode || oldRecord.orderNumber || oldRecord.ecommerceExportCode);
        }

        const newRecord = await tx.ecommerceExport.update({
            where: { id },
            data: {
                customerName: data.customerName,
                ecommerceExportCode: data.ecommerceExportCode || null,
                orderNumber: data.orderNumber || null,
                ecommerceExportReason: data.ecommerceExportReason || null,
                ecommerceExportDate: data.ecommerceExportDate ? new Date(data.ecommerceExportDate) : undefined,
                items: resolvedItems ? JSON.stringify(resolvedItems) : undefined,
                totalAmount: data.totalAmount,
                notes: data.notes || null,
                status: data.status,
                createdBy: data.createdBy !== undefined ? data.createdBy : undefined,
                pickedBy: data.pickedBy !== undefined ? data.pickedBy : undefined
            }
        });

        const oldItemsStrFinal = oldRecord.items || '[]';
        const newItemsStrFinal = resolvedItems ? JSON.stringify(resolvedItems) : oldItemsStrFinal;
        const skipDeduct = oldRecord.status === 'completed' && data.status === 'completed' && oldItemsStrFinal === newItemsStrFinal;
        if (data.status === 'completed' && !skipDeduct) {
            const newItems = JSON.parse(newItemsStrFinal);
            for (const item of newItems) {
                if (item.variantSku) {
                    await deductItemOrCombo(tx, item.variantSku, -item.quantity, {
                        type: 'ecom_sale',
                        referenceType: 'TMDT_EDIT',
                        reference: data.orderNumber || data.ecommerceExportCode || 'Sua thu cong',
                        note: 'Tao/Sua don TMDT: ' + (data.customerName || oldRecord.customerName || 'TMDT'),
                        createdBy: data.createdBy || 'System'
                    }, { allowMissing: true });
                }
            }
        }

        if (data.status === 'completed' && oldRecord.status !== 'completed') {
            await ensureMarketplaceOrderInTx(tx, newRecord, data.pickedBy || data.createdBy || oldRecord.pickedBy || oldRecord.createdBy || null);
        }
        return { skipped: false, data: newRecord };
    }, { timeout: 30000, maxWait: 10000 }));
    return result;
}

ipcMain.handle('ecommerceExports:update', async (event, id, data) => {
    try {
        const result = await execEcommerceExportUpdate(id, data);
        if (result?.skipped) {
            return { success: true, skipped: true, reason: result.reason, data: result.data };
        }
        const record = result.data;
        console.log('Updated ecommerce export #' + record.id);
        void logActivity({ module: 'export', action: 'UPDATE', description: 'Cap nhat ban giao TMDT #' + record.id, recordId: record.id });
        return { success: true, data: record };
    } catch (error) {
        if (isNetworkError(error)) {
            console.warn('[OfflineQueue] Network error, queuing update id=' + id + ':', error.message);
            try {
                offlineQueue.enqueue('ecommerceExports:update', { id, data });
                return { success: true, queued: true, pendingCount: offlineQueue.count() };
            } catch (qErr) {
                console.error('[OfflineQueue] Failed to enqueue:', qErr.message);
            }
        }
        console.error('Update ecommerce export error:', error);
        return { success: false, error: error.message };
    }
});
ipcMain.handle('ecommerceExports:delete', async (event, id) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        // 🔒 StockMutex: serialize stock operations — tránh race condition Thẻ Kho
        await withStockLock(() => prisma.$transaction(async (tx) => {
            const doc = await tx.ecommerceExport.findUnique({ where: { id } });
            if (!doc) return;

            if (doc.status === 'completed') {
                const items = JSON.parse(doc.items || '[]');
                for (const item of items) {
                    if (item.variantSku) {
                        await deductItemOrCombo(tx, item.variantSku, item.quantity, {
                            type: 'adjustment',
                            referenceType: 'TMDT_CANCEL',
                            reference: doc.orderNumber || doc.ecommerceExportCode || 'Xóa thủ công',
                            note: `Hoàn tồn do xóa đơn TMDT #${id}`,
                            createdBy: 'System'
                        }, { allowMissing: true });
                    }
                }
            }
            await tx.ecommerceExport.delete({ where: { id } });
        }, { timeout: 30000, maxWait: 10000 }));

        console.log(`✅ Deleted ecommerce export #${id}`);
        void logActivity({ module: 'export', action: 'DELETE', description: `Xóa bàn giao TMDT #${id}` });
        return { success: true };
    } catch (error) {
        console.error('❌ Delete ecommerce export error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('ecommerceExports:bulkDelete', async (event, ids) => {
    try {
        requireRole('admin');
        if (!prisma) throw new Error('Prisma not available');
        const startTime = Date.now();

        // 🔒 StockMutex: serialize stock operations — tránh race condition Thẻ Kho
        const count = await withStockLock(() => prisma.$transaction(async (tx) => {
            // 🚀 Bước 1: Lấy TẤT CẢ đơn cần xóa trong 1 query
            const docs = await tx.ecommerceExport.findMany({
                where: { id: { in: ids } }
            });
            if (docs.length === 0) return 0;

            // 🚀 Bước 2: Gom SKU cần hoàn kho từ đơn completed
            const completedDocs = docs.filter(d => d.status === 'completed');
            if (completedDocs.length > 0) {
                const skuCache = await buildSkuCache(tx);
                const skuChanges = [];
                for (const doc of completedDocs) {
                    const items = JSON.parse(doc.items || '[]');
                    for (const item of items) {
                        if (item.variantSku) {
                            skuChanges.push({ sku: item.variantSku, quantity: item.quantity }); // + quantity = hoàn kho
                        }
                    }
                }
                if (skuChanges.length > 0) {
                    await batchStockUpdate(tx, skuChanges, {
                        type: 'adjustment',
                        referenceType: 'TMDT_CANCEL',
                        reference: `Xóa hàng loạt ${docs.length} đơn`,
                        note: `Hoàn tồn do xóa ${completedDocs.length} đơn TMDT completed`,
                        createdBy: 'System'
                    }, skuCache);
                }
            }

            // 🚀 Bước 3: Xóa tất cả trong 1 DELETE statement
            const deleted = await tx.ecommerceExport.deleteMany({
                where: { id: { in: ids } }
            });
            return deleted.count;
        }, { timeout: 60000, maxWait: 10000 }));

        const elapsed = Date.now() - startTime;
        console.log(`✅ Bulk deleted ${count} ecommerce exports in ${elapsed}ms`);
        void logActivity({ module: 'export', action: 'DELETE', description: `Xóa hàng loạt ${count} bàn giao TMDT (${elapsed}ms)` });
        return { success: true, data: count };
    } catch (error) {
        console.error('❌ Bulk delete ecommerce exports error:', error);
        return { success: false, error: error.message };
    }
});

// ⚡ Xóa TẤT CẢ đơn TMDT (dùng khi cần reset/cleanup)
ipcMain.handle('ecommerceExports:deleteAll', async () => {
    try {
        requireRole('admin');
        if (!prisma) throw new Error('Prisma not available');

        const count = await prisma.$transaction(async (tx) => {
            const completedDocs = await tx.ecommerceExport.findMany({
                where: { status: 'completed' }
            });
            for (const doc of completedDocs) {
                await ensureMarketplaceOrderInTx(tx, doc, doc.pickedBy || doc.createdBy || null);
            }

            const deleted = await tx.ecommerceExport.deleteMany({});
            return deleted.count;
        });

        console.log(`🗑️ Deleted ALL ${count} ecommerce exports`);
        void logActivity({ module: 'export', action: 'DELETE', description: `Xóa toàn bộ ${count} bàn giao TMDT` });
        return { success: true, data: count };
    } catch (error) {
        console.error('❌ Delete all ecommerce exports error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('ecommerceExports:deleteCancelled', async () => {
    try {
        requireRole('admin', 'manager');
        if (!prisma) throw new Error('Prisma not available');

        const result = await prisma.ecommerceExport.deleteMany({
            where: { status: 'cancelled' }
        });

        console.log(`🗑️ Deleted ${result.count} cancelled ecommerce exports`);
        void logActivity({ module: 'export', action: 'DELETE', description: `Xóa ${result.count} đơn TMDT đã hủy` });
        return { success: true, data: result.count };
    } catch (error) {
        console.error('❌ Delete cancelled ecommerce exports error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('ecommerceExports:bulkCreate', async (event, records) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const startTime = Date.now();
        const orderKeys = [...new Set(
            (records || [])
                .map(r => (r?.orderNumber || r?.ecommerceExportCode || '').trim())
                .filter(Boolean)
        )];

        // Re-import file TMDT nên thay thế các đơn chưa giao/cancelled cùng Order ID,
        // chỉ giữ lại đơn completed để tránh ghi đè lịch sử đã pickup.
        if (orderKeys.length > 0) {
            await prisma.ecommerceExport.deleteMany({
                where: {
                    status: { not: 'completed' },
                    OR: [
                        { orderNumber: { in: orderKeys } },
                        { ecommerceExportCode: { in: orderKeys } }
                    ]
                }
            });
        }

        const [existingRecords, existingOrders] = orderKeys.length > 0
            ? await Promise.all([
                prisma.ecommerceExport.findMany({
                    where: {
                        status: 'completed',
                        OR: [
                            { orderNumber: { in: orderKeys } },
                            { ecommerceExportCode: { in: orderKeys } }
                        ]
                    },
                    select: { orderNumber: true, ecommerceExportCode: true }
                }),
                prisma.order.findMany({
                    where: { orderNumber: { in: orderKeys } },
                    select: { orderNumber: true }
                })
            ])
            : [[], []];

        const existingOrderKeys = new Set();
        for (const record of existingRecords) {
            if (record.orderNumber) existingOrderKeys.add(record.orderNumber.trim());
            if (record.ecommerceExportCode) existingOrderKeys.add(record.ecommerceExportCode.trim());
        }
        for (const order of existingOrders) {
            if (order.orderNumber) existingOrderKeys.add(order.orderNumber.trim());
        }

        const seenIncomingOrderKeys = new Set();
        const dedupedRecords = [];
        for (const record of (records || [])) {
            const orderKey = (record?.orderNumber || record?.ecommerceExportCode || '').trim();
            if (orderKey) {
                if (existingOrderKeys.has(orderKey) || seenIncomingOrderKeys.has(orderKey)) {
                    continue;
                }
                seenIncomingOrderKeys.add(orderKey);
            }
            dedupedRecords.push(record);
        }

        if (dedupedRecords.length === 0) {
            return { success: true, data: { count: 0, skipped: records.length } };
        }

        // 🔒 StockMutex: serialize stock operations — tránh race condition Thẻ Kho
        const result = await withStockLock(() => prisma.$transaction(async (tx) => {
            // 🚀 Bước 1: Batch INSERT tất cả đơn cùng lúc (1 SQL statement)
            const normalizedRecords = [];
            for (const data of dedupedRecords) {
                const resolvedItems = await resolveTmdtItemsSkus(tx, data.items);
                if (data.status === 'completed') {
                    assertTmdtItemsHaveSku(resolvedItems, data.orderNumber || data.ecommerceExportCode);
                    await assertTmdtItemsSkusExist(tx, resolvedItems, data.orderNumber || data.ecommerceExportCode);
                }
                normalizedRecords.push({ ...data, items: JSON.stringify(resolvedItems) });
            }

            const createData = normalizedRecords.map(data => ({
                customerName: data.customerName,
                ecommerceExportCode: data.ecommerceExportCode || null,
                orderNumber: data.orderNumber || null,
                ecommerceExportReason: data.ecommerceExportReason || null,
                ecommerceExportDate: (data.ecommerceExportDate && !isNaN(new Date(data.ecommerceExportDate).getTime())) ? new Date(data.ecommerceExportDate) : new Date(),
                items: data.items,
                totalAmount: data.totalAmount || 0,
                notes: data.notes || null,
                status: data.status || 'processing',
                createdBy: data.createdBy || null
            }));

            await tx.ecommerceExport.createMany({ data: createData });

            // 🚀 Bước 2: Gom tất cả SKU cần trừ kho → batch update
            const completedRecords = normalizedRecords.filter(d => d.status === 'completed');
            if (completedRecords.length > 0) {
                const skuCache = await buildSkuCache(tx);
                const skuChanges = [];
                for (const data of completedRecords) {
                    const itemsList = JSON.parse(data.items || '[]');
                    for (const item of itemsList) {
                        if (item.variantSku) {
                            skuChanges.push({ sku: item.variantSku, quantity: -item.quantity });
                        }
                    }
                }
                if (skuChanges.length > 0) {
                    await batchStockUpdate(tx, skuChanges, {
                        type: 'ecom_sale',
                        referenceType: 'TMDT',
                        reference: `Nhập hàng loạt ${records.length} đơn`,
                        note: `Tạo hàng loạt ${completedRecords.length} đơn TMDT completed`,
                        createdBy: dedupedRecords[0]?.createdBy || 'System'
                    }, skuCache);
                }
            }

            return dedupedRecords.length;
        }, {
            maxWait: 15000,
            timeout: 120000,
        }));

        const elapsed = Date.now() - startTime;
        console.log(`✅ Bulk created ${result} ecommerce exports in ${elapsed}ms`);
        void logActivity({ module: 'export', action: 'CREATE', description: `Tạo hàng loạt ${result} bàn giao TMDT (${elapsed}ms)` });
        return { success: true, data: { count: result, skipped: records.length - result } };

    } catch (error) {
        console.error('❌ Bulk create ecommerce exports error:', error);
        return { success: false, error: error.message };
    }
});

// 🚫 Đánh dấu hàng loạt đơn TMDT đã bị hủy trên sàn (đối soát khi import file mới)
// Chỉ cancel đơn pending — không đụng vào đơn completed (đã giao rồi)
ipcMain.handle('ecommerceExports:bulkCancel', async (event, ids) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        if (!ids || ids.length === 0) return { success: true, data: 0 };

        const result = await prisma.ecommerceExport.updateMany({
            where: {
                id: { in: ids },
                status: { notIn: ['completed'] } // Chỉ cancel đơn chưa giao
            },
            data: { status: 'cancelled' }
        });

        console.log(`🚫 Bulk cancelled ${result.count} ecommerce exports (đối soát sàn)`);
        void logActivity({ module: 'export', action: 'UPDATE', description: `Tự động hủy ${result.count} đơn TMDT (đối soát sàn)` });
        return { success: true, data: result.count };
    } catch (error) {
        console.error('❌ Bulk cancel ecommerce exports error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('marketplaceOrders:getAll', async (event, { since, search, limit } = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const trimmedSearch = search ? String(search).trim() : '';
        const syntheticIdMatch = trimmedSearch.match(/^#?TMDT-(\d+)$/i);
        const numericId = syntheticIdMatch ? Number(syntheticIdMatch[1]) : null;
        const where = {
            source: { in: ['tiktok', 'shopee', 'lazada', 'tmdt'] },
            status: 'completed',
            ...(since && !search ? { createdAt: { gte: new Date(since) } } : {}),
        };
        if (search) where.OR = [
            { orderNumber: { contains: search, mode: 'insensitive' } },
            { customerName: { contains: search, mode: 'insensitive' } },
            { trackingNumber: { contains: search, mode: 'insensitive' } },
            ...(numericId ? [{ id: numericId }] : []),
        ];
        const orders = await prisma.order.findMany({
            where,
            select: {
                id: true, orderNumber: true, source: true, status: true,
                total: true, note: true, trackingNumber: true,
                createdAt: true, updatedAt: true,
                user: { select: { username: true, fullName: true } },
                items: { select: { productName: true, quantity: true, price: true, sku: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: search ? 50 : (limit || 1000),
        });

        const formatted = orders.map(o => ({
            ...o,
            userName: o.user?.username || o.user?.fullName || null,
            createdAt: o.createdAt.toISOString(),
            updatedAt: o.updatedAt.toISOString(),
        }));
        return { success: true, data: formatted };
    } catch (error) {
        console.error('❌ Get marketplace orders error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// EXPORT ORDERS HANDLERS (XUẤT HÀNG POS)
// ========================================

ipcMain.handle('marketplaceOrders:delete', async (event, { id, userName }) => {
    try {
        requireRole('admin');
        if (!prisma) throw new Error('Prisma not available');

        const order = await prisma.order.findUnique({
            where: { id },
            include: { items: true }
        });
        if (!order) throw new Error('Không tìm thấy đơn hàng.');
        if (!['shopee', 'tiktok', 'lazada', 'tmdt'].includes(String(order.source || '').toLowerCase())) {
            throw new Error('Đây không phải đơn TMDT.');
        }

        await withStockLock(() => getPrismaDirectTx().$transaction(async (tx) => {
            const linkedExport = await tx.ecommerceExport.findFirst({
                where: {
                    OR: [
                        { orderNumber: order.orderNumber },
                        { ecommerceExportCode: order.orderNumber }
                    ]
                }
            });

            if (linkedExport && linkedExport.status === 'completed') {
                const exportItems = JSON.parse(linkedExport.items || '[]');
                for (const item of exportItems) {
                    if (item.variantSku) {
                        await deductItemOrCombo(tx, item.variantSku, item.quantity, {
                            type: 'adjustment',
                            referenceType: 'TMDT_CANCEL',
                            reference: linkedExport.orderNumber || linkedExport.ecommerceExportCode || order.orderNumber,
                            note: `Hoàn tồn do xóa đơn TMDT ${order.orderNumber} từ màn Đơn hàng`,
                            createdBy: userName || 'System'
                        }, { allowMissing: true });
                    }
                }
            } else if (order.status === 'completed') {
                for (const item of order.items) {
                    if (item.sku) {
                        await deductItemOrCombo(tx, item.sku, item.quantity, {
                            type: 'adjustment',
                            referenceType: 'TMDT_CANCEL',
                            reference: order.orderNumber,
                            note: `Hoàn tồn do xóa đơn TMDT ${order.orderNumber} từ màn Đơn hàng`,
                            createdBy: userName || 'System'
                        }, { allowMissing: true });
                    }
                }
            }

            if (linkedExport) {
                await tx.ecommerceExport.delete({ where: { id: linkedExport.id } });
            }

            await tx.payment.deleteMany({ where: { orderId: order.id } });
            await tx.orderItem.deleteMany({ where: { orderId: order.id } });
            await tx.order.delete({ where: { id: order.id } });
        }, { timeout: 30000, maxWait: 10000 }));

        void logActivity({
            module: 'sales',
            action: 'DELETE',
            description: `Xóa đơn TMDT #${order.orderNumber} từ màn Đơn hàng`,
            userName: userName || 'System'
        });
        return { success: true };
    } catch (error) {
        console.error('marketplaceOrders:delete error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('exportOrders:getAll', async (event, { since, search, limit } = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const trimmedSearch = search ? String(search).trim() : '';
        const syntheticIdMatch = trimmedSearch.match(/^#?(?:XH|EX)-(\d+)$/i);
        const numericId = syntheticIdMatch ? Number(syntheticIdMatch[1]) : null;
        const where = search ? {
            OR: [
                { customer: { contains: search, mode: 'insensitive' } },
                { notes: { contains: search, mode: 'insensitive' } },
                ...(numericId ? [{ id: numericId }] : []),
            ]
        } : (since ? { exportDate: { gte: new Date(since) } } : undefined);
        const orders = await prisma.exportOrder.findMany({
            where,
            orderBy: { exportDate: 'desc' },
            take: search ? 50 : (limit || 1000),
        });
        const formatted = orders.map(o => ({
            ...o,
            exportDate: o.exportDate.toISOString(),
            items: typeof o.items === 'string' ? JSON.parse(o.items) : o.items
        }));
        return { success: true, data: formatted };
    } catch (error) {
        console.error('❌ Get export orders error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('exportOrders:create', async (event, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const record = await prisma.exportOrder.create({
            data: {
                exportDate: new Date(data.exportDate),
                customer: data.customer,
                status: data.status || 'processing',
                totalAmount: data.totalAmount || 0,
                notes: data.notes || null,
                items: typeof data.items === 'string' ? data.items : JSON.stringify(data.items),
                createdBy: data.createdBy || null
            }
        });
        console.log(`✅ Created export order #${record.id}`);
        void logActivity({ module: 'export', action: 'CREATE', description: `Tạo xuất hàng #${record.id} - ${data.customer}`, recordName: data.customer, userName: data.createdBy });
        return { success: true, data: record };
    } catch (error) {
        console.error('❌ Create export order error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('exportOrders:update', async (event, id, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const record = await prisma.exportOrder.update({
            where: { id },
            data: {
                exportDate: data.exportDate ? new Date(data.exportDate) : undefined,
                customer: data.customer,
                status: data.status,
                totalAmount: data.totalAmount,
                notes: data.notes || null,
                items: data.items ? (typeof data.items === 'string' ? data.items : JSON.stringify(data.items)) : undefined
            }
        });
        console.log(`✅ Updated export order #${record.id}`);
        void logActivity({ module: 'export', action: 'UPDATE', description: `Cập nhật xuất hàng #${record.id}` });
        return { success: true, data: record };
    } catch (error) {
        console.error('❌ Update export order error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('exportOrders:delete', async (event, id) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        await prisma.exportOrder.delete({ where: { id } });
        console.log(`✅ Deleted export order #${id}`);
        void logActivity({ module: 'export', action: 'DELETE', description: `Xóa xuất hàng #${id}` });
        return { success: true };
    } catch (error) {
        console.error('❌ Delete export order error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// RETURNS HANDLERS (TRẢ HÀNG)
// ========================================

ipcMain.handle('returns:getAll', async (event, { since } = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const returns = await prisma.return.findMany({
            where: since ? { createdAt: { gte: new Date(since) } } : undefined,
            orderBy: { createdAt: 'desc' },
            take: 500 // ⚡ Giới hạn 500 phiếu trả gần nhất
        });
        const formatted = returns.map(r => ({
            ...r,
            // Map DB fields → frontend fields
            complaintCode: r.returnCode || '',      // returnCode → complaintCode
            productName: r.customerName || '',       // customerName → productName (frontend uses productName)
            complaintDate: r.returnDate.toISOString().split('T')[0],  // returnDate → complaintDate
            reason: r.returnReason || '',            // returnReason → reason
            returnDate: r.returnDate.toISOString().split('T')[0],
            processNotes: r.notes || null,           // notes → processNotes
            faultParty: r.faultParty || 'warehouse', // ✅ Map faultParty (mặc định warehouse)
        }));
        return { success: true, data: formatted };
    } catch (error) {
        console.error('❌ Get returns error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('returns:create', async (event, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const record = await prisma.return.create({
            data: {
                customerName: data.customerName,
                returnCode: data.returnCode || null,
                orderNumber: data.orderNumber || null,
                returnReason: data.returnReason || null,
                returnDate: new Date(data.returnDate),
                items: typeof data.items === 'string' ? data.items : JSON.stringify(data.items),
                totalAmount: data.totalAmount || 0,
                notes: data.notes || null,
                status: data.status || 'pending',
                packer: data.packer || null,
                faultParty: data.faultParty === 'customer' ? 'customer' : 'warehouse', // ✅ Lưu lý do lỗi
                createdBy: data.createdBy || null
            }
        });
        console.log(`✅ Created return #${record.id}`);
        void logActivity({ module: 'returns', action: 'CREATE', description: `Tạo trả hàng #${record.id} - ${data.customerName}`, recordName: data.customerName, userName: data.createdBy });
        return { success: true, data: record };
    } catch (error) {
        console.error('❌ Create return error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('returns:update', async (event, id, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        // 🔧 FIX: Chỉ update field được gửi, không ghi đè null các field khác
        const updateData = {};
        if (data.customerName !== undefined) updateData.customerName = data.customerName;
        if (data.returnCode !== undefined) updateData.returnCode = data.returnCode || null;
        if (data.orderNumber !== undefined) updateData.orderNumber = data.orderNumber || null;
        if (data.returnReason !== undefined) updateData.returnReason = data.returnReason || null;
        if (data.returnDate !== undefined) updateData.returnDate = new Date(data.returnDate);
        if (data.items !== undefined) updateData.items = typeof data.items === 'string' ? data.items : JSON.stringify(data.items);
        if (data.totalAmount !== undefined) updateData.totalAmount = data.totalAmount;
        if (data.notes !== undefined) updateData.notes = data.notes || null;
        if (data.status !== undefined) updateData.status = data.status;
        if (data.packer !== undefined) updateData.packer = data.packer || null;
        if (data.faultParty !== undefined) updateData.faultParty = data.faultParty === 'customer' ? 'customer' : 'warehouse'; // ✅ Cập nhật lý do lỗi

        const record = await prisma.return.update({
            where: { id },
            data: updateData
        });
        console.log(`✅ Updated return #${record.id}`);
        void logActivity({ module: 'returns', action: 'UPDATE', description: `Cập nhật trả hàng #${record.id}`, changes: data });
        return { success: true, data: record };
    } catch (error) {
        console.error('❌ Update return error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('returns:delete', async (event, id) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        await prisma.return.delete({ where: { id } });
        console.log(`✅ Deleted return #${id}`);
        void logActivity({ module: 'returns', action: 'DELETE', description: `Xóa trả hàng #${id}` });
        return { success: true };
    } catch (error) {
        console.error('❌ Delete return error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('returns:bulkCreate', async (event, records) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        console.log(`📦 returns:bulkCreate called with ${records.length} records`);
        const created = [];
        for (let i = 0; i < records.length; i++) {
            const data = records[i];
            try {
                // 🔧 Safe date parsing
                let returnDate = new Date(data.returnDate);
                if (isNaN(returnDate.getTime())) {
                    console.warn(`⚠️ Record ${i}: Invalid returnDate: "${data.returnDate}", using current date`);
                    returnDate = new Date();
                }
                const record = await prisma.return.create({
                    data: {
                        customerName: data.customerName || 'N/A',
                        returnCode: data.returnCode || null,
                        orderNumber: data.orderNumber || null,
                        returnReason: data.returnReason || null,
                        returnDate: returnDate,
                        items: typeof data.items === 'string' ? data.items : JSON.stringify(data.items || []),
                        totalAmount: data.totalAmount || 0,
                        notes: data.notes || null,
                        status: data.status || 'pending',
                        packer: data.packer || null,
                        faultParty: data.faultParty === 'customer' ? 'customer' : 'warehouse', // ✅ Lưu lý do lỗi (bulkCreate)
                        createdBy: data.createdBy || null
                    }
                });
                created.push(record);
            } catch (recordError) {
                console.error(`❌ Record ${i} failed:`, recordError.message, 'Data:', JSON.stringify(data));
            }
        }
        console.log(`✅ Bulk created ${created.length}/${records.length} returns`);
        void logActivity({ module: 'returns', action: 'CREATE', description: `Tạo hàng loạt ${created.length} trả hàng` });
        return { success: true, data: created };
    } catch (error) {
        console.error('❌ Bulk create returns error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// REFUNDS HANDLERS (HÀNG HOÀN)
// ========================================

ipcMain.handle('refunds:getAll', async (event, { since, limit } = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const refunds = await prisma.refund.findMany({
            where: since ? { createdAt: { gte: new Date(since) } } : undefined,
            orderBy: { createdAt: 'desc' },
            take: limit || 1000,
        });
        const formatted = refunds.map(r => ({
            ...r,
            refundDate: r.refundDate.toISOString().split('T')[0]
        }));
        return { success: true, data: formatted };
    } catch (error) {
        console.error('❌ Get refunds error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('refunds:create', async (event, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        // 🔧 Safe date parsing
        let refundDate = new Date(data.refundDate);
        if (isNaN(refundDate.getTime())) {
            console.warn(`⚠️ Invalid refundDate: "${data.refundDate}", using current date`);
            refundDate = new Date();
        }
        const record = await prisma.refund.create({
            data: {
                customerName: data.customerName || 'N/A',
                refundCode: data.refundCode || null,
                orderNumber: data.orderNumber || null,
                refundReason: data.refundReason || null,
                refundDate: refundDate,
                items: typeof data.items === 'string' ? data.items : JSON.stringify(data.items || []),
                totalAmount: data.totalAmount || 0,
                notes: data.notes || null,
                status: data.status || 'processing',
                createdBy: data.createdBy || null
            }
        });
        console.log(`✅ Created refund #${record.id}`);
        void logActivity({ module: 'refunds', action: 'CREATE', description: `Tạo hàng hoàn #${record.id} - ${data.customerName}`, recordName: data.customerName, userName: data.createdBy });
        return { success: true, data: record };
    } catch (error) {
        console.error('❌ Create refund error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('refunds:update', async (event, id, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        // 🔧 FIX: Chỉ update các field được gửi lên, KHÔNG overwrite field không có
        const updateData = {};
        if (data.customerName !== undefined) updateData.customerName = data.customerName;
        if (data.refundCode !== undefined) updateData.refundCode = data.refundCode || null;
        if (data.orderNumber !== undefined) updateData.orderNumber = data.orderNumber || null;
        if (data.refundReason !== undefined) updateData.refundReason = data.refundReason || null;
        if (data.refundDate !== undefined) updateData.refundDate = new Date(data.refundDate);
        if (data.items !== undefined) updateData.items = typeof data.items === 'string' ? data.items : JSON.stringify(data.items);
        if (data.totalAmount !== undefined) updateData.totalAmount = data.totalAmount;
        if (data.notes !== undefined) updateData.notes = data.notes || null;
        if (data.status !== undefined) updateData.status = data.status;

        console.log(`📝 Updating refund #${id} with fields:`, Object.keys(updateData));
        const record = await prisma.refund.update({
            where: { id },
            data: updateData
        });
        console.log(`✅ Updated refund #${record.id}`);
        void logActivity({ module: 'refunds', action: 'UPDATE', description: `Cập nhật hàng hoàn #${record.id}`, changes: data });
        return { success: true, data: record };
    } catch (error) {
        console.error('❌ Update refund error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('refunds:delete', async (event, id) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        await prisma.refund.delete({ where: { id } });
        console.log(`✅ Deleted refund #${id}`);
        void logActivity({ module: 'refunds', action: 'DELETE', description: `Xóa hàng hoàn #${id}` });
        return { success: true };
    } catch (error) {
        console.error('❌ Delete refund error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('refunds:bulkDelete', async (event, ids) => {
    try {
        requireRole('admin');
        if (!prisma) throw new Error('Prisma not available');
        const result = await prisma.refund.deleteMany({
            where: { id: { in: ids } }
        });
        console.log(`✅ Bulk deleted ${result.count} refunds`);
        void logActivity({ module: 'refunds', action: 'DELETE', description: `Xóa hàng loạt ${result.count} hàng hoàn` });
        return { success: true, data: result.count };
    } catch (error) {
        console.error('❌ Bulk delete refunds error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('refunds:bulkCreate', async (event, records) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        console.log(`📦 refunds:bulkCreate called with ${records.length} records`);
        const created = [];
        for (let i = 0; i < records.length; i++) {
            const data = records[i];
            try {
                // 🔧 Safe date parsing
                let refundDate;
                try {
                    refundDate = new Date(data.refundDate);
                    if (isNaN(refundDate.getTime())) {
                        console.warn(`⚠️ Invalid refundDate for record ${i}: "${data.refundDate}", using current date`);
                        refundDate = new Date();
                    }
                } catch {
                    refundDate = new Date();
                }

                const record = await prisma.refund.create({
                    data: {
                        customerName: data.customerName || 'N/A',
                        refundCode: data.refundCode || null,
                        orderNumber: data.orderNumber || null,
                        refundReason: data.refundReason || null,
                        refundDate: refundDate,
                        items: typeof data.items === 'string' ? data.items : JSON.stringify(data.items || []),
                        totalAmount: data.totalAmount || 0,
                        notes: data.notes || null,
                        status: data.status || 'processing',
                        createdBy: data.createdBy || null
                    }
                });
                created.push(record);
            } catch (itemError) {
                console.error(`❌ Error creating refund record ${i}:`, itemError.message);
                console.error(`   Data:`, JSON.stringify(data).substring(0, 200));
                // Continue with other records
            }
        }
        console.log(`✅ Bulk created ${created.length}/${records.length} refunds`);
        void logActivity({ module: 'refunds', action: 'CREATE', description: `Tạo hàng loạt ${created.length} hàng hoàn` });
        return { success: true, data: created };
    } catch (error) {
        console.error('❌ Bulk create refunds error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// STOCK BALANCE HANDLERS (CÂN BẰNG KHO)
// ========================================

ipcMain.handle('stockBalance:getAll', async (event, { limit } = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const records = await prisma.stockBalance.findMany({
            orderBy: { createdAt: 'desc' },
            take: limit || 500,
        });
        const formatted = records.map(r => ({
            ...r,
            date: r.createdAt.toISOString(),
            items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items
        }));
        return { success: true, data: formatted };
    } catch (error) {
        console.error('❌ Get stock balance records error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('stockBalance:create', async (event, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const record = await prisma.stockBalance.create({
            data: {
                date: new Date(data.date),
                adjustedBy: currentSession?.username || data.adjustedBy || 'System',
                items: typeof data.items === 'string' ? data.items : JSON.stringify(data.items),
                notes: data.notes || null
            }
        });
        console.log(`✅ Created stock balance record #${record.id}`);
        const effectiveUser = currentSession?.username || data.adjustedBy || 'System';
        void logActivity({ module: 'products', action: 'UPDATE', description: `Cân bằng kho - ${effectiveUser}`, recordName: effectiveUser, userName: effectiveUser });
        return { success: true, data: record };
    } catch (error) {
        console.error('❌ Create stock balance error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// INVENTORY LOGS / THẺ KHO
// ========================================

// Helper: Ghi log thẻ kho — được gọi từ tất cả module (POS, Purchase, Export, Returns, Refunds, StockBalance)
async function createInventoryLog({ sku, productId, productName, variantColor, type, referenceType, reference, quantity, oldStock, newStock, note, createdBy }) {
    try {
        if (!prisma) return null;

        let reporterId = null;

        // Đích danh user đang thao tác (chống ghi đè 'System' hay 'Admin' mù mờ)
        let actualUsername = currentSession?.username;
        if (!actualUsername && typeof createdBy === 'string') actualUsername = createdBy;

        if (actualUsername) {
            const user = await prisma.user.findUnique({ where: { username: actualUsername } });
            if (user) reporterId = user.id;
        } else if (typeof createdBy === 'number') {
            reporterId = createdBy;
        }

        const log = await prisma.inventoryLog.create({
            data: {
                productId: productId || 0,
                sku: sku || '',
                productName: productName || null,
                variantColor: variantColor || null,
                type: type || 'adjustment',
                referenceType: referenceType || null,
                reference: reference || null,
                quantity: quantity || 0,
                oldStock: oldStock || 0,
                newStock: newStock || 0,
                note: note || null,
                createdBy: reporterId,
            }
        });
        console.log(`📋 [ThẻKho] ${referenceType || type}: ${sku} ${quantity > 0 ? '+' : ''}${quantity} → Tồn cuối: ${newStock}`);
        return log;
    } catch (err) {
        console.error('❌ [ThẻKho] Error:', err.message);
        return null;
    }
}

// Helper: Lấy stock hiện tại của SKU (product hoặc variant)
async function getCurrentStock(sku) {
    try {
        if (!prisma) return 0;

        // Tìm product trực tiếp
        const product = await prisma.product.findUnique({ where: { sku } });
        if (product) return product.stock || 0;

        // Tìm trong variants
        const products = await prisma.product.findMany({
            where: { variants: { contains: sku } }
        });
        for (const p of products) {
            if (!p.variants) continue;
            try {
                const variants = JSON.parse(p.variants);
                const v = variants.find(v => v.sku === sku);
                if (v) return v.stock || 0;
            } catch { }
        }
        return 0;
    } catch {
        return 0;
    }
}

// Helper: Lấy productId + product info từ SKU
async function getProductInfoBySku(sku) {
    try {
        if (!prisma) return null;

        const product = await prisma.product.findUnique({ where: { sku } });
        if (product) {
            return { productId: product.id, productName: product.name, variantColor: null };
        }

        // Tìm trong variants
        const products = await prisma.product.findMany({
            where: { variants: { contains: sku } }
        });
        for (const p of products) {
            if (!p.variants) continue;
            try {
                const variants = JSON.parse(p.variants);
                const v = variants.find(v => v.sku === sku);
                if (v) {
                    return { productId: p.id, productName: p.name, variantColor: v.color || v.name || null };
                }
            } catch { }
        }
        return null;
    } catch {
        return null;
    }
}

// Lấy tất cả inventory logs (có filter + phân trang)
ipcMain.handle('inventoryLogs:getAll', async (event, filters = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        const where = {};
        if (filters.sku) where.sku = filters.sku;
        if (filters.type) where.type = filters.type;
        if (filters.referenceType) where.referenceType = filters.referenceType;
        if (filters.search) {
            where.OR = [
                { sku: { contains: filters.search, mode: 'insensitive' } },
                { productName: { contains: filters.search, mode: 'insensitive' } },
                { reference: { contains: filters.search, mode: 'insensitive' } },
            ];
        }
        if (filters.startDate || filters.endDate) {
            where.createdAt = {};
            if (filters.startDate) where.createdAt.gte = new Date(filters.startDate);
            if (filters.endDate) {
                const end = new Date(filters.endDate);
                end.setHours(23, 59, 59, 999);
                where.createdAt.lte = end;
            }
        }

        const queryOptions = {
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                user: { select: { username: true, fullName: true } },
            }
        };
        // Chỉ giới hạn khi caller truyền limit rõ ràng (vd: getBySku dùng limit: 100)
        // Không giới hạn khi load thẻ kho để tổng xuất/nhập luôn chính xác
        if (filters.limit) queryOptions.take = filters.limit;

        const logs = await prisma.inventoryLog.findMany(queryOptions);

        const formatted = logs.map(l => ({
            ...l,
            createdAt: l.createdAt.toISOString(),
            userName: l.user?.username || null,
        }));

        console.log(`📋 [ThẻKho] Loaded ${formatted.length} logs`);
        return { success: true, data: formatted };
    } catch (error) {
        console.error('❌ Get inventory logs error:', error);
        return { success: false, error: error.message };
    }
});

// Lấy log theo SKU (thẻ kho 1 sản phẩm)
ipcMain.handle('inventoryLogs:getBySku', async (event, { sku, limit = 100 }) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        const logs = await prisma.inventoryLog.findMany({
            where: { sku },
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: {
                user: { select: { username: true, fullName: true } },
            }
        });

        const formatted = logs.map(l => ({
            ...l,
            createdAt: l.createdAt.toISOString(),
            userName: l.user?.username || null,
        }));

        return { success: true, data: formatted };
    } catch (error) {
        console.error('❌ Get inventory logs by SKU error:', error);
        return { success: false, error: error.message };
    }
});

// Lấy chi tiết chứng từ gốc từ inventory log (click Mã CT)
ipcMain.handle('inventoryLogs:getRefDetail', async (event, { referenceType, reference }) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        if (!reference) return { success: false, error: 'Không có mã chứng từ' };

        const refType = (referenceType || '').toUpperCase();

        // TMDT / TMDT_EDIT / TMDT_CANCEL
        if (refType.startsWith('TMDT')) {
            const doc = await prisma.ecommerceExport.findFirst({
                where: { OR: [{ orderNumber: reference }, { ecommerceExportCode: reference }] }
            });
            if (!doc) return { success: false, error: `Chi tiết chứng từ gốc không còn trên hệ thống: ${reference}` };
            let items = [];
            try { items = typeof doc.items === 'string' ? JSON.parse(doc.items) : (doc.items || []); } catch { }
            // Với mỗi item là combo, load combo definition để biết components
            const itemsWithCombo = await Promise.all(items.map(async (item) => {
                const sku = item.variantSku || item.sku || '';
                console.log(`[getRefDetail] item sku: "${sku}"`);
                if (!sku) return item;
                const combo = await prisma.comboProduct.findUnique({ where: { sku } });
                console.log(`[getRefDetail] combo found for "${sku}":`, combo ? `YES - items: ${combo.items}` : 'NO');
                if (!combo) return item;
                let comboComponents = [];
                try { comboComponents = typeof combo.items === 'string' ? JSON.parse(combo.items) : (combo.items || []); } catch { }
                console.log(`[getRefDetail] comboComponents for "${sku}":`, JSON.stringify(comboComponents));
                return { ...item, comboComponents };
            }));
            return { success: true, type: 'TMDT', data: { ...doc, items: itemsWithCombo } };
        }

        // POS / POS_EDIT / POS_CANCEL
        if (refType.startsWith('POS')) {
            const order = await prisma.order.findFirst({
                where: { orderNumber: reference },
                include: { items: true, payments: true, customer: true }
            });
            if (!order) return { success: false, error: `Chi tiết chứng từ gốc không còn trên hệ thống: ${reference}` };
            return { success: true, type: 'POS', data: order };
        }

        // NHAP (Purchase)
        if (refType === 'NHAP') {
            const po = await prisma.purchaseOrder.findFirst({
                where: { poNumber: reference },
                include: { supplier: true, items: { include: { product: { select: { name: true, sku: true, unit: true } } } } }
            });
            if (!po) return { success: false, error: `Chi tiết chứng từ gốc không còn trên hệ thống: ${reference}` };
            return { success: true, type: 'PURCHASE', data: po };
        }

        // Adjustment / other — không có chứng từ gốc
        return { success: false, error: 'Loại chứng từ này không có chi tiết để xem.' };
    } catch (error) {
        console.error('❌ getRefDetail error:', error);
        return { success: false, error: error.message };
    }
});

// Tạo inventory log thủ công (điều chỉnh / cân bằng kho)
ipcMain.handle('inventoryLogs:create', async (event, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const log = await createInventoryLog(data);
        return { success: true, data: log };
    } catch (error) {
        console.error('❌ Create inventory log error:', error);
        return { success: false, error: error.message };
    }
});


// ========================================
// APP CONFIG HANDLERS (CẤU HÌNH ỨNG DỤNG)
// ========================================

ipcMain.handle('appConfig:get', async (event, key) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const config = await prisma.appConfig.findUnique({
            where: { key }
        });
        if (config) {
            return { success: true, data: JSON.parse(config.value) };
        }
        return { success: true, data: null };
    } catch (error) {
        console.error(`❌ Get config "${key}" error:`, error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('appConfig:set', async (event, key, value) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const adminOnlyKeys = new Set([
            'variantMinStocks',
            'pausedVariants',
        ]);
        if (adminOnlyKeys.has(key)) {
            requireRole('admin');
        }
        const config = await prisma.appConfig.upsert({
            where: { key },
            update: { value: JSON.stringify(value) },
            create: { key, value: JSON.stringify(value) }
        });
        console.log(`✅ Set config "${key}"`);
        return { success: true, data: config };
    } catch (error) {
        console.error(`❌ Set config "${key}" error:`, error);
        return { success: false, error: error.message };
    }
});

// ========================================
// USERS HANDLERS (NGƯỜI DÙNG / PHÂN QUYỀN)
// ========================================

ipcMain.handle('users:getAll', async () => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        // Dùng raw SQL để luôn lấy được lastActiveAt kể cả khi Prisma client cũ chưa generate lại
        const users = await prisma.$queryRaw`SELECT id, username, "fullName", email, role, status, "createdAt", "lastActiveAt" FROM "User" ORDER BY id ASC`;
        const formatted = users.map(u => ({
            id: u.id,
            username: u.username,
            fullName: u.fullName,
            email: u.email,
            role: u.role,
            isActive: u.status === 'active',
            createdAt: new Date(u.createdAt).toISOString(),
            lastActiveAt: u.lastActiveAt ? new Date(u.lastActiveAt).toISOString() : null,
        }));
        return { success: true, data: formatted };
    } catch (error) {
        console.error('❌ Get users error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('users:create', async (event, data) => {
    try {
        requireRole('admin');
        if (!prisma) throw new Error('Prisma not available');
        // 🔒 SECURITY: Hash password trước khi lưu
        const hashedPassword = await bcrypt.hash(data.password, 10);
        const user = await prisma.user.create({
            data: {
                username: data.username,
                password: hashedPassword,
                fullName: data.fullName,
                email: data.email || null,
                role: data.role || 'staff',
                status: data.isActive !== false ? 'active' : 'inactive'
            }
        });
        console.log(`✅ Created user: ${user.username}`);
        void logActivity({ module: 'users', action: 'CREATE', description: `Tạo người dùng "${user.username}" (${data.role || 'staff'})`, recordName: user.username });
        return { success: true, data: { ...user, isActive: user.status === 'active' } };
    } catch (error) {
        console.error('❌ Create user error:', error);
        if (error.code === 'P2002') {
            return { success: false, error: 'Tên đăng nhập đã tồn tại!' };
        }
        return { success: false, error: error.message };
    }
});

ipcMain.handle('users:update', async (event, id, data) => {
    try {
        requireRole('admin');
        if (!prisma) throw new Error('Prisma not available');
        const updateData = {};
        if (data.username !== undefined) updateData.username = data.username;
        if (data.fullName !== undefined) updateData.fullName = data.fullName;
        if (data.email !== undefined) updateData.email = data.email;
        if (data.role !== undefined) updateData.role = data.role;
        // 🔒 SECURITY: Hash password mới nếu đổi mật khẩu
        if (data.password !== undefined) updateData.password = await bcrypt.hash(data.password, 10);
        if (data.isActive !== undefined) updateData.status = data.isActive ? 'active' : 'inactive';

        const user = await prisma.user.update({
            where: { id },
            data: updateData
        });
        console.log(`✅ Updated user: ${user.username}`);
        void logActivity({ module: 'users', action: 'UPDATE', description: `Cập nhật người dùng "${user.username}"`, recordName: user.username });
        return { success: true, data: { ...user, isActive: user.status === 'active' } };
    } catch (error) {
        console.error('❌ Update user error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('users:delete', async (event, id) => {
    try {
        requireRole('admin');
        if (!prisma) throw new Error('Prisma not available');
        await prisma.user.delete({ where: { id } });
        console.log(`✅ Deleted user #${id}`);
        void logActivity({ module: 'users', action: 'DELETE', description: `Xóa người dùng #${id}` });
        return { success: true };
    } catch (error) {
        console.error('❌ Delete user error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('users:login', async (event, username, password, rememberMe = false) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const normalizedUsername = typeof username === 'string' ? username.trim() : '';
        const user = await prisma.user.findUnique({
            where: { username: normalizedUsername }
        });
        if (!user || user.status !== 'active') {
            return { success: false, error: 'Tài khoản không tồn tại hoặc đã bị vô hiệu hóa' };
        }
        // 🔒 SECURITY: So sánh bằng bcrypt
        const isHashed = typeof user.password === 'string' && user.password.startsWith('$2');
        let passwordValid = false;
        if (isHashed) {
            passwordValid = await bcrypt.compare(password, user.password);
        } else {
            // Backward compatible: plaintext password cũ → auto-upgrade sang hash
            passwordValid = (user.password === password);
            if (passwordValid) {
                const hashed = await bcrypt.hash(password, 10);
                await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
                console.log(`🔒 Auto-upgraded password for user: ${user.username}`);
            }
        }
        if (!passwordValid) {
            return { success: false, error: 'Mật khẩu không đúng' };
        }
        // Lưu session phía backend
        currentSession = { id: user.id, username: user.username, role: user.role };
        prisma.$executeRaw`UPDATE "User" SET "lastActiveAt" = NOW() WHERE id = ${user.id}`.catch(() => { });
        void logActivity({ module: 'users', action: 'LOGIN', description: `Đăng nhập: ${user.username}`, recordName: user.username, userName: user.username });
        const rememberToken = rememberMe && user.role === 'admin'
            ? await issueRememberToken(user.id)
            : null;
        return { success: true, data: sanitizeUserForClient(user), rememberToken };
    } catch (error) {
        console.error('❌ Login error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('users:logout', async (event, rememberToken) => {
    await revokeRememberToken(rememberToken).catch(() => { });
    if (currentSession?.id) {
        await prisma.$executeRaw`UPDATE "User" SET "lastActiveAt" = NULL WHERE id = ${currentSession.id}`.catch(() => { });
    }
    currentSession = null;
    return { success: true };
});

ipcMain.handle('users:getCurrentSession', async () => {
    try {
        if (!prisma) return { success: false };
        if (!currentSession?.id) return { success: false };
        const user = await prisma.user.findUnique({ where: { id: currentSession.id } });
        if (!user || user.status !== 'active') {
            currentSession = null;
            return { success: false };
        }
        currentSession = { id: user.id, username: user.username, role: user.role };
        return { success: true, data: sanitizeUserForClient(user) };
    } catch {
        return { success: false };
    }
});

// Restore session khi auto-login từ remember token đã cấp sau login password thành công
ipcMain.handle('users:restoreSession', async (event, rememberToken) => {
    try {
        if (!prisma || typeof rememberToken !== 'string' || rememberToken.length < 32) return { success: false };
        const now = Date.now();
        const tokenHash = hashRememberToken(rememberToken);
        const tokens = await readRememberTokens();
        const validTokens = tokens.filter(t => t && t.expiresAt && new Date(t.expiresAt).getTime() > now);
        const record = validTokens.find(t => t.tokenHash === tokenHash);
        if (!record) {
            if (validTokens.length !== tokens.length) await writeRememberTokens(validTokens);
            return { success: false };
        }
        if (validTokens.length !== tokens.length) await writeRememberTokens(validTokens);
        const user = await prisma.user.findUnique({ where: { id: record.userId } });
        if (!user || user.status !== 'active') return { success: false };
        currentSession = { id: user.id, username: user.username, role: user.role };
        prisma.$executeRaw`UPDATE "User" SET "lastActiveAt" = NOW() WHERE id = ${user.id}`.catch(() => { });
        return { success: true, data: sanitizeUserForClient(user) };
    } catch {
        return { success: false };
    }
});

ipcMain.handle('users:heartbeat', async () => {
    try {
        if (!currentSession?.id || !prisma) return { success: false };
        await prisma.$executeRaw`UPDATE "User" SET "lastActiveAt" = NOW() WHERE id = ${currentSession.id}`.catch(() => { });
        return { success: true };
    } catch {
        return { success: false };
    }
});

ipcMain.handle('users:ensureAdmin', async () => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        // Check if any active admin exists
        const adminCount = await prisma.user.count({
            where: { role: 'admin', status: 'active' }
        });
        if (adminCount === 0) {
            // Create default admin
            await prisma.user.upsert({
                where: { username: 'admin' },
                update: { status: 'active', role: 'admin' },
                create: {
                    username: 'admin',
                    password: await bcrypt.hash('admin', 10),
                    fullName: 'Quản trị viên',
                    email: 'admin@example.com',
                    role: 'admin',
                    status: 'active'
                }
            });
            console.log('✅ Ensured default admin exists');
        }
        return { success: true };
    } catch (error) {
        console.error('❌ Ensure admin error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// DAILY EXPENSES HANDLERS (CHI PHÍ HÀNG NGÀY - P&L)
// ========================================

ipcMain.handle('dailyExpenses:getAll', async (event, filters) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const where = {};
        if (filters?.startDate && filters?.endDate) {
            where.date = {
                gte: new Date(filters.startDate),
                lte: new Date(filters.endDate),
            };
        }
        const records = await prisma.dailyExpense.findMany({
            where,
            orderBy: { date: 'desc' }
        });
        const formatted = records.map(r => ({
            ...r,
            date: r.date.toISOString().split('T')[0],
        }));
        return { success: true, data: formatted };
    } catch (error) {
        console.error('❌ Get daily expenses error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('dailyExpenses:upsert', async (event, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const dateObj = new Date(data.date);
        // Normalize to start of day UTC
        dateObj.setUTCHours(0, 0, 0, 0);

        const expenseData = {
            shopeeAds: data.shopeeAds || 0,
            tiktokAds: data.tiktokAds || 0,
            facebookAds: data.facebookAds || 0,
            otherAds: data.otherAds || 0,
            shippingCost: data.shippingCost || 0,
            returnCost: data.returnCost || 0,
            otherExpense: data.otherExpense || 0,
            otherNote: data.otherNote || null,
            createdBy: data.createdBy || null,
        };

        const record = await prisma.dailyExpense.upsert({
            where: { date: dateObj },
            update: expenseData,
            create: { date: dateObj, ...expenseData },
        });
        console.log(`✅ Upserted daily expense for ${data.date}`);
        return { success: true, data: { ...record, date: record.date.toISOString().split('T')[0] } };
    } catch (error) {
        console.error('❌ Upsert daily expense error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('dailyExpenses:delete', async (event, id) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        await prisma.dailyExpense.delete({ where: { id } });
        console.log(`✅ Deleted daily expense #${id}`);
        return { success: true };
    } catch (error) {
        console.error('❌ Delete daily expense error:', error);
        return { success: false, error: error.message };
    }
});

module.exports = { prisma };

// ===== REFUNDS: Import từ thư mục =====
ipcMain.handle('refunds:importFromFolder', async () => {
    try {
        // 1. Mở dialog chọn thư mục
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Chọn thư mục chứa file Excel hàng hoàn',
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: 'cancelled' };
        }

        const folderPath = result.filePaths[0];
        console.log(`📂 Selected folder: ${folderPath}`);

        // 2. Tìm tất cả file .xlsx / .xls trong thư mục
        const allFiles = fs.readdirSync(folderPath);
        const excelFiles = allFiles.filter(f => {
            const ext = path.extname(f).toLowerCase();
            return ext === '.xlsx' || ext === '.xls';
        });

        if (excelFiles.length === 0) {
            return { success: false, error: 'Không tìm thấy file Excel (.xlsx/.xls) trong thư mục!' };
        }

        console.log(`📊 Found ${excelFiles.length} Excel files:`, excelFiles);

        // 3. Đọc dữ liệu từ tất cả file — TÁCH RIÊNG từng file
        const filesData = [];
        const fileResults = [];
        let totalRows = 0;

        for (const fileName of excelFiles) {
            try {
                const filePath = path.join(folderPath, fileName);
                const workbook = XLSX.readFile(filePath);
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);

                console.log(`  📄 ${fileName}: ${jsonData.length} rows`);
                filesData.push({ name: fileName, data: jsonData });
                fileResults.push({ name: fileName, rows: jsonData.length, success: true });
                totalRows += jsonData.length;
            } catch (fileError) {
                console.error(`  ❌ ${fileName}: ${fileError.message}`);
                fileResults.push({ name: fileName, rows: 0, success: false, error: fileError.message });
            }
        }

        console.log(`✅ Total: ${totalRows} rows from ${excelFiles.length} files`);

        return {
            success: true,
            filesData,
            folderPath,
            fileResults,
            totalFiles: excelFiles.length,
            totalRows,
        };
    } catch (error) {
        console.error('❌ Import from folder error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// MISA meINVOICE API INTEGRATION
// ========================================

const { v4: uuidv4 } = (() => {
    try { return require('uuid'); } catch {
        // Fallback UUID generator nếu chưa install uuid
        return {
            v4: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            })
        };
    }
})();

// Cache token MISA
let misaTokenCache = { token: null, expiresAt: 0 };

// Mã hóa / giải mã password đơn giản (obfuscation)
function encodeSecret(plain) {
    if (!plain) return '';
    return Buffer.from(plain).toString('base64');
}
function decodeSecret(encoded) {
    if (!encoded) return '';
    try { return Buffer.from(encoded, 'base64').toString('utf-8'); } catch { return encoded; }
}
function maskString(str, showChars = 3) {
    if (!str || str.length <= showChars) return '***';
    return str.substring(0, showChars) + '***';
}

// Lấy cấu hình MISA từ AppConfig
async function getMisaConfig() {
    if (!prisma) throw new Error('Database not initialized');
    const configRecord = await prisma.appConfig.findUnique({ where: { key: 'misaConfig' } });
    if (!configRecord?.value) throw new Error('Chưa cấu hình MISA meInvoice! Vào ⚙️ Cấu hình để thiết lập.');
    const config = JSON.parse(configRecord.value);
    // Giải mã password nếu đã mã hóa
    if (config.password) {
        config.password = decodeSecret(config.password);
    }
    if (!config.appid || !config.taxcode || !config.username || !config.password) {
        throw new Error('Cấu hình MISA thiếu thông tin! Cần: AppID, MST, Username, Password.');
    }
    return config;
}

// Lấy token MISA (có cache)
async function getMisaToken() {
    // Trả về cached token nếu chưa hết hạn (trừ 5 phút buffer)
    if (misaTokenCache.token && Date.now() < misaTokenCache.expiresAt - 300000) {
        return misaTokenCache.token;
    }

    const config = await getMisaConfig();
    const baseUrl = 'https://api.meinvoice.vn';

    // Trim tất cả field để loại bỏ khoảng trắng ẩn
    const appid = (config.appid || '').trim();
    const taxcode = (config.taxcode || '').trim();
    const username = (config.username || '').trim();
    const password = (config.password || '').trim();

    console.log(`🔑 MISA: Requesting token from ${baseUrl}...`);
    console.log(`🔑 MISA: AppID=${maskString(appid)}, TaxCode=${maskString(taxcode)}, User=${maskString(username)}, PassLen=${password.length}`);

    // Thử cả 2 URL endpoint (v3 và integration)
    const tokenUrls = [
        `${baseUrl}/api/integration/auth/token`,
        `${baseUrl}/api/v3/auth/token`,
    ];

    let lastError = '';
    let lastResult = null;

    for (const tokenUrl of tokenUrls) {
        console.log(`🔑 MISA: Trying ${tokenUrl}...`);
        let response;
        try {
            response = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    appid,
                    taxcode,
                    username,
                    password,
                }),
            });
        } catch (fetchErr) {
            console.error(`❌ MISA fetch error (${tokenUrl}):`, fetchErr.message);
            lastError = fetchErr.message;
            continue;
        }

        const responseText = await response.text();
        console.log(`🔑 MISA Response from ${tokenUrl} (${response.status}):`, responseText.substring(0, 800));

        let result;
        try {
            result = JSON.parse(responseText);
        } catch {
            console.error(`❌ MISA: Non-JSON response from ${tokenUrl}`);
            lastError = `Response không hợp lệ (status ${response.status}): ${responseText.substring(0, 200)}`;
            continue;
        }

        // MISA API có thể trả về Success hoặc success
        const isSuccess = result.Success === true || result.success === true;
        const data = result.Data || result.data;
        const errorCode = result.ErrorCode || result.errorCode || '';

        if (isSuccess && data) {
            // Thành công!
            misaTokenCache = {
                token: data,
                expiresAt: Date.now() + 2 * 60 * 60 * 1000, // Cache 2 giờ (MISA token expire nhanh)
            };
            console.log(`✅ MISA: Token obtained successfully from ${tokenUrl}`);
            return data;
        }

        // Lưu lại lỗi, thử URL tiếp theo
        console.error(`❌ MISA Auth Error from ${tokenUrl}:`, JSON.stringify(result, null, 2));
        lastResult = result;
        lastError = errorCode;
    }

    // Cả 2 URL đều thất bại — phân tích lỗi chi tiết
    const errorCode = lastError;
    const errors = lastResult?.Errors || lastResult?.errors || [];
    const errorsStr = Array.isArray(errors) ? errors.join(', ') : String(errors);
    const fullResponse = lastResult ? JSON.stringify(lastResult).substring(0, 400) : 'No response';

    // Check Errors array trước — MISA thường ghi chi tiết lỗi ở đây
    let errorMsg;
    if (errorsStr.includes('TaxCodeNotExist')) {
        errorMsg = `❌ Mã số thuế "${taxcode}" KHÔNG tồn tại trên MISA! Kiểm tra lại MST hoặc đăng ký MST trên meinvoice.vn trước.`;
    } else if (errorCode === 'InvalidAppID') {
        errorMsg = `❌ Sai AppID MISA! [${fullResponse}]`;
    } else if (errorCode === 'InactiveAppID') {
        errorMsg = `❌ AppID MISA đã bị khóa! [${fullResponse}]`;
    } else if (errorCode === 'UnAuthorize') {
        errorMsg = `❌ Lỗi xác thực MISA (UnAuthorize). Chi tiết: ${errorsStr || 'Không rõ'}. [User=${username}, TaxCode=${taxcode}]`;
    } else {
        errorMsg = `❌ Lỗi MISA: ${errorsStr || fullResponse}`;
    }
    throw new Error(errorMsg);
}

// Xóa token cache khi bị reject (để lần sau lấy token mới)
function invalidateMisaToken() {
    misaTokenCache = { token: null, expiresAt: 0 };
    console.log('🔄 MISA: Token cache invalidated — sẽ lấy token mới lần tới');
}

// Chuyển số thành chữ tiếng Việt
function numberToVietnameseWords(num) {
    if (num === 0) return 'Không đồng.';
    const units = ['', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
    const groups = ['', 'nghìn', 'triệu', 'tỷ'];

    function readThreeDigits(n, showZeroHundred) {
        const h = Math.floor(n / 100);
        const t = Math.floor((n % 100) / 10);
        const u = n % 10;
        let result = '';
        if (h > 0) result += units[h] + ' trăm ';
        else if (showZeroHundred) result += 'không trăm ';
        if (t > 1) result += units[t] + ' mươi ';
        else if (t === 1) result += 'mười ';
        else if (t === 0 && h > 0 && u > 0) result += 'lẻ ';
        if (u === 1 && t > 1) result += 'mốt';
        else if (u === 5 && t > 0) result += 'lăm';
        else if (u > 0) result += units[u];
        return result.trim();
    }

    const rounded = Math.round(num);
    const parts = [];
    let temp = rounded;
    while (temp > 0) {
        parts.push(temp % 1000);
        temp = Math.floor(temp / 1000);
    }

    let result = '';
    for (let i = parts.length - 1; i >= 0; i--) {
        if (parts[i] > 0 || i < parts.length - 1) {
            const text = readThreeDigits(parts[i], i < parts.length - 1);
            if (text) result += text + ' ' + groups[i] + ' ';
        }
    }

    result = result.trim();
    result = result.charAt(0).toUpperCase() + result.slice(1) + ' đồng.';
    return result;
}

// Build InvoiceData cho MISA API từ DB record
function buildMisaInvoiceData(order, config) {
    let items = [];
    try { items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items; } catch { items = []; }

    const totalAmount = order.totalAmount || 0;
    const refId = uuidv4();

    // Build OriginalInvoiceDetail
    const invoiceDetails = items.map((item, idx) => ({
        ItemType: 1,
        LineNumber: idx + 1,
        SortOrder: idx + 1,
        ItemCode: item.sku || '',
        ItemName: item.productName || 'Hàng hóa',
        UnitName: 'Cái',
        Quantity: item.quantity || 1,
        UnitPrice: item.unitPrice || 0,
        DiscountRate: 0,
        DiscountAmountOC: 0,
        DiscountAmount: 0,
        AmountOC: item.total || (item.unitPrice * item.quantity) || 0,
        Amount: item.total || (item.unitPrice * item.quantity) || 0,
        AmountWithoutVATOC: item.total || (item.unitPrice * item.quantity) || 0,
        AmountWithoutVAT: item.total || (item.unitPrice * item.quantity) || 0,
        VATRateName: config.vatRate || 'KCT',
        VATAmountOC: 0,
        VATAmount: 0,
    }));

    // Build TaxRateInfo
    const taxRateInfo = [{
        VATRateName: config.vatRate || 'KCT',
        AmountWithoutVATOC: totalAmount,
        VATAmountOC: 0,
    }];

    return {
        RefID: refId,
        InvSeries: config.invSeries || '',
        InvDate: order.deliveryDate
            ? new Date(order.deliveryDate).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0],
        CurrencyCode: 'VND',
        ExchangeRate: 1.0,
        PaymentMethodName: config.paymentMethod || 'TM/CK',
        // Thông tin người mua
        BuyerLegalName: order.customerName || 'Người mua không lấy hóa đơn',
        BuyerTaxCode: '',
        BuyerAddress: '',
        BuyerFullName: order.customerName || 'Người mua không lấy hóa đơn',
        BuyerPhoneNumber: order.customerPhone || '',
        BuyerEmail: '',
        // Tổng tiền
        TotalSaleAmountOC: totalAmount,
        TotalSaleAmount: totalAmount,
        TotalDiscountAmountOC: 0,
        TotalDiscountAmount: 0,
        TotalAmountWithoutVATOC: totalAmount,
        TotalAmountWithoutVAT: totalAmount,
        TotalVATAmountOC: 0,
        TotalVATAmount: 0,
        TotalAmountOC: totalAmount,
        TotalAmount: totalAmount,
        TotalAmountInWords: numberToVietnameseWords(totalAmount),
        // Chi tiết
        OriginalInvoiceDetail: invoiceDetails,
        TaxRateInfo: taxRateInfo,
        OptionUserDefined: {
            MainCurrency: 'VND',
            AmountDecimalDigits: '0',
            AmountOCDecimalDigits: '0',
            UnitPriceOCDecimalDigits: '0',
            UnitPriceDecimalDigits: '0',
        },
        _refId: refId, // internal tracking
    };
}

// Gọi MISA API phát hành hóa đơn — Theo tài liệu Mục 6
// URL: {BaseURL}/invoice
// SignType: 2 = HSM (ký số từ xa), 5 = Không ký (MTT/Vé)
async function publishMisaInvoice(invoiceDataList) {
    const config = await getMisaConfig();
    const token = await getMisaToken();
    const baseUrl = 'https://api.meinvoice.vn/api/integration';

    // Body theo tài liệu Mục 6: { SignType, InvoiceData, PublishInvoiceData }
    const body = {
        SignType: 2,  // 2=HSM ký số từ xa, 5=Không ký (MTT)
        InvoiceData: invoiceDataList,
        PublishInvoiceData: null,
    };

    console.log(`📤 MISA: Publishing ${invoiceDataList.length} invoice(s) to ${baseUrl}/invoice ...`);
    console.log(`📤 MISA: SignType=${body.SignType}, Sample:`, JSON.stringify(invoiceDataList[0]).substring(0, 500));

    // Helper: gọi API publish 1 lần
    async function doPublishRequest(authToken) {
        const response = await fetch(`${baseUrl}/invoice`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify(body),
        });

        const responseText = await response.text();
        console.log(`📤 MISA Publish Response (${response.status}):`, responseText.substring(0, 800));

        let result;
        try {
            result = JSON.parse(responseText);
        } catch {
            throw new Error(`MISA trả về response không hợp lệ khi phát hành (status ${response.status}): ${responseText.substring(0, 200)}`);
        }
        return { result, status: response.status };
    }

    let { result, status } = await doPublishRequest(token);

    // Check success (MISA API trả về success hoặc Success)
    let isSuccess = result.Success === true || result.success === true;

    // AUTO-RETRY: Nếu bị UnAuthorize hoặc HTTP 401 → xóa cache, lấy token mới, thử lại 1 lần
    if (!isSuccess) {
        const errCode = result.ErrorCode || result.errorCode || '';
        if (errCode === 'UnAuthorize' || status === 401) {
            console.log('🔄 MISA: Token expired — invalidating cache and retrying with fresh token...');
            invalidateMisaToken();
            const newToken = await getMisaToken();
            const retry = await doPublishRequest(newToken);
            result = retry.result;
            isSuccess = result.Success === true || result.success === true;
        }
    }

    if (!isSuccess) {
        const errCode = result.ErrorCode || result.errorCode || '';
        const errDesc = result.descriptionErrorCode || result.Errors || '';
        console.error('❌ MISA Publish FULL Response:', JSON.stringify(result, null, 2));
        throw new Error(`MISA Publish Error: ${errCode} — ${errDesc || JSON.stringify(result).substring(0, 300)}`);
    }

    // Parse publishInvoiceResult (có thể là string JSON) — theo tài liệu Mục 6
    let publishResults = result.publishInvoiceResult;
    if (typeof publishResults === 'string') {
        try { publishResults = JSON.parse(publishResults); } catch { publishResults = []; }
    }
    if (!publishResults) publishResults = [];

    console.log(`✅ MISA: Published ${publishResults.length} invoice(s)`);
    return publishResults;
}

// Tải PDF hóa đơn từ MISA — Theo tài liệu Mục 8
// URL: {BaseURL}/invoice/download?downloadDataType=2  (2=PDF)
async function downloadMisaInvoicePDF(transactionId) {
    const config = await getMisaConfig();
    let token = await getMisaToken();
    const baseUrl = 'https://api.meinvoice.vn/api/integration';

    async function doDownloadRequest(authToken) {
        const response = await fetch(`${baseUrl}/invoice/download?downloadDataType=2`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify([transactionId]),
        });

        const responseText = await response.text();
        console.log(`📥 MISA Download Response (${response.status}):`, responseText.substring(0, 300));

        let result;
        try { result = JSON.parse(responseText); } catch {
            throw new Error(`MISA download trả về response không hợp lệ (status ${response.status})`);
        }
        return { result, status: response.status };
    }

    let { result, status } = await doDownloadRequest(token);
    let isSuccess = result.Success === true || result.success === true;

    // AUTO-RETRY: token expired → lấy mới và thử lại
    if (!isSuccess) {
        const errCode = result.ErrorCode || result.errorCode || '';
        if (errCode === 'UnAuthorize' || status === 401) {
            console.log('🔄 MISA Download: Token expired — retrying with fresh token...');
            invalidateMisaToken();
            token = await getMisaToken();
            const retry = await doDownloadRequest(token);
            result = retry.result;
            isSuccess = result.Success === true || result.success === true;
        }
    }

    const data = result.Data || result.data;
    if (!isSuccess || !data) {
        throw new Error(`Lỗi tải PDF: ${result.ErrorCode || result.errorCode || JSON.stringify(result).substring(0, 200)}`);
    }

    // Data trả về dạng: [{ TransactionID, Data (base64) }]
    if (Array.isArray(data) && data.length > 0) {
        return data[0].Data; // Base64 PDF string
    }
    return data; // Fallback
}

// ========================================
// MISA CONFIG IPC HANDLERS
// ========================================

ipcMain.handle('misa:getConfig', async () => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        const record = await prisma.appConfig.findUnique({ where: { key: 'misaConfig' } });
        const config = record?.value ? JSON.parse(record.value) : {};
        // Không trả password ra frontend
        return { success: true, data: { ...config, password: '' } }; // Không trả password, frontend tự hiện placeholder
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('misa:saveConfig', async (event, config) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        // Nếu password rỗng hoặc là masked → giữ nguyên password cũ (đã mã hóa)
        if (!config.password || config.password === '••••••••') {
            const existing = await prisma.appConfig.findUnique({ where: { key: 'misaConfig' } });
            if (existing?.value) {
                const old = JSON.parse(existing.value);
                config.password = old.password; // Giữ nguyên password đã mã hóa
            }
        } else {
            // Mã hóa password mới trước khi lưu
            config.password = encodeSecret(config.password);
        }
        await prisma.appConfig.upsert({
            where: { key: 'misaConfig' },
            update: { value: JSON.stringify(config) },
            create: { key: 'misaConfig', value: JSON.stringify(config) },
        });
        // Clear token cache khi đổi config
        invalidateMisaToken();
        console.log(`✅ MISA config saved (password length: ${config.password?.length || 0})`);
        void logActivity({ module: 'einvoice', action: 'UPDATE', description: 'Cập nhật cấu hình MISA meInvoice', userName: 'Admin' });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('misa:testConnection', async () => {
    try {
        const token = await getMisaToken();
        return { success: true, data: { tokenLength: token.length } };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Lấy danh sách mẫu HĐ — Tài liệu Mục 3
ipcMain.handle('misa:getTemplates', async () => {
    try {
        const config = await getMisaConfig();
        const token = await getMisaToken();
        const baseUrl = config.env === 'live'
            ? 'https://api.meinvoice.vn/api/integration'
            : 'https://testapi.meinvoice.vn/api/integration';

        // Thử nhiều combinations để tìm tất cả mẫu HĐ
        const queries = [
            'invoiceWithCode=true&ticket=false',
            'invoiceWithCode=false&ticket=false',
            'ticket=true',
            '', // Không filter
        ];

        let allTemplates = [];
        let lastResponse = '';
        for (const q of queries) {
            const url = q ? `${baseUrl}/invoice/templates?${q}` : `${baseUrl}/invoice/templates`;
            console.log(`📋 MISA: Trying templates URL: ${url}`);
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const responseText = await response.text();
            console.log(`📋 MISA Templates Response (${q}):`, responseText.substring(0, 500));

            let result;
            try { result = JSON.parse(responseText); } catch { continue; }

            const isSuccess = result.Success === true || result.success === true;
            let data = result.Data || result.data;

            // Data có thể là string JSON
            if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch { }
            }

            if (isSuccess && data) {
                if (Array.isArray(data) && data.length > 0) {
                    allTemplates = [...allTemplates, ...data];
                    break;
                } else if (typeof data === 'object' && !Array.isArray(data)) {
                    // Có thể là object đơn
                    allTemplates.push(data);
                    break;
                }
            }
            // Lưu lại response cuối để debug
            lastResponse = responseText.substring(0, 400);
        }

        // Loại bỏ trùng
        const uniqueMap = new Map();
        allTemplates.forEach(t => uniqueMap.set(t.InvSeries || t.invSeries, t));
        const unique = Array.from(uniqueMap.values());

        if (unique.length === 0) {
            return { success: false, error: `Không tìm thấy mẫu HĐ. MISA Response: ${lastResponse || 'Empty'}` };
        }
        return { success: true, data: unique };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Xem nháp HĐ (unpublishview) — Tài liệu Mục 4 — KHÔNG phát hành, chỉ xem
ipcMain.handle('misa:previewInvoice', async (event, invoiceData) => {
    try {
        const config = await getMisaConfig();
        const token = await getMisaToken();
        const baseUrl = config.env === 'live'
            ? 'https://api.meinvoice.vn/api/integration'
            : 'https://testapi.meinvoice.vn/api/integration';
        console.log('👀 MISA Preview: Sending unpublishview...', JSON.stringify(invoiceData).substring(0, 500));
        const response = await fetch(`${baseUrl}/invoice/unpublishview`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(invoiceData),
        });
        const responseText = await response.text();
        console.log('👀 MISA Preview Response:', responseText.substring(0, 500));
        let result;
        try { result = JSON.parse(responseText); } catch {
            throw new Error(`MISA preview trả về response không hợp lệ (status ${response.status})`);
        }
        const isSuccess = result.Success === true || result.success === true;
        const data = result.Data || result.data;
        if (!isSuccess || !data) {
            const errCode = result.ErrorCode || result.errorCode || '';
            const errors = result.Errors || result.errors || [];
            throw new Error(`Lỗi xem nháp: ${errCode} — ${Array.isArray(errors) ? errors.join(', ') : errors || JSON.stringify(result).substring(0, 300)}`);
        }
        return { success: true, data: data }; // data = link xem HĐ
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('misa:downloadPDF', async (event, transactionId) => {
    try {
        const base64PDF = await downloadMisaInvoicePDF(transactionId);
        // Cho user chọn nơi lưu
        const result = await dialog.showSaveDialog({
            title: 'Lưu hóa đơn PDF',
            defaultPath: `HoaDon_${transactionId}.pdf`,
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (result.canceled || !result.filePath) return { success: false, error: 'Đã hủy' };
        fs.writeFileSync(result.filePath, Buffer.from(base64PDF, 'base64'));
        console.log(`✅ PDF saved: ${result.filePath}`);
        return { success: true, data: { filePath: result.filePath } };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ========================================
// E-INVOICE / HÓA ĐƠN ĐIỆN TỬ (HĐĐT)
// ========================================

// Lấy tất cả đơn HĐĐT
ipcMain.handle('einvoice:getAll', async (event, { limit } = {}) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        const records = await prisma.eInvoice.findMany({
            orderBy: { createdAt: 'desc' },
            take: limit || 1000,
        });
        const formatted = records.map(r => ({
            ...r,
            deliveryDate: r.deliveryDate.toISOString(),
            invoiceDate: r.invoiceDate ? r.invoiceDate.toISOString() : null,
            createdAt: r.createdAt.toISOString(),
        }));
        console.log(`✅ Loaded ${records.length} einvoice records`);
        return { success: true, data: formatted };
    } catch (error) {
        console.error('❌ einvoice:getAll error:', error.message);
        return { success: false, error: error.message };
    }
});

// Import hàng loạt — chống trùng orderId ở tầng DB
ipcMain.handle('einvoice:bulkImport', async (event, orders) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        if (!Array.isArray(orders) || orders.length === 0) {
            return { success: false, error: 'Không có đơn hàng để import' };
        }

        const isTMDT = (platform) => ['Shopee', 'TikTok', 'Lazada', 'Sendo'].includes(platform);

        // Chuẩn bị data batch
        const dataForInsert = orders.map(order => ({
            orderId: order.orderId,
            platform: order.platform,
            customerName: order.customerName,
            customerPhone: order.customerPhone || null,
            items: typeof order.items === 'string' ? order.items : JSON.stringify(order.items),
            totalQuantity: order.totalQuantity || 1,
            totalAmount: order.totalAmount || 0,
            deliveryDate: new Date(order.deliveryDate),
            sourceFile: order.sourceFile || null,
            isTaxDeductedByPlatform: isTMDT(order.platform),
            platformTaxRate: isTMDT(order.platform) ? 0.015 : null,
            platformTaxAmount: isTMDT(order.platform) ? Math.round((order.totalAmount || 0) * 0.015) : null,
            invoiceType: isTMDT(order.platform) ? 'pos_receipt' : 'b2b',
            status: 'pending',
        }));

        // 🚀 Batch insert — 1 query duy nhất thay vì N queries
        const result = await prisma.eInvoice.createMany({
            data: dataForInsert,
            skipDuplicates: true, // Tự động bỏ qua orderId trùng
        });

        const imported = result.count;
        const duplicated = orders.length - imported;

        console.log(`✅ EInvoice import: ${imported} new, ${duplicated} duplicates skipped (batch insert)`);

        void logActivity({
            module: 'einvoice',
            action: 'CREATE',
            description: `Import ${imported} đơn HĐĐT${duplicated > 0 ? `, bỏ qua ${duplicated} đơn trùng` : ''} (batch)`,
            userName: 'System',
        });

        return {
            success: true,
            data: { imported, duplicated, duplicateIds: [] },
        };
    } catch (error) {
        console.error('❌ einvoice:bulkImport error:', error.message);
        return { success: false, error: error.message };
    }
});

// Xem nháp HĐ từ đơn hàng thật — gọi unpublishview, KHÔNG phát hành
ipcMain.handle('einvoice:previewDraft', async (event, orderId) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        const misaConfig = await getMisaConfig();
        const token = await getMisaToken();

        // Lấy đơn hàng từ DB
        const order = await prisma.eInvoice.findFirst({ where: { orderId } });
        if (!order) throw new Error(`Không tìm thấy đơn ${orderId}`);

        // Build data HĐ giống khi xuất thật
        let customerName = order.customerName;
        if (!customerName || customerName.trim() === '' || customerName === '***') {
            customerName = 'Người mua không lấy hóa đơn';
        }
        const invoiceData = buildMisaInvoiceData({ ...order, customerName }, misaConfig);
        delete invoiceData._refId;

        // Gọi unpublishview
        const baseUrl = misaConfig.env === 'live'
            ? 'https://api.meinvoice.vn/api/integration'
            : 'https://testapi.meinvoice.vn/api/integration';

        console.log('👀 Preview Draft:', JSON.stringify(invoiceData).substring(0, 500));

        const response = await fetch(`${baseUrl}/invoice/unpublishview`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(invoiceData),
        });

        const responseText = await response.text();
        console.log('👀 Preview Response:', responseText.substring(0, 500));

        let result;
        try { result = JSON.parse(responseText); } catch {
            throw new Error(`MISA preview lá»—i (status ${response.status}): ${responseText.substring(0, 200)}`);
        }

        const isSuccess = result.Success === true || result.success === true;
        const data = result.Data || result.data;
        if (!isSuccess || !data) {
            const errCode = result.ErrorCode || result.errorCode || '';
            const errors = result.Errors || result.errors || [];
            throw new Error(`Lỗi nháp: ${errCode} — ${Array.isArray(errors) ? errors.join(', ') : JSON.stringify(result).substring(0, 300)}`);
        }

        return { success: true, data: data }; // data = link xem HĐ
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Xuất HĐĐT — gọi MISA meInvoice API thật (SignType=2 — HSM ký tự động)
ipcMain.handle('einvoice:issueInvoices', async (event, orderIds) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return { success: false, error: 'Không có đơn nào để xuất' };
        }

        // Kiểm tra config MISA trước
        let misaConfig;
        try {
            misaConfig = await getMisaConfig();
        } catch (configErr) {
            return { success: false, error: configErr.message };
        }

        // Chỉ lấy đơn PENDING — tuyệt đối không xuất lại
        const pendingOrders = await prisma.eInvoice.findMany({
            where: {
                orderId: { in: orderIds },
                status: 'pending',
            }
        });

        if (pendingOrders.length === 0) {
            return { success: false, error: 'Tất cả đơn đã được xuất HĐĐT trước đó!' };
        }

        const batchId = `BATCH-${Date.now()}`;
        const issuedOrders = [];
        const errorLog = [];

        // Xuất từng đơn qua MISA API (1 đơn = 1 API call để dễ track lỗi)
        for (const order of pendingOrders) {
            try {
                // Validate data
                let customerName = order.customerName;
                if (!customerName || customerName.trim() === '' || customerName === '***') {
                    customerName = 'Người mua không lấy hóa đơn';
                    await prisma.eInvoice.update({
                        where: { id: order.id },
                        data: { customerName }
                    });
                }

                const orderForBuild = { ...order, customerName };

                // Build MISA InvoiceData
                const invoiceData = buildMisaInvoiceData(orderForBuild, misaConfig);
                const refId = invoiceData._refId;
                delete invoiceData._refId; // Xóa field internal trước khi gửi MISA

                // Gọi MISA API phát hành (SignType=2)
                const publishResults = await publishMisaInvoice([invoiceData]);

                if (!publishResults || publishResults.length === 0) {
                    throw new Error('MISA không trả về kết quả phát hành');
                }

                const misaResult = publishResults[0];

                // Kiểm tra lỗi từ MISA cho từng HĐ
                if (misaResult.ErrorCode && misaResult.ErrorCode !== '') {
                    throw new Error(`MISA: ${misaResult.ErrorCode}`);
                }

                // Thành công — cập nhật DB với dữ liệu thật từ MISA
                await prisma.eInvoice.update({
                    where: { id: order.id },
                    data: {
                        status: 'issued',
                        invoiceNumber: misaResult.InvNo || misaResult.invNo || '',
                        invoiceDate: new Date(),
                        taxCode: misaResult.TransactionID || misaResult.transactionID || '',
                        templateCode: misaResult.InvTemplateNo || misaResult.invTemplateNo || '',
                        invoiceSeries: misaResult.InvSeries || misaResult.invSeries || misaConfig.invSeries || '',
                        batchId,
                    }
                });

                const invoiceNumber = misaResult.InvNo || misaResult.invNo || '';
                const transactionId = misaResult.TransactionID || misaResult.transactionID || '';

                issuedOrders.push({
                    orderId: order.orderId,
                    invoiceNumber,
                    taxCode: transactionId,
                    refId,
                });

                console.log(`✅ MISA issued: ${order.orderId} → HĐ số ${invoiceNumber} | Mã: ${transactionId}`);

                // Backup PDF lên Google Drive & Telegram (chạy ngầm)
                (async () => {
                    try {
                        const pdfBase64 = await downloadMisaInvoicePDF(transactionId);
                        const pdfBuffer = Buffer.from(pdfBase64, 'base64');
                        const pdfPath = path.join(os.tmpdir(), `HD_${invoiceNumber}_${transactionId}.pdf`);
                        fs.writeFileSync(pdfPath, pdfBuffer);

                        // Lưu path PDF vào DB
                        await prisma.eInvoice.update({
                            where: { id: order.id },
                            data: { pdfFilePath: pdfPath }
                        });

                        console.log(`📄 PDF saved: ${pdfPath}`);
                    } catch (backupErr) {
                        console.error(`⚠️ Backup PDF for ${invoiceNumber} failed:`, backupErr.message);
                    }
                })();

            } catch (orderErr) {
                console.error(`❌ MISA issue error for ${order.orderId}:`, orderErr.message);
                errorLog.push({
                    orderId: order.orderId,
                    error: orderErr.message,
                    timestamp: new Date().toISOString(),
                });

                void logActivity({
                    module: 'einvoice',
                    action: 'ERROR',
                    description: `Lỗi xuất HĐĐT MISA cho đơn ${order.orderId}: ${orderErr.message}`,
                    recordId: order.id,
                    severity: 'ERROR',
                    userName: 'System',
                });
            }
        }

        const skippedCount = orderIds.length - pendingOrders.length;

        console.log(`✅ MISA Issued ${issuedOrders.length} einvoices (skipped ${skippedCount} already issued, ${errorLog.length} errors)`);

        // Gửi tóm tắt batch lên Telegram
        if (issuedOrders.length > 0) {
            const totalAmount = pendingOrders
                .filter(o => issuedOrders.some(i => i.orderId === o.orderId))
                .reduce((s, o) => s + (o.totalAmount || 0), 0);
            const summaryMsg = `📊 <b>BATCH XUẤT HĐĐT (MISA)</b>\n` +
                `━━━━━━━━━━━━━━\n` +
                `🧾 Số HĐ: ${issuedOrders.length}\n` +
                `💰 Tổng: ${totalAmount.toLocaleString('vi-VN')}đ\n` +
                `📋 Batch: ${batchId}\n` +
                `🔑 Ký số: HSM (SignType=2)\n` +
                `📅 ${new Date().toLocaleDateString('vi-VN')} ${new Date().toLocaleTimeString('vi-VN')}\n` +
                (skippedCount > 0 ? `⚠️ Bỏ qua: ${skippedCount} đơn đã xuất\n` : '') +
                (errorLog.length > 0 ? `❌ Lỗi: ${errorLog.length} đơn\n` : '') +
                `━━━━━━━━━━━━━━`;
            sendTelegramMessage(summaryMsg).catch(err => console.error('Telegram summary error:', err));
        }

        void logActivity({
            module: 'einvoice',
            action: 'UPDATE',
            description: `MISA: Xuất ${issuedOrders.length} HĐĐT thật (batch: ${batchId}, HSM ký số)${skippedCount > 0 ? ` — Bỏ qua ${skippedCount} đơn đã xuất` : ''}${errorLog.length > 0 ? ` — ${errorLog.length} đơn lỗi` : ''}`,
            userName: 'System',
        });

        return {
            success: true,
            data: {
                issued: issuedOrders,
                issuedCount: issuedOrders.length,
                skippedCount,
                batchId,
                errorLog,
                errorCount: errorLog.length,
            },
        };
    } catch (error) {
        console.error('❌ einvoice:issueInvoices error:', error.message);
        return { success: false, error: error.message };
    }
});

// Thống kê
ipcMain.handle('einvoice:getStats', async () => {
    try {
        if (!prisma) throw new Error('Database not initialized');

        // 🚀 Gộp thành 2 queries thay vì 5 + ÁP DỤNG BỘ LỌC 3 NGÀY CHỐNG ĐẾM TRÀN RÁC (842 bills cũ)
        const dateThreshold = new Date();
        dateThreshold.setDate(dateThreshold.getDate() - 3);

        const [statusCounts, totalAmount] = await Promise.all([
            prisma.eInvoice.groupBy({
                by: ['status'],
                where: { createdAt: { gte: dateThreshold } },
                _count: { status: true },
            }),
            prisma.eInvoice.aggregate({
                _sum: { totalAmount: true },
                where: {
                    status: 'issued',
                    createdAt: { gte: dateThreshold }
                },
            }),
        ]);

        const countMap = {};
        let total = 0;
        for (const row of statusCounts) {
            countMap[row.status] = row._count.status;
            total += row._count.status;
        }

        return {
            success: true,
            data: {
                total,
                issued: countMap['issued'] || 0,
                pending: countMap['pending'] || 0,
                adjusted: countMap['adjusted'] || 0,
                cancelled: countMap['cancelled'] || 0,
                totalIssuedAmount: totalAmount._sum.totalAmount || 0,
            },
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Xuất Excel báo cáo
ipcMain.handle('einvoice:exportExcel', async (event, filters) => {
    try {
        if (!prisma) throw new Error('Database not initialized');

        const where = {};
        if (filters?.status) where.status = filters.status;
        if (filters?.platform) where.platform = filters.platform;

        const records = await prisma.eInvoice.findMany({
            where,
            orderBy: { createdAt: 'desc' },
        });

        if (records.length === 0) {
            return { success: false, error: 'Không có dữ liệu để xuất' };
        }

        // Tạo data cho Excel
        const excelData = records.map((r, idx) => {
            let items = [];
            try { items = JSON.parse(r.items); } catch { }

            return {
                'STT': idx + 1,
                'Sàn': r.platform,
                'Mã đơn hàng': r.orderId,
                'Khách hàng': r.customerName,
                'SĐT': r.customerPhone || '',
                'Sản phẩm': items.map(i => `${i.productName} x${i.quantity}`).join('; '),
                'Tổng SL': r.totalQuantity,
                'Thành tiền': r.totalAmount,
                'Ngày giao': r.deliveryDate ? new Date(r.deliveryDate).toLocaleDateString('vi-VN') : '',
                'Số HĐĐT': r.invoiceNumber || '',
                'Ngày xuất HĐ': r.invoiceDate ? new Date(r.invoiceDate).toLocaleDateString('vi-VN') : '',
                'Mã tra cứu': r.taxCode || '',
                'Trạng thái': r.status === 'issued' ? 'Đã xuất' : 'Chưa xuất',
                'File gốc': r.sourceFile || '',
            };
        });

        const ws = XLSX.utils.json_to_sheet(excelData);

        // Set column widths
        ws['!cols'] = [
            { wch: 5 },  // STT
            { wch: 10 }, // Sàn
            { wch: 25 }, // Mã đơn
            { wch: 20 }, // Khách hàng
            { wch: 15 }, // SĐT
            { wch: 50 }, // Sản phẩm
            { wch: 8 },  // Tổng SL
            { wch: 15 }, // Thành tiền
            { wch: 12 }, // Ngày giao
            { wch: 15 }, // Số HĐĐT
            { wch: 12 }, // Ngày xuất
            { wch: 18 }, // Mã tra cứu
            { wch: 12 }, // Trạng thái
            { wch: 30 }, // File gốc
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'HĐĐT');

        // Show save dialog
        const result = await dialog.showSaveDialog({
            title: 'Xuất báo cáo HĐĐT',
            defaultPath: `BaoCao_HDDT_${new Date().toISOString().slice(0, 10)}.xlsx`,
            filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        });

        if (result.canceled || !result.filePath) {
            return { success: false, error: 'Đã hủy xuất file' };
        }

        XLSX.writeFile(wb, result.filePath);
        console.log(`✅ Exported ${records.length} einvoice records to ${result.filePath}`);

        void logActivity({
            module: 'einvoice',
            action: 'EXPORT',
            description: `Xuất báo cáo HĐĐT: ${records.length} dòng → ${path.basename(result.filePath)}`,
            userName: 'System',
        });

        return { success: true, data: { filePath: result.filePath, count: records.length } };
    } catch (error) {
        console.error('❌ einvoice:exportExcel error:', error.message);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('einvoice:delete', async (event, id) => {
    try {
        requireRole('admin');
        if (!prisma) throw new Error('Database not initialized');
        await prisma.eInvoice.delete({ where: { id: parseInt(id) } });
        console.log(`✅ Deleted einvoice #${id}`);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('einvoice:bulkDelete', async (event, orderIds) => {
    try {
        requireRole('admin');
        if (!prisma) throw new Error('Database not initialized');
        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return { success: false, error: 'Không có đơn để xóa' };
        }
        const result = await prisma.eInvoice.deleteMany({
            where: { orderId: { in: orderIds } }
        });
        console.log(`✅ Bulk deleted ${result.count} einvoice records`);
        void logActivity({
            module: 'einvoice', action: 'DELETE',
            description: `Xóa hàng loạt ${result.count} đơn HĐĐT`,
            userName: 'Admin',
        });
        return { success: true, data: { deleted: result.count } };
    } catch (error) {
        console.error('❌ einvoice:bulkDelete error:', error.message);
        return { success: false, error: error.message };
    }
});

// ⚠️ TEST ONLY — Xóa toàn bộ HĐĐT (sẽ tắt sau khi test xong)
ipcMain.handle('einvoice:deleteAll', async () => {
    try {
        requireRole('admin');
        if (!prisma) throw new Error('Database not initialized');
        const result = await prisma.eInvoice.deleteMany({});
        console.log(`⚠️ DELETED ALL ${result.count} einvoice records`);
        void logActivity({
            module: 'einvoice', action: 'DELETE',
            description: `⚠️ XÓA TẤT CẢ ${result.count} đơn HĐĐT (TEST MODE)`,
            userName: 'Admin',
        });
        return { success: true, data: { deleted: result.count } };
    } catch (error) {
        console.error('❌ einvoice:deleteAll error:', error.message);
        return { success: false, error: error.message };
    }
});

// ============================================================
// TASK 1: Truy xuất HĐ gốc
// ============================================================
ipcMain.handle('einvoice:getOriginalInvoice', async (event, orderId) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        const invoice = await prisma.eInvoice.findFirst({
            where: { orderId, status: 'issued' },
        });
        if (!invoice) {
            return { success: false, error: `Đơn ${orderId} chưa có HĐĐT — không thể điều chỉnh` };
        }
        return { success: true, data: invoice };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============================================================
// TASK 2+3+4: Điều chỉnh / Hủy hóa đơn
// ============================================================
function buildAdjustmentPayload(orig, adjustmentType, reason) {
    let items = [];
    try { items = typeof orig.items === 'string' ? JSON.parse(orig.items) : orig.items; } catch (e) { items = []; }

    const autoReason = reason || `Trả lại hàng hóa cho HĐ Mẫu số ${orig.templateCode || 'N/A'}, Ký hiệu ${orig.invoiceSeries || 'N/A'}, Số ${orig.invoiceNumber}, ngày ${orig.invoiceDate ? new Date(orig.invoiceDate).toLocaleDateString('vi-VN') : 'N/A'}`;

    const payload = {
        OriginalInvoiceData: {
            TemplateCode: orig.templateCode || '',
            InvoiceSeries: orig.invoiceSeries || '',
            InvoiceNumber: orig.invoiceNumber || '',
            InvoiceDate: orig.invoiceDate,
        },
        RefType: adjustmentType === 'replacement' ? 4 : 3,
        AdjustmentType: adjustmentType,
        Reason: autoReason,
        BuyerName: orig.customerName,
        BuyerPhone: orig.customerPhone,
        InvoiceDetails: items.map((item, idx) => ({
            LineNumber: idx + 1,
            ItemName: item.productName || '',
            SKU: item.sku || '',
            Unit: 'Cái',
            Quantity: -(item.quantity || 1),
            UnitPrice: item.unitPrice || 0,
            Amount: -(item.total || 0),
        })),
        TotalAmount: -(orig.totalAmount || 0),
    };
    return { payload, autoReason };
}

ipcMain.handle('einvoice:adjustInvoice', async (event, { orderId, adjustmentType, reason, partialItems }) => {
    try {
        if (!prisma) throw new Error('Database not initialized');

        // Tìm HĐ gốc (issued HOẶC adjusted — đã điều chỉnh 1 phần vẫn cho tiếp)
        const orig = await prisma.eInvoice.findFirst({
            where: { orderId, status: { in: ['issued', 'adjusted'] }, adjustmentType: null },
            orderBy: { createdAt: 'asc' },
        });
        if (!orig) return { success: false, error: `Đơn ${orderId} chưa có HĐĐT hoặc đã bị hủy` };

        // Tìm chain điều chỉnh
        const chain = await prisma.eInvoice.findMany({
            where: { refInvoiceId: orig.id },
            orderBy: { createdAt: 'asc' },
        });

        const totalAdjusted = chain.reduce((sum, inv) => sum + Math.abs(inv.totalAmount || 0), 0);
        const remaining = (orig.totalAmount || 0) - totalAdjusted;

        if (remaining <= 0) {
            return { success: false, error: `HĐ ${orig.invoiceNumber} đã điều chỉnh hết (${totalAdjusted.toLocaleString()}đ / ${(orig.totalAmount || 0).toLocaleString()}đ)` };
        }

        // NĐ 123: giữ nguyên hình thức lần đầu
        if (chain.length > 0 && chain[0].adjustmentType && chain[0].adjustmentType !== adjustmentType) {
            return { success: false, error: `Theo NĐ 123/2020: Lần đầu đã chọn "${chain[0].adjustmentType}", các lần sau phải giữ nguyên.` };
        }

        // Xác định items + amount
        let adjItems, adjAmount, adjQuantity;
        if (partialItems && partialItems.length > 0) {
            adjItems = JSON.stringify(partialItems);
            adjAmount = partialItems.reduce((s, i) => s + (i.total || 0), 0);
            adjQuantity = partialItems.reduce((s, i) => s + (i.quantity || 0), 0);
        } else {
            adjItems = orig.items;
            adjAmount = remaining;
            adjQuantity = orig.totalQuantity || 0;
        }

        // Validate không vượt remaining
        if (adjAmount > remaining + 0.01) {
            return { success: false, error: `Vượt quá: ${adjAmount.toLocaleString()}đ > còn lại ${remaining.toLocaleString()}đ` };
        }

        // Tham chiếu HĐ cuối chain (NĐ 123 yêu cầu)
        const lastInChain = chain.length > 0 ? chain[chain.length - 1] : orig;
        const chainNum = chain.length + 1;
        const autoReason = reason || `Điều chỉnh lần ${chainNum} cho HĐ Số ${lastInChain.invoiceNumber}, ngày ${lastInChain.invoiceDate ? new Date(lastInChain.invoiceDate).toLocaleDateString('vi-VN') : 'N/A'}`;

        // Simulation
        const last = await prisma.eInvoice.findFirst({ where: { invoiceNumber: { not: null } }, orderBy: { invoiceNumber: 'desc' }, select: { invoiceNumber: true } });
        let counter = 1;
        if (last?.invoiceNumber) { const m = last.invoiceNumber.match(/HD(\d+)/); if (m) counter = parseInt(m[1]) + 1; }
        const newNum = `HD${String(counter).padStart(7, '0')}`;
        const newTax = `MCQ-ADJ-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

        const isFullyDone = (totalAdjusted + adjAmount) >= (orig.totalAmount || 0) - 0.01;

        const [, adjRecord] = await prisma.$transaction([
            prisma.eInvoice.update({
                where: { id: orig.id },
                data: { status: adjustmentType === 'replacement' ? 'replaced' : 'adjusted' },
            }),
            prisma.eInvoice.create({
                data: {
                    orderId: `${orderId}-${adjustmentType.substring(0, 3).toUpperCase()}-${Date.now()}`,
                    platform: orig.platform, customerName: orig.customerName, customerPhone: orig.customerPhone,
                    items: adjItems, totalQuantity: adjQuantity, totalAmount: -(adjAmount),
                    deliveryDate: orig.deliveryDate, invoiceNumber: newNum, invoiceDate: new Date(),
                    taxCode: newTax, templateCode: orig.templateCode, invoiceSeries: orig.invoiceSeries,
                    refInvoiceId: orig.id, adjustmentType, adjustmentReason: autoReason, adjustmentDate: new Date(),
                    status: 'issued', batchId: `ADJ-${Date.now()}`,
                },
            }),
        ]);

        console.log(`✅ Điều chỉnh lần ${chainNum}: ${orig.invoiceNumber} → ${newNum} | -${adjAmount.toLocaleString()}đ | Còn lại: ${(remaining - adjAmount).toLocaleString()}đ`);
        void logActivity({
            module: 'einvoice', action: adjustmentType === 'replacement' ? 'REPLACE' : 'ADJUST',
            description: `Lần ${chainNum}: ${orig.invoiceNumber} → ${newNum}. -${adjAmount.toLocaleString()}đ. Còn: ${(remaining - adjAmount).toLocaleString()}đ. ${autoReason}`,
            userName: 'System',
        });

        return {
            success: true, data: {
                originalInvoice: orig.invoiceNumber, newInvoice: newNum, adjustmentType, reason: autoReason,
                chainNumber: chainNum, totalAdjusted: totalAdjusted + adjAmount, remaining: remaining - adjAmount,
            }
        };
    } catch (error) {
        console.error('❌ einvoice:adjustInvoice error:', error.message);
        return { success: false, error: error.message };
    }
});

// Lấy chuỗi chain HĐ điều chỉnh
ipcMain.handle('einvoice:getInvoiceChain', async (event, orderId) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        const orig = await prisma.eInvoice.findFirst({ where: { orderId, adjustmentType: null }, orderBy: { createdAt: 'asc' } });
        if (!orig) return { success: false, error: 'Không tìm thấy HĐ gốc' };
        const adjustments = await prisma.eInvoice.findMany({ where: { refInvoiceId: orig.id }, orderBy: { createdAt: 'asc' } });
        const totalAdjusted = adjustments.reduce((sum, inv) => sum + Math.abs(inv.totalAmount || 0), 0);
        return { success: true, data: { original: orig, adjustments, totalAdjusted, remaining: (orig.totalAmount || 0) - totalAdjusted, chainLength: adjustments.length } };
    } catch (error) { return { success: false, error: error.message }; }
});

// ========================================
// ATTENDANCE / CHẤM CÔNG KHUÔN MẶT
// On-demand: Python chỉ chạy khi vào tab Điểm danh
// Tự tắt sau 10 phút ko dùng
// ========================================

const net = require('net');

const FACE_SERVICE_URL = 'http://127.0.0.1:5001';
const FACE_SERVICE_PORT = 5001;
const FACE_SERVICE_IDLE_TIMEOUT = 30 * 60 * 1000; // Tăng lên 30 phút thay vì 10 phút
const FACE_SERVICE_NAME = 'attendance';

let faceServiceProcess = null;   // child_process reference
let faceServiceReady = false;
let faceServiceIdleTimer = null;
let faceExeDisabled = false;

// Reset idle timer mỗi khi có request → tự kill sau 30 phút idle
function resetFaceServiceIdleTimer() {
    if (faceServiceIdleTimer) clearTimeout(faceServiceIdleTimer);
    faceServiceIdleTimer = setTimeout(async () => {
        if (faceServiceProcess) {
            console.log('[Face] ⏹ Tự tắt Python service sau 30 phút không dùng');
            try {
                await faceServiceFetch('/shutdown', { method: 'POST' });
            } catch { /* Python đã tắt hoặc không phản hồi */ }
            // Chờ 2s cho Python tự thoát
            await new Promise(r => setTimeout(r, 2000));
            // Nếu vẫn còn sống thì force kill
            if (faceServiceProcess) {
                faceServiceProcess.kill();
                faceServiceProcess = null;
            }
            faceServiceReady = false;
        }
    }, FACE_SERVICE_IDLE_TIMEOUT);
}

// Spawn Python service on-demand
let _faceLastSpawnFail = 0;      // Timestamp lần spawn thất bại cuối
let _ensurePromise = null;       // Promise quản lý việc spawn chống race condition

function isLiveFaceService(data) {
    // Service đã sống (có thể đang initializing hoặc ready)
    return Boolean(
        data &&
        data.ok === true &&
        data.service === FACE_SERVICE_NAME &&
        (data.status === 'ready' || data.status === 'initializing') &&
        data.version !== undefined
    );
}

function isValidFaceServiceStatus(data) {
    // Service đã sống VÀ sẵn sàng xử lý request
    return Boolean(
        data &&
        data.ok === true &&
        data.service === FACE_SERVICE_NAME &&
        data.status === 'ready' &&
        data.version !== undefined
    );
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isFaceServicePortFree() {
    return new Promise((resolve) => {
        const tester = net.createServer();

        tester.once('error', () => resolve(false));
        tester.once('listening', () => {
            tester.close(() => resolve(true));
        });

        tester.listen(FACE_SERVICE_PORT, '127.0.0.1');
    });
}

function killProcessOnFacePort(execSync) {
    const killCommand = [
        "$targets = @(Get-NetTCPConnection -LocalPort 5001 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)",
        "if ($targets.Count -gt 0) {",
        "  $targets | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }",
        "}"
    ].join('; ');

    execSync(`powershell.exe -NoProfile -NonInteractive -Command "${killCommand}"`, {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 10000,
    });
}

async function waitForFacePortFree(maxAttempts = 10, delayMs = 1000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (await isFaceServicePortFree()) {
            return true;
        }
        console.log(`[Face] Chờ port ${FACE_SERVICE_PORT} free... lần ${attempt}/${maxAttempts}`);
        await sleep(delayMs);
    }
    return false;
}

function ensureFaceService() {
    // Nếu đang có 1 tiến trình spawn dang dở, trả về luôn tiến trình đó (Chống Race Condition)
    if (_ensurePromise) return _ensurePromise;

    _ensurePromise = (async () => {
        try {
            // 1. Đã chạy và ready → dùng luôn
            if (faceServiceProcess && faceServiceReady) {
                resetFaceServiceIdleTimer();
                return true;
            }

            // 2. Kiểm tra port 5001 đã có service sẵn chưa (zombie hoặc process từ lần trước)
            try {
                const data = await faceServiceFetch('/status');
                if (isValidFaceServiceStatus(data)) {
                    console.log('[Face] ✅ Phát hiện service đang chạy sẵn trên port 5001');
                    faceServiceReady = true;
                    resetFaceServiceIdleTimer();
                    return true;
                }
                console.warn('[Face] ⚠️ Port 5001 có phản hồi nhưng không đúng attendance service, sẽ thay thế bằng service nội bộ');
            } catch {
                // Port chưa có service → sẽ spawn bên dưới
            }

            // 3. Cooldown: tránh spawn loop (đợi 10s giữa các lần thất bại)
            const cooldown = Date.now() - _faceLastSpawnFail;
            if (cooldown < 10000) {
                throw new Error(`Đợi ${Math.ceil((10000 - cooldown) / 1000)}s trước khi thử lại`);
            }

            // 4. Spawn má»›i
            const { spawn, execSync } = require('child_process');

            // Kill process đang giữ port 5001 rồi chờ Windows nhả port thật sự.
            try {
                killProcessOnFacePort(execSync);
            } catch {
                /* Bỏ qua nếu lệnh kill lỗi hoặc không có ai dùng port */
            }
            if (!(await waitForFacePortFree())) {
                throw new Error(`Port ${FACE_SERVICE_PORT} không giải phóng được sau 10s`);
            }

            // ── Xác định cách chạy: EXE (ưu tiên) hoặc Python (fallback) ──────
            const exePath = path.join(__dirname, '..', 'python', 'dist', 'attendance_service.exe');
            const scriptPath = path.join(__dirname, '..', 'python', 'attendance_service.py');
            let spawnCmd, spawnArgs;

            const preferFaceExe = app.isPackaged && !faceExeDisabled;
            if (preferFaceExe && fs.existsSync(exePath)) {
                console.log('[Face] 🚀 Dùng attendance_service.exe (standalone)');
                spawnCmd = exePath;
                spawnArgs = [];
            } else if (fs.existsSync(scriptPath)) {
                if (!app.isPackaged && fs.existsSync(exePath)) {
                    console.log('[Face] 🛠 Dev mode → bỏ qua attendance_service.exe, dùng Python script để debug ổn định hơn');
                } else if (faceExeDisabled) {
                    console.log('[Face] ⚠️ attendance_service.exe đã bị vô hiệu hóa cho phiên này → fallback sang Python script');
                }
                console.log('[Face] 🐍 Không có EXE → tìm Python...');
                function findPythonForFace() {
                    const { spawnSync } = require('child_process');
                    const usernames = [...new Set(['Admin', 'NCPC', process.env.USERNAME || ''].filter(Boolean))];
                    const candidates = [];
                    for (const uname of usernames) {
                        for (const ver of ['Python311', 'Python310', 'Python39', 'Python312']) {
                            candidates.push({ exe: `C:\\Users\\${uname}\\AppData\\Local\\Programs\\Python\\${ver}\\python.exe`, args: [] });
                        }
                    }
                    for (const ver of ['Python311', 'Python310', 'Python39', 'Python312']) {
                        candidates.push({ exe: `C:\\Program Files\\${ver}\\python.exe`, args: [] });
                    }
                    candidates.push(
                        { exe: 'py', args: ['-3.11'] }, { exe: 'py', args: ['-3.10'] }, { exe: 'py', args: ['-3'] },
                        { exe: 'python', args: [] }, { exe: 'python3', args: [] }
                    );

                    console.log(`[Face] 🔍 Tìm Python có face_recognition (${candidates.length} candidates, users: ${usernames.join(',')})`);

                    for (const c of candidates) {
                        try {
                            if (c.exe.includes('\\')) {
                                if (!fs.existsSync(c.exe)) continue;
                            } else {
                                const res = spawnSync(c.exe, [...c.args, '--version'], { windowsHide: true, timeout: 5000, stdio: 'pipe' });
                                if (res.error || res.status !== 0) continue;
                            }

                            const verifyArgs = [...c.args, '-c', 'import face_recognition; print("OK")'];
                            const verify = spawnSync(c.exe, verifyArgs, { windowsHide: true, timeout: 15000, stdio: 'pipe' });
                            if (verify.error || verify.status !== 0) continue;

                            console.log(`[Face]   ✅ CHỌN: ${c.exe} ${c.args.join(' ')} → có face_recognition`);
                            return c;
                        } catch (err) { }
                    }
                    return null;
                }
                const pyFound = findPythonForFace();
                if (!pyFound) {
                    throw new Error('Không có EXE và không tìm thấy Python. Liên hệ kỹ thuật.');
                }
                spawnCmd = pyFound.exe;
                spawnArgs = [...pyFound.args, scriptPath];
            } else {
                throw new Error('Không tìm thấy attendance_service.exe hoặc .py');
            }
            console.log('[Face] Spawn:', spawnCmd, spawnArgs.join(' '));

            faceServiceProcess = require('child_process').spawn(spawnCmd, spawnArgs, {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
                env: {
                    ...process.env,
                    FACE_DATA_DIR: app.getPath('userData'),
                    PYTHONIOENCODING: 'utf-8',
                },
            });

            faceServiceProcess.stdout.on('data', (data) => {
                const output = data.toString().trim();
                if (output) console.log('[Face-py]', output);
            });

            faceServiceProcess.stderr.on('data', (data) => {
                const output = data.toString().trim();
                if (output) console.log('[Face-py:err]', output);
            });

            faceServiceProcess.on('error', (err) => {
                console.error('[Face] ❌ Không thể chạy Python:', err.message);
                faceServiceProcess = null;
                faceServiceReady = false;
                _faceLastSpawnFail = Date.now();
            });

            faceServiceProcess.on('exit', (code) => {
                console.log(`[Face] Python service exited (code ${code})`);
                if (spawnCmd === exePath && code !== 0) {
                    faceExeDisabled = true;
                    console.warn('[Face] ⚠️ attendance_service.exe lỗi, sẽ fallback sang Python script ở lần thử tiếp theo');
                }
                faceServiceProcess = null;
                faceServiceReady = false;
                if (code !== 0) _faceLastSpawnFail = Date.now();
                if (faceServiceIdleTimer) { clearTimeout(faceServiceIdleTimer); faceServiceIdleTimer = null; }
            });

            // Poll chờ service sống (initializing hoặc ready đều OK)
            // KHÔNG đợi ready vì rebuild encodings có thể > 30s trên máy chậm
            return await new Promise((res, rej) => {
                let attempts = 0;
                const maxAttempts = 180; // 180 x 500ms = 90s (máy khách chậm cần thêm thời gian load)
                const pollReady = setInterval(async () => {
                    attempts++;
                    if (!faceServiceProcess) {
                        clearInterval(pollReady);
                        _faceLastSpawnFail = Date.now();
                        return rej(new Error('Python process thoát bất ngờ'));
                    }
                    try {
                        const statusData = await faceServiceFetch('/status');
                        if (isLiveFaceService(statusData)) {
                            clearInterval(pollReady);
                            // Nếu đã ready thì set luôn, nếu initializing thì chưa set ready
                            if (statusData.status === 'ready') {
                                faceServiceReady = true;
                                console.log(`[Face] ✅ Python face service sẵn sàng sau ${attempts * 0.5}s!`);
                            } else {
                                console.log(`[Face] ✅ Python service đã mở port sau ${attempts * 0.5}s (đang load encodings...)`);
                            }
                            resetFaceServiceIdleTimer();
                            res(true);
                        } else {
                            throw new Error('Invalid attendance service status payload');
                        }
                    } catch {
                        if (attempts >= maxAttempts) {
                            clearInterval(pollReady);
                            _faceLastSpawnFail = Date.now();
                            console.error('[Face] ❌ Python service không phản hồi sau 90s');
                            if (faceServiceProcess) { faceServiceProcess.kill(); faceServiceProcess = null; }
                            rej(new Error('Python service khởi động thất bại (Timeout 90s)'));
                        }
                    }
                }, 500);
            });

        } catch (err) {
            _faceLastSpawnFail = Date.now();
            throw err;
        } finally {
            // Khi spawn thành công hoặc thất bại, giải phóng Promise để lệnh sau có thể thử lại
            _ensurePromise = null;
        }
    })();

    return _ensurePromise;
}

// Tự dọn process khi app thoát
app.on('before-quit', () => {
    if (faceServiceProcess) {
        console.log('[Face] 🧹 Tắt Python service khi app thoát');
        faceServiceProcess.kill();
        faceServiceProcess = null;
    }
});

function faceServiceFetch(urlPath, options = {}) {
    return new Promise((resolve, reject) => {
        const body = options.body || null;
        const method = options.method || 'GET';
        const url = new URL(`${FACE_SERVICE_URL}${urlPath}`);
        const reqOptions = {
            hostname: url.hostname,
            port: url.port || 5001,
            path: url.pathname,
            method,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        };
        const req = http.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                try { resolve(JSON.parse(data)); }
                catch { reject(new Error('Invalid JSON response')); }
            });
        });
        // /register: 120s (50 ảnh × HOG + encoding), /recognize: 15s, /profile (delete+rebuild): 60s, còn lại: 5s
        const timeout = urlPath.includes('/register') ? 120000 : urlPath.includes('/recognize') ? 15000 : urlPath.includes('/profile') ? 60000 : 5000;
        req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

// Xác định loại chấm công theo giờ hiện tại
function getLocalDateKey(now = new Date()) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getCheckType(now = new Date()) {
    const h = now.getHours();
    const m = now.getMinutes();
    const total = h * 60 + m;

    // Ca sáng
    // Check-in: 07:00 đến trước 11:50
    // Check-out: 11:50 đến 12:30
    if (total >= 7 * 60 && total <= 12 * 60 + 30) {
        if (total < 11 * 60 + 50) return 'morning_in';
        return 'morning_out';
    }

    // Ca chiều
    // Check-in: 13:00 đến trước 17:30
    // Check-out: 17:30 đến 20:30
    if (total >= 13 * 60 && total <= 20 * 60 + 30) {
        if (total < 17 * 60 + 30) return 'afternoon_in';
        return 'evening_out';
    }

    // DEBUG: Tạm bỏ giới hạn giờ — luôn cho phép chấm công
    // Ngoài khung giờ → tự chọn ca gần nhất thay vì block
    if (total < 7 * 60) return 'morning_in';           // Trước 7h → coi như sáng vào sớm
    if (total <= 13 * 60) return 'morning_out';         // 12:30-13:00 (nghỉ trưa) → sáng ra
    return 'evening_out';                               // Sau 20:30 → tối ra
}

function attendanceDecision(checkType, extra = {}) {
    return { checkType, ...extra };
}

async function resolveAttendanceCheckType(faceId, date, now = new Date()) {
    const baseCheckType = getCheckType(now);
    if (!baseCheckType) return attendanceDecision(null);

    const total = now.getHours() * 60 + now.getMinutes();
    const logs = await prisma.attendanceLog.findMany({
        where: { faceId, date },
        select: { checkType: true, timestamp: true },
        orderBy: { timestamp: 'asc' },
    });
    const has = (type) => logs.some(log => log.checkType === type);

    // Once a session has check-in, the next valid recognition for that session is checkout.
    if (baseCheckType === 'morning_in' && has('morning_in')) {
        if (has('morning_out')) return attendanceDecision('morning_out');
        if (total < 11 * 60 + 50) {
            return attendanceDecision(null, {
                reason: 'not_checkout_time',
                nextCheckType: 'morning_out',
                allowedFrom: '11:50',
            });
        }
        return attendanceDecision('morning_out');
    }

    if (baseCheckType === 'afternoon_in' && has('afternoon_in')) {
        if (has('evening_out')) return attendanceDecision('evening_out');
        if (total < 17 * 60 + 30) {
            return attendanceDecision(null, {
                reason: 'not_checkout_time',
                nextCheckType: 'evening_out',
                allowedFrom: '17:30',
            });
        }
        return attendanceDecision('evening_out');
    }

    return attendanceDecision(baseCheckType);
}

function encodeMailHeader(value) {
    return `=?UTF-8?B?${Buffer.from(String(value || ''), 'utf8').toString('base64')}?=`;
}

function toBase64Url(value) {
    return Buffer.from(value, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function isGoogleReauthError(err) {
    const parts = [
        err?.message,
        err?.response?.data?.error,
        err?.response?.data?.error_description,
    ].filter(Boolean).map(value => String(value).toLowerCase());
    return parts.some(value => value.includes('invalid_grant') || value.includes('token has been expired or revoked'));
}

async function sendGmailWithAttachment({ to, subject, html, fileName, pdfBase64 }) {
    const tokenPath = ensureGoogleTokenPath();
    if (!fs.existsSync(tokenPath)) {
        return { success: false, reauthRequired: true, error: 'Chưa có token Google. Cần đăng nhập Google trước khi gửi Gmail.' };
    }

    const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
    const scope = String(tokens.scope || '');
    if (!scope.includes('https://www.googleapis.com/auth/gmail.send')) {
        return {
            success: false,
            reauthRequired: true,
            error: 'Token Google hiện tại chưa có quyền Gmail. Cần cấp lại quyền với scope gmail.send.',
        };
    }

    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
    oauth2Client.setCredentials(tokens);
    oauth2Client.on('tokens', (newTokens) => {
        try {
            const saved = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
            fs.writeFileSync(tokenPath, JSON.stringify({ ...saved, ...newTokens }, null, 2));
        } catch (err) {
            console.error('[Gmail] Failed to save refreshed token:', err.message);
        }
    });

    const boundary = `payslip_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const sender = 'yendao444@gmail.com';
    const safeFileName = fileName || 'phieu-luong.pdf';
    const message = [
        `From: ${encodeMailHeader('Hệ thống Quản lý')} <${sender}>`,
        `To: ${to}`,
        `Subject: ${encodeMailHeader(subject)}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(html || '', 'utf8').toString('base64'),
        '',
        `--${boundary}`,
        `Content-Type: application/pdf; name="${safeFileName}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${safeFileName}"`,
        '',
        String(pdfBase64 || '').replace(/^data:application\/pdf;base64,/, ''),
        '',
        `--${boundary}--`,
    ].join('\r\n');

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    let sent;
    try {
        sent = await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw: toBase64Url(message) },
        });
    } catch (err) {
        if (isGoogleReauthError(err)) {
            return {
                success: false,
                reauthRequired: true,
                error: 'Token Google da het han hoac bi thu hoi. Vui long chay reauth-gdrive.bat de dang nhap Google lai roi gui lai Gmail.',
            };
        }
        throw err;
    }

    return { success: true, data: { id: sent.data.id } };
}

ipcMain.handle('attendance:sendPayslipEmail', async (event, { to, employeeName, period, fileName, pdfBase64 } = {}) => {
    try {
        if (!to || !pdfBase64) throw new Error('Thiếu email nhận hoặc file PDF');

        const companyName = 'AIRCLEAN CORP.';
        const employeeLabel = String(employeeName || '').trim();
        const rawPeriod = String(period || '').trim();
        const formattedPeriod = rawPeriod ? `Tháng ${rawPeriod.replace('-', '/')}` : 'Tháng';
        const subject = `${companyName} - Phiếu Lương ${formattedPeriod} - ${employeeLabel}`.replace(/\s+/g, ' ').trim();
        const greetingName = employeeLabel ? ` ${employeeLabel}` : '';
        const html = `
            <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#111;">
                <p>Kính gửi anh/chị${greetingName},</p>
                <p>${companyName} gửi anh/chị phiếu lương kỳ ${formattedPeriod.toLowerCase()} trong file đính kèm.</p>
                <p>Anh/chị vui lòng kiểm tra thông tin chi tiết. Nếu có thắc mắc hoặc cần đối soát, vui lòng phản hồi lại email này hoặc liên hệ bộ phận phụ trách.</p>
                <p>Trân trọng,<br/>Bộ phận Nhân sự<br/>DBY Software</p>
            </div>
        `;
        return await sendGmailWithAttachment({ to, subject, html, fileName, pdfBase64 });
    } catch (err) {
        console.error('❌ attendance:sendPayslipEmail error:', err.message);
        const message = err?.response?.data?.error || err.message || 'Gửi Gmail thất bại';
        return { success: false, error: typeof message === 'string' ? message : JSON.stringify(message) };
    }
});

// Kiểm tra + tự khởi động Python service khi vào tab Điểm danh
ipcMain.handle('attendance:savePayslipPDF', async (event, { fileName, pdfBase64 } = {}) => {
    try {
        if (!fileName || !pdfBase64) throw new Error('Thiếu tên file hoặc dữ liệu PDF');
        const safeFileName = String(fileName)
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
            .replace(/\s+/g, ' ')
            .trim() || `phieu-luong-${Date.now()}.pdf`;
        const downloadsDir = app.getPath('downloads');
        const targetPath = path.join(downloadsDir, safeFileName.toLowerCase().endsWith('.pdf') ? safeFileName : `${safeFileName}.pdf`);
        fs.writeFileSync(targetPath, Buffer.from(String(pdfBase64).replace(/^data:application\/pdf;base64,/, ''), 'base64'));
        return { success: true, data: { filePath: targetPath } };
    } catch (err) {
        console.error('❌ attendance:savePayslipPDF error:', err.message);
        return { success: false, error: err.message || 'Không lưu được file PDF' };
    }
});

ipcMain.handle('attendance:status', async () => {
    const exePath = path.join(__dirname, '..', 'python', 'dist', 'attendance_service.exe');
    const scriptPath = path.join(__dirname, '..', 'python', 'attendance_service.py');
    const debug = {
        isPackaged: app.isPackaged,
        exeExists: fs.existsSync(exePath),
        scriptExists: fs.existsSync(scriptPath),
        exePath,
        faceExeDisabled,
        faceServiceReady,
        hasProcess: !!faceServiceProcess,
    };
    console.log('[Face:status] debug:', JSON.stringify(debug));
    try {
        // Tự động spawn Python nếu chưa chạy
        await ensureFaceService();
        const data = await faceServiceFetch('/status');
        if (!isLiveFaceService(data)) {
            throw new Error('Attendance service trả về /status không hợp lệ: ' + JSON.stringify(data));
        }
        // Nếu đang initializing → vẫn báo success nhưng ghi nhận chưa ready
        if (data.status === 'ready' && !faceServiceReady) {
            faceServiceReady = true;
        }
        console.log('[Face:status] OK →', data.status);
        return { success: true, data, debug };
    } catch (err) {
        console.warn('[Face:status] FAILED:', err.message);
        return { success: false, error: err.message || 'Python service chưa sẵn sàng', debug };
    }
});

// Phát hiện khuôn mặt (không so khớp) — dùng cho modal đăng ký
ipcMain.handle('attendance:detect', async (event, { image }) => {
    try {
        await ensureFaceService();
        resetFaceServiceIdleTimer();
        const result = await faceServiceFetch('/detect', {
            method: 'POST',
            body: JSON.stringify({ image }),
        });
        return { success: true, face_box: result.face_box, img_height: result.img_height, found: result.found, reason: result.reason };
    } catch (err) {
        console.error('❌ attendance:detect error:', err.message);
        return { success: false, error: err.message };
    }
});

// Nhận diện khuôn mặt + ghi chấm công
ipcMain.handle('attendance:recognize', async (event, { image }) => {
    try {
        await ensureFaceService();
        resetFaceServiceIdleTimer();
        const result = await faceServiceFetch('/recognize', {
            method: 'POST',
            body: JSON.stringify({ image }),
        });

        // ── DEBUG LOG ──────────────────────────────────────────────────
        console.log('[Face DEBUG] Python result:', JSON.stringify({
            found: result.found,
            face_id: result.face_id,
            reason: result.reason,
            confidence: result.confidence,
            dist: result.dist,
            _debug: result._debug,
        }));

        // Luôn đính kèm face_box để frontend vẽ overlay real-time
        const faceInfo = {
            face_box: result.face_box || null,
            img_width: result.img_width || 640,
            img_height: result.img_height || 480,
        };

        // Không phát hiện mặt
        if (!result.found) return { success: false, reason: result.reason, ...faceInfo };

        // Phát hiện mặt nhưng không khớp profile nào
        if (!result.face_id) return { success: false, reason: 'no_match', ...faceInfo };

        // Lấy thông tin user từ FaceProfile (cần trước cả out_of_hours để có userName)
        const profile = await prisma.faceProfile.findUnique({ where: { faceId: result.face_id } });
        const userName = profile?.userName || result.face_id;
        const userId = profile?.userId || null;

        const now = new Date();
        const today = getLocalDateKey(now);
        const checkDecision = await resolveAttendanceCheckType(result.face_id, today, now);
        const checkType = checkDecision.checkType;
        if (!checkType) {
            return {
                success: false,
                reason: checkDecision.reason || 'out_of_hours',
                nextCheckType: checkDecision.nextCheckType,
                allowedFrom: checkDecision.allowedFrom,
                face_id: result.face_id,
                userName,
                ...faceInfo
            };
        }

        // Mỗi loại log chỉ ghi 1 lần/ngày.
        const existing = await prisma.attendanceLog.findFirst({
            where: { faceId: result.face_id, checkType, date: today }
        });
        if (existing) return { success: false, reason: 'duplicate', face_id: result.face_id, userName, ...faceInfo };

        // Ghi log
        const log = await prisma.attendanceLog.create({
            data: {
                userId, userName, faceId: result.face_id,
                checkType, confidence: result.confidence,
                date: today,
            }
        });

        return { success: true, data: { ...log, confidence: result.confidence, userName, ...faceInfo } };
    } catch (err) {
        console.error('❌ attendance:recognize error:', err.message);
        return { success: false, error: err.message };
    }
});

// Đăng ký khuôn mặt nhân viên
ipcMain.handle('attendance:register', async (event, { face_id, user_name, user_id, images }) => {
    try {
        await ensureFaceService();
        resetFaceServiceIdleTimer();
        const result = await faceServiceFetch('/register', {
            method: 'POST',
            body: JSON.stringify({ face_id, user_name, images }),
        });
        if (!result.ok) throw new Error('Python register failed');

        // Lưu FaceProfile vào DB
        await prisma.faceProfile.upsert({
            where: { faceId: face_id },
            update: { userName: user_name, userId: user_id || null, photoCount: result.saved, isActive: true },
            create: { faceId: face_id, userName: user_name, userId: user_id || null, photoCount: result.saved },
        });

        return { success: true, saved: result.saved };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Lấy lịch sử chấm công
ipcMain.handle('attendance:getLogs', async (event, { date, month, userId } = {}) => {
    try {
        const where = {};
        if (date) where.date = date;
        else if (month) where.date = { startsWith: month }; // month: 'YYYY-MM'

        if (userId) where.userId = userId;

        const logs = await prisma.attendanceLog.findMany({
            where, orderBy: { timestamp: 'desc' },
            ...(date ? { take: 200 } : {}) // Limit if single date, fetch all for month
        });
        return { success: true, data: logs };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Kiểm tra toàn bộ profiles — so sánh DB, disk, Python memory
// Trả về danh sách profiles ở từng nơi và highlight mismatch
ipcMain.handle('attendance:verifyAll', async () => {
    const result = { db: [], disk: [], pythonMemory: [], mismatches: [], serviceOnline: false };
    try {
        // 1. DB
        const dbRows = await prisma.faceProfile.findMany({ where: { isActive: true } });
        result.db = dbRows.map(r => r.faceId);
    } catch (err) {
        console.error('[attendance] verifyAll DB error:', err.message);
    }
    try {
        // 2. Disk
        const facesRoot = path.join(app.getPath('userData'), 'faces');
        if (fs.existsSync(facesRoot)) {
            result.disk = fs.readdirSync(facesRoot).filter(name =>
                fs.statSync(path.join(facesRoot, name)).isDirectory()
            );
        }
    } catch (err) {
        console.error('[attendance] verifyAll disk error:', err.message);
    }
    try {
        // 3. Python memory
        const status = await faceServiceFetch('/status');
        if (!isValidFaceServiceStatus(status)) {
            throw new Error('Invalid attendance service status payload');
        }
        result.pythonMemory = status.face_ids || [];
        result.serviceOnline = true;
    } catch (_) {
        result.serviceOnline = false;
    }

    // So sánh tìm mismatch
    const allIds = new Set([...result.db, ...result.disk, ...result.pythonMemory]);
    for (const id of allIds) {
        const inDb = result.db.includes(id);
        const inDisk = result.disk.includes(id);
        const inPython = result.serviceOnline ? result.pythonMemory.includes(id) : null;
        const isMismatch = inDb !== inDisk || (inPython !== null && inDb !== inPython);
        if (isMismatch) {
            result.mismatches.push({ face_id: id, inDb, inDisk, inPython });
        }
    }

    console.log('[attendance] verifyAll:', JSON.stringify(result, null, 2));
    return { success: true, ...result };
});

// Lấy danh sách profiles khuôn mặt
ipcMain.handle('attendance:getProfiles', async () => {
    try {
        const profiles = await prisma.faceProfile.findMany({ where: { isActive: true } });
        return { success: true, data: profiles };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// Xóa profile khuôn mặt
ipcMain.handle('attendance:deleteProfile', async (event, { face_id }) => {
    // Xóa Python encodings qua service
    try {
        await faceServiceFetch(`/profile/${encodeURIComponent(face_id)}`, { method: 'DELETE' });
    } catch (err) {
        console.warn('[attendance] Python delete failed, fallback to direct fs delete:', err.message);
        // Fallback: service offline → xóa folder ảnh trực tiếp bằng fs
        // Tránh trường hợp DB xóa thành công nhưng ảnh vẫn còn trên disk
        try {
            const facesDir = path.join(app.getPath('userData'), 'faces', face_id);
            if (fs.existsSync(facesDir)) {
                fs.rmSync(facesDir, { recursive: true, force: true });
                console.log('[attendance] Deleted face folder directly:', facesDir);
            }
        } catch (fsErr) {
            console.error('[attendance] fs delete also failed:', fsErr.message);
        }
    }
    // Luôn xóa DB record
    try {
        await prisma.faceProfile.updateMany({ where: { faceId: face_id }, data: { isActive: false } });
    } catch (err) {
        console.error('[attendance] DB delete failed:', err.message);
        return { success: false, error: err.message };
    }

    // Verify sau khi xóa — kiểm tra cả 3 nơi để chắc chắn sạch
    const verify = { db: false, disk: false, pythonMemory: false };
    try {
        const dbRecord = await prisma.faceProfile.findFirst({ where: { faceId: face_id, isActive: true } });
        verify.db = dbRecord === null; // true = không còn record active
    } catch (_) { }
    try {
        const facesDir = path.join(app.getPath('userData'), 'faces', face_id);
        verify.disk = !fs.existsSync(facesDir); // true = folder đã bị xóa
    } catch (_) { }
    try {
        const status = await faceServiceFetch('/status');
        if (!isValidFaceServiceStatus(status)) {
            throw new Error('Invalid attendance service status payload');
        }
        verify.pythonMemory = !status.face_ids?.includes(face_id); // true = không còn trong memory
    } catch (_) {
        verify.pythonMemory = null; // null = service offline, không kiểm tra được
    }

    const allClean = verify.db && verify.disk && (verify.pythonMemory === true || verify.pythonMemory === null);
    console.log(`[attendance] Delete verify for '${face_id}':`, verify);
    return { success: true, verify, allClean };
});



// 
// OFFLINE QUEUE  Sync & Status handlers
// 

// Tr� v� s� �n ang ch� sync
ipcMain.handle('offlineQueue:status', () => {
    return { success: true, pendingCount: offlineQueue.count() };
});

// Flush to�n b� queue l�n Supabase
ipcMain.handle('offlineQueue:sync', async () => {
    const items = offlineQueue.dequeueAll();
    if (items.length === 0) return { success: true, synced: 0, failed: 0 };

    let synced = 0, failed = 0;
    const errors = [];

    for (const item of items) {
        try {
            if (item.type === 'ecommerceExports:update') {
                await execEcommerceExportUpdate(item.payload.id, item.payload.data);
                offlineQueue.remove(item._filename);
                synced++;
                console.log('[OfflineQueue] Synced:', item._filename);
            } else {
                // Unknown type  b� qua, x�a � kh�ng b� loop
                offlineQueue.remove(item._filename);
            }
        } catch (err) {
            failed++;
            errors.push({ file: item._filename, error: err.message });
            console.error('[OfflineQueue] Sync failed for', item._filename, ':', err.message);
            // Kh�ng x�a file  gi� l�i � retry l�n sau
        }
    }

    console.log('[OfflineQueue] Sync complete  synced:', synced, '| failed:', failed, '| remaining:', offlineQueue.count());
    return { success: true, synced, failed, remaining: offlineQueue.count(), errors };
});
