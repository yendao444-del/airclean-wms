const { ipcMain, dialog, shell, app } = require('electron');
const path = require('path');

// âœ… PRODUCTION CONFIG - KhÃ´ng cáº§n .env ná»¯a
const config = require('./config');

// 📦 Offline Queue — lưu scan khi mất mạng, sync lại khi có mạng
const offlineQueue = require('./offline-queue');
try { offlineQueue.init(app.getPath('userData')); } catch (e) { console.error('[OfflineQueue] Init failed:', e.message); }

// Set environment variables tá»« config
process.env.DATABASE_URL = config.DATABASE_URL;
process.env.DIRECT_URL = config.DIRECT_URL;

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

// ========================================
// ðŸ”’ STOCK MUTEX â€” Serialize stock operations
// NgÄƒn race condition khi nhiá»u scan/import cháº¡y Ä‘á»“ng thá»i
// Äáº£m báº£o Tá»“n Ä‘áº§u/Tá»“n cuá»‘i trong Tháº» Kho luÃ´n Ä‘Ãºng
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

// âš¡ LAZY LOADING â€” Module náº·ng chá»‰ load khi cáº§n, khÃ´ng block startup
// googleapis (~3-5s), xlsx (~1-2s), bcryptjs (~0.5s) â†’ tiáº¿t kiá»‡m ~5-7s
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
// GOOGLE DRIVE + TELEGRAM â€” HÄÄT BACKUP
// ========================================

const GDRIVE_FOLDER_ID = config.GDRIVE_FOLDER_ID;
const TELEGRAM_BOT_TOKEN = config.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = config.TELEGRAM_CHAT_ID;

// OAuth2 Client credentials
const OAUTH_CLIENT_ID = config.OAUTH_CLIENT_ID;
const OAUTH_CLIENT_SECRET = config.OAUTH_CLIENT_SECRET;

// Google Drive auth (OAuth2 â€” dÃ¹ng storage cá»§a user, khÃ´ng bá»‹ quota limit)
let driveClient = null;
let driveClientTokenMtime = 0;

function getDriveClient() {
    try {
        const tokenPath = path.join(__dirname, 'gdrive-token.json');
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

// TÃ¬m hoáº·c táº¡o subfolder theo thÃ¡ng: HDDT-AIRCLEAN/2026-03/
async function getOrCreateMonthFolder(drive, parentFolderId, monthStr) {
    try {
        // TÃ¬m folder Ä‘Ã£ cÃ³
        const res = await drive.files.list({
            q: `'${parentFolderId}' in parents and name='${monthStr}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id, name)',
        });
        if (res.data.files.length > 0) {
            return res.data.files[0].id;
        }
        // Táº¡o má»›i
        const folder = await drive.files.create({
            requestBody: {
                name: monthStr,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parentFolderId],
            },
            fields: 'id',
        });
        console.log(`ðŸ“ Created Drive folder: ${monthStr}`);
        return folder.data.id;
    } catch (err) {
        console.error('âŒ Create month folder error:', err.message);
        return parentFolderId; // Fallback: upload vÃ o root folder
    }
}

// Upload file lÃªn Google Drive
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

        // Set quyá»n "Anyone with link can view" â€” fire-and-forget, khÃ´ng block upload
        drive.permissions.create({
            fileId: file.data.id,
            requestBody: { role: 'reader', type: 'anyone' },
        }).catch(permErr => console.warn(`âš ï¸ Could not set public permission for ${fileName}:`, permErr.message));

        console.log(`â˜ï¸ Uploaded to Drive: ${fileName} (${file.data.id}) [public]`);
        return { fileId: file.data.id, webViewLink: file.data.webViewLink };
    } catch (err) {
        console.error(`âŒ Drive upload error (${fileName}):`, err.message);
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
                        console.log(`ðŸ“± Telegram sent: ${fileName}`);
                        resolve({ success: true });
                    } else {
                        console.error(`âŒ Telegram error ${res.statusCode}:`, data.substring(0, 200));
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

// Gá»­i tin nháº¯n text qua Telegram
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

// Táº¡o XML hÃ³a Ä‘Æ¡n (chuáº©n bá»‹ â€” khi tÃ­ch há»£p MISA sáº½ láº¥y tá»« API)
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
    <Note>File XML nÃ y Ä‘Æ°á»£c táº¡o tá»± Ä‘á»™ng. Khi tÃ­ch há»£p MISA MeInvoice, file XML cÃ³ chá»¯ kÃ½ sá»‘ há»£p lá»‡ sáº½ thay tháº¿ file nÃ y.</Note>
</Invoice>`;
}

function escapeXml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Upload + gá»­i 1 hÃ³a Ä‘Æ¡n lÃªn Drive & Telegram (cháº¡y ngáº§m, khÃ´ng block)
async function backupInvoiceToCloudAndTelegram(order, invoiceNumber, taxCode) {
    const results = { drive: { xml: null, pdf: null }, telegram: { xml: false, pdf: false } };

    try {
        const xmlContent = generateInvoiceXML(order, invoiceNumber, taxCode);
        const xmlFileName = `${invoiceNumber}_${order.orderId}.xml`;

        // Táº¡o ná»™i dung text Ä‘Æ¡n giáº£n thay cho PDF (vÃ¬ chÆ°a cÃ³ MISA API tráº£ PDF tháº­t)
        const pdfContent = `HÃ“A ÄÆ N ÄIá»†N Tá»¬ - Báº¢N THá»‚ HIá»†N\n` +
            `========================================\n` +
            `Sá»‘ HÄ: ${invoiceNumber}\n` +
            `NgÃ y: ${new Date().toLocaleDateString('vi-VN')}\n` +
            `MÃ£ tra cá»©u: ${taxCode}\n` +
            `\nNGÆ¯á»œI BÃN: AIRCLEAN\n` +
            `\nNGÆ¯á»œI MUA: ${order.customerName}\n` +
            `SÄT: ${order.customerPhone || 'N/A'}\n` +
            `SÃ n: ${order.platform}\n` +
            `MÃ£ Ä‘Æ¡n: ${order.orderId}\n` +
            `\nTá»”NG TIá»€N: ${Number(order.totalAmount).toLocaleString('vi-VN')}Ä‘\n` +
            `========================================\n` +
            `âœ… ÄÃ£ kÃ½ sá»‘ Ä‘iá»‡n tá»­\n` +
            `ðŸ“‹ LÆ°u Ã½: ÄÃ¢y lÃ  báº£n thá»ƒ hiá»‡n. File XML gá»‘c cÃ³ giÃ¡ trá»‹ phÃ¡p lÃ½.`;
        const pdfFileName = `${invoiceNumber}_${order.orderId}.txt`; // .txt vÃ¬ chÆ°a cÃ³ PDF tháº­t

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
        const caption = `ðŸ§¾ ${invoiceNumber}\n` +
            `ðŸ‘¤ ${order.customerName}\n` +
            `ðŸ’° ${Number(order.totalAmount).toLocaleString('vi-VN')}Ä‘\n` +
            `ðŸ›’ ${order.platform} | ${order.orderId}\n` +
            `ðŸ“… ${new Date().toLocaleDateString('vi-VN')}`;

        const [tgXml, tgPdf] = await Promise.all([
            sendTelegramDocument(Buffer.from(xmlContent, 'utf-8'), xmlFileName, `ðŸ“Ž XML gá»‘c â€” ${caption}`),
            sendTelegramDocument(Buffer.from(pdfContent, 'utf-8'), pdfFileName, `ðŸ“„ Báº£n thá»ƒ hiá»‡n â€” ${caption}`),
        ]);
        results.telegram.xml = tgXml.success;
        results.telegram.pdf = tgPdf.success;

    } catch (err) {
        console.error(`âŒ Backup invoice ${invoiceNumber} error:`, err.message);
    }

    return results;
}

// ========================================
// PRISMA CLIENT - Báº®T BUá»˜C SUPABASE
// ========================================

let prisma;
let prismaDirectTx; // DÃ¹ng DIRECT_URL cho transactions náº·ng (bypass PgBouncer)

// âš¡ LAZY INIT â€” chá»‰ táº¡o khi láº§n Ä‘áº§u cáº§n (tiáº¿t kiá»‡m ~500ms startup)
function getPrismaDirectTx() {
    if (!prismaDirectTx) {
        console.time('âš¡ lazy-init prismaDirectTx');
        prismaDirectTx = new PrismaClient({
            log: ['error', 'warn'],
            datasources: { db: { url: config.DIRECT_URL } }
        });
        prismaDirectTx.$connect()
            .then(() => console.log('âœ… Connected Prisma Direct (for transactions)'))
            .catch(err => console.error('âš ï¸ Prisma Direct connect failed:', err.message));
        console.timeEnd('âš¡ lazy-init prismaDirectTx');
    }
    return prismaDirectTx;
}

try {
    console.log('ðŸ”„ Initializing Prisma Client...');
    console.log('   ðŸ†• CODE VERSION: 3.0 (Production with embedded config)');
    console.log('   APP:', config.APP_NAME, config.APP_VERSION);
    console.log('   ENVIRONMENT:', config.ENVIRONMENT);
    console.log('   DATABASE_URL:', config.DATABASE_URL.split('@')[1] || 'Invalid'); // Chá»‰ log domain, khÃ´ng log password

    prisma = new PrismaClient({
        log: ['error', 'warn'],
        datasources: {
            db: {
                url: config.DATABASE_URL
            }
        }
    });
    console.log('âœ… Prisma Client initialized successfully');

    // Test connection - REQUIRED
    prisma.$connect()
        .then(() => {
            console.log('âœ… Connected to Supabase PostgreSQL');
        })
        .catch(err => {
            console.error('âŒ CRITICAL: Database connection failed!');
            console.error('   Error:', err.message);
            console.error('   Stack:', err.stack);

            // Show error dialog to user
            const { dialog } = require('electron');
            dialog.showErrorBox(
                'Lá»—i káº¿t ná»‘i Database',
                `KhÃ´ng thá»ƒ káº¿t ná»‘i Ä‘áº¿n database.\n\nChi tiáº¿t: ${err.message}\n\nVui lÃ²ng kiá»ƒm tra káº¿t ná»‘i internet vÃ  thá»­ láº¡i.`
            );

            // Exit app if can't connect to database
            app.quit();
        });
} catch (error) {
    console.error('âŒ CRITICAL: Prisma Client initialization failed!');
    console.error('   Error:', error.message);
    console.error('   Stack:', error.stack);

    // Show error dialog
    const { dialog } = require('electron');
    dialog.showErrorBox(
        'Lá»—i khá»Ÿi táº¡o Database',
        `KhÃ´ng thá»ƒ khá»Ÿi táº¡o káº¿t ná»‘i database.\n\nChi tiáº¿t: ${error.message}\n\ná»¨ng dá»¥ng sáº½ thoÃ¡t.`
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

function requireRole(...roles) {
    if (!currentSession) {
        throw new Error('ChÆ°a Ä‘Äƒng nháº­p');
    }
    if (roles.length > 0 && !roles.includes(currentSession.role)) {
        throw new Error(`KhÃ´ng cÃ³ quyá»n thá»±c hiá»‡n thao tÃ¡c nÃ y (yÃªu cáº§u: ${roles.join('/')})`);
    }
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
        console.error('âš ï¸ Activity log failed:', err.message);
    }
}

// ========================================
// AUTO CLEANUP - XÃ³a log cÅ© hÆ¡n 7 ngÃ y
// ========================================
async function cleanupOldLogs() {
    try {
        if (!prisma) return;

        // 1. XÃ³a ActivityLog cÅ© hÆ¡n 30 ngÃ y
        const logCutoff = new Date();
        logCutoff.setDate(logCutoff.getDate() - 30);
        const logResult = await prisma.activityLog.deleteMany({
            where: { timestamp: { lt: logCutoff } }
        });
        if (logResult.count > 0) {
            console.log(`ðŸ§¹ Cleanup: ÄÃ£ xÃ³a ${logResult.count} activity log cÅ© hÆ¡n 30 ngÃ y`);
        }

        // 2. XÃ³a EcommerceExport Ä‘Ã£ hoÃ n thÃ nh cÅ© hÆ¡n 2 thÃ¡ng
        const exportCutoff = new Date();
        exportCutoff.setMonth(exportCutoff.getMonth() - 2);
        const exportResult = await prisma.ecommerceExport.deleteMany({
            where: {
                status: 'completed',
                ecommerceExportDate: { lt: exportCutoff }
            }
        });
        if (exportResult.count > 0) {
            console.log(`ðŸ§¹ Cleanup: ÄÃ£ xÃ³a ${exportResult.count} Ä‘Æ¡n TMDT hoÃ n thÃ nh cÅ© hÆ¡n 2 thÃ¡ng`);
        }

    } catch (err) {
        console.error('âš ï¸ Cleanup failed:', err.message);
    }
}

// Cháº¡y cleanup khi app khá»Ÿi Ä‘á»™ng (delay 10s Ä‘á»ƒ DB sáºµn sÃ ng)
setTimeout(cleanupOldLogs, 10000);

// Láº·p láº¡i má»—i 24 tiáº¿ng
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
        console.error('âŒ system:getInfo error:', error.message);
        return { success: false, error: error.message };
    }
});

// ========================================
// PRODUCTS
// ========================================

ipcMain.handle('products:getAll', async () => {
    try {
        if (!prisma) {
            throw new Error('Database chÆ°a Ä‘Æ°á»£c khá»Ÿi táº¡o. Vui lÃ²ng khá»Ÿi Ä‘á»™ng láº¡i á»©ng dá»¥ng.');
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

        console.log(`âœ… Loaded ${products.length} products from Supabase`);
        return { success: true, data: products };
    } catch (error) {
        console.error('âŒ Error loading products:', error.message);
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
        console.log('ðŸ“ Create product called with:', JSON.stringify(data, null, 2));
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
                unit: data.unit || 'CÃ¡i',
                status: data.status || 'active',
                variants: data.variants || null
            },
            include: { category: true }
        });
        console.log(`âœ… Created product: ${product.name} (ID: ${product.id})`);
        void logActivity({ module: 'products', action: 'CREATE', description: `Táº¡o sáº£n pháº©m "${product.name}" (SKU: ${product.sku})`, recordId: product.id, recordName: product.name, userName: data.userName || 'Admin' });
        return { success: true, data: product };
    } catch (error) {
        console.error('âŒ Create product ERROR:', error.code, error.message);

        // Prisma unique constraint error
        if (error.code === 'P2002') {
            const field = error.meta?.target?.[0] || 'unknown';
            if (field === 'sku') {
                return { success: false, error: `MÃ£ SKU "${data.sku}" Ä‘Ã£ tá»“n táº¡i. Vui lÃ²ng sá»­ dá»¥ng mÃ£ khÃ¡c.` };
            }
            if (field === 'barcode') {
                return { success: false, error: `MÃ£ váº¡ch "${data.barcode}" Ä‘Ã£ tá»“n táº¡i. Vui lÃ²ng sá»­ dá»¥ng mÃ£ khÃ¡c.` };
            }
            return { success: false, error: `Dá»¯ liá»‡u trÃ¹ng láº·p (${field})` };
        }

        return { success: false, error: error.message || 'Lá»—i khi táº¡o sáº£n pháº©m' };
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
        console.log(`âœ… Updated product: ${product.name}`);
        void logActivity({ module: 'products', action: 'UPDATE', description: `Cáº­p nháº­t sáº£n pháº©m "${product.name}"`, recordId: product.id, recordName: product.name, changes: data, userName: data.userName || 'Admin' });
        return { success: true, data: product };
    } catch (error) {
        console.error('âŒ Update product error:', error.code, error.message);

        if (error.code === 'P2002') {
            const field = error.meta?.target?.[0] || 'unknown';
            if (field === 'sku') {
                return { success: false, error: `MÃ£ SKU "${data.sku}" Ä‘Ã£ tá»“n táº¡i. Vui lÃ²ng sá»­ dá»¥ng mÃ£ khÃ¡c.` };
            }
            if (field === 'barcode') {
                return { success: false, error: `MÃ£ váº¡ch "${data.barcode}" Ä‘Ã£ tá»“n táº¡i. Vui lÃ²ng sá»­ dá»¥ng mÃ£ khÃ¡c.` };
            }
        }

        return { success: false, error: error.message || 'Lá»—i khi cáº­p nháº­t sáº£n pháº©m' };
    }
});

ipcMain.handle('products:delete', async (event, id) => {
    try {
        requireRole('admin');
        if (!prisma) throw new Error('Prisma not available');
        const product = await prisma.product.findUnique({ where: { id } });
        await prisma.product.delete({ where: { id } });
        console.log(`âœ… Deleted product ID: ${id}`);
        void logActivity({ module: 'products', action: 'DELETE', description: `XÃ³a sáº£n pháº©m "${product?.name || id}"`, recordId: id, recordName: product?.name });
        return { success: true };
    } catch (error) {
        console.error('âŒ Delete product error:', error.message);
        return { success: false, error: error.message };
    }
});

// ========================================
// CATEGORIES - Danh má»¥c sáº£n pháº©m (PRISMA)
// ========================================

ipcMain.handle('categories:getAll', async () => {
    try {
        if (!prisma) {
            throw new Error('Database chÆ°a Ä‘Æ°á»£c khá»Ÿi táº¡o.');
        }

        const categories = await prisma.category.findMany({
            orderBy: { name: 'asc' }
        });
        return { success: true, data: categories };
    } catch (error) {
        console.error('âŒ Error getting categories:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('categories:create', async (event, data) => {
    try {
        if (!prisma) {
            throw new Error('Database chÆ°a Ä‘Æ°á»£c khá»Ÿi táº¡o.');
        }

        const newCategory = await prisma.category.create({
            data: {
                name: data.name,
            }
        });

        console.log('âœ… Category created:', newCategory);
        void logActivity({ module: 'products', action: 'CREATE', description: `Táº¡o danh má»¥c "${newCategory.name}"`, recordName: newCategory.name });
        return { success: true, data: newCategory };
    } catch (error) {
        console.error('âŒ Error creating category:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('categories:update', async (event, id, data) => {
    try {
        if (!prisma) {
            throw new Error('Database chÆ°a Ä‘Æ°á»£c khá»Ÿi táº¡o.');
        }

        const updatedCategory = await prisma.category.update({
            where: { id: parseInt(id) },
            data: {
                name: data.name,
            }
        });

        console.log('âœ… Category updated:', updatedCategory);
        void logActivity({ module: 'products', action: 'UPDATE', description: `Cáº­p nháº­t danh má»¥c "${updatedCategory.name}"`, recordName: updatedCategory.name });
        return { success: true, data: updatedCategory };
    } catch (error) {
        console.error('âŒ Error updating category:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('categories:delete', async (event, id) => {
    try {
        if (!prisma) {
            throw new Error('Database chÆ°a Ä‘Æ°á»£c khá»Ÿi táº¡o.');
        }

        // Check if category is being used by any products
        const productsCount = await prisma.product.count({
            where: { categoryId: parseInt(id) }
        });

        if (productsCount > 0) {
            return {
                success: false,
                error: `KhÃ´ng thá»ƒ xÃ³a danh má»¥c nÃ y vÃ¬ Ä‘ang cÃ³ ${productsCount} sáº£n pháº©m sá»­ dá»¥ng!`
            };
        }

        await prisma.category.delete({
            where: { id: parseInt(id) }
        });

        console.log('âœ… Category deleted:', id);
        void logActivity({ module: 'products', action: 'DELETE', description: `XÃ³a danh má»¥c #${id}` });
        return { success: true };
    } catch (error) {
        console.error('âŒ Error deleting category:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// PICKUP - QuÃ©t mÃ£ váº­n Ä‘Æ¡n
// ========================================

// In-memory state
let pickupTrackingData = [];  // { trackingNumber, source, file }
let pickupHistory = [];       // { trackingNumber, source, file, scannedAt }
let pickupDataFolder = '';
let pickupLogFile = '';

const HEADER_FILTER_REGEX = /tracking|order|number|the |description|seller|sku|váº­n chuyá»ƒn/i;

function normalizeStr(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
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

        if (jsonData.length === 0) continue;

        // ðŸ” PhÃ¡t hiá»‡n nguá»“n (TikTok vs Shopee)
        const firstRow = jsonData[0] || {};
        const isTikTok = 'Order ID' in firstRow || 'Tracking ID' in firstRow;
        const isShopee = 'MÃ£ Ä‘Æ¡n hÃ ng' in firstRow || 'MÃ£ váº­n Ä‘Æ¡n' in firstRow;

        console.log(`[Pickup] Processing ${file}: TikTok=${isTikTok}, Shopee=${isShopee}`);

        if (isTikTok) {
            // ===== PARSE TIKTOK =====
            jsonData.forEach((row) => {
                const trackingId = normalizeStr(row['Tracking ID'] || '');
                const orderId = normalizeStr(row['Order ID'] || '');
                const productName = normalizeStr(row['Product Name'] || '');
                const variation = normalizeStr(row['Variation'] || '');
                const sku = normalizeStr(row['SKU'] || row['Sku'] || '');
                const quantity = parseInt(row['Quantity'] || row['Quantity of return'] || '1');
                const shippingProvider = normalizeStr(row['Shipping Provider Name'] || '');
                const orderRefundAmount = parseFloat(row['Order Refund Amount'] || row['Total Amount'] || '0');
                const unitPrice = parseFloat(row['SKU Unit Original Price'] || row['Product Price'] || '0');

                if (!trackingId || HEADER_FILTER_REGEX.test(trackingId)) return;

                combined.push({
                    trackingNumber: trackingId,
                    orderNumber: orderId,
                    source: 'TikTok',
                    file,
                    items: JSON.stringify([{
                        sku: sku,
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
            jsonData.forEach((row) => {
                const trackingId = normalizeStr(row['MÃ£ váº­n Ä‘Æ¡n'] || '');
                const orderId = normalizeStr(row['MÃ£ Ä‘Æ¡n hÃ ng'] || '');
                const productName = normalizeStr(row['TÃªn sáº£n pháº©m'] || row['TÃªn Sáº£n Pháº©m'] || '');
                const variation = normalizeStr(row['TÃªn phÃ¢n loáº¡i hÃ ng'] || row['PhÃ¢n loáº¡i hÃ ng'] || '');
                const sku = normalizeStr(row['MÃ£ phÃ¢n loáº¡i hÃ ng'] || row['SKU phÃ¢n loáº¡i hÃ ng'] || '');
                const quantity = parseInt(row['Sá»‘ lÆ°á»£ng'] || '1');
                const shippingProvider = normalizeStr(row['ÄÆ¡n Vá»‹ Váº­n Chuyá»ƒn'] || '');
                const totalAmount = parseFloat(row['Tá»•ng giÃ¡ bÃ¡n (sáº£n pháº©m)'] || row['Tá»•ng cá»™ng'] || '0');
                const unitPrice = parseFloat(row['GiÃ¡ gá»‘c'] || row['ÄÆ¡n giÃ¡'] || '0');

                if (!trackingId || HEADER_FILTER_REGEX.test(trackingId)) return;

                combined.push({
                    trackingNumber: trackingId,
                    orderNumber: orderId,
                    source: 'Shopee',
                    file,
                    items: JSON.stringify([{
                        sku: sku,
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
            trackingNumber: normalizeStr(row['MÃ£ váº­n Ä‘Æ¡n'] || ''),
            orderNumber: normalizeStr(row['Order ID'] || ''),
            source: normalizeStr(row['Nguá»“n'] || row['Cá»™t nguá»“n'] || ''),
            file: normalizeStr(row['File'] || ''),
            scannedAt: normalizeStr(row['Thá»i gian quÃ©t'] || ''),
            items: normalizeStr(row['Items'] || '[]'),
            shippingProvider: normalizeStr(row['Shipping Provider'] || ''),
            totalAmount: parseFloat(row['Tá»•ng tiá»n'] || '0'),
            status: normalizeStr(row['Tráº¡ng thÃ¡i'] || 'scanned'),
        }));
    } catch (e) {
        console.error('[Pickup] Error reading pickup log:', e.message);
        return [];
    }
}

function savePickupLog(logFilePath, history) {
    const wsData = history.map(item => ({
        'MÃ£ váº­n Ä‘Æ¡n': item.trackingNumber,
        'Order ID': item.orderNumber || '',
        'Nguá»“n': item.source,
        'File': item.file,
        'Thá»i gian quÃ©t': item.scannedAt,
        'Items': item.items || '[]',
        'Shipping Provider': item.shippingProvider || '',
        'Tá»•ng tiá»n': item.totalAmount || 0,
        'Tráº¡ng thÃ¡i': item.status || 'scanned',
    }));
    const ws = XLSX.utils.json_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pickup');
    XLSX.writeFile(wb, logFilePath);
}

// Chá»n thÆ° má»¥c
ipcMain.handle('pickup:selectFolder', async () => {
    try {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Chá»n thÆ° má»¥c chá»©a file Ä‘Æ¡n hÃ ng',
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: 'KhÃ´ng cÃ³ thÆ° má»¥c Ä‘Æ°á»£c chá»n' };
        }
        return { success: true, data: result.filePaths[0] };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Táº£i dá»¯ liá»‡u tá»« thÆ° má»¥c
ipcMain.handle('pickup:loadData', async (event, folderPath) => {
    try {
        if (!folderPath || !fs.existsSync(folderPath)) {
            return { success: false, error: 'ThÆ° má»¥c khÃ´ng tá»“n táº¡i' };
        }

        pickupDataFolder = folderPath;
        pickupLogFile = path.join(folderPath, 'Pickup.xlsx');

        const { data, fileCount } = extractTrackingNumbers(folderPath);
        pickupTrackingData = data;
        pickupHistory = loadPickupLog(pickupLogFile);

        const shopeeCount = data.filter(d => d.source === 'G').length;
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

// QuÃ©t mÃ£ váº­n Ä‘Æ¡n
ipcMain.handle('pickup:scan', async (event, trackingNumber) => {
    try {
        const trimmed = normalizeStr(trackingNumber);
        if (!trimmed) {
            return { success: false, error: 'Vui lÃ²ng nháº­p mÃ£ váº­n Ä‘Æ¡n', errorType: 'empty' };
        }

        if (pickupTrackingData.length === 0) {
            return { success: false, error: 'ChÆ°a cÃ³ dá»¯ liá»‡u. Vui lÃ²ng chá»n thÆ° má»¥c vÃ  táº£i dá»¯ liá»‡u', errorType: 'no_data' };
        }

        // Kiá»ƒm tra Ä‘Ã£ quÃ©t chÆ°a
        const alreadyScanned = pickupHistory.some(h => h.trackingNumber === trimmed);
        if (alreadyScanned) {
            return { success: false, error: `MÃ£ ${trimmed} Ä‘Ã£ pickup rá»“i!`, errorType: 'duplicate' };
        }

        // TÃ¬m kiáº¿m
        const matches = pickupTrackingData.filter(d => d.trackingNumber === trimmed);
        if (matches.length === 0) {
            return { success: false, error: `KhÃ´ng tÃ¬m tháº¥y: ${trimmed}`, errorType: 'not_found' };
        }

        // Æ¯u tiÃªn Shopee
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

        // LÆ°u vÃ o Pickup.xlsx
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

// Láº¥y lá»‹ch sá»­ quÃ©t
ipcMain.handle('pickup:getHistory', async (event, limit = 10) => {
    try {
        const recent = [...pickupHistory].reverse().slice(0, limit);
        return { success: true, data: recent };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Láº¥y thá»‘ng kÃª
ipcMain.handle('pickup:getStats', async () => {
    try {
        const shopeeCount = pickupTrackingData.filter(d => d.source === 'G').length;
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

// Gá»­i thÃ´ng bÃ¡o Telegram
ipcMain.handle('pickup:sendTelegram', async (event, { token, chatId, message }) => {
    try {
        if (!token || !chatId || !message) {
            return { success: false, error: 'Thiáº¿u thÃ´ng tin Telegram' };
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

// Xuáº¥t file Pickup
ipcMain.handle('pickup:exportPickup', async () => {
    try {
        const result = await dialog.showSaveDialog({
            title: 'Xuáº¥t file Pickup',
            defaultPath: `Pickup_${new Date().toISOString().slice(0, 10)}.xlsx`,
            filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        });

        if (result.canceled || !result.filePath) {
            return { success: false, error: 'ÄÃ£ há»§y xuáº¥t file' };
        }

        savePickupLog(result.filePath, pickupHistory);
        return { success: true, data: result.filePath };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ========================================
// PICKUP - AUTO WATCH THÆ¯ Má»¤C
// ========================================

let pickupWatcher = null;
let pickupWatchFolder = '';
let pickupKnownFiles = new Set();

// Chá»n thÆ° má»¥c + báº¯t Ä‘áº§u theo dÃµi
ipcMain.handle('pickup:selectAndWatch', async () => {
    try {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Chá»n thÆ° má»¥c chá»©a file Ä‘Æ¡n hÃ ng (sáº½ tá»± Ä‘á»™ng import)',
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: 'KhÃ´ng cÃ³ thÆ° má»¥c Ä‘Æ°á»£c chá»n' };
        }

        const folderPath = result.filePaths[0];

        // Láº¥y danh sÃ¡ch file hiá»‡n cÃ³
        const existingFiles = fs.readdirSync(folderPath).filter(f => {
            const ext = path.extname(f).toLowerCase();
            return ['.xlsx', '.xls', '.csv'].includes(ext) && !f.startsWith('~$');
        });

        pickupKnownFiles = new Set(existingFiles);
        pickupWatchFolder = folderPath;

        // Dá»«ng watcher cÅ© náº¿u cÃ³
        if (pickupWatcher) {
            pickupWatcher.close();
            pickupWatcher = null;
        }

        // Báº¯t Ä‘áº§u theo dÃµi thÆ° má»¥c
        let debounceTimer = null;
        pickupWatcher = fs.watch(folderPath, (eventType, filename) => {
            if (!filename) return;
            const ext = path.extname(filename).toLowerCase();
            if (!['.xlsx', '.xls', '.csv'].includes(ext)) return;
            if (filename.startsWith('~$')) return; // File táº¡m Excel

            // Debounce 2 giÃ¢y (file cÃ³ thá»ƒ Ä‘ang copy)
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const filePath = path.join(folderPath, filename);

                // Chá»‰ xá»­ lÃ½ file Má»šI (chÆ°a cÃ³ trong danh sÃ¡ch)
                if (!pickupKnownFiles.has(filename) && fs.existsSync(filePath)) {
                    console.log(`ðŸ“ [AutoWatch] File má»›i: ${filename}`);
                    pickupKnownFiles.add(filename);

                    // Äá»c file vÃ  gá»­i vá» frontend
                    try {
                        const fileBuffer = fs.readFileSync(filePath);
                        const base64 = fileBuffer.toString('base64');

                        // Gá»­i event vá» táº¥t cáº£ cá»­a sá»•
                        const { BrowserWindow } = require('electron');
                        const windows = BrowserWindow.getAllWindows();
                        for (const win of windows) {
                            win.webContents.send('pickup:newFile', {
                                name: filename,
                                base64: base64,
                                path: filePath
                            });
                        }
                        console.log(`âœ… [AutoWatch] ÄÃ£ gá»­i ${filename} vá» frontend`);
                    } catch (readErr) {
                        console.error(`âŒ [AutoWatch] Lá»—i Ä‘á»c file ${filename}:`, readErr.message);
                    }
                }
            }, 2000);
        });

        console.log(`ðŸ‘ï¸ [AutoWatch] Äang theo dÃµi: ${folderPath} (${existingFiles.length} file cÃ³ sáºµn)`);

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

// Dá»«ng theo dÃµi
ipcMain.handle('pickup:stopWatch', async () => {
    if (pickupWatcher) {
        pickupWatcher.close();
        pickupWatcher = null;
        pickupWatchFolder = '';
        pickupKnownFiles.clear();
        console.log('ðŸ›‘ [AutoWatch] ÄÃ£ dá»«ng theo dÃµi');
        return { success: true };
    }
    return { success: false, error: 'KhÃ´ng cÃ³ watcher nÃ o Ä‘ang cháº¡y' };
});

// Äá»c táº¥t cáº£ file Excel trong thÆ° má»¥c (tráº£ vá» base64, khÃ´ng má»Ÿ dialog)
ipcMain.handle('pickup:readFolderFiles', async (event, folderPath) => {
    try {
        if (!folderPath || !fs.existsSync(folderPath)) {
            return { success: false, error: 'ThÆ° má»¥c khÃ´ng tá»“n táº¡i' };
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
                console.warn(`âš ï¸ KhÃ´ng Ä‘á»c Ä‘Æ°á»£c ${filename}:`, e.message);
            }
        }

        console.log(`ðŸ“‚ [ReadFolder] Äá»c ${files.length}/${excelFiles.length} files tá»« ${folderPath}`);
        return { success: true, data: files };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Báº¯t Ä‘áº§u theo dÃµi trá»±c tiáº¿p (khÃ´ng dialog â€” dÃ¹ng khi auto-restore)
ipcMain.handle('pickup:startWatch', async (event, folderPath) => {
    try {
        if (!folderPath || !fs.existsSync(folderPath)) {
            return { success: false, error: 'ThÆ° má»¥c khÃ´ng tá»“n táº¡i' };
        }

        // Láº¥y danh sÃ¡ch file hiá»‡n cÃ³
        const existingFiles = fs.readdirSync(folderPath).filter(f => {
            const ext = path.extname(f).toLowerCase();
            return ['.xlsx', '.xls', '.csv'].includes(ext) && !f.startsWith('~$');
        });

        pickupKnownFiles = new Set(existingFiles);
        pickupWatchFolder = folderPath;

        // Dá»«ng watcher cÅ© náº¿u cÃ³
        if (pickupWatcher) {
            pickupWatcher.close();
            pickupWatcher = null;
        }

        // Báº¯t Ä‘áº§u theo dÃµi
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
                    console.log(`ðŸ“ [AutoWatch] File má»›i: ${filename}`);
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
                        console.log(`âœ… [AutoWatch] ÄÃ£ gá»­i ${filename} vá» frontend`);
                    } catch (readErr) {
                        console.error(`âŒ [AutoWatch] Lá»—i Ä‘á»c file ${filename}:`, readErr.message);
                    }
                }
            }, 2000);
        });

        console.log(`ðŸ‘ï¸ [AutoWatch-Restore] Äang theo dÃµi: ${folderPath} (${existingFiles.length} file cÃ³ sáºµn)`);

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

// Update stock khi export hoáº·c cÃ¢n báº±ng kho
ipcMain.handle('products:updateStock', async (event, { sku, quantity, isAdd = false, logContext = null, allowMissing = false }) => {
    try {
        requireRole('admin', 'manager', 'staff');
        console.log(`ðŸ“¦ Update stock: SKU=${sku}, Qty=${quantity}, Add=${isAdd}`);

        if (!prisma) {
            throw new Error('Database chÆ°a Ä‘Æ°á»£c khá»Ÿi táº¡o.');
        }

        const delta = isAdd ? quantity : -quantity;

        // Bá»c toÃ n bá»™ vÃ o 1 Transaction duy nháº¥t
        // ðŸ”’ StockMutex: serialize stock operations â€” trÃ¡nh race condition
        return await withStockLock(() => prisma.$transaction(async (tx) => {
            // ðŸŽ CHECK IF SKU IS A COMBO
            const combo = await tx.comboProduct.findUnique({
                where: { sku }
            });

            if (combo) {
                // â­ THIS IS A COMBO - Update stock for components
                const action = isAdd ? 'Adding' : 'Deducting';
                console.log(`ðŸŽ Detected COMBO (${action}): ${combo.name}`);
                const items = JSON.parse(combo.items || '[]');

                const updateResults = [];
                for (const item of items) {
                    const componentQty = item.quantity * quantity; // Qty per combo Ã— combos sold
                    const componentDelta = isAdd ? componentQty : -componentQty;
                    console.log(`  â†’ ${action} ${componentQty} ${isAdd ? 'to' : 'from'} ${item.sku}`);

                    const updateResult = await updateProductStockInTx(tx, item.sku, componentDelta, logContext, { allowMissing });
                    updateResults.push(updateResult);
                }

                console.log(`âœ… Combo ${sku}: ${action} ${quantity} combo(s)`);
                return { success: true, isCombo: true, deductResults: updateResults };
            }

            // Regular product/variant stock update
            const result = await updateProductStockInTx(tx, sku, delta, logContext, { allowMissing });
            if (result === false) {
                // allowMissing=true vÃ  khÃ´ng tÃ¬m tháº¥y SKU
                return { success: false, skipped: true, error: `SKU "${sku}" khÃ´ng tÃ¬m tháº¥y trong kho` };
            }
            return { success: true, data: result };
        }));
    } catch (error) {
        console.error('âŒ Update stock error:', error);
        return { success: false, error: error.message };
    }
});

/**
 * ðŸš€ BATCH OPTIMIZATION HELPERS â€” tá»‘i Æ°u import/delete hÃ ng loáº¡t
 */

/**
 * XÃ¢y cache SKU â†’ Product/Variant 1 láº§n duy nháº¥t cho cáº£ batch.
 * Thay vÃ¬ full table scan má»—i láº§n tÃ¬m variant, cache O(1) lookup.
 */
async function buildSkuCache(tx) {
    const allProducts = await tx.product.findMany();
    const allCombos = await tx.comboProduct.findMany();

    const productMap = new Map(); // sku â†’ { product, isVariant, variantIndex }
    const comboMap = new Map();   // sku â†’ { combo, items[] }

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
 * Batch stock update: gom táº¥t cáº£ SKU thay Ä‘á»•i â†’ nhÃ³m theo SKU â†’ 1 láº§n update/SKU.
 * @param {object} tx - Prisma transaction
 * @param {Array<{sku: string, quantity: number}>} skuChanges - Danh sÃ¡ch {sku, quantity} (quantity < 0 = trá»« kho)
 * @param {object} logContext - Context log cho inventory
 * @param {object} skuCache - Cache tá»« buildSkuCache()
 */
async function batchStockUpdate(tx, skuChanges, logContext, skuCache) {
    const { productMap, comboMap } = skuCache;

    // BÆ°á»›c 1: Resolve combo â†’ flat list of actual SKU changes
    const flatChanges = new Map(); // sku â†’ tá»•ng quantity
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

    // BÆ°á»›c 2: Lookup user ID 1 láº§n
    let createdById = null;
    if (logContext.createdBy) {
        if (typeof logContext.createdBy === 'string') {
            const user = await tx.user.findUnique({ where: { username: logContext.createdBy } });
            createdById = user ? user.id : null;
        } else if (typeof logContext.createdBy === 'number') {
            createdById = logContext.createdBy;
        }
    }

    // BÆ°á»›c 3: Update stock + create log cho má»—i SKU (Ä‘Ã£ gom)
    for (const [sku, totalQty] of flatChanges) {
        const info = productMap.get(sku);
        if (!info) {
            console.warn(`âš ï¸ [Batch] Bá» qua SKU ${sku} â€” khÃ´ng tÃ¬m tháº¥y sáº£n pháº©m`);
            continue;
        }

        const { product, isVariant, variantIndex } = info;
        let oldStock = 0, newStock = 0, variantColor = null;

        if (isVariant) {
            // âš ï¸ Äá»c variants Má»šI NHáº¤T tá»« cache (cÃ³ thá»ƒ Ä‘Ã£ bá»‹ update bá»Ÿi variant khÃ¡c cÃ¹ng product)
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
            // ðŸ”§ SYNC CACHE: cáº­p nháº­t product.variants trong cache
            // Ä‘á»ƒ variant khÃ¡c cÃ¹ng product Ä‘á»c Ä‘Ãºng data má»›i nháº¥t
            product.variants = updatedVariantsStr;
        } else {
            oldStock = product.stock || 0;
            const op = totalQty >= 0 ? { increment: totalQty } : { decrement: Math.abs(totalQty) };
            const updated = await tx.product.update({
                where: { id: product.id },
                data: { stock: op }
            });
            newStock = updated.stock;
            // ðŸ”§ SYNC CACHE cho non-variant
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
 * Deduct/restore stock cho 1 item â€” tá»± Ä‘á»™ng expand náº¿u lÃ  ComboProduct.
 * DÃ¹ng thay cho updateProductStockInTx khi xá»­ lÃ½ TMDT/POS items.
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
 * HÃ m lÃµi do AI Agent cáº­p nháº­t theo "Má»‡nh lá»‡nh tá»‘i cao":
 * Báº¯t buá»™c 100% cháº¡y trong Prisma Transaction, kÃ¨m logContext.
 */
async function updateProductStockInTx(tx, sku, quantity, logContext, options = {}) {
    if (!logContext || !logContext.type || !logContext.referenceType || !logContext.reference) {
        throw new Error(`[Inventory Error] Thiáº¿u logContext cho SKU: ${sku}. KhÃ´ng thá»ƒ cáº­p nháº­t kho mÃ  khÃ´ng cÃ³ lÃ½ do.`);
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
            console.warn(`âš ï¸ [Inventory Warning] Bá» qua trá»« kho - Sáº£n pháº©m vá»›i SKU ${sku} khÃ´ng tá»“n táº¡i.`);
            return false;
        }
        throw new Error(`Sáº£n pháº©m vá»›i SKU ${sku} khÃ´ng tá»“n táº¡i.`);
    }

    let oldStock = 0;
    let newStock = 0;
    let variantColor = null;

    if (isVariant) {
        let variants = JSON.parse(product.variants);
        const variantIndex = variants.findIndex(v => v.sku === sku);
        if (variantIndex < 0) throw new Error(`Variant ${sku} khÃ´ng tÃ¬m tháº¥y`);

        oldStock = variants[variantIndex].stock || 0;
        newStock = oldStock + quantity;
        variants[variantIndex].stock = newStock;
        variantColor = variants[variantIndex].color || variants[variantIndex].name || null;

        // LÆ°u biáº¿n thá»ƒ: Báº¯t buá»™c serialize xuá»‘ng JSON, phÃ³ thÃ¡c cho Transaction Sequential cá»§a SQLite
        await tx.product.update({
            where: { id: product.id },
            data: { variants: JSON.stringify(variants) }
        });
    } else {
        // [VÃ Lá»–I RACE CONDITION] DÃ¹ng cÆ¡ cháº¿ Atomic Increment cá»§a Database cho trÆ°á»ng Integer Native
        oldStock = product.stock || 0;
        const op = quantity >= 0 ? { increment: quantity } : { decrement: Math.abs(quantity) };
        const updatedProduct = await tx.product.update({
            where: { id: product.id },
            data: { stock: op }
        });
        newStock = updatedProduct.stock;
    }

    // Táº¡o báº£n ghi Tháº» kho Náº°M TRONG TRANSACTION
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
// POS ORDER - BÃN HÃ€NG Táº I QUáº¦Y
// ========================================

// Táº¡o Ä‘Æ¡n hÃ ng POS (thanh toÃ¡n)
ipcMain.handle('posOrder:create', async (event, data) => {
    try {
        if (!prisma) throw new Error('Database chÆ°a Ä‘Æ°á»£c khá»Ÿi táº¡o.');
        console.log('ðŸ’° [POS] Creating order...', JSON.stringify(data, null, 2));

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
                console.log('  âš ï¸ Could not find user:', data.userName);
            }
        }

        const paidAmount = data.paidAmount || 0;
        const paymentStatus = paidAmount >= total ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

        // ðŸ”’ StockMutex: serialize stock operations â€” trÃ¡nh race condition Tháº» Kho
        const order = await withStockLock(() => prisma.$transaction(async (tx) => {
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
                    throw new Error(`Kho lá»—i SKU ${item.sku}: ${stockErr.message}`);
                }
            }

            return newOrder;
        }));

        // 5. Activity Log
        try {
            await prisma.activityLog.create({
                data: {
                    module: 'sales',
                    action: 'CREATE',
                    description: `BÃ¡n hÃ ng POS: ${orderNumber} - ${items.length} SP - ${new Intl.NumberFormat('vi-VN').format(total)}Ä‘ (${data.paymentMethod || 'cash'})`,
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
            console.error('  âš ï¸ Activity log failed:', logErr.message);
        }

        console.log(`âœ… [POS] Order created: ${orderNumber}, Total: ${total}`);
        return { success: true, data: { ...order, orderNumber } };
    } catch (error) {
        console.error('âŒ [POS] Create order error:', error.message);
        return { success: false, error: error.message };
    }
});

// Láº¥y danh sÃ¡ch Ä‘Æ¡n hÃ ng POS
ipcMain.handle('posOrder:getAll', async (event, filters = {}) => {
    try {
        if (!prisma) throw new Error('Database chÆ°a Ä‘Æ°á»£c khá»Ÿi táº¡o.');

        const where = { source: 'pos' };

        // Máº·c Ä‘á»‹nh áº©n Ä‘Æ¡n Ä‘Ã£ há»§y â€” trá»« khi explicitly yÃªu cáº§u status cá»¥ thá»ƒ
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

        const orders = await prisma.order.findMany({
            where,
            include: {
                items: true,
                payments: true,
                customer: true,
                user: { select: { username: true, fullName: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: filters.limit || 200,
        });

        // Map userName from user relation for frontend
        const ordersWithUser = orders.map(o => ({
            ...o,
            userName: o.user?.username || o.user?.fullName || null,
        }));

        console.log(`âœ… [POS] Loaded ${orders.length} POS orders`);
        return { success: true, data: ordersWithUser };
    } catch (error) {
        console.error('âŒ [POS] Get orders error:', error.message);
        return { success: false, error: error.message };
    }
});

// Xem chi tiáº¿t Ä‘Æ¡n hÃ ng POS
ipcMain.handle('posOrder:getById', async (event, id) => {
    try {
        if (!prisma) throw new Error('Database chÆ°a Ä‘Æ°á»£c khá»Ÿi táº¡o.');
        const order = await prisma.order.findUnique({
            where: { id },
            include: { items: true, payments: true, customer: true },
        });
        return { success: true, data: order };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Sá»­a Ä‘Æ¡n hÃ ng POS (note, discount, items)
ipcMain.handle('posOrder:update', async (event, { id, note, discount, items, paymentMethod, userName }) => {
    try {
        if (!prisma) throw new Error('Database chÆ°a Ä‘Æ°á»£c khá»Ÿi táº¡o.');

        // Láº¥y Ä‘Æ¡n cÅ©
        const oldOrder = await prisma.order.findUnique({
            where: { id },
            include: { items: true },
        });
        if (!oldOrder) throw new Error('KhÃ´ng tÃ¬m tháº¥y Ä‘Æ¡n hÃ ng.');
        if (oldOrder.status === 'cancelled') throw new Error('ÄÆ¡n hÃ ng Ä‘Ã£ há»§y, khÃ´ng thá»ƒ sá»­a.');

        // TÃ­nh láº¡i tá»•ng tiá»n
        const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
        const disc = discount ?? 0;
        const total = subtotal - disc;
        const totalCost = items.reduce((s, it) => s + (it.cost || 0) * it.qty, 0);
        const profit = total - totalCost;

        // ðŸ”’ StockMutex: serialize stock operations â€” trÃ¡nh race condition Tháº» Kho
        await withStockLock(() => prisma.$transaction(async (tx) => {
            // 1. HoÃ n láº¡i kho theo items cÅ©
            for (const oldItem of oldOrder.items) {
                await updateProductStockInTx(tx, oldItem.sku, oldItem.quantity, {
                    type: 'adjustment',
                    referenceType: 'POS_EDIT',
                    reference: oldOrder.orderNumber,
                    note: `Hoàn tồn (sửa đơn POS #${oldOrder.orderNumber})`,
                    createdBy: userName || 'System'
                });
            }

            // 2. Cáº­p nháº­t order
            await tx.order.update({
                where: { id },
                data: { note: note ?? null, discount: disc, subtotal, total, profit, paymentMethod: paymentMethod || oldOrder.paymentMethod },
            });

            // 3. XÃ³a items cÅ©, thÃªm items má»›i
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

                // 4. Trá»« kho theo items má»›i
                await updateProductStockInTx(tx, it.sku, -it.qty, {
                    type: 'pos_sale',
                    referenceType: 'POS_EDIT',
                    reference: oldOrder.orderNumber,
                    note: `Trừ tồn mới (sửa đơn POS #${oldOrder.orderNumber})`,
                    createdBy: userName || 'System'
                });
            }

            // 5. Cáº­p nháº­t payment
            await tx.payment.updateMany({
                where: { orderId: id },
                data: { method: paymentMethod || oldOrder.paymentMethod, amount: total },
            });
        }));

        void logActivity({ module: 'sales', action: 'UPDATE', description: `Sá»­a Ä‘Æ¡n POS #${oldOrder.orderNumber}`, userName: userName || 'System' });
        return { success: true };
    } catch (error) {
        console.error('âŒ [POS] Update order error:', error.message);
        return { success: false, error: error.message };
    }
});

// XÃ³a Ä‘Æ¡n hÃ ng POS (hoÃ n kho) - KHÃ”NG XÃ“A Cá»¨NG (Soft Cancel)
ipcMain.handle('posOrder:delete', async (event, { id, userName }) => {
    console.log(`ðŸ—‘ï¸ [DELETE] posOrder:delete called, id=${id}, type=${typeof id}`);
    try {
        if (!prisma) throw new Error('Database chÆ°a Ä‘Æ°á»£c khá»Ÿi táº¡o.');

        const order = await prisma.order.findUnique({
            where: { id },
            include: { items: true },
        });
        console.log(`ðŸ—‘ï¸ [DELETE] order found:`, order ? `#${order.orderNumber} status=${order.status} items=${order.items.length}` : 'NOT FOUND');
        if (!order) throw new Error('KhÃ´ng tÃ¬m tháº¥y Ä‘Æ¡n hÃ ng.');
        if (order.status === 'cancelled') return { success: true };

        // ðŸ”’ StockMutex: serialize stock operations â€” trÃ¡nh race condition Tháº» Kho
        await withStockLock(() => prisma.$transaction(async (tx) => {
            // HoÃ n kho â€” dÃ¹ng deductItemOrCombo Ä‘á»ƒ xá»­ lÃ½ cáº£ combo SKU
            const logCtx = {
                type: 'adjustment',
                referenceType: 'POS_CANCEL',
                reference: order.orderNumber,
                note: `Hoàn tồn do hủy đơn POS ${order.orderNumber}`,
                createdBy: userName || 'System'
            };
            for (const item of order.items) {
                // +quantity = cá»™ng láº¡i kho (vÃ¬ Ä‘ang há»§y Ä‘Æ¡n bÃ¡n)
                await deductItemOrCombo(tx, item.sku, item.quantity, logCtx, { allowMissing: true });
            }
            // Cáº­p nháº­t tráº¡ng thÃ¡i phiáº¿u thay vÃ¬ xÃ³a cá»©ng
            await tx.order.update({ where: { id }, data: { status: 'cancelled' } });

            // XÃ³a payment liÃªn quan náº¿u cáº§n thiáº¿t hoáº·c Ä‘Ã¡nh dáº¥u há»§y (táº¡m comment delete payment)
            // await tx.payment.deleteMany({ where: { orderId: id } });
        }));

        void logActivity({ module: 'sales', action: 'DELETE', description: `Há»§y Ä‘Æ¡n POS #${order.orderNumber}`, userName: userName || 'System' });
        return { success: true };
    } catch (error) {
        console.error('âŒ [POS] Cancel order error:', error.message);
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
        console.error('âŒ Get activity logs error:', error);
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

        console.log(`âœ… Created activity log: ${data.description}`);
        return { success: true, data: log };
    } catch (error) {
        console.error('âŒ Create activity log error:', error);
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
        console.error('âŒ Get record logs error:', error);
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
        console.error('âŒ Get activity stats error:', error);
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
            take: 100 // âš¡ Giáº£m tá»« 300 â†’ 100 phiáº¿u gáº§n nháº¥t
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
                color: item.color || null, // ðŸŽ¨ Äá»c tá»« database
                variantSku: item.variantSku || null, // ðŸŽ¨ Äá»c tá»« database
                unit: item.product.unit || 'CÃ¡i' // ThÃªm unit
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
                // HÄ VAT
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
                // Phiáº¿u nháº­p kho
                importReceiptStatus: p.importReceiptStatus,
                importReceiptFile: p.importReceiptFile,
                importReceiptDriveUrl: p.importReceiptDriveUrl,
            };
        });

        return { success: true, data: formatted };
    } catch (error) {
        console.error('âŒ Get purchases error:', error);
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
        console.error('âŒ Create VAT group error:', error);
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
                console.error(`âš ï¸ Drive upload group VAT failed for file ${i + 1}:`, driveErr.message);
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
            ? 'âš ï¸ File nhóm đã lưu local + Telegram, nhưng Google Drive upload thất bại. Kiểm tra lại Google Drive.'
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
        console.error('âŒ Upload group VAT invoice error:', error);
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
        console.error('âŒ Remove VAT group error:', error);
        return { success: false, error: error.message };
    }
});

// Create purchase
ipcMain.handle('purchases:create', async (event, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        console.log('ðŸ“¦ Creating purchase order with data:', data);

        // Parse items and validate productIds
        const items = JSON.parse(data.items);
        console.log('ðŸ“¦ Items to create:', items);

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
        // ðŸ”’ StockMutex: serialize stock operations â€” trÃ¡nh race condition Tháº» Kho
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
                    vatInvoiceStatus: data.isThht ? 'thht' : (data.isNoVat ? 'no_vat' : 'pending'), // ðŸ“¦ THHT / KhÃ´ng VAT flag
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

            // ðŸŒŸ Láº¥y map Product SKU Ä‘á»ƒ cáº­p nháº­t tá»“n
            const purchaseProducts = await tx.product.findMany({
                where: { id: { in: productIds } }
            });
            const productMap = new Map(purchaseProducts.map(p => [p.id, p]));

            for (const item of items) {
                const product = productMap.get(item.productId);
                if (!product) continue;

                const skuToUpdate = item.variantSku || product.sku;
                if (!skuToUpdate) continue;

                // ðŸŒŸ Gá»i hÃ m Má»‡nh lá»‡nh tá»‘i cao Ä‘á»ƒ tÄƒng tá»“n kho an toÃ n & sinh tháº» kho
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

        console.log(`âœ… Created purchase order: ${purchase.poNumber}`);
        void logActivity({ module: 'purchases', action: 'CREATE', description: `Táº¡o phiáº¿u nháº­p ${purchase.poNumber} - ${new Intl.NumberFormat('vi-VN').format(data.totalAmount)}Ä‘`, recordName: purchase.poNumber, userName: data.createdBy || 'Admin' });

        return { success: true, data: purchase };
    } catch (error) {
        console.error('âŒ Create purchase error:', error);
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
                } : {}), // ðŸ“¦ THHT / KhÃ´ng VAT
            }
        });

        console.log(`âœ… Updated purchase order: ${purchase.poNumber}`);
        void logActivity({ module: 'purchases', action: 'UPDATE', description: `Cáº­p nháº­t phiáº¿u nháº­p ${purchase.poNumber}`, recordName: purchase.poNumber });
        return { success: true, data: purchase };
    } catch (error) {
        console.error('âŒ Update purchase error:', error);
        return { success: false, error: error.message };
    }
});

// Delete purchase (Soft-delete & HoÃ n kho)
ipcMain.handle('purchases:delete', async (event, id) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        console.log(`ðŸ—‘ï¸  Soft-deleting purchase order #${id}...`);

        const order = await prisma.purchaseOrder.findUnique({
            where: { id },
            include: { items: true }
        });
        if (!order) throw new Error(`KhÃ´ng tÃ¬m tháº¥y phiáº¿u nháº­p #${id}`);
        if (order.status === 'cancelled') return { success: true };

        // ðŸ”’ StockMutex: serialize stock operations â€” trÃ¡nh race condition Tháº» Kho
        await withStockLock(() => getPrismaDirectTx().$transaction(async (tx) => {
            const productIds = [...new Set(order.items.map(i => i.productId))];
            const products = await tx.product.findMany({
                where: { id: { in: productIds } }
            });
            const productMap = new Map(products.map(p => [p.id, p]));

            // 1. HoÃ n lÆ°á»£ng tá»“n kho Ä‘Ã£ nháº­p (Ã¢m quantity) - ghi tháº» kho Reversal
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

            // 2. Chuyá»ƒn tráº¡ng thÃ¡i sang cancelled thay vÃ¬ xÃ³a váº­t lÃ½ khá»‘i item
            await tx.purchaseOrder.update({
                where: { id },
                data: { status: 'cancelled' }
            });
        }));

        console.log(`âœ… Successfully cancelled purchase order #${id}`);
        void logActivity({ module: 'purchases', action: 'DELETE', description: `Há»§y phiáº¿u nháº­p #${id}`, recordName: order.poNumber });
        return { success: true };
    } catch (error) {
        console.error('âŒ Delete purchase error:', error);
        console.error('   Error code:', error.code);
        console.error('   Error meta:', error.meta);
        return { success: false, error: error.message };
    }
});

// ========================================
// UPLOAD HÄ VAT NHÃ€ CUNG Cáº¤P
// Bot Telegram: tool HÄ cÅ© (8091...)
// Google Drive: folder LUUTRU-HOADONVAT
// Email: Nodemailer + Gmail OAuth2
// ========================================

// Config riÃªng cho module HÄ VAT nháº­p hÃ ng
const VAT_TELEGRAM_BOT = '***REDACTED_VAT_TELEGRAM_TOKEN***';
const VAT_TELEGRAM_CHAT = '1397184795';
const VAT_DRIVE_FOLDER_NAME = 'LUUTRU-HOADONVAT';
let vatDriveFolderId = null; // Cache folder ID

// TÃ¬m hoáº·c táº¡o folder LUUTRU-HOADONVAT trÃªn Drive
async function getOrCreateVatDriveFolder() {
    if (vatDriveFolderId) return vatDriveFolderId;
    const drive = getDriveClient();
    if (!drive) return null;

    try {
        // TÃ¬m folder Ä‘Ã£ tá»“n táº¡i
        const search = await drive.files.list({
            q: `name='${VAT_DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id)',
        });
        if (search.data.files && search.data.files.length > 0) {
            vatDriveFolderId = search.data.files[0].id;
            console.log(`ðŸ“ Found Drive folder ${VAT_DRIVE_FOLDER_NAME}: ${vatDriveFolderId}`);
            return vatDriveFolderId;
        }

        // Táº¡o má»›i
        const folder = await drive.files.create({
            requestBody: {
                name: VAT_DRIVE_FOLDER_NAME,
                mimeType: 'application/vnd.google-apps.folder',
            },
            fields: 'id',
        });
        vatDriveFolderId = folder.data.id;
        console.log(`ðŸ“ Created Drive folder ${VAT_DRIVE_FOLDER_NAME}: ${vatDriveFolderId}`);
        return vatDriveFolderId;
    } catch (err) {
        console.error('âŒ VAT Drive folder error:', err.message);
        if (err.response) {
            console.error('âŒ Drive API response:', err.response.status, JSON.stringify(err.response.data));
        }
        if (err.code) {
            console.error('âŒ Drive error code:', err.code);
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
            console.log(`ðŸ“ Found Drive folder ${IMPORT_RECEIPT_DRIVE_FOLDER_NAME}: ${importReceiptDriveFolderId}`);
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
        console.log(`ðŸ“ Created Drive folder ${IMPORT_RECEIPT_DRIVE_FOLDER_NAME}: ${importReceiptDriveFolderId}`);
        return importReceiptDriveFolderId;
    } catch (err) {
        console.error('âŒ Import Receipt Drive folder error:', err.message);
        return null;
    }
}

// Gá»­i Telegram báº±ng bot HÄ cÅ©
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

// Gá»­i file qua Telegram bot HÄ cÅ©
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

// Gá»­i email thÃ´ng bÃ¡o HÄ VAT qua Gmail (Nodemailer + OAuth2)
async function sendVatEmail(invoiceData) {
    try {
        const nodemailer = require('nodemailer');
        const tokenPath = path.join(__dirname, 'gdrive-token.json');
        if (!fs.existsSync(tokenPath)) {
            console.warn('âš ï¸ No OAuth2 token â€” skip email');
            return { success: false };
        }
        const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
        const oauth2Client = new google.auth.OAuth2(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
        oauth2Client.setCredentials(tokens);

        // Láº¥y access token má»›i
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
            from: '"Há»‡ thá»‘ng Quáº£n lÃ½" <yendao444@gmail.com>',
            to: 'yendao444@gmail.com',
            subject: `ðŸ§¾ HÄ VAT má»›i: ${invoiceData.invoiceNumber} â€” ${invoiceData.supplierName}`,
            html: `
                <h2>ðŸ§¾ HÃ³a Ä‘Æ¡n VAT nhÃ  cung cáº¥p</h2>
                <table style="border-collapse:collapse; font-size:14px;">
                    <tr><td style="padding:6px 12px;"><b>ðŸ“‹ Phiáº¿u nháº­p:</b></td><td>#${invoiceData.purchaseId}</td></tr>
                    <tr><td style="padding:6px 12px;"><b>ðŸ¢ NCC:</b></td><td>${invoiceData.supplierName}</td></tr>
                    <tr><td style="padding:6px 12px;"><b>ðŸ”¢ Sá»‘ HÄ:</b></td><td>${invoiceData.invoiceNumber}</td></tr>
                    <tr><td style="padding:6px 12px;"><b>ðŸ“… NgÃ y:</b></td><td>${invoiceData.invoiceDate}</td></tr>
                    <tr><td style="padding:6px 12px;"><b>ðŸ’° Tá»•ng tiá»n:</b></td><td>${invoiceData.totalAmount}</td></tr>
                    ${invoiceData.driveUrl ? `<tr><td style="padding:6px 12px;"><b>ðŸ“Ž Drive:</b></td><td><a href="${invoiceData.driveUrl}">Xem file</a></td></tr>` : ''}
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
        console.log('ðŸ“§ VAT email sent successfully');
        return { success: true };
    } catch (err) {
        console.error('âš ï¸ VAT email error (non-blocking):', err.message);
        return { success: false, error: err.message };
    }
}

ipcMain.handle('purchases:uploadVATInvoice', async (event, { purchaseId, invoiceNumber, invoiceDate, files = [], fileBase64, fileName }) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const vatFileMeta = await getPurchaseVatFileMeta();

        // 1. Láº¥y thÃ´ng tin phiáº¿u nháº­p
        const purchase = await prisma.purchaseOrder.findUnique({
            where: { id: purchaseId },
            include: { supplier: true },
        });
        if (!purchase) throw new Error(`KhÃ´ng tÃ¬m tháº¥y phiáº¿u nháº­p #${purchaseId}`);

        // Normalize: há»— trá»£ cáº£ nhiá»u file (files[]) vÃ  1 file (fileBase64/fileName)
        const filesList = files.length > 0 ? files : (fileBase64 ? [{ fileBase64, fileName }] : []);

        const userDataPath = app.getPath('userData');
        const vatDir = path.join(userDataPath, 'vat-invoices');
        if (!fs.existsSync(vatDir)) fs.mkdirSync(vatDir, { recursive: true });

        const localPaths = [];
        const driveUrls = [];
        const savedBuffers = [];
        const savedFileNames = [];
        let primaryVatMeta = null;

        // 2. LÆ°u tá»«ng file local + upload Drive
        for (let i = 0; i < filesList.length; i++) {
            const { fileBase64: b64, fileName: fn } = filesList[i];
            const ext = (fn || 'jpg').split('.').pop() || 'jpg';
            const suffix = filesList.length > 1 ? `_${i + 1}` : '';
            const localFileName = `VAT_PO${purchaseId}_${Date.now()}${suffix}.${ext}`;
            const localPath = path.join(vatDir, localFileName);

            const fileBuffer = Buffer.from(b64, 'base64');
            fs.writeFileSync(localPath, fileBuffer);
            console.log(`ðŸ“ Saved VAT invoice [${i + 1}/${filesList.length}]: ${localPath}`);
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

            // Upload lÃªn Google Drive
            try {
                const drive = getDriveClient();
                if (drive) {
                    const folderId = await getOrCreateVatDriveFolder();
                    if (folderId) {
                        const driveFileName = `HÄ_VAT_${purchase.supplier?.name || 'NCC'}_PO${purchaseId}_${invoiceNumber}${suffix}.${ext}`;
                        const result = await uploadToDrive(drive, folderId, driveFileName, fileBuffer, ext === 'pdf' ? 'application/pdf' : 'image/jpeg');
                        if (result) {
                            driveUrls.push(result.webViewLink);
                            console.log(`â˜ï¸ Uploaded to Drive [${i + 1}]: ${result.webViewLink}`);
                        } else {
                            console.error(`âš ï¸ Drive upload returned null for file ${i + 1}`);
                        }
                    } else {
                        console.error('âš ï¸ Drive folder creation failed - folderId is null');
                    }
                } else {
                    console.error('âš ï¸ Google Drive client not available (token missing or expired)');
                }
            } catch (driveErr) {
                console.error(`âš ï¸ Drive upload failed for file ${i + 1}:`, driveErr.message);
            }
        }

        if (primaryVatMeta) {
            vatFileMeta[String(purchaseId)] = primaryVatMeta;
            await savePurchaseVatFileMeta(vatFileMeta);
        }

        // 3. Cáº­p nháº­t DB
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

        // 5. Gá»­i Email (file Ä‘áº§u tiÃªn)
        if (savedBuffers.length > 0) {
            sendVatEmail({
                purchaseId,
                supplierName: purchase.supplier?.name || 'N/A',
                invoiceNumber,
                invoiceDate: new Date(invoiceDate).toLocaleDateString('vi-VN'),
                totalAmount: purchase.total.toLocaleString('vi-VN') + 'Ä‘',
                driveUrl: driveUrls[0] || null,
                fileBuffer: savedBuffers[0],
                fileName: savedFileNames[0],
            }).catch(err => console.error('Email error:', err));
        }

        void logActivity({
            module: 'purchases', action: 'VAT_UPLOAD',
            description: `Upload ${filesList.length} file HÄ VAT #${invoiceNumber} cho phiáº¿u nháº­p #${purchaseId} (${purchase.supplier?.name})`,
            userName: 'System',
        });

        const driveWarning = driveUrls.length === 0 && filesList.length > 0
            ? 'âš ï¸ File Ä‘Ã£ lÆ°u local + Telegram, nhÆ°ng Google Drive upload THáº¤T Báº I. Kiá»ƒm tra káº¿t ná»‘i Google Drive.'
            : null;
        if (driveWarning) console.warn(driveWarning);
        console.log(`âœ… VAT invoice uploaded for PO#${purchaseId}: ${invoiceNumber} (${filesList.length} files, Drive: ${driveUrls.length > 0 ? 'OK' : 'FAILED'})`);
        return { success: true, data: { localPaths, driveUrls, invoiceNumber, vatId: primaryVatMeta?.vatId || null }, driveWarning };
    } catch (error) {
        console.error('âŒ Upload VAT invoice error:', error);
        return { success: false, error: error.message };
    }
});

// Upload Phiáº¿u Nháº­p Kho
ipcMain.handle('purchases:uploadImportReceipt', async (event, { purchaseId, files = [], fileBase64, fileName }) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        // 1. Láº¥y thÃ´ng tin phiáº¿u nháº­p
        const purchase = await prisma.purchaseOrder.findUnique({
            where: { id: purchaseId },
            include: { supplier: true },
        });
        if (!purchase) throw new Error(`KhÃ´ng tÃ¬m tháº¥y phiáº¿u nháº­p #${purchaseId}`);

        // Normalize: há»— trá»£ cáº£ nhiá»u file (files[]) vÃ  1 file (fileBase64/fileName)
        const filesList = files.length > 0 ? files : (fileBase64 ? [{ fileBase64, fileName }] : []);

        const userDataPath = app.getPath('userData');
        const receiptDir = path.join(userDataPath, 'import-receipts');
        if (!fs.existsSync(receiptDir)) fs.mkdirSync(receiptDir, { recursive: true });

        const localPaths = [];
        const driveUrls = [];

        // 2. LÆ°u tá»«ng file local + upload Drive
        for (let i = 0; i < filesList.length; i++) {
            const { fileBase64: b64, fileName: fn } = filesList[i];
            const ext = (fn || 'jpg').split('.').pop() || 'jpg';
            const suffix = filesList.length > 1 ? `_${i + 1}` : '';
            const localFileName = `PN_PO${purchaseId}_${Date.now()}${suffix}.${ext}`;
            const localPath = path.join(receiptDir, localFileName);

            const fileBuffer = Buffer.from(b64, 'base64');
            fs.writeFileSync(localPath, fileBuffer);
            console.log(`ðŸ“ Saved Import Receipt [${i + 1}/${filesList.length}]: ${localPath}`);
            localPaths.push(localPath);

            // Upload lÃªn Google Drive
            try {
                const drive = getDriveClient();
                if (drive) {
                    const folderId = await getOrCreateImportReceiptDriveFolder(); // Separated folder
                    if (folderId) {
                        const driveFileName = `Phiáº¿u_Nháº­p_${purchase.supplier?.name || 'NCC'}_PO${purchaseId}${suffix}.${ext}`;
                        const result = await uploadToDrive(drive, folderId, driveFileName, fileBuffer, ext === 'pdf' ? 'application/pdf' : 'image/jpeg');
                        if (result) {
                            driveUrls.push(result.webViewLink);
                            console.log(`â˜ï¸ Uploaded Receipt to Drive [${i + 1}]: ${result.webViewLink}`);
                        }
                    }
                }
            } catch (driveErr) {
                console.error(`âš ï¸ Drive upload failed for Receipt file ${i + 1}:`, driveErr.message);
            }
        }

        // 3. Cáº­p nháº­t DB
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
            description: `Upload Phiáº¿u Nháº­p cá»§a phiáº¿u #${purchaseId} (${purchase.supplier?.name})`,
            userName: 'System',
        });

        return { success: true, data: { localPaths, driveUrls } };
    } catch (error) {
        console.error('âŒ Upload Import Receipt error:', error);
        return { success: false, error: error.message };
    }
});

// XÃ³a Phiáº¿u Nháº­p Kho
ipcMain.handle('purchases:deleteImportReceipt', async (event, purchaseId) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const purchase = await prisma.purchaseOrder.findUnique({
            where: { id: purchaseId },
            include: { supplier: true },
        });
        if (!purchase) throw new Error(`KhÃ´ng tÃ¬m tháº¥y phiáº¿u nháº­p #${purchaseId}`);

        // Chá»‰ cáº­p nháº­t DB Ä‘á»ƒ bá» mapping
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
            description: `XÃ³a Phiáº¿u Nháº­p cá»§a phiáº¿u #${purchaseId} (${purchase.supplier?.name})`,
            userName: 'System',
        });

        return { success: true };
    } catch (error) {
        console.error('âŒ Delete Import Receipt error:', error);
        return { success: false, error: error.message };
    }
});
// ÄÃ¡nh dáº¥u phiáº¿u nháº­p lÃ  "ÄÆ¡n THHT" (khÃ´ng cáº§n HÄ VAT)
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
            description: `${revert ? 'HoÃ n tÃ¡c' : 'ÄÃ¡nh dáº¥u'} phiáº¿u nháº­p #${purchaseId} lÃ  ÄÆ¡n THHT`,
            userName: 'System',
        });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ðŸ‘ï¸ Äá»c file HÄ VAT local â†’ tráº£ vá» base64 data URL Ä‘á»ƒ hiá»ƒn thá»‹ trong app
ipcMain.handle('purchases:getVATFileData', async (event, { purchaseId }) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const purchase = await prisma.purchaseOrder.findUnique({ where: { id: purchaseId } });
        if (!purchase || !purchase.vatInvoiceFile) {
            return { success: false, error: 'KhÃ´ng tÃ¬m tháº¥y file HÄ VAT' };
        }

        // vatInvoiceFile cÃ³ thá»ƒ lÃ  1 path hoáº·c JSON array nhiá»u paths
        let filePaths = [];
        try {
            filePaths = JSON.parse(purchase.vatInvoiceFile);
        } catch {
            filePaths = [purchase.vatInvoiceFile];
        }

        // Äá»c tá»«ng file â†’ tráº£ vá» array data URLs
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
            return { success: false, error: 'File khÃ´ng tá»“n táº¡i trÃªn mÃ¡y' };
        }

        return { success: true, data: filesData };
    } catch (error) {
        console.error('âŒ Get VAT file data error:', error);
        return { success: false, error: error.message };
    }
});

// ðŸ‘ï¸ Äá»c file Phiáº¿u Nháº­p Kho local â†’ tráº£ vá» base64 data URL Ä‘á»ƒ hiá»ƒn thá»‹ trong app
ipcMain.handle('purchases:getImportReceiptFileData', async (event, { purchaseId }) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const purchase = await prisma.purchaseOrder.findUnique({ where: { id: purchaseId } });
        if (!purchase || !purchase.importReceiptFile) {
            return { success: false, error: 'KhÃ´ng tÃ¬m tháº¥y file Phiáº¿u Nháº­p Kho' };
        }

        // importReceiptFile cÃ³ thá»ƒ lÃ  1 path hoáº·c JSON array nhiá»u paths
        let filePaths = [];
        try {
            filePaths = JSON.parse(purchase.importReceiptFile);
        } catch {
            filePaths = [purchase.importReceiptFile];
        }

        // Äá»c tá»«ng file â†’ tráº£ vá» array data URLs
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
            return { success: false, error: 'File khÃ´ng tá»“n táº¡i trÃªn mÃ¡y' };
        }

        return { success: true, data: filesData };
    } catch (error) {
        console.error('âŒ Get Import Receipt file data error:', error);
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
        console.error('âŒ Get suppliers error:', error);
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

        console.log(`âœ… Created supplier: ${supplier.name}`);
        void logActivity({ module: 'purchases', action: 'CREATE', description: `Táº¡o NCC "${supplier.name}"`, recordName: supplier.name });
        return { success: true, data: supplier };
    } catch (error) {
        console.error('âŒ Create supplier error:', error);
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

        console.log(`âœ… Updated supplier: ${supplier.name}`);
        void logActivity({ module: 'purchases', action: 'UPDATE', description: `Cáº­p nháº­t NCC "${supplier.name}"`, recordName: supplier.name });
        return { success: true, data: supplier };
    } catch (error) {
        console.error('âŒ Update supplier error:', error);
        return { success: false, error: error.message };
    }
});

// Delete supplier
ipcMain.handle('suppliers:delete', async (event, id) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        // Kiá»ƒm tra xem cÃ³ phiáº¿u nháº­p nÃ o Ä‘ang dÃ¹ng supplier nÃ y khÃ´ng
        const purchaseCount = await prisma.purchaseOrder.count({
            where: { supplierId: id }
        });

        if (purchaseCount > 0) {
            return {
                success: false,
                error: `KhÃ´ng thá»ƒ xÃ³a! NhÃ  cung cáº¥p nÃ y Ä‘ang Ä‘Æ°á»£c sá»­ dá»¥ng trong ${purchaseCount} phiáº¿u nháº­p.`
            };
        }

        await prisma.supplier.delete({
            where: { id }
        });

        console.log(`âœ… Deleted supplier #${id}`);
        void logActivity({ module: 'purchases', action: 'DELETE', description: `XÃ³a nhÃ  cung cáº¥p #${id}` });
        return { success: true };
    } catch (error) {
        console.error('âŒ Delete supplier error:', error);

        // Xá»­ lÃ½ lá»—i foreign key constraint
        if (error.code === 'P2003') {
            return { success: false, error: 'KhÃ´ng thá»ƒ xÃ³a! NhÃ  cung cáº¥p Ä‘ang Ä‘Æ°á»£c sá»­ dá»¥ng trong cÃ¡c phiáº¿u nháº­p.' };
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

        console.log('ðŸ“¤ Starting database export...');

        // Query all data from Prisma
        const [categories, products, suppliers, purchaseOrders, purchaseItems, customers, orders, orderItems, payments, users, expenses, inventoryLogs, activityLogs] = await Promise.all([
            prisma.category.findMany({ orderBy: { id: 'asc' } }),
            prisma.product.findMany({ orderBy: { id: 'asc' } }),
            prisma.supplier.findMany({ orderBy: { id: 'asc' } }),
            prisma.purchaseOrder.findMany({ orderBy: { id: 'asc' } }),
            prisma.purchaseItem.findMany({ orderBy: { id: 'asc' } }),
            prisma.customer.findMany({ orderBy: { id: 'asc' } }),
            prisma.order.findMany({ orderBy: { id: 'asc' } }),
            prisma.orderItem.findMany({ orderBy: { id: 'asc' } }),
            prisma.payment.findMany({ orderBy: { id: 'asc' } }),
            prisma.user.findMany({ orderBy: { id: 'asc' } }),
            prisma.expense.findMany({ orderBy: { id: 'asc' } }),
            prisma.inventoryLog.findMany({ orderBy: { id: 'desc' }, take: 1000 }),
            prisma.activityLog.findMany({ orderBy: { id: 'desc' }, take: 1000 })
        ]);

        console.log(`  âœ… Queried data: ${categories.length} categories, ${products.length} products, ${suppliers.length} suppliers`);

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
            title: 'LÆ°u file sao lÆ°u dá»¯ liá»‡u',
            defaultPath: `DataBackup_${new Date().toISOString().split('T')[0]}.xlsx`,
            filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
        });

        if (!filePath) {
            console.log('âŒ User cancelled save dialog');
            return { success: false, error: 'User cancelled' };
        }

        // Write file
        XLSX.writeFile(wb, filePath);
        console.log(`âœ… Database exported successfully to: ${filePath}`);

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
        console.error('âŒ Database export error:', error);
        return { success: false, error: error.message };
    }
});

// Import all database from Excel
ipcMain.handle('database:importAll', async () => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        console.log('ðŸ“¥ Starting database import...');

        // Show open dialog
        const { filePaths } = await dialog.showOpenDialog({
            title: 'Chá»n file sao lÆ°u Ä‘á»ƒ nháº­p',
            filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
            properties: ['openFile']
        });

        if (!filePaths || filePaths.length === 0) {
            console.log('âŒ User cancelled open dialog');
            return { success: false, error: 'No file selected' };
        }

        const filePath = filePaths[0];
        console.log(`ðŸ“‚ Reading file: ${filePath}`);

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

        console.log(`  âœ… Parsed data: ${categories.length} categories, ${products.length} products, ${suppliers.length} suppliers`);

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
                        unit: prod.unit || 'CÃ¡i',
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
                        unit: prod.unit || 'CÃ¡i',
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
                    console.warn(`âš ï¸  Skipping OrderItem ${item.id}: missing productId`);
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

            console.log('  âœ… Import stats:', stats);
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

        console.log(`âœ… Database imported successfully from: ${filePath}`);
        return { success: true, data: result };
    } catch (error) {
        console.error('âŒ Database import error:', error);
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
            return { success: false, error: 'NgÆ°á»i dÃ¹ng khÃ´ng tá»“n táº¡i' };
        }

        // Verify old password (bcrypt compare â€” há»— trá»£ cáº£ plaintext legacy)
        let passwordValid = false;
        if (user.password && user.password.startsWith('$2')) {
            passwordValid = await bcrypt.compare(oldPassword, user.password);
        } else {
            passwordValid = user.password === oldPassword;
        }
        if (!passwordValid) {
            return { success: false, error: 'Máº­t kháº©u hiá»‡n táº¡i khÃ´ng Ä‘Ãºng' };
        }

        // Hash new password before storing
        const hashedNew = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: userId },
            data: { password: hashedNew }
        });

        console.log(`âœ… Changed password for user: ${user.username}`);
        void logActivity({ module: 'users', action: 'UPDATE', description: `Äá»•i máº­t kháº©u: ${user.username}`, recordName: user.username, userName: user.username });
        return { success: true };
    } catch (error) {
        console.error('âŒ Change password error:', error);
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
            return { success: false, error: 'NgÆ°á»i dÃ¹ng khÃ´ng tá»“n táº¡i' };
        }

        // Update password
        await prisma.user.update({
            where: { id: userId },
            data: { password: newPassword }
        });

        console.log(`âœ… Reset password for user: ${user.username}`);
        return { success: true };
    } catch (error) {
        console.error('âŒ Reset password error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// BACKUP & RESTORE SYSTEM
// ========================================

const AdmZip = require('adm-zip');

// Backup toÃ n bá»™ folder desktop thÃ nh ZIP
ipcMain.handle('system:backup', async () => {
    try {
        console.log('ðŸ”„ Starting FULL system backup (including node_modules)...');

        // Sá»­ dá»¥ng thÆ° má»¥c backup máº·c Ä‘á»‹nh
        const backupDir = 'G:\\QUAN LY BAN HANG\\apps\\BACKUP';

        // Táº¡o thÆ° má»¥c backup náº¿u chÆ°a tá»“n táº¡i
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
            console.log('ðŸ“ Created backup directory:', backupDir);
        }

        console.log('ðŸ“‚ Backup directory:', backupDir);

        // ÄÆ°á»ng dáº«n folder cáº§n backup (toÃ n bá»™ desktop)
        const sourceFolder = path.join(__dirname, '..');
        console.log('ðŸ“ Source folder:', sourceFolder);

        // TÃªn file backup vá»›i format: BACKUP-MMDDYY-HHMMSS.zip
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const year = String(now.getFullYear()).slice(-2); // 2 chá»¯ sá»‘ cuá»‘i
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');

        const backupFileName = `BACKUP-${month}${day}${year}-${hours}${minutes}${seconds}.zip`;
        const backupFilePath = path.join(backupDir, backupFileName);

        console.log('ðŸ“¦ Creating ZIP file:', backupFilePath);
        console.log('âš ï¸  This will take several minutes due to large size...');

        // Sá»­ dá»¥ng AdmZip Ä‘á»ƒ backup
        const zip = new AdmZip();

        // Äáº¿m files Ä‘á»ƒ track progress
        let addedCount = 0;

        // HÃ m Ä‘á»‡ quy Ä‘á»ƒ thÃªm toÃ n bá»™ folder
        function addFolderToZip(folderPath, zipPath) {
            const items = fs.readdirSync(folderPath);

            for (const item of items) {
                const itemPath = path.join(folderPath, item);
                const itemZipPath = zipPath ? path.join(zipPath, item) : item;

                const stats = fs.statSync(itemPath);

                if (stats.isDirectory()) {
                    // ThÃªm folder Ä‘á»‡ quy
                    addFolderToZip(itemPath, itemZipPath);
                } else if (stats.isFile()) {
                    // ThÃªm file
                    zip.addLocalFile(itemPath, path.dirname(itemZipPath), path.basename(itemPath));
                    addedCount++;

                    if (addedCount % 1000 === 0) {
                        console.log(`   â³ Added ${addedCount} files...`);
                    }
                }
            }
        }

        console.log('ðŸ”„ Adding all files (this may take 2-5 minutes)...');

        // ThÃªm TOÃ€N Bá»˜ folder desktop
        addFolderToZip(sourceFolder, '');

        console.log(`âœ… Total files added: ${addedCount}`);
        console.log('ðŸ’¾ Writing ZIP file (this may take another 1-2 minutes)...');

        // LÆ°u file ZIP
        zip.writeZip(backupFilePath);

        // Láº¥y kÃ­ch thÆ°á»›c file
        const stats = fs.statSync(backupFilePath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

        console.log(`âœ… Backup completed: ${backupFilePath}`);
        console.log(`ðŸ“Š Size: ${sizeMB} MB (${stats.size} bytes)`);
        console.log(`ðŸ“ Files: ${addedCount}`);

        return {
            success: true,
            data: {
                path: backupFilePath,
                size: stats.size,
                filename: backupFileName
            }
        };
    } catch (error) {
        console.error('âŒ Backup error:', error);
        console.error('   Stack:', error.stack);
        return { success: false, error: error.message };
    }
});

// Láº¥y danh sÃ¡ch backups
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
            .sort((a, b) => b.createdAt - a.createdAt); // Má»›i nháº¥t á»Ÿ Ä‘áº§u

        console.log(`ðŸ“‚ Found ${files.length} backup files`);
        return { success: true, data: files };
    } catch (error) {
        console.error('âŒ List backups error:', error);
        return { success: false, error: error.message };
    }
});

// Restore tá»« backup (giáº£i nÃ©n ZIP)
ipcMain.handle('system:restore', async (event, backupPath) => {
    try {
        console.log('ðŸ”„ Starting restore from:', backupPath);

        if (!fs.existsSync(backupPath)) {
            return { success: false, error: 'File backup khÃ´ng tá»“n táº¡i!' };
        }

        // ThÆ° má»¥c restore
        const restoreDir = path.join(__dirname, '..');

        // Sá»­ dá»¥ng adm-zip Ä‘á»ƒ giáº£i nÃ©n
        const zip = new AdmZip(backupPath);

        // Táº¡o backup táº¡m cá»§a database trÆ°á»›c khi restore
        const dbPath = path.join(restoreDir, 'prisma', 'dev.db');
        const dbBackupPath = path.join(restoreDir, 'prisma', `dev.backup.${Date.now()}.db`);
        if (fs.existsSync(dbPath)) {
            fs.copyFileSync(dbPath, dbBackupPath);
            console.log(`ðŸ“¦ Created database backup: ${dbBackupPath}`);
        }

        // Extract táº¥t cáº£ files
        zip.extractAllTo(restoreDir, true); // true = overwrite

        console.log(`âœ… Restore completed to: ${restoreDir}`);

        return {
            success: true,
            data: {
                restoreDir,
                message: 'KhÃ´i phá»¥c thÃ nh cÃ´ng! Vui lÃ²ng khá»Ÿi Ä‘á»™ng láº¡i á»©ng dá»¥ng.'
            }
        };
    } catch (error) {
        console.error('âŒ Restore error:', error);
        return { success: false, error: error.message };
    }
});

// Inspect/Preview backup - Xem thÃ´ng tin chi tiáº¿t
ipcMain.handle('system:inspectBackup', async (event, backupPath) => {
    try {
        console.log('ðŸ” Inspecting backup:', backupPath);

        if (!fs.existsSync(backupPath)) {
            return { success: false, error: 'File backup khÃ´ng tá»“n táº¡i!' };
        }

        // Láº¥y thÃ´ng tin file
        const stats = fs.statSync(backupPath);
        const zip = new AdmZip(backupPath);
        const entries = zip.getEntries();

        // PhÃ¢n loáº¡i entries
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

        // Kiá»ƒm tra cÃ¡c folder quan trá»ng
        const hasSrc = entries.some(e => e.entryName.startsWith('src/'));
        const hasElectron = entries.some(e => e.entryName.startsWith('electron/'));
        const hasPrisma = entries.some(e => e.entryName.startsWith('prisma/'));
        const hasNodeModules = entries.some(e => e.entryName.startsWith('node_modules/'));
        const hasPackageJson = entries.some(e => e.entryName === 'package.json');

        // Top 10 files lá»›n nháº¥t
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

        console.log('âœ… Backup inspection complete');
        console.log(`   Files: ${info.totalFiles}, Folders: ${info.totalFolders}`);
        console.log(`   Size: ${info.fileSizeMB} MB (${info.compressionRatio}% compression)`);
        console.log(`   Valid: ${info.isValid}`);

        return { success: true, data: info };
    } catch (error) {
        console.error('âŒ Inspect backup error:', error);
        return { success: false, error: error.message };
    }
});

// Browse vÃ  chá»n file backup Ä‘á»ƒ restore
ipcMain.handle('system:browseAndRestore', async () => {
    try {
        console.log('ðŸ“‚ Opening file browser for backup selection...');

        // Cho user chá»n file ZIP
        const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            title: 'Chá»n file backup Ä‘á»ƒ khÃ´i phá»¥c',
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
        console.log('âœ… Selected file:', selectedFile);

        // Tráº£ vá» file path Ä‘á»ƒ UI xá»­ lÃ½ tiáº¿p
        return {
            success: true,
            data: {
                filePath: selectedFile,
                message: 'File Ä‘Ã£ Ä‘Æ°á»£c chá»n. Nháº¥n OK Ä‘á»ƒ tiáº¿p tá»¥c khÃ´i phá»¥c.'
            }
        };
    } catch (error) {
        console.error('âŒ Browse error:', error);
        return { success: false, error: error.message };
    }
});

// XÃ³a backup
ipcMain.handle('system:deleteBackup', async (event, backupPath) => {
    try {
        if (!fs.existsSync(backupPath)) {
            return { success: false, error: 'File backup khÃ´ng tá»“n táº¡i!' };
        }

        fs.unlinkSync(backupPath);
        console.log(`âœ… Deleted backup: ${backupPath}`);

        return { success: true };
    } catch (error) {
        console.error('âŒ Delete backup error:', error);
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

        void logActivity({ module: 'system', action: 'CREATE', description: `Táº¡o cÃ´ng viá»‡c "${task.title}"`, recordName: task.title, userName: taskData.assignee || 'ChÆ°a phÃ¢n cÃ´ng' });
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

        // Auto set completedAt khi status thay Ä‘á»•i
        if (updates.status === 'completed' && !updates.completedAt) {
            updateData.completedAt = new Date();
        } else if (updates.status === 'pending') {
            updateData.completedAt = null;
        }

        const task = await prisma.dailyTask.update({
            where: { id },
            data: updateData
        });

        void logActivity({ module: 'system', action: 'UPDATE', description: `Cáº­p nháº­t cÃ´ng viá»‡c #${id}`, recordId: id });
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

        void logActivity({ module: 'system', action: 'DELETE', description: `XÃ³a cÃ´ng viá»‡c #${id}` });
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

// Reset daily tasks - tá»± Ä‘á»™ng reset khi sang ngÃ y má»›i
ipcMain.handle('dailyTasks:resetDaily', async () => {
    try {
        if (!prisma) throw new Error('Database chÆ°a Ä‘Æ°á»£c khá»Ÿi táº¡o.');

        // Fix null assignee/verifier (tÆ°Æ¡ng thÃ­ch Prisma client cÅ©)
        await prisma.$executeRawUnsafe(`UPDATE "DailyTask" SET assignee = '' WHERE assignee IS NULL`);
        await prisma.$executeRawUnsafe(`UPDATE "DailyTask" SET verifier = '' WHERE verifier IS NULL`);

        // Láº¥y ngÃ y hÃ´m nay (theo timezone local)
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        // Kiá»ƒm tra ngÃ y reset cuá»‘i cÃ¹ng
        const lastResetConfig = await prisma.appConfig.findUnique({
            where: { key: 'dailyTasksLastResetDate' }
        });

        const lastResetDate = lastResetConfig ? JSON.parse(lastResetConfig.value) : null;

        if (lastResetDate === today) {
            // ÄÃ£ reset hÃ´m nay rá»“i
            return { success: true, data: { reset: false, message: 'ÄÃ£ reset hÃ´m nay rá»“i' } };
        }

        // Fix dá»¯ liá»‡u cÅ©: CÃ¡c task category='BÃ n giao' nhÆ°ng type='daily' â†’ sá»­a thÃ nh 'assignment'
        await prisma.dailyTask.updateMany({
            where: { category: 'BÃ n giao', type: 'daily' },
            data: { type: 'assignment' }
        });

        // Láº¥y danh sÃ¡ch task HÃ€NG NGÃ€Y Ä‘Ã£ completed Ä‘á»ƒ lÆ°u history trÆ°á»›c khi reset
        // BÃ n giao (type: 'assignment') KHÃ”NG reset - chá»‰ reset daily tasks
        const completedTasks = await prisma.dailyTask.findMany({
            where: { status: 'completed', type: 'daily' }
        });

        // LÆ°u vÃ o history trÆ°á»›c khi reset
        if (completedTasks.length > 0) {
            // Äá»c history cÅ©
            const historyConfig = await prisma.appConfig.findUnique({
                where: { key: 'dailyTasksHistory' }
            });
            const existingHistory = historyConfig ? JSON.parse(historyConfig.value) : [];

            // ThÃªm entry cho má»—i task Ä‘Ã£ hoÃ n thÃ nh
            const newEntries = completedTasks.map(task => ({
                taskId: task.id,
                taskTitle: task.title,
                category: task.category,
                assignee: task.assignee,
                verifier: task.verifier || '',
                action: 'daily_reset',
                timestamp: task.completedAt ? task.completedAt.toISOString() : lastResetDate || now.toISOString(),
                description: `âœ… ÄÃ£ hoÃ n thÃ nh: "${task.title}" (tá»± Ä‘á»™ng reset sang ngÃ y ${today})`
            }));

            const updatedHistory = [...newEntries, ...existingHistory].slice(0, 500); // Giá»¯ tá»‘i Ä‘a 500 entries

            await prisma.appConfig.upsert({
                where: { key: 'dailyTasksHistory' },
                update: { value: JSON.stringify(updatedHistory) },
                create: { key: 'dailyTasksHistory', value: JSON.stringify(updatedHistory) }
            });

            // Reset chá»‰ daily tasks completed vá» pending (khÃ´ng reset bÃ n giao)
            await prisma.dailyTask.updateMany({
                where: { status: 'completed', type: 'daily' },
                data: {
                    status: 'pending',
                    completedAt: null,
                    verifier: '',
                    assignee: ''  // XÃ³a ngÆ°á»i thá»±c hiá»‡n â†’ ai ráº£nh nháº­n viá»‡c láº¡i má»—i ngÃ y
                }
            });

            console.log(`âœ… [DAILY RESET] NgÃ y ${today}: Reset ${completedTasks.length} tasks completed â†’ pending`);
        }

        // Reset assignee cá»§a Táº¤T Cáº¢ daily tasks sang ngÃ y má»›i (ai ráº£nh nháº­n viá»‡c láº¡i)
        // BÃ n giao (assignment) KHÃ”NG reset assignee
        const resetAssigneeResult = await prisma.dailyTask.updateMany({
            where: { type: 'daily' },
            data: { assignee: '', verifier: '' }
        });
        console.log(`âœ… [DAILY RESET] ÄÃ£ xÃ³a assignee cá»§a ${resetAssigneeResult.count} daily tasks`);

        // Cáº­p nháº­t dueDate cá»§a chá»‰ DAILY tasks sang ngÃ y hÃ´m nay (giá»¯ nguyÃªn giá»)
        // Fix bug: task váº«n mang dueDate cÅ© â†’ calendar hiá»ƒn thá»‹ sai ngÃ y hoÃ n thÃ nh
        // BÃ n giao (assignment) giá»¯ nguyÃªn deadline riÃªng, khÃ´ng cáº­p nháº­t
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
        console.log(`âœ… [DAILY RESET] ÄÃ£ cáº­p nháº­t dueDate cá»§a ${allTasks.length} tasks sang ngÃ y ${today}`);

        // LÆ°u ngÃ y reset
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
                    ? `ÄÃ£ reset ${completedTasks.length} cÃ´ng viá»‡c sang ngÃ y má»›i`
                    : 'Sang ngÃ y má»›i, khÃ´ng cÃ³ cÃ´ng viá»‡c cáº§n reset'
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
        const products = await prisma.product.findMany();
        const combosWithStock = combos.map(combo => {
            const items = JSON.parse(combo.items || '[]');
            let availableStock = Infinity;
            let calculatedCost = 0;
            items.forEach(item => {
                const product = products.find(p => p.id === item.productId);
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
        void logActivity({ module: 'products', action: 'CREATE', description: `Táº¡o combo "${combo.name}" (SKU: ${combo.sku})`, recordName: combo.name });
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
        void logActivity({ module: 'products', action: 'UPDATE', description: `Cáº­p nháº­t combo "${combo.name}"`, recordName: combo.name });
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
        void logActivity({ module: 'products', action: 'DELETE', description: `XÃ³a combo #${id}` });
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

// KÃ­ch hoáº¡t dialog chá»n thÆ° má»¥c vÃ  tá»± Ä‘á»™ng start watcher
ipcMain.handle('ecommerceExport:selectAndWatch', async () => {
    try {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Chá»n thÆ° má»¥c theo dÃµi file Excel TMÄT (Realtime)',
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: 'KhÃ´ng cÃ³ thÆ° má»¥c Ä‘Æ°á»£c chá»n' };
        }

        const folderPath = result.filePaths[0];

        // Láº¥y danh sÃ¡ch file hiá»‡n cÃ³
        const existingFiles = fs.readdirSync(folderPath).filter(f => {
            const ext = path.extname(f).toLowerCase();
            return ['.xlsx', '.xls', '.csv'].includes(ext) && !f.startsWith('~$');
        });

        ecommerceExportKnownFiles = new Set(existingFiles);
        ecommerceExportWatchFolder = folderPath;

        // Dá»«ng watcher cÅ© náº¿u cÃ³
        if (ecommerceExportWatcher) {
            ecommerceExportWatcher.close();
            ecommerceExportWatcher = null;
        }

        // Báº¯t Ä‘áº§u theo dÃµi thÆ° má»¥c
        let debounceTimer = null;
        ecommerceExportWatcher = fs.watch(folderPath, (eventType, filename) => {
            if (!filename) return;
            const ext = path.extname(filename).toLowerCase();
            if (!['.xlsx', '.xls', '.csv'].includes(ext)) return;
            if (filename.startsWith('~$')) return; // File táº¡m Excel

            // Debounce 2 giÃ¢y (file cÃ³ thá»ƒ Ä‘ang copy)
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const filePath = path.join(folderPath, filename);

                // Chá»‰ xá»­ lÃ½ file Má»šI (chÆ°a cÃ³ trong danh sÃ¡ch)
                if (!ecommerceExportKnownFiles.has(filename) && fs.existsSync(filePath)) {
                    console.log(`ðŸ“ [TMDT Watcher] File má»›i: ${filename}`);
                    ecommerceExportKnownFiles.add(filename);

                    // Äá»c file vÃ  gá»­i vá» frontend
                    try {
                        const fileBuffer = fs.readFileSync(filePath);
                        const base64 = fileBuffer.toString('base64');

                        // Gá»­i event vá» táº¥t cáº£ cá»­a sá»•
                        const { BrowserWindow } = require('electron');
                        const windows = BrowserWindow.getAllWindows();
                        for (const win of windows) {
                            win.webContents.send('ecommerceExport:newFile', {
                                name: filename,
                                base64: base64,
                                path: filePath
                            });
                        }
                        console.log(`âœ… [TMDT Watcher] ÄÃ£ gá»­i ${filename} vá» frontend`);
                    } catch (readErr) {
                        console.error(`âŒ [TMDT Watcher] Lá»—i Ä‘á»c file ${filename}:`, readErr.message);
                    }
                }
            }, 2000);
        });

        console.log(`ðŸ‘ï¸ [TMDT Watcher] Äang theo dÃµi: ${folderPath} (${existingFiles.length} file cÃ³ sáºµn â€” chá»‰ watch file Má»šI)`);

        // âš¡ KHÃ”NG Ä‘á»c ná»™i dung file cÅ© â€” chÃºng Ä‘Ã£ tá»“n táº¡i trong DB hoáº·c user sáº½ import thá»§ cÃ´ng
        // Chá»‰ track tÃªn file Ä‘á»ƒ watcher biáº¿t Ä‘Ã¢u lÃ  file Má»šI
        return {
            success: true,
            data: {
                folderPath,
                existingFiles: existingFiles.length,
                existingFileList: [] // âš¡ Tráº£ rá»—ng â€” khÃ´ng load file cÅ©
            }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Báº¯t Ä‘áº§u theo dÃµi trá»±c tiáº¿p (khÃ´ng dialog â€” dÃ¹ng khi auto-restore)
ipcMain.handle('ecommerceExport:startWatch', async (event, folderPath) => {
    try {
        if (!folderPath || !fs.existsSync(folderPath)) {
            return { success: false, error: 'ThÆ° má»¥c khÃ´ng tá»“n táº¡i' };
        }

        // Láº¥y danh sÃ¡ch file hiá»‡n cÃ³ (CHá»ˆ Äá»‚ TRACK â€” khÃ´ng Ä‘á»c ná»™i dung)
        const existingFiles = fs.readdirSync(folderPath).filter(f => {
            const ext = path.extname(f).toLowerCase();
            return ['.xlsx', '.xls', '.csv'].includes(ext) && !f.startsWith('~$');
        });

        ecommerceExportKnownFiles = new Set(existingFiles);
        ecommerceExportWatchFolder = folderPath;

        // Dá»«ng watcher cÅ© náº¿u cÃ³
        if (ecommerceExportWatcher) {
            ecommerceExportWatcher.close();
            ecommerceExportWatcher = null;
        }

        // Báº¯t Ä‘áº§u theo dÃµi â€” CHá»ˆ phÃ¡t hiá»‡n file Má»šI
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
                    console.log(`ðŸ“ [TMDT Watcher] File má»›i: ${filename}`);
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
                        console.error(`âŒ [TMDT Watcher] Lá»—i Ä‘á»c file ${filename}:`, readErr.message);
                    }
                }
            }, 2000);
        });

        // âš¡ KHÃ”NG Äá»ŒC Ná»˜I DUNG FILE CÅ¨ â€” chÃºng Ä‘Ã£ Ä‘Æ°á»£c import trÆ°á»›c Ä‘Ã³
        // Chá»‰ tráº£ vá» sá»‘ lÆ°á»£ng file Ä‘Ã£ biáº¿t (Ä‘á»ƒ UI hiá»ƒn thá»‹)
        console.log(`ðŸ‘ï¸ [TMDT Watcher] ÄÃ£ khÃ´i phá»¥c session theo dÃµi: ${folderPath} (${existingFiles.length} file Ä‘Ã£ cÃ³)`);

        return {
            success: true,
            data: { folderPath, existingFiles: existingFiles.length, existingFileList: [] }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Dá»«ng theo dÃµi
ipcMain.handle('ecommerceExport:stopWatch', async () => {
    if (ecommerceExportWatcher) {
        ecommerceExportWatcher.close();
        ecommerceExportWatcher = null;
        ecommerceExportWatchFolder = '';
        ecommerceExportKnownFiles.clear();
        console.log('ðŸ›‘ [TMDT Watcher] ÄÃ£ dá»«ng theo dÃµi');
        return { success: true };
    }
    return { success: false, error: 'KhÃ´ng cÃ³ watcher nÃ o Ä‘ang cháº¡y' };
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

// Äá»c táº¥t cáº£ file Excel tá»« thÆ° má»¥c
ipcMain.handle('ecommerceExport:loadExcelFiles', async (event, folderPath) => {
    try {
        if (!folderPath || !fs.existsSync(folderPath)) {
            return { success: false, error: 'ThÆ° má»¥c khÃ´ng tá»“n táº¡i' };
        }

        // Äá»c táº¥t cáº£ file trong thÆ° má»¥c
        const files = fs.readdirSync(folderPath);

        // Lá»c chá»‰ láº¥y file Excel (.xlsx, .xls)
        const excelFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ext === '.xlsx' || ext === '.xls';
        });

        if (excelFiles.length === 0) {
            return { success: false, error: 'KhÃ´ng tÃ¬m tháº¥y file Excel nÃ o trong thÆ° má»¥c' };
        }

        // Äá»c ná»™i dung tá»«ng file
        const filesData = [];
        for (const fileName of excelFiles) {
            const filePath = path.join(folderPath, fileName);
            try {
                const fileBuffer = fs.readFileSync(filePath);
                // Convert buffer to base64 Ä‘á»ƒ gá»­i qua IPC
                const base64Data = fileBuffer.toString('base64');
                filesData.push({
                    name: fileName,
                    data: base64Data
                });
            } catch (err) {
                console.error(`Error reading file ${fileName}:`, err);
            }
        }

        console.log(`âœ… Loaded ${filesData.length} Excel files from ${folderPath}`);
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
        console.log(`âœ… Opened external URL: ${url}`);
        return { success: true };
    } catch (error) {
        console.error('âŒ Error opening external URL:', error);
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
require('./update-handlers')(prisma);

// ========================================
// ECOMMERCE EXPORTS HANDLERS (XUáº¤T HÃ€NG TMDT)
// ========================================

ipcMain.handle('ecommerceExports:getAll', async (event, { since, sinceField } = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        // sinceField: 'ecommerceExportDate' (BusinessReport) hoáº·c 'updatedAt' (Attendance packing)
        const field = sinceField || 'ecommerceExportDate';
        const exports = await prisma.ecommerceExport.findMany({
            where: since ? { [field]: { gte: new Date(since) } } : undefined,
            orderBy: { ecommerceExportDate: 'desc' },
        });
        // Format dates for frontend
        const formatted = exports.map(e => ({
            ...e,
            ecommerceExportDate: e.ecommerceExportDate.toISOString(),
            items: e.items // Already JSON string
        }));
        return { success: true, data: formatted };
    } catch (error) {
        console.error('âŒ Get ecommerce exports error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('ecommerceExports:create', async (event, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const isCompleted = data.status === 'completed';
        const orderKey = (data.orderNumber || data.ecommerceExportCode || '').trim();

        // ðŸ”’ StockMutex: serialize stock operations â€” trÃ¡nh race condition Tháº» Kho
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

            const newRecord = await tx.ecommerceExport.create({
                data: {
                    customerName: data.customerName,
                    ecommerceExportCode: data.ecommerceExportCode || null,
                    orderNumber: data.orderNumber || null,
                    ecommerceExportReason: data.ecommerceExportReason || null,
                    ecommerceExportDate: new Date(data.ecommerceExportDate),
                    items: typeof data.items === 'string' ? data.items : JSON.stringify(data.items),
                    totalAmount: data.totalAmount || 0,
                    notes: data.notes || null,
                    status: data.status || 'processing',
                    createdBy: data.createdBy || null,
                    pickedBy: data.pickedBy || null
                }
            });

            if (isCompleted) {
                const itemsList = typeof data.items === 'string' ? JSON.parse(data.items) : data.items;
                for (const item of itemsList) {
                    if (item.variantSku) {
                        await deductItemOrCombo(tx, item.variantSku, -item.quantity, {
                            type: 'ecom_sale',
                            referenceType: 'TMDT',
                            reference: data.orderNumber || data.ecommerceExportCode || 'LÆ°u thá»§ cÃ´ng',
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
        console.log(`âœ… Created ecommerce export #${record.id}`);
        void logActivity({ module: 'export', action: 'CREATE', description: `Táº¡o bÃ n giao TMDT #${record.id} - ${data.customerName}`, recordName: data.customerName, userName: data.createdBy });
        return { success: true, data: record };
    } catch (error) {
        console.error('âŒ Create ecommerce export error:', error);
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

        const newRecord = await tx.ecommerceExport.update({
            where: { id },
            data: {
                customerName: data.customerName,
                ecommerceExportCode: data.ecommerceExportCode || null,
                orderNumber: data.orderNumber || null,
                ecommerceExportReason: data.ecommerceExportReason || null,
                ecommerceExportDate: data.ecommerceExportDate ? new Date(data.ecommerceExportDate) : undefined,
                items: data.items ? (typeof data.items === 'string' ? data.items : JSON.stringify(data.items)) : undefined,
                totalAmount: data.totalAmount,
                notes: data.notes || null,
                status: data.status,
                createdBy: data.createdBy !== undefined ? data.createdBy : undefined,
                pickedBy: data.pickedBy !== undefined ? data.pickedBy : undefined
            }
        });

        const oldItemsStrFinal = oldRecord.items || '[]';
        const newItemsStrFinal = data.items ? (typeof data.items === 'string' ? data.items : JSON.stringify(data.items)) : oldItemsStrFinal;
        const skipDeduct = oldRecord.status === 'completed' && data.status === 'completed' && oldItemsStrFinal === newItemsStrFinal;
        if (data.status === 'completed' && !skipDeduct) {
            const newItems = typeof newItemsStrFinal === 'string' ? JSON.parse(newItemsStrFinal) : newItemsStrFinal;
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

        // ðŸ”’ StockMutex: serialize stock operations â€” trÃ¡nh race condition Tháº» Kho
        await withStockLock(() => prisma.$transaction(async (tx) => {
            const doc = await tx.ecommerceExport.findUnique({ where: { id } });
            if (!doc) return;

            if (doc.status === 'completed') {
                const items = JSON.parse(doc.items || '[]');
                for (const item of items) {
                    if (item.variantSku) {
                        await updateProductStockInTx(tx, item.variantSku, item.quantity, {
                            type: 'adjustment',
                            referenceType: 'TMDT_CANCEL',
                            reference: doc.orderNumber || doc.ecommerceExportCode || 'XÃ³a thá»§ cÃ´ng',
                            note: `Hoàn tồn do xóa đơn TMDT #${id}`,
                            createdBy: 'System'
                        }, { allowMissing: true });
                    }
                }
            }
            await tx.ecommerceExport.delete({ where: { id } });
        }, { timeout: 30000, maxWait: 10000 }));

        console.log(`âœ… Deleted ecommerce export #${id}`);
        void logActivity({ module: 'export', action: 'DELETE', description: `XÃ³a bÃ n giao TMDT #${id}` });
        return { success: true };
    } catch (error) {
        console.error('âŒ Delete ecommerce export error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('ecommerceExports:bulkDelete', async (event, ids) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const startTime = Date.now();

        // ðŸ”’ StockMutex: serialize stock operations â€” trÃ¡nh race condition Tháº» Kho
        const count = await withStockLock(() => prisma.$transaction(async (tx) => {
            // ðŸš€ BÆ°á»›c 1: Láº¥y Táº¤T Cáº¢ Ä‘Æ¡n cáº§n xÃ³a trong 1 query
            const docs = await tx.ecommerceExport.findMany({
                where: { id: { in: ids } }
            });
            if (docs.length === 0) return 0;

            // ðŸš€ BÆ°á»›c 2: Gom SKU cáº§n hoÃ n kho tá»« Ä‘Æ¡n completed
            const completedDocs = docs.filter(d => d.status === 'completed');
            if (completedDocs.length > 0) {
                const skuCache = await buildSkuCache(tx);
                const skuChanges = [];
                for (const doc of completedDocs) {
                    const items = JSON.parse(doc.items || '[]');
                    for (const item of items) {
                        if (item.variantSku) {
                            skuChanges.push({ sku: item.variantSku, quantity: item.quantity }); // + quantity = hoÃ n kho
                        }
                    }
                }
                if (skuChanges.length > 0) {
                    await batchStockUpdate(tx, skuChanges, {
                        type: 'adjustment',
                        referenceType: 'TMDT_CANCEL',
                        reference: `XÃ³a hÃ ng loáº¡t ${docs.length} Ä‘Æ¡n`,
                        note: `Hoàn tồn do xóa ${completedDocs.length} đơn TMDT completed`,
                        createdBy: 'System'
                    }, skuCache);
                }
            }

            // ðŸš€ BÆ°á»›c 3: XÃ³a táº¥t cáº£ trong 1 DELETE statement
            const deleted = await tx.ecommerceExport.deleteMany({
                where: { id: { in: ids } }
            });
            return deleted.count;
        }, { timeout: 60000, maxWait: 10000 }));

        const elapsed = Date.now() - startTime;
        console.log(`âœ… Bulk deleted ${count} ecommerce exports in ${elapsed}ms`);
        void logActivity({ module: 'export', action: 'DELETE', description: `XÃ³a hÃ ng loáº¡t ${count} bÃ n giao TMDT (${elapsed}ms)` });
        return { success: true, data: count };
    } catch (error) {
        console.error('âŒ Bulk delete ecommerce exports error:', error);
        return { success: false, error: error.message };
    }
});

// âš¡ XÃ³a Táº¤T Cáº¢ Ä‘Æ¡n TMDT (dÃ¹ng khi cáº§n reset/cleanup)
ipcMain.handle('ecommerceExports:deleteAll', async () => {
    try {
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

        console.log(`ðŸ—‘ï¸ Deleted ALL ${count} ecommerce exports`);
        void logActivity({ module: 'export', action: 'DELETE', description: `XÃ³a toÃ n bá»™ ${count} bÃ n giao TMDT` });
        return { success: true, data: count };
    } catch (error) {
        console.error('âŒ Delete all ecommerce exports error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('ecommerceExports:deleteCancelled', async () => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        const result = await prisma.ecommerceExport.deleteMany({
            where: { status: 'cancelled' }
        });

        console.log(`ðŸ—‘ï¸ Deleted ${result.count} cancelled ecommerce exports`);
        void logActivity({ module: 'export', action: 'DELETE', description: `XÃ³a ${result.count} Ä‘Æ¡n TMDT Ä‘Ã£ há»§y` });
        return { success: true, data: result.count };
    } catch (error) {
        console.error('âŒ Delete cancelled ecommerce exports error:', error);
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

        // ðŸ”’ StockMutex: serialize stock operations â€” trÃ¡nh race condition Tháº» Kho
        const result = await withStockLock(() => prisma.$transaction(async (tx) => {
            // ðŸš€ BÆ°á»›c 1: Batch INSERT táº¥t cáº£ Ä‘Æ¡n cÃ¹ng lÃºc (1 SQL statement)
            const createData = dedupedRecords.map(data => ({
                customerName: data.customerName,
                ecommerceExportCode: data.ecommerceExportCode || null,
                orderNumber: data.orderNumber || null,
                ecommerceExportReason: data.ecommerceExportReason || null,
                ecommerceExportDate: (data.ecommerceExportDate && !isNaN(new Date(data.ecommerceExportDate).getTime())) ? new Date(data.ecommerceExportDate) : new Date(),
                items: typeof data.items === 'string' ? data.items : JSON.stringify(data.items),
                totalAmount: data.totalAmount || 0,
                notes: data.notes || null,
                status: data.status || 'processing',
                createdBy: data.createdBy || null
            }));

            await tx.ecommerceExport.createMany({ data: createData });

            // ðŸš€ BÆ°á»›c 2: Gom táº¥t cáº£ SKU cáº§n trá»« kho â†’ batch update
            const completedRecords = dedupedRecords.filter(d => d.status === 'completed');
            if (completedRecords.length > 0) {
                const skuCache = await buildSkuCache(tx);
                const skuChanges = [];
                for (const data of completedRecords) {
                    const itemsList = typeof data.items === 'string' ? JSON.parse(data.items) : data.items;
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
                        reference: `Nháº­p hÃ ng loáº¡t ${records.length} Ä‘Æ¡n`,
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
        console.log(`âœ… Bulk created ${result} ecommerce exports in ${elapsed}ms`);
        void logActivity({ module: 'export', action: 'CREATE', description: `Táº¡o hÃ ng loáº¡t ${result} bÃ n giao TMDT (${elapsed}ms)` });
        return { success: true, data: { count: result, skipped: records.length - result } };

    } catch (error) {
        console.error('âŒ Bulk create ecommerce exports error:', error);
        return { success: false, error: error.message };
    }
});

// ðŸš« ÄÃ¡nh dáº¥u hÃ ng loáº¡t Ä‘Æ¡n TMDT Ä‘Ã£ bá»‹ há»§y trÃªn sÃ n (Ä‘á»‘i soÃ¡t khi import file má»›i)
// Chá»‰ cancel Ä‘Æ¡n pending â€” khÃ´ng Ä‘á»¥ng vÃ o Ä‘Æ¡n completed (Ä‘Ã£ giao rá»“i)
ipcMain.handle('ecommerceExports:bulkCancel', async (event, ids) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        if (!ids || ids.length === 0) return { success: true, data: 0 };

        const result = await prisma.ecommerceExport.updateMany({
            where: {
                id: { in: ids },
                status: { notIn: ['completed'] } // Chá»‰ cancel Ä‘Æ¡n chÆ°a giao
            },
            data: { status: 'cancelled' }
        });

        console.log(`ðŸš« Bulk cancelled ${result.count} ecommerce exports (Ä‘á»‘i soÃ¡t sÃ n)`);
        void logActivity({ module: 'export', action: 'UPDATE', description: `Tá»± Ä‘á»™ng há»§y ${result.count} Ä‘Æ¡n TMDT (Ä‘á»‘i soÃ¡t sÃ n)` });
        return { success: true, data: result.count };
    } catch (error) {
        console.error('âŒ Bulk cancel ecommerce exports error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('marketplaceOrders:getAll', async (event, { since } = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const orders = await prisma.order.findMany({
            where: {
                source: { in: ['tiktok', 'shopee', 'lazada', 'tmdt'] },
                status: 'completed',
                ...(since ? { createdAt: { gte: new Date(since) } } : {}),
            },
            include: {
                items: true,
                user: { select: { username: true, fullName: true } },
            },
            orderBy: { createdAt: 'desc' },
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
// EXPORT ORDERS HANDLERS (XUáº¤T HÃ€NG POS)
// ========================================

ipcMain.handle('exportOrders:getAll', async (event, { since } = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const orders = await prisma.exportOrder.findMany({
            where: since ? { exportDate: { gte: new Date(since) } } : undefined,
            orderBy: { exportDate: 'desc' }
        });
        const formatted = orders.map(o => ({
            ...o,
            exportDate: o.exportDate.toISOString(),
            items: typeof o.items === 'string' ? JSON.parse(o.items) : o.items
        }));
        return { success: true, data: formatted };
    } catch (error) {
        console.error('âŒ Get export orders error:', error);
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
        console.log(`âœ… Created export order #${record.id}`);
        void logActivity({ module: 'export', action: 'CREATE', description: `Táº¡o xuáº¥t hÃ ng #${record.id} - ${data.customer}`, recordName: data.customer, userName: data.createdBy });
        return { success: true, data: record };
    } catch (error) {
        console.error('âŒ Create export order error:', error);
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
        console.log(`âœ… Updated export order #${record.id}`);
        void logActivity({ module: 'export', action: 'UPDATE', description: `Cáº­p nháº­t xuáº¥t hÃ ng #${record.id}` });
        return { success: true, data: record };
    } catch (error) {
        console.error('âŒ Update export order error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('exportOrders:delete', async (event, id) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        await prisma.exportOrder.delete({ where: { id } });
        console.log(`âœ… Deleted export order #${id}`);
        void logActivity({ module: 'export', action: 'DELETE', description: `XÃ³a xuáº¥t hÃ ng #${id}` });
        return { success: true };
    } catch (error) {
        console.error('âŒ Delete export order error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// RETURNS HANDLERS (TRáº¢ HÃ€NG)
// ========================================

ipcMain.handle('returns:getAll', async (event, { since } = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const returns = await prisma.return.findMany({
            where: since ? { createdAt: { gte: new Date(since) } } : undefined,
            orderBy: { createdAt: 'desc' },
            take: 500 // âš¡ Giá»›i háº¡n 500 phiáº¿u tráº£ gáº§n nháº¥t
        });
        const formatted = returns.map(r => ({
            ...r,
            // Map DB fields â†’ frontend fields
            complaintCode: r.returnCode || '',      // returnCode â†’ complaintCode
            productName: r.customerName || '',       // customerName â†’ productName (frontend uses productName)
            complaintDate: r.returnDate.toISOString().split('T')[0],  // returnDate â†’ complaintDate
            reason: r.returnReason || '',            // returnReason â†’ reason
            returnDate: r.returnDate.toISOString().split('T')[0],
            processNotes: r.notes || null,           // notes â†’ processNotes
        }));
        return { success: true, data: formatted };
    } catch (error) {
        console.error('âŒ Get returns error:', error);
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
                createdBy: data.createdBy || null
            }
        });
        console.log(`âœ… Created return #${record.id}`);
        void logActivity({ module: 'returns', action: 'CREATE', description: `Táº¡o tráº£ hÃ ng #${record.id} - ${data.customerName}`, recordName: data.customerName, userName: data.createdBy });
        return { success: true, data: record };
    } catch (error) {
        console.error('âŒ Create return error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('returns:update', async (event, id, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        // ðŸ”§ FIX: Chá»‰ update field Ä‘Æ°á»£c gá»­i, khÃ´ng ghi Ä‘Ã¨ null cÃ¡c field khÃ¡c
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

        const record = await prisma.return.update({
            where: { id },
            data: updateData
        });
        console.log(`âœ… Updated return #${record.id}`);
        void logActivity({ module: 'returns', action: 'UPDATE', description: `Cáº­p nháº­t tráº£ hÃ ng #${record.id}`, changes: data });
        return { success: true, data: record };
    } catch (error) {
        console.error('âŒ Update return error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('returns:delete', async (event, id) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        await prisma.return.delete({ where: { id } });
        console.log(`âœ… Deleted return #${id}`);
        void logActivity({ module: 'returns', action: 'DELETE', description: `XÃ³a tráº£ hÃ ng #${id}` });
        return { success: true };
    } catch (error) {
        console.error('âŒ Delete return error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('returns:bulkCreate', async (event, records) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        console.log(`ðŸ“¦ returns:bulkCreate called with ${records.length} records`);
        const created = [];
        for (let i = 0; i < records.length; i++) {
            const data = records[i];
            try {
                // ðŸ”§ Safe date parsing
                let returnDate = new Date(data.returnDate);
                if (isNaN(returnDate.getTime())) {
                    console.warn(`âš ï¸ Record ${i}: Invalid returnDate: "${data.returnDate}", using current date`);
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
                        createdBy: data.createdBy || null
                    }
                });
                created.push(record);
            } catch (recordError) {
                console.error(`âŒ Record ${i} failed:`, recordError.message, 'Data:', JSON.stringify(data));
            }
        }
        console.log(`âœ… Bulk created ${created.length}/${records.length} returns`);
        void logActivity({ module: 'returns', action: 'CREATE', description: `Táº¡o hÃ ng loáº¡t ${created.length} tráº£ hÃ ng` });
        return { success: true, data: created };
    } catch (error) {
        console.error('âŒ Bulk create returns error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// REFUNDS HANDLERS (HÃ€NG HOÃ€N)
// ========================================

ipcMain.handle('refunds:getAll', async (event, { since } = {}) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const refunds = await prisma.refund.findMany({
            where: since ? { createdAt: { gte: new Date(since) } } : undefined,
            orderBy: { createdAt: 'desc' }
        });
        const formatted = refunds.map(r => ({
            ...r,
            refundDate: r.refundDate.toISOString().split('T')[0]
        }));
        return { success: true, data: formatted };
    } catch (error) {
        console.error('âŒ Get refunds error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('refunds:create', async (event, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        // ðŸ”§ Safe date parsing
        let refundDate = new Date(data.refundDate);
        if (isNaN(refundDate.getTime())) {
            console.warn(`âš ï¸ Invalid refundDate: "${data.refundDate}", using current date`);
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
        console.log(`âœ… Created refund #${record.id}`);
        void logActivity({ module: 'refunds', action: 'CREATE', description: `Táº¡o hÃ ng hoÃ n #${record.id} - ${data.customerName}`, recordName: data.customerName, userName: data.createdBy });
        return { success: true, data: record };
    } catch (error) {
        console.error('âŒ Create refund error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('refunds:update', async (event, id, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        // ðŸ”§ FIX: Chá»‰ update cÃ¡c field Ä‘Æ°á»£c gá»­i lÃªn, KHÃ”NG overwrite field khÃ´ng cÃ³
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

        console.log(`ðŸ“ Updating refund #${id} with fields:`, Object.keys(updateData));
        const record = await prisma.refund.update({
            where: { id },
            data: updateData
        });
        console.log(`âœ… Updated refund #${record.id}`);
        void logActivity({ module: 'refunds', action: 'UPDATE', description: `Cáº­p nháº­t hÃ ng hoÃ n #${record.id}`, changes: data });
        return { success: true, data: record };
    } catch (error) {
        console.error('âŒ Update refund error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('refunds:delete', async (event, id) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        await prisma.refund.delete({ where: { id } });
        console.log(`âœ… Deleted refund #${id}`);
        void logActivity({ module: 'refunds', action: 'DELETE', description: `XÃ³a hÃ ng hoÃ n #${id}` });
        return { success: true };
    } catch (error) {
        console.error('âŒ Delete refund error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('refunds:bulkDelete', async (event, ids) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const result = await prisma.refund.deleteMany({
            where: { id: { in: ids } }
        });
        console.log(`âœ… Bulk deleted ${result.count} refunds`);
        void logActivity({ module: 'refunds', action: 'DELETE', description: `XÃ³a hÃ ng loáº¡t ${result.count} hÃ ng hoÃ n` });
        return { success: true, data: result.count };
    } catch (error) {
        console.error('âŒ Bulk delete refunds error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('refunds:bulkCreate', async (event, records) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        console.log(`ðŸ“¦ refunds:bulkCreate called with ${records.length} records`);
        const created = [];
        for (let i = 0; i < records.length; i++) {
            const data = records[i];
            try {
                // ðŸ”§ Safe date parsing
                let refundDate;
                try {
                    refundDate = new Date(data.refundDate);
                    if (isNaN(refundDate.getTime())) {
                        console.warn(`âš ï¸ Invalid refundDate for record ${i}: "${data.refundDate}", using current date`);
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
                console.error(`âŒ Error creating refund record ${i}:`, itemError.message);
                console.error(`   Data:`, JSON.stringify(data).substring(0, 200));
                // Continue with other records
            }
        }
        console.log(`âœ… Bulk created ${created.length}/${records.length} refunds`);
        void logActivity({ module: 'refunds', action: 'CREATE', description: `Táº¡o hÃ ng loáº¡t ${created.length} hÃ ng hoÃ n` });
        return { success: true, data: created };
    } catch (error) {
        console.error('âŒ Bulk create refunds error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// STOCK BALANCE HANDLERS (CÃ‚N Báº°NG KHO)
// ========================================

ipcMain.handle('stockBalance:getAll', async () => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const records = await prisma.stockBalance.findMany({
            orderBy: { createdAt: 'desc' }
        });
        const formatted = records.map(r => ({
            ...r,
            date: r.createdAt.toISOString(),
            items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items
        }));
        return { success: true, data: formatted };
    } catch (error) {
        console.error('âŒ Get stock balance records error:', error);
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
        console.log(`âœ… Created stock balance record #${record.id}`);
        const effectiveUser = currentSession?.username || data.adjustedBy || 'System';
        void logActivity({ module: 'products', action: 'UPDATE', description: `CÃ¢n báº±ng kho - ${effectiveUser}`, recordName: effectiveUser, userName: effectiveUser });
        return { success: true, data: record };
    } catch (error) {
        console.error('âŒ Create stock balance error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// INVENTORY LOGS / THáºº KHO
// ========================================

// Helper: Ghi log tháº» kho â€” Ä‘Æ°á»£c gá»i tá»« táº¥t cáº£ module (POS, Purchase, Export, Returns, Refunds, StockBalance)
async function createInventoryLog({ sku, productId, productName, variantColor, type, referenceType, reference, quantity, oldStock, newStock, note, createdBy }) {
    try {
        if (!prisma) return null;

        let reporterId = null;

        // ÄÃ­ch danh user Ä‘ang thao tÃ¡c (chá»‘ng ghi Ä‘Ã¨ 'System' hay 'Admin' mÃ¹ má»)
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
        console.log(`ðŸ“‹ [Tháº»Kho] ${referenceType || type}: ${sku} ${quantity > 0 ? '+' : ''}${quantity} â†’ Tá»“n cuá»‘i: ${newStock}`);
        return log;
    } catch (err) {
        console.error('âŒ [Tháº»Kho] Error:', err.message);
        return null;
    }
}

// Helper: Láº¥y stock hiá»‡n táº¡i cá»§a SKU (product hoáº·c variant)
async function getCurrentStock(sku) {
    try {
        if (!prisma) return 0;

        // TÃ¬m product trá»±c tiáº¿p
        const product = await prisma.product.findUnique({ where: { sku } });
        if (product) return product.stock || 0;

        // TÃ¬m trong variants
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

// Helper: Láº¥y productId + product info tá»« SKU
async function getProductInfoBySku(sku) {
    try {
        if (!prisma) return null;

        const product = await prisma.product.findUnique({ where: { sku } });
        if (product) {
            return { productId: product.id, productName: product.name, variantColor: null };
        }

        // TÃ¬m trong variants
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

// Láº¥y táº¥t cáº£ inventory logs (cÃ³ filter + phÃ¢n trang)
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

        console.log(`ðŸ“‹ [Tháº»Kho] Loaded ${formatted.length} logs`);
        return { success: true, data: formatted };
    } catch (error) {
        console.error('âŒ Get inventory logs error:', error);
        return { success: false, error: error.message };
    }
});

// Láº¥y log theo SKU (tháº» kho 1 sáº£n pháº©m)
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
        console.error('âŒ Get inventory logs by SKU error:', error);
        return { success: false, error: error.message };
    }
});

// Láº¥y chi tiáº¿t chá»©ng tá»« gá»‘c tá»« inventory log (click MÃ£ CT)
ipcMain.handle('inventoryLogs:getRefDetail', async (event, { referenceType, reference }) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        if (!reference) return { success: false, error: 'KhÃ´ng cÃ³ mÃ£ chá»©ng tá»«' };

        const refType = (referenceType || '').toUpperCase();

        // TMDT / TMDT_EDIT / TMDT_CANCEL
        if (refType.startsWith('TMDT')) {
            const doc = await prisma.ecommerceExport.findFirst({
                where: { OR: [{ orderNumber: reference }, { ecommerceExportCode: reference }] }
            });
            if (!doc) return { success: false, error: `Chi tiáº¿t chá»©ng tá»« gá»‘c khÃ´ng cÃ²n trÃªn há»‡ thá»‘ng: ${reference}` };
            let items = [];
            try { items = typeof doc.items === 'string' ? JSON.parse(doc.items) : (doc.items || []); } catch { }
            // Vá»›i má»—i item lÃ  combo, load combo definition Ä‘á»ƒ biáº¿t components
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
            if (!order) return { success: false, error: `Chi tiáº¿t chá»©ng tá»« gá»‘c khÃ´ng cÃ²n trÃªn há»‡ thá»‘ng: ${reference}` };
            return { success: true, type: 'POS', data: order };
        }

        // NHAP (Purchase)
        if (refType === 'NHAP') {
            const po = await prisma.purchaseOrder.findFirst({
                where: { poNumber: reference },
                include: { supplier: true, items: { include: { product: { select: { name: true, sku: true, unit: true } } } } }
            });
            if (!po) return { success: false, error: `Chi tiáº¿t chá»©ng tá»« gá»‘c khÃ´ng cÃ²n trÃªn há»‡ thá»‘ng: ${reference}` };
            return { success: true, type: 'PURCHASE', data: po };
        }

        // Adjustment / other â€” khÃ´ng cÃ³ chá»©ng tá»« gá»‘c
        return { success: false, error: 'Loáº¡i chá»©ng tá»« nÃ y khÃ´ng cÃ³ chi tiáº¿t Ä‘á»ƒ xem.' };
    } catch (error) {
        console.error('âŒ getRefDetail error:', error);
        return { success: false, error: error.message };
    }
});

// Táº¡o inventory log thá»§ cÃ´ng (Ä‘iá»u chá»‰nh / cÃ¢n báº±ng kho)
ipcMain.handle('inventoryLogs:create', async (event, data) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const log = await createInventoryLog(data);
        return { success: true, data: log };
    } catch (error) {
        console.error('âŒ Create inventory log error:', error);
        return { success: false, error: error.message };
    }
});


// ========================================
// APP CONFIG HANDLERS (Cáº¤U HÃŒNH á»¨NG Dá»¤NG)
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
        console.error(`âŒ Get config "${key}" error:`, error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('appConfig:set', async (event, key, value) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const config = await prisma.appConfig.upsert({
            where: { key },
            update: { value: JSON.stringify(value) },
            create: { key, value: JSON.stringify(value) }
        });
        console.log(`âœ… Set config "${key}"`);
        return { success: true, data: config };
    } catch (error) {
        console.error(`âŒ Set config "${key}" error:`, error);
        return { success: false, error: error.message };
    }
});

// ========================================
// USERS HANDLERS (NGÆ¯á»œI DÃ™NG / PHÃ‚N QUYá»€N)
// ========================================

ipcMain.handle('users:getAll', async () => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        // DÃ¹ng raw SQL Ä‘á»ƒ luÃ´n láº¥y Ä‘Æ°á»£c lastActiveAt ká»ƒ cáº£ khi Prisma client cÅ© chÆ°a generate láº¡i
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
        console.error('âŒ Get users error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('users:create', async (event, data) => {
    try {
        requireRole('admin');
        if (!prisma) throw new Error('Prisma not available');
        // ðŸ”’ SECURITY: Hash password trÆ°á»›c khi lÆ°u
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
        console.log(`âœ… Created user: ${user.username}`);
        void logActivity({ module: 'users', action: 'CREATE', description: `Táº¡o ngÆ°á»i dÃ¹ng "${user.username}" (${data.role || 'staff'})`, recordName: user.username });
        return { success: true, data: { ...user, isActive: user.status === 'active' } };
    } catch (error) {
        console.error('âŒ Create user error:', error);
        if (error.code === 'P2002') {
            return { success: false, error: 'TÃªn Ä‘Äƒng nháº­p Ä‘Ã£ tá»“n táº¡i!' };
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
        // ðŸ”’ SECURITY: Hash password má»›i náº¿u Ä‘á»•i máº­t kháº©u
        if (data.password !== undefined) updateData.password = await bcrypt.hash(data.password, 10);
        if (data.isActive !== undefined) updateData.status = data.isActive ? 'active' : 'inactive';

        const user = await prisma.user.update({
            where: { id },
            data: updateData
        });
        console.log(`âœ… Updated user: ${user.username}`);
        void logActivity({ module: 'users', action: 'UPDATE', description: `Cáº­p nháº­t ngÆ°á»i dÃ¹ng "${user.username}"`, recordName: user.username });
        return { success: true, data: { ...user, isActive: user.status === 'active' } };
    } catch (error) {
        console.error('âŒ Update user error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('users:delete', async (event, id) => {
    try {
        requireRole('admin');
        if (!prisma) throw new Error('Prisma not available');
        await prisma.user.delete({ where: { id } });
        console.log(`âœ… Deleted user #${id}`);
        void logActivity({ module: 'users', action: 'DELETE', description: `XÃ³a ngÆ°á»i dÃ¹ng #${id}` });
        return { success: true };
    } catch (error) {
        console.error('âŒ Delete user error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('users:login', async (event, username, password) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        const normalizedUsername = typeof username === 'string' ? username.trim() : '';
        const user = await prisma.user.findUnique({
            where: { username: normalizedUsername }
        });
        if (!user || user.status !== 'active') {
            return { success: false, error: 'TÃ i khoáº£n khÃ´ng tá»“n táº¡i hoáº·c Ä‘Ã£ bá»‹ vÃ´ hiá»‡u hÃ³a' };
        }
        // ðŸ”’ SECURITY: So sÃ¡nh báº±ng bcrypt
        const isHashed = typeof user.password === 'string' && user.password.startsWith('$2');
        let passwordValid = false;
        if (isHashed) {
            passwordValid = await bcrypt.compare(password, user.password);
        } else {
            // Backward compatible: plaintext password cÅ© â†’ auto-upgrade sang hash
            passwordValid = (user.password === password);
            if (passwordValid) {
                const hashed = await bcrypt.hash(password, 10);
                await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
                console.log(`ðŸ”’ Auto-upgraded password for user: ${user.username}`);
            }
        }
        if (!passwordValid) {
            return { success: false, error: 'Máº­t kháº©u khÃ´ng Ä‘Ãºng' };
        }
        // Return user without password
        const { password: _, ...userWithoutPassword } = user;
        // LÆ°u session phÃ­a backend
        currentSession = { id: user.id, username: user.username, role: user.role };
        prisma.$executeRaw`UPDATE "User" SET "lastActiveAt" = NOW() WHERE id = ${user.id}`.catch(() => { });
        void logActivity({ module: 'users', action: 'LOGIN', description: `ÄÄƒng nháº­p: ${user.username}`, recordName: user.username, userName: user.username });
        return { success: true, data: { ...userWithoutPassword, isActive: user.status === 'active' } };
    } catch (error) {
        console.error('âŒ Login error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('users:logout', async () => {
    if (currentSession?.id) {
        await prisma.$executeRaw`UPDATE "User" SET "lastActiveAt" = NULL WHERE id = ${currentSession.id}`.catch(() => { });
    }
    currentSession = null;
    return { success: true };
});

// Restore session khi auto-login tá»« localStorage (khÃ´ng cáº§n password)
ipcMain.handle('users:restoreSession', async (event, userId) => {
    try {
        if (!prisma) return { success: false };
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user || user.status !== 'active') return { success: false };
        currentSession = { id: user.id, username: user.username, role: user.role };
        prisma.$executeRaw`UPDATE "User" SET "lastActiveAt" = NOW() WHERE id = ${user.id}`.catch(() => { });
        return { success: true };
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
                    fullName: 'Quáº£n trá»‹ viÃªn',
                    email: 'admin@example.com',
                    role: 'admin',
                    status: 'active'
                }
            });
            console.log('âœ… Ensured default admin exists');
        }
        return { success: true };
    } catch (error) {
        console.error('âŒ Ensure admin error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// DAILY EXPENSES HANDLERS (CHI PHÃ HÃ€NG NGÃ€Y - P&L)
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
        console.error('âŒ Get daily expenses error:', error);
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
        console.log(`âœ… Upserted daily expense for ${data.date}`);
        return { success: true, data: { ...record, date: record.date.toISOString().split('T')[0] } };
    } catch (error) {
        console.error('âŒ Upsert daily expense error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('dailyExpenses:delete', async (event, id) => {
    try {
        if (!prisma) throw new Error('Prisma not available');
        await prisma.dailyExpense.delete({ where: { id } });
        console.log(`âœ… Deleted daily expense #${id}`);
        return { success: true };
    } catch (error) {
        console.error('âŒ Delete daily expense error:', error);
        return { success: false, error: error.message };
    }
});

module.exports = { prisma };

// ===== REFUNDS: Import tá»« thÆ° má»¥c =====
ipcMain.handle('refunds:importFromFolder', async () => {
    try {
        // 1. Má»Ÿ dialog chá»n thÆ° má»¥c
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Chá»n thÆ° má»¥c chá»©a file Excel hÃ ng hoÃ n',
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: 'cancelled' };
        }

        const folderPath = result.filePaths[0];
        console.log(`ðŸ“‚ Selected folder: ${folderPath}`);

        // 2. TÃ¬m táº¥t cáº£ file .xlsx / .xls trong thÆ° má»¥c
        const allFiles = fs.readdirSync(folderPath);
        const excelFiles = allFiles.filter(f => {
            const ext = path.extname(f).toLowerCase();
            return ext === '.xlsx' || ext === '.xls';
        });

        if (excelFiles.length === 0) {
            return { success: false, error: 'KhÃ´ng tÃ¬m tháº¥y file Excel (.xlsx/.xls) trong thÆ° má»¥c!' };
        }

        console.log(`ðŸ“Š Found ${excelFiles.length} Excel files:`, excelFiles);

        // 3. Äá»c dá»¯ liá»‡u tá»« táº¥t cáº£ file â€” TÃCH RIÃŠNG tá»«ng file
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

                console.log(`  ðŸ“„ ${fileName}: ${jsonData.length} rows`);
                filesData.push({ name: fileName, data: jsonData });
                fileResults.push({ name: fileName, rows: jsonData.length, success: true });
                totalRows += jsonData.length;
            } catch (fileError) {
                console.error(`  âŒ ${fileName}: ${fileError.message}`);
                fileResults.push({ name: fileName, rows: 0, success: false, error: fileError.message });
            }
        }

        console.log(`âœ… Total: ${totalRows} rows from ${excelFiles.length} files`);

        return {
            success: true,
            filesData,
            folderPath,
            fileResults,
            totalFiles: excelFiles.length,
            totalRows,
        };
    } catch (error) {
        console.error('âŒ Import from folder error:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// MISA meINVOICE API INTEGRATION
// ========================================

const { v4: uuidv4 } = (() => {
    try { return require('uuid'); } catch {
        // Fallback UUID generator náº¿u chÆ°a install uuid
        return {
            v4: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            })
        };
    }
})();

// Cache token MISA
let misaTokenCache = { token: null, expiresAt: 0 };

// MÃ£ hÃ³a / giáº£i mÃ£ password Ä‘Æ¡n giáº£n (obfuscation)
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

// Láº¥y cáº¥u hÃ¬nh MISA tá»« AppConfig
async function getMisaConfig() {
    if (!prisma) throw new Error('Database not initialized');
    const configRecord = await prisma.appConfig.findUnique({ where: { key: 'misaConfig' } });
    if (!configRecord?.value) throw new Error('ChÆ°a cáº¥u hÃ¬nh MISA meInvoice! VÃ o âš™ï¸ Cáº¥u hÃ¬nh Ä‘á»ƒ thiáº¿t láº­p.');
    const config = JSON.parse(configRecord.value);
    // Giáº£i mÃ£ password náº¿u Ä‘Ã£ mÃ£ hÃ³a
    if (config.password) {
        config.password = decodeSecret(config.password);
    }
    if (!config.appid || !config.taxcode || !config.username || !config.password) {
        throw new Error('Cáº¥u hÃ¬nh MISA thiáº¿u thÃ´ng tin! Cáº§n: AppID, MST, Username, Password.');
    }
    return config;
}

// Láº¥y token MISA (cÃ³ cache)
async function getMisaToken() {
    // Tráº£ vá» cached token náº¿u chÆ°a háº¿t háº¡n (trá»« 5 phÃºt buffer)
    if (misaTokenCache.token && Date.now() < misaTokenCache.expiresAt - 300000) {
        return misaTokenCache.token;
    }

    const config = await getMisaConfig();
    const baseUrl = 'https://api.meinvoice.vn';

    // Trim táº¥t cáº£ field Ä‘á»ƒ loáº¡i bá» khoáº£ng tráº¯ng áº©n
    const appid = (config.appid || '').trim();
    const taxcode = (config.taxcode || '').trim();
    const username = (config.username || '').trim();
    const password = (config.password || '').trim();

    console.log(`ðŸ”‘ MISA: Requesting token from ${baseUrl}...`);
    console.log(`ðŸ”‘ MISA: AppID=${maskString(appid)}, TaxCode=${maskString(taxcode)}, User=${maskString(username)}, PassLen=${password.length}`);

    // Thá»­ cáº£ 2 URL endpoint (v3 vÃ  integration)
    const tokenUrls = [
        `${baseUrl}/api/integration/auth/token`,
        `${baseUrl}/api/v3/auth/token`,
    ];

    let lastError = '';
    let lastResult = null;

    for (const tokenUrl of tokenUrls) {
        console.log(`ðŸ”‘ MISA: Trying ${tokenUrl}...`);
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
            console.error(`âŒ MISA fetch error (${tokenUrl}):`, fetchErr.message);
            lastError = fetchErr.message;
            continue;
        }

        const responseText = await response.text();
        console.log(`ðŸ”‘ MISA Response from ${tokenUrl} (${response.status}):`, responseText.substring(0, 800));

        let result;
        try {
            result = JSON.parse(responseText);
        } catch {
            console.error(`âŒ MISA: Non-JSON response from ${tokenUrl}`);
            lastError = `Response khÃ´ng há»£p lá»‡ (status ${response.status}): ${responseText.substring(0, 200)}`;
            continue;
        }

        // MISA API cÃ³ thá»ƒ tráº£ vá» Success hoáº·c success
        const isSuccess = result.Success === true || result.success === true;
        const data = result.Data || result.data;
        const errorCode = result.ErrorCode || result.errorCode || '';

        if (isSuccess && data) {
            // ThÃ nh cÃ´ng!
            misaTokenCache = {
                token: data,
                expiresAt: Date.now() + 2 * 60 * 60 * 1000, // Cache 2 giá» (MISA token expire nhanh)
            };
            console.log(`âœ… MISA: Token obtained successfully from ${tokenUrl}`);
            return data;
        }

        // LÆ°u láº¡i lá»—i, thá»­ URL tiáº¿p theo
        console.error(`âŒ MISA Auth Error from ${tokenUrl}:`, JSON.stringify(result, null, 2));
        lastResult = result;
        lastError = errorCode;
    }

    // Cáº£ 2 URL Ä‘á»u tháº¥t báº¡i â€” phÃ¢n tÃ­ch lá»—i chi tiáº¿t
    const errorCode = lastError;
    const errors = lastResult?.Errors || lastResult?.errors || [];
    const errorsStr = Array.isArray(errors) ? errors.join(', ') : String(errors);
    const fullResponse = lastResult ? JSON.stringify(lastResult).substring(0, 400) : 'No response';

    // Check Errors array trÆ°á»›c â€” MISA thÆ°á»ng ghi chi tiáº¿t lá»—i á»Ÿ Ä‘Ã¢y
    let errorMsg;
    if (errorsStr.includes('TaxCodeNotExist')) {
        errorMsg = `âŒ MÃ£ sá»‘ thuáº¿ "${taxcode}" KHÃ”NG tá»“n táº¡i trÃªn MISA! Kiá»ƒm tra láº¡i MST hoáº·c Ä‘Äƒng kÃ½ MST trÃªn meinvoice.vn trÆ°á»›c.`;
    } else if (errorCode === 'InvalidAppID') {
        errorMsg = `âŒ Sai AppID MISA! [${fullResponse}]`;
    } else if (errorCode === 'InactiveAppID') {
        errorMsg = `âŒ AppID MISA Ä‘Ã£ bá»‹ khÃ³a! [${fullResponse}]`;
    } else if (errorCode === 'UnAuthorize') {
        errorMsg = `âŒ Lá»—i xÃ¡c thá»±c MISA (UnAuthorize). Chi tiáº¿t: ${errorsStr || 'KhÃ´ng rÃµ'}. [User=${username}, TaxCode=${taxcode}]`;
    } else {
        errorMsg = `âŒ Lá»—i MISA: ${errorsStr || fullResponse}`;
    }
    throw new Error(errorMsg);
}

// XÃ³a token cache khi bá»‹ reject (Ä‘á»ƒ láº§n sau láº¥y token má»›i)
function invalidateMisaToken() {
    misaTokenCache = { token: null, expiresAt: 0 };
    console.log('ðŸ”„ MISA: Token cache invalidated â€” sáº½ láº¥y token má»›i láº§n tá»›i');
}

// Chuyá»ƒn sá»‘ thÃ nh chá»¯ tiáº¿ng Viá»‡t
function numberToVietnameseWords(num) {
    if (num === 0) return 'KhÃ´ng Ä‘á»“ng.';
    const units = ['', 'má»™t', 'hai', 'ba', 'bá»‘n', 'nÄƒm', 'sÃ¡u', 'báº£y', 'tÃ¡m', 'chÃ­n'];
    const groups = ['', 'nghÃ¬n', 'triá»‡u', 'tá»·'];

    function readThreeDigits(n, showZeroHundred) {
        const h = Math.floor(n / 100);
        const t = Math.floor((n % 100) / 10);
        const u = n % 10;
        let result = '';
        if (h > 0) result += units[h] + ' trÄƒm ';
        else if (showZeroHundred) result += 'khÃ´ng trÄƒm ';
        if (t > 1) result += units[t] + ' mÆ°Æ¡i ';
        else if (t === 1) result += 'mÆ°á»i ';
        else if (t === 0 && h > 0 && u > 0) result += 'láº» ';
        if (u === 1 && t > 1) result += 'má»‘t';
        else if (u === 5 && t > 0) result += 'lÄƒm';
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
    result = result.charAt(0).toUpperCase() + result.slice(1) + ' Ä‘á»“ng.';
    return result;
}

// Build InvoiceData cho MISA API tá»« DB record
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
        ItemName: item.productName || 'HÃ ng hÃ³a',
        UnitName: 'CÃ¡i',
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
        // ThÃ´ng tin ngÆ°á»i mua
        BuyerLegalName: order.customerName || 'NgÆ°á»i mua khÃ´ng láº¥y hÃ³a Ä‘Æ¡n',
        BuyerTaxCode: '',
        BuyerAddress: '',
        BuyerFullName: order.customerName || 'NgÆ°á»i mua khÃ´ng láº¥y hÃ³a Ä‘Æ¡n',
        BuyerPhoneNumber: order.customerPhone || '',
        BuyerEmail: '',
        // Tá»•ng tiá»n
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
        // Chi tiáº¿t
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

// Gá»i MISA API phÃ¡t hÃ nh hÃ³a Ä‘Æ¡n â€” Theo tÃ i liá»‡u Má»¥c 6
// URL: {BaseURL}/invoice
// SignType: 2 = HSM (kÃ½ sá»‘ tá»« xa), 5 = KhÃ´ng kÃ½ (MTT/VÃ©)
async function publishMisaInvoice(invoiceDataList) {
    const config = await getMisaConfig();
    const token = await getMisaToken();
    const baseUrl = 'https://api.meinvoice.vn/api/integration';

    // Body theo tÃ i liá»‡u Má»¥c 6: { SignType, InvoiceData, PublishInvoiceData }
    const body = {
        SignType: 2,  // 2=HSM kÃ½ sá»‘ tá»« xa, 5=KhÃ´ng kÃ½ (MTT)
        InvoiceData: invoiceDataList,
        PublishInvoiceData: null,
    };

    console.log(`ðŸ“¤ MISA: Publishing ${invoiceDataList.length} invoice(s) to ${baseUrl}/invoice ...`);
    console.log(`ðŸ“¤ MISA: SignType=${body.SignType}, Sample:`, JSON.stringify(invoiceDataList[0]).substring(0, 500));

    // Helper: gá»i API publish 1 láº§n
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
        console.log(`ðŸ“¤ MISA Publish Response (${response.status}):`, responseText.substring(0, 800));

        let result;
        try {
            result = JSON.parse(responseText);
        } catch {
            throw new Error(`MISA tráº£ vá» response khÃ´ng há»£p lá»‡ khi phÃ¡t hÃ nh (status ${response.status}): ${responseText.substring(0, 200)}`);
        }
        return { result, status: response.status };
    }

    let { result, status } = await doPublishRequest(token);

    // Check success (MISA API tráº£ vá» success hoáº·c Success)
    let isSuccess = result.Success === true || result.success === true;

    // AUTO-RETRY: Náº¿u bá»‹ UnAuthorize hoáº·c HTTP 401 â†’ xÃ³a cache, láº¥y token má»›i, thá»­ láº¡i 1 láº§n
    if (!isSuccess) {
        const errCode = result.ErrorCode || result.errorCode || '';
        if (errCode === 'UnAuthorize' || status === 401) {
            console.log('ðŸ”„ MISA: Token expired â€” invalidating cache and retrying with fresh token...');
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
        console.error('âŒ MISA Publish FULL Response:', JSON.stringify(result, null, 2));
        throw new Error(`MISA Publish Error: ${errCode} â€” ${errDesc || JSON.stringify(result).substring(0, 300)}`);
    }

    // Parse publishInvoiceResult (cÃ³ thá»ƒ lÃ  string JSON) â€” theo tÃ i liá»‡u Má»¥c 6
    let publishResults = result.publishInvoiceResult;
    if (typeof publishResults === 'string') {
        try { publishResults = JSON.parse(publishResults); } catch { publishResults = []; }
    }
    if (!publishResults) publishResults = [];

    console.log(`âœ… MISA: Published ${publishResults.length} invoice(s)`);
    return publishResults;
}

// Táº£i PDF hÃ³a Ä‘Æ¡n tá»« MISA â€” Theo tÃ i liá»‡u Má»¥c 8
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
        console.log(`ðŸ“¥ MISA Download Response (${response.status}):`, responseText.substring(0, 300));

        let result;
        try { result = JSON.parse(responseText); } catch {
            throw new Error(`MISA download tráº£ vá» response khÃ´ng há»£p lá»‡ (status ${response.status})`);
        }
        return { result, status: response.status };
    }

    let { result, status } = await doDownloadRequest(token);
    let isSuccess = result.Success === true || result.success === true;

    // AUTO-RETRY: token expired â†’ láº¥y má»›i vÃ  thá»­ láº¡i
    if (!isSuccess) {
        const errCode = result.ErrorCode || result.errorCode || '';
        if (errCode === 'UnAuthorize' || status === 401) {
            console.log('ðŸ”„ MISA Download: Token expired â€” retrying with fresh token...');
            invalidateMisaToken();
            token = await getMisaToken();
            const retry = await doDownloadRequest(token);
            result = retry.result;
            isSuccess = result.Success === true || result.success === true;
        }
    }

    const data = result.Data || result.data;
    if (!isSuccess || !data) {
        throw new Error(`Lá»—i táº£i PDF: ${result.ErrorCode || result.errorCode || JSON.stringify(result).substring(0, 200)}`);
    }

    // Data tráº£ vá» dáº¡ng: [{ TransactionID, Data (base64) }]
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
        // KhÃ´ng tráº£ password ra frontend
        return { success: true, data: { ...config, password: '' } }; // KhÃ´ng tráº£ password, frontend tá»± hiá»‡n placeholder
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('misa:saveConfig', async (event, config) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        // Náº¿u password rá»—ng hoáº·c lÃ  masked â†’ giá»¯ nguyÃªn password cÅ© (Ä‘Ã£ mÃ£ hÃ³a)
        if (!config.password || config.password === 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢') {
            const existing = await prisma.appConfig.findUnique({ where: { key: 'misaConfig' } });
            if (existing?.value) {
                const old = JSON.parse(existing.value);
                config.password = old.password; // Giá»¯ nguyÃªn password Ä‘Ã£ mÃ£ hÃ³a
            }
        } else {
            // MÃ£ hÃ³a password má»›i trÆ°á»›c khi lÆ°u
            config.password = encodeSecret(config.password);
        }
        await prisma.appConfig.upsert({
            where: { key: 'misaConfig' },
            update: { value: JSON.stringify(config) },
            create: { key: 'misaConfig', value: JSON.stringify(config) },
        });
        // Clear token cache khi Ä‘á»•i config
        invalidateMisaToken();
        console.log(`âœ… MISA config saved (password length: ${config.password?.length || 0})`);
        void logActivity({ module: 'einvoice', action: 'UPDATE', description: 'Cáº­p nháº­t cáº¥u hÃ¬nh MISA meInvoice', userName: 'Admin' });
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

// Láº¥y danh sÃ¡ch máº«u HÄ â€” TÃ i liá»‡u Má»¥c 3
ipcMain.handle('misa:getTemplates', async () => {
    try {
        const config = await getMisaConfig();
        const token = await getMisaToken();
        const baseUrl = config.env === 'live'
            ? 'https://api.meinvoice.vn/api/integration'
            : 'https://testapi.meinvoice.vn/api/integration';

        // Thá»­ nhiá»u combinations Ä‘á»ƒ tÃ¬m táº¥t cáº£ máº«u HÄ
        const queries = [
            'invoiceWithCode=true&ticket=false',
            'invoiceWithCode=false&ticket=false',
            'ticket=true',
            '', // KhÃ´ng filter
        ];

        let allTemplates = [];
        let lastResponse = '';
        for (const q of queries) {
            const url = q ? `${baseUrl}/invoice/templates?${q}` : `${baseUrl}/invoice/templates`;
            console.log(`ðŸ“‹ MISA: Trying templates URL: ${url}`);
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const responseText = await response.text();
            console.log(`ðŸ“‹ MISA Templates Response (${q}):`, responseText.substring(0, 500));

            let result;
            try { result = JSON.parse(responseText); } catch { continue; }

            const isSuccess = result.Success === true || result.success === true;
            let data = result.Data || result.data;

            // Data cÃ³ thá»ƒ lÃ  string JSON
            if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch { }
            }

            if (isSuccess && data) {
                if (Array.isArray(data) && data.length > 0) {
                    allTemplates = [...allTemplates, ...data];
                    break;
                } else if (typeof data === 'object' && !Array.isArray(data)) {
                    // CÃ³ thá»ƒ lÃ  object Ä‘Æ¡n
                    allTemplates.push(data);
                    break;
                }
            }
            // LÆ°u láº¡i response cuá»‘i Ä‘á»ƒ debug
            lastResponse = responseText.substring(0, 400);
        }

        // Loáº¡i bá» trÃ¹ng
        const uniqueMap = new Map();
        allTemplates.forEach(t => uniqueMap.set(t.InvSeries || t.invSeries, t));
        const unique = Array.from(uniqueMap.values());

        if (unique.length === 0) {
            return { success: false, error: `KhÃ´ng tÃ¬m tháº¥y máº«u HÄ. MISA Response: ${lastResponse || 'Empty'}` };
        }
        return { success: true, data: unique };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Xem nhÃ¡p HÄ (unpublishview) â€” TÃ i liá»‡u Má»¥c 4 â€” KHÃ”NG phÃ¡t hÃ nh, chá»‰ xem
ipcMain.handle('misa:previewInvoice', async (event, invoiceData) => {
    try {
        const config = await getMisaConfig();
        const token = await getMisaToken();
        const baseUrl = config.env === 'live'
            ? 'https://api.meinvoice.vn/api/integration'
            : 'https://testapi.meinvoice.vn/api/integration';
        console.log('ðŸ‘€ MISA Preview: Sending unpublishview...', JSON.stringify(invoiceData).substring(0, 500));
        const response = await fetch(`${baseUrl}/invoice/unpublishview`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(invoiceData),
        });
        const responseText = await response.text();
        console.log('ðŸ‘€ MISA Preview Response:', responseText.substring(0, 500));
        let result;
        try { result = JSON.parse(responseText); } catch {
            throw new Error(`MISA preview tráº£ vá» response khÃ´ng há»£p lá»‡ (status ${response.status})`);
        }
        const isSuccess = result.Success === true || result.success === true;
        const data = result.Data || result.data;
        if (!isSuccess || !data) {
            const errCode = result.ErrorCode || result.errorCode || '';
            const errors = result.Errors || result.errors || [];
            throw new Error(`Lá»—i xem nhÃ¡p: ${errCode} â€” ${Array.isArray(errors) ? errors.join(', ') : errors || JSON.stringify(result).substring(0, 300)}`);
        }
        return { success: true, data: data }; // data = link xem HÄ
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('misa:downloadPDF', async (event, transactionId) => {
    try {
        const base64PDF = await downloadMisaInvoicePDF(transactionId);
        // Cho user chá»n nÆ¡i lÆ°u
        const result = await dialog.showSaveDialog({
            title: 'LÆ°u hÃ³a Ä‘Æ¡n PDF',
            defaultPath: `HoaDon_${transactionId}.pdf`,
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (result.canceled || !result.filePath) return { success: false, error: 'ÄÃ£ há»§y' };
        fs.writeFileSync(result.filePath, Buffer.from(base64PDF, 'base64'));
        console.log(`âœ… PDF saved: ${result.filePath}`);
        return { success: true, data: { filePath: result.filePath } };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ========================================
// E-INVOICE / HÃ“A ÄÆ N ÄIá»†N Tá»¬ (HÄÄT)
// ========================================

// Láº¥y táº¥t cáº£ Ä‘Æ¡n HÄÄT
ipcMain.handle('einvoice:getAll', async () => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        const records = await prisma.eInvoice.findMany({
            orderBy: { createdAt: 'desc' }
        });
        const formatted = records.map(r => ({
            ...r,
            deliveryDate: r.deliveryDate.toISOString(),
            invoiceDate: r.invoiceDate ? r.invoiceDate.toISOString() : null,
            createdAt: r.createdAt.toISOString(),
        }));
        console.log(`âœ… Loaded ${records.length} einvoice records`);
        return { success: true, data: formatted };
    } catch (error) {
        console.error('âŒ einvoice:getAll error:', error.message);
        return { success: false, error: error.message };
    }
});

// Import hÃ ng loáº¡t â€” chá»‘ng trÃ¹ng orderId á»Ÿ táº§ng DB
ipcMain.handle('einvoice:bulkImport', async (event, orders) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        if (!Array.isArray(orders) || orders.length === 0) {
            return { success: false, error: 'KhÃ´ng cÃ³ Ä‘Æ¡n hÃ ng Ä‘á»ƒ import' };
        }

        const isTMDT = (platform) => ['Shopee', 'TikTok', 'Lazada', 'Sendo'].includes(platform);

        // Chuáº©n bá»‹ data batch
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

        // ðŸš€ Batch insert â€” 1 query duy nháº¥t thay vÃ¬ N queries
        const result = await prisma.eInvoice.createMany({
            data: dataForInsert,
            skipDuplicates: true, // Tá»± Ä‘á»™ng bá» qua orderId trÃ¹ng
        });

        const imported = result.count;
        const duplicated = orders.length - imported;

        console.log(`âœ… EInvoice import: ${imported} new, ${duplicated} duplicates skipped (batch insert)`);

        void logActivity({
            module: 'einvoice',
            action: 'CREATE',
            description: `Import ${imported} Ä‘Æ¡n HÄÄT${duplicated > 0 ? `, bá» qua ${duplicated} Ä‘Æ¡n trÃ¹ng` : ''} (batch)`,
            userName: 'System',
        });

        return {
            success: true,
            data: { imported, duplicated, duplicateIds: [] },
        };
    } catch (error) {
        console.error('âŒ einvoice:bulkImport error:', error.message);
        return { success: false, error: error.message };
    }
});

// Xem nhÃ¡p HÄ tá»« Ä‘Æ¡n hÃ ng tháº­t â€” gá»i unpublishview, KHÃ”NG phÃ¡t hÃ nh
ipcMain.handle('einvoice:previewDraft', async (event, orderId) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        const misaConfig = await getMisaConfig();
        const token = await getMisaToken();

        // Láº¥y Ä‘Æ¡n hÃ ng tá»« DB
        const order = await prisma.eInvoice.findFirst({ where: { orderId } });
        if (!order) throw new Error(`KhÃ´ng tÃ¬m tháº¥y Ä‘Æ¡n ${orderId}`);

        // Build data HÄ giá»‘ng khi xuáº¥t tháº­t
        let customerName = order.customerName;
        if (!customerName || customerName.trim() === '' || customerName === '***') {
            customerName = 'NgÆ°á»i mua khÃ´ng láº¥y hÃ³a Ä‘Æ¡n';
        }
        const invoiceData = buildMisaInvoiceData({ ...order, customerName }, misaConfig);
        delete invoiceData._refId;

        // Gá»i unpublishview
        const baseUrl = misaConfig.env === 'live'
            ? 'https://api.meinvoice.vn/api/integration'
            : 'https://testapi.meinvoice.vn/api/integration';

        console.log('ðŸ‘€ Preview Draft:', JSON.stringify(invoiceData).substring(0, 500));

        const response = await fetch(`${baseUrl}/invoice/unpublishview`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(invoiceData),
        });

        const responseText = await response.text();
        console.log('ðŸ‘€ Preview Response:', responseText.substring(0, 500));

        let result;
        try { result = JSON.parse(responseText); } catch {
            throw new Error(`MISA preview lá»—i (status ${response.status}): ${responseText.substring(0, 200)}`);
        }

        const isSuccess = result.Success === true || result.success === true;
        const data = result.Data || result.data;
        if (!isSuccess || !data) {
            const errCode = result.ErrorCode || result.errorCode || '';
            const errors = result.Errors || result.errors || [];
            throw new Error(`Lá»—i nhÃ¡p: ${errCode} â€” ${Array.isArray(errors) ? errors.join(', ') : JSON.stringify(result).substring(0, 300)}`);
        }

        return { success: true, data: data }; // data = link xem HÄ
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Xuáº¥t HÄÄT â€” gá»i MISA meInvoice API tháº­t (SignType=2 â€” HSM kÃ½ tá»± Ä‘á»™ng)
ipcMain.handle('einvoice:issueInvoices', async (event, orderIds) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return { success: false, error: 'KhÃ´ng cÃ³ Ä‘Æ¡n nÃ o Ä‘á»ƒ xuáº¥t' };
        }

        // Kiá»ƒm tra config MISA trÆ°á»›c
        let misaConfig;
        try {
            misaConfig = await getMisaConfig();
        } catch (configErr) {
            return { success: false, error: configErr.message };
        }

        // Chá»‰ láº¥y Ä‘Æ¡n PENDING â€” tuyá»‡t Ä‘á»‘i khÃ´ng xuáº¥t láº¡i
        const pendingOrders = await prisma.eInvoice.findMany({
            where: {
                orderId: { in: orderIds },
                status: 'pending',
            }
        });

        if (pendingOrders.length === 0) {
            return { success: false, error: 'Táº¥t cáº£ Ä‘Æ¡n Ä‘Ã£ Ä‘Æ°á»£c xuáº¥t HÄÄT trÆ°á»›c Ä‘Ã³!' };
        }

        const batchId = `BATCH-${Date.now()}`;
        const issuedOrders = [];
        const errorLog = [];

        // Xuáº¥t tá»«ng Ä‘Æ¡n qua MISA API (1 Ä‘Æ¡n = 1 API call Ä‘á»ƒ dá»… track lá»—i)
        for (const order of pendingOrders) {
            try {
                // Validate data
                let customerName = order.customerName;
                if (!customerName || customerName.trim() === '' || customerName === '***') {
                    customerName = 'NgÆ°á»i mua khÃ´ng láº¥y hÃ³a Ä‘Æ¡n';
                    await prisma.eInvoice.update({
                        where: { id: order.id },
                        data: { customerName }
                    });
                }

                const orderForBuild = { ...order, customerName };

                // Build MISA InvoiceData
                const invoiceData = buildMisaInvoiceData(orderForBuild, misaConfig);
                const refId = invoiceData._refId;
                delete invoiceData._refId; // XÃ³a field internal trÆ°á»›c khi gá»­i MISA

                // Gá»i MISA API phÃ¡t hÃ nh (SignType=2)
                const publishResults = await publishMisaInvoice([invoiceData]);

                if (!publishResults || publishResults.length === 0) {
                    throw new Error('MISA khÃ´ng tráº£ vá» káº¿t quáº£ phÃ¡t hÃ nh');
                }

                const misaResult = publishResults[0];

                // Kiá»ƒm tra lá»—i tá»« MISA cho tá»«ng HÄ
                if (misaResult.ErrorCode && misaResult.ErrorCode !== '') {
                    throw new Error(`MISA: ${misaResult.ErrorCode}`);
                }

                // ThÃ nh cÃ´ng â€” cáº­p nháº­t DB vá»›i dá»¯ liá»‡u tháº­t tá»« MISA
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

                console.log(`âœ… MISA issued: ${order.orderId} â†’ HÄ sá»‘ ${invoiceNumber} | MÃ£: ${transactionId}`);

                // Backup PDF lÃªn Google Drive & Telegram (cháº¡y ngáº§m)
                (async () => {
                    try {
                        const pdfBase64 = await downloadMisaInvoicePDF(transactionId);
                        const pdfBuffer = Buffer.from(pdfBase64, 'base64');
                        const pdfPath = path.join(os.tmpdir(), `HD_${invoiceNumber}_${transactionId}.pdf`);
                        fs.writeFileSync(pdfPath, pdfBuffer);

                        // LÆ°u path PDF vÃ o DB
                        await prisma.eInvoice.update({
                            where: { id: order.id },
                            data: { pdfFilePath: pdfPath }
                        });

                        console.log(`ðŸ“„ PDF saved: ${pdfPath}`);
                    } catch (backupErr) {
                        console.error(`âš ï¸ Backup PDF for ${invoiceNumber} failed:`, backupErr.message);
                    }
                })();

            } catch (orderErr) {
                console.error(`âŒ MISA issue error for ${order.orderId}:`, orderErr.message);
                errorLog.push({
                    orderId: order.orderId,
                    error: orderErr.message,
                    timestamp: new Date().toISOString(),
                });

                void logActivity({
                    module: 'einvoice',
                    action: 'ERROR',
                    description: `Lá»—i xuáº¥t HÄÄT MISA cho Ä‘Æ¡n ${order.orderId}: ${orderErr.message}`,
                    recordId: order.id,
                    severity: 'ERROR',
                    userName: 'System',
                });
            }
        }

        const skippedCount = orderIds.length - pendingOrders.length;

        console.log(`âœ… MISA Issued ${issuedOrders.length} einvoices (skipped ${skippedCount} already issued, ${errorLog.length} errors)`);

        // Gá»­i tÃ³m táº¯t batch lÃªn Telegram
        if (issuedOrders.length > 0) {
            const totalAmount = pendingOrders
                .filter(o => issuedOrders.some(i => i.orderId === o.orderId))
                .reduce((s, o) => s + (o.totalAmount || 0), 0);
            const summaryMsg = `ðŸ“Š <b>BATCH XUáº¤T HÄÄT (MISA)</b>\n` +
                `â”â”â”â”â”â”â”â”â”â”â”â”â”â”\n` +
                `ðŸ§¾ Sá»‘ HÄ: ${issuedOrders.length}\n` +
                `ðŸ’° Tá»•ng: ${totalAmount.toLocaleString('vi-VN')}Ä‘\n` +
                `ðŸ“‹ Batch: ${batchId}\n` +
                `ðŸ”‘ KÃ½ sá»‘: HSM (SignType=2)\n` +
                `ðŸ“… ${new Date().toLocaleDateString('vi-VN')} ${new Date().toLocaleTimeString('vi-VN')}\n` +
                (skippedCount > 0 ? `âš ï¸ Bá» qua: ${skippedCount} Ä‘Æ¡n Ä‘Ã£ xuáº¥t\n` : '') +
                (errorLog.length > 0 ? `âŒ Lá»—i: ${errorLog.length} Ä‘Æ¡n\n` : '') +
                `â”â”â”â”â”â”â”â”â”â”â”â”â”â”`;
            sendTelegramMessage(summaryMsg).catch(err => console.error('Telegram summary error:', err));
        }

        void logActivity({
            module: 'einvoice',
            action: 'UPDATE',
            description: `MISA: Xuáº¥t ${issuedOrders.length} HÄÄT tháº­t (batch: ${batchId}, HSM kÃ½ sá»‘)${skippedCount > 0 ? ` â€” Bá» qua ${skippedCount} Ä‘Æ¡n Ä‘Ã£ xuáº¥t` : ''}${errorLog.length > 0 ? ` â€” ${errorLog.length} Ä‘Æ¡n lá»—i` : ''}`,
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
        console.error('âŒ einvoice:issueInvoices error:', error.message);
        return { success: false, error: error.message };
    }
});

// Thá»‘ng kÃª
ipcMain.handle('einvoice:getStats', async () => {
    try {
        if (!prisma) throw new Error('Database not initialized');

        // ðŸš€ Gá»™p thÃ nh 2 queries thay vÃ¬ 5 + ÃP Dá»¤NG Bá»˜ Lá»ŒC 3 NGÃ€Y CHá»NG Äáº¾M TRÃ€N RÃC (842 bills cÅ©)
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

// Xuáº¥t Excel bÃ¡o cÃ¡o
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
            return { success: false, error: 'KhÃ´ng cÃ³ dá»¯ liá»‡u Ä‘á»ƒ xuáº¥t' };
        }

        // Táº¡o data cho Excel
        const excelData = records.map((r, idx) => {
            let items = [];
            try { items = JSON.parse(r.items); } catch { }

            return {
                'STT': idx + 1,
                'SÃ n': r.platform,
                'MÃ£ Ä‘Æ¡n hÃ ng': r.orderId,
                'KhÃ¡ch hÃ ng': r.customerName,
                'SÄT': r.customerPhone || '',
                'Sáº£n pháº©m': items.map(i => `${i.productName} x${i.quantity}`).join('; '),
                'Tá»•ng SL': r.totalQuantity,
                'ThÃ nh tiá»n': r.totalAmount,
                'NgÃ y giao': r.deliveryDate ? new Date(r.deliveryDate).toLocaleDateString('vi-VN') : '',
                'Sá»‘ HÄÄT': r.invoiceNumber || '',
                'NgÃ y xuáº¥t HÄ': r.invoiceDate ? new Date(r.invoiceDate).toLocaleDateString('vi-VN') : '',
                'MÃ£ tra cá»©u': r.taxCode || '',
                'Tráº¡ng thÃ¡i': r.status === 'issued' ? 'ÄÃ£ xuáº¥t' : 'ChÆ°a xuáº¥t',
                'File gá»‘c': r.sourceFile || '',
            };
        });

        const ws = XLSX.utils.json_to_sheet(excelData);

        // Set column widths
        ws['!cols'] = [
            { wch: 5 },  // STT
            { wch: 10 }, // SÃ n
            { wch: 25 }, // MÃ£ Ä‘Æ¡n
            { wch: 20 }, // KhÃ¡ch hÃ ng
            { wch: 15 }, // SÄT
            { wch: 50 }, // Sáº£n pháº©m
            { wch: 8 },  // Tá»•ng SL
            { wch: 15 }, // ThÃ nh tiá»n
            { wch: 12 }, // NgÃ y giao
            { wch: 15 }, // Sá»‘ HÄÄT
            { wch: 12 }, // NgÃ y xuáº¥t
            { wch: 18 }, // MÃ£ tra cá»©u
            { wch: 12 }, // Tráº¡ng thÃ¡i
            { wch: 30 }, // File gá»‘c
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'HÄÄT');

        // Show save dialog
        const result = await dialog.showSaveDialog({
            title: 'Xuáº¥t bÃ¡o cÃ¡o HÄÄT',
            defaultPath: `BaoCao_HDDT_${new Date().toISOString().slice(0, 10)}.xlsx`,
            filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        });

        if (result.canceled || !result.filePath) {
            return { success: false, error: 'ÄÃ£ há»§y xuáº¥t file' };
        }

        XLSX.writeFile(wb, result.filePath);
        console.log(`âœ… Exported ${records.length} einvoice records to ${result.filePath}`);

        void logActivity({
            module: 'einvoice',
            action: 'EXPORT',
            description: `Xuáº¥t bÃ¡o cÃ¡o HÄÄT: ${records.length} dÃ²ng â†’ ${path.basename(result.filePath)}`,
            userName: 'System',
        });

        return { success: true, data: { filePath: result.filePath, count: records.length } };
    } catch (error) {
        console.error('âŒ einvoice:exportExcel error:', error.message);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('einvoice:delete', async (event, id) => {
    try {
        requireRole('admin');
        if (!prisma) throw new Error('Database not initialized');
        await prisma.eInvoice.delete({ where: { id: parseInt(id) } });
        console.log(`âœ… Deleted einvoice #${id}`);
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
            return { success: false, error: 'KhÃ´ng cÃ³ Ä‘Æ¡n Ä‘á»ƒ xÃ³a' };
        }
        const result = await prisma.eInvoice.deleteMany({
            where: { orderId: { in: orderIds } }
        });
        console.log(`âœ… Bulk deleted ${result.count} einvoice records`);
        void logActivity({
            module: 'einvoice', action: 'DELETE',
            description: `XÃ³a hÃ ng loáº¡t ${result.count} Ä‘Æ¡n HÄÄT`,
            userName: 'Admin',
        });
        return { success: true, data: { deleted: result.count } };
    } catch (error) {
        console.error('âŒ einvoice:bulkDelete error:', error.message);
        return { success: false, error: error.message };
    }
});

// âš ï¸ TEST ONLY â€” XÃ³a toÃ n bá»™ HÄÄT (sáº½ táº¯t sau khi test xong)
ipcMain.handle('einvoice:deleteAll', async () => {
    try {
        requireRole('admin');
        if (!prisma) throw new Error('Database not initialized');
        const result = await prisma.eInvoice.deleteMany({});
        console.log(`âš ï¸ DELETED ALL ${result.count} einvoice records`);
        void logActivity({
            module: 'einvoice', action: 'DELETE',
            description: `âš ï¸ XÃ“A Táº¤T Cáº¢ ${result.count} Ä‘Æ¡n HÄÄT (TEST MODE)`,
            userName: 'Admin',
        });
        return { success: true, data: { deleted: result.count } };
    } catch (error) {
        console.error('âŒ einvoice:deleteAll error:', error.message);
        return { success: false, error: error.message };
    }
});

// ============================================================
// TASK 1: Truy xuáº¥t HÄ gá»‘c
// ============================================================
ipcMain.handle('einvoice:getOriginalInvoice', async (event, orderId) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        const invoice = await prisma.eInvoice.findFirst({
            where: { orderId, status: 'issued' },
        });
        if (!invoice) {
            return { success: false, error: `ÄÆ¡n ${orderId} chÆ°a cÃ³ HÄÄT â€” khÃ´ng thá»ƒ Ä‘iá»u chá»‰nh` };
        }
        return { success: true, data: invoice };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ============================================================
// TASK 2+3+4: Äiá»u chá»‰nh / Há»§y hÃ³a Ä‘Æ¡n
// ============================================================
function buildAdjustmentPayload(orig, adjustmentType, reason) {
    let items = [];
    try { items = typeof orig.items === 'string' ? JSON.parse(orig.items) : orig.items; } catch (e) { items = []; }

    const autoReason = reason || `Tráº£ láº¡i hÃ ng hÃ³a cho HÄ Máº«u sá»‘ ${orig.templateCode || 'N/A'}, KÃ½ hiá»‡u ${orig.invoiceSeries || 'N/A'}, Sá»‘ ${orig.invoiceNumber}, ngÃ y ${orig.invoiceDate ? new Date(orig.invoiceDate).toLocaleDateString('vi-VN') : 'N/A'}`;

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
            Unit: 'CÃ¡i',
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

        // TÃ¬m HÄ gá»‘c (issued HOáº¶C adjusted â€” Ä‘Ã£ Ä‘iá»u chá»‰nh 1 pháº§n váº«n cho tiáº¿p)
        const orig = await prisma.eInvoice.findFirst({
            where: { orderId, status: { in: ['issued', 'adjusted'] }, adjustmentType: null },
            orderBy: { createdAt: 'asc' },
        });
        if (!orig) return { success: false, error: `ÄÆ¡n ${orderId} chÆ°a cÃ³ HÄÄT hoáº·c Ä‘Ã£ bá»‹ há»§y` };

        // TÃ¬m chain Ä‘iá»u chá»‰nh
        const chain = await prisma.eInvoice.findMany({
            where: { refInvoiceId: orig.id },
            orderBy: { createdAt: 'asc' },
        });

        const totalAdjusted = chain.reduce((sum, inv) => sum + Math.abs(inv.totalAmount || 0), 0);
        const remaining = (orig.totalAmount || 0) - totalAdjusted;

        if (remaining <= 0) {
            return { success: false, error: `HÄ ${orig.invoiceNumber} Ä‘Ã£ Ä‘iá»u chá»‰nh háº¿t (${totalAdjusted.toLocaleString()}Ä‘ / ${(orig.totalAmount || 0).toLocaleString()}Ä‘)` };
        }

        // NÄ 123: giá»¯ nguyÃªn hÃ¬nh thá»©c láº§n Ä‘áº§u
        if (chain.length > 0 && chain[0].adjustmentType && chain[0].adjustmentType !== adjustmentType) {
            return { success: false, error: `Theo NÄ 123/2020: Láº§n Ä‘áº§u Ä‘Ã£ chá»n "${chain[0].adjustmentType}", cÃ¡c láº§n sau pháº£i giá»¯ nguyÃªn.` };
        }

        // XÃ¡c Ä‘á»‹nh items + amount
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

        // Validate khÃ´ng vÆ°á»£t remaining
        if (adjAmount > remaining + 0.01) {
            return { success: false, error: `VÆ°á»£t quÃ¡: ${adjAmount.toLocaleString()}Ä‘ > cÃ²n láº¡i ${remaining.toLocaleString()}Ä‘` };
        }

        // Tham chiáº¿u HÄ cuá»‘i chain (NÄ 123 yÃªu cáº§u)
        const lastInChain = chain.length > 0 ? chain[chain.length - 1] : orig;
        const chainNum = chain.length + 1;
        const autoReason = reason || `Äiá»u chá»‰nh láº§n ${chainNum} cho HÄ Sá»‘ ${lastInChain.invoiceNumber}, ngÃ y ${lastInChain.invoiceDate ? new Date(lastInChain.invoiceDate).toLocaleDateString('vi-VN') : 'N/A'}`;

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

        console.log(`âœ… Äiá»u chá»‰nh láº§n ${chainNum}: ${orig.invoiceNumber} â†’ ${newNum} | -${adjAmount.toLocaleString()}Ä‘ | CÃ²n láº¡i: ${(remaining - adjAmount).toLocaleString()}Ä‘`);
        void logActivity({
            module: 'einvoice', action: adjustmentType === 'replacement' ? 'REPLACE' : 'ADJUST',
            description: `Láº§n ${chainNum}: ${orig.invoiceNumber} â†’ ${newNum}. -${adjAmount.toLocaleString()}Ä‘. CÃ²n: ${(remaining - adjAmount).toLocaleString()}Ä‘. ${autoReason}`,
            userName: 'System',
        });

        return {
            success: true, data: {
                originalInvoice: orig.invoiceNumber, newInvoice: newNum, adjustmentType, reason: autoReason,
                chainNumber: chainNum, totalAdjusted: totalAdjusted + adjAmount, remaining: remaining - adjAmount,
            }
        };
    } catch (error) {
        console.error('âŒ einvoice:adjustInvoice error:', error.message);
        return { success: false, error: error.message };
    }
});

// Láº¥y chuá»—i chain HÄ Ä‘iá»u chá»‰nh
ipcMain.handle('einvoice:getInvoiceChain', async (event, orderId) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        const orig = await prisma.eInvoice.findFirst({ where: { orderId, adjustmentType: null }, orderBy: { createdAt: 'asc' } });
        if (!orig) return { success: false, error: 'KhÃ´ng tÃ¬m tháº¥y HÄ gá»‘c' };
        const adjustments = await prisma.eInvoice.findMany({ where: { refInvoiceId: orig.id }, orderBy: { createdAt: 'asc' } });
        const totalAdjusted = adjustments.reduce((sum, inv) => sum + Math.abs(inv.totalAmount || 0), 0);
        return { success: true, data: { original: orig, adjustments, totalAdjusted, remaining: (orig.totalAmount || 0) - totalAdjusted, chainLength: adjustments.length } };
    } catch (error) { return { success: false, error: error.message }; }
});

// ========================================
// ZKTECO / RONALD JACK â€” MÃY CHáº¤M CÃ”NG VÃ‚N TAY
// ========================================
// Ronald Jack 1800 WiFi chá»‰ há»— trá»£ ADMS Push (HTTP).
// MÃ¡y tá»± gá»­i data lÃªn server, KHÃ”NG há»— trá»£ Pull (UDP/ZK Protocol).

const admsServer = require('./zkteco-adms');

// Auto-start ADMS server khi app khá»Ÿi Ä‘á»™ng
(async () => {
    try {
        await admsServer.startServer(5005);
        console.log('âœ… [ADMS] Server Ä‘Ã£ tá»± Ä‘á»™ng khá»Ÿi Ä‘á»™ng trÃªn port 5005');
    } catch (err) {
        console.error('âŒ [ADMS] KhÃ´ng thá»ƒ khá»Ÿi Ä‘á»™ng server:', err.message);
    }
})();

// Start/Stop ADMS server
ipcMain.handle('zkteco:connect', async (event, config) => {
    try {
        console.log('ðŸ”Œ [IPC] zkteco:connect (ADMS mode)');
        const result = await admsServer.startServer(config?.port || 8098);
        return result;
    } catch (error) {
        console.error('âŒ zkteco:connect error:', error.message);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('zkteco:disconnect', async () => {
    try {
        return admsServer.stopServer();
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Tráº¡ng thÃ¡i ADMS server
ipcMain.handle('zkteco:getStatus', async () => {
    try {
        return { success: true, data: admsServer.getStatus() };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Láº¥y danh sÃ¡ch NV Ä‘Ã£ nháº­n tá»« ADMS
ipcMain.handle('zkteco:getUsers', async () => {
    try {
        const data = admsServer.getData();
        return { success: true, data: data.users, count: data.userCount };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Láº¥y logs cháº¥m cÃ´ng Ä‘Ã£ nháº­n tá»« ADMS
ipcMain.handle('zkteco:getAttendanceLogs', async () => {
    try {
        const data = admsServer.getData();
        return { success: true, data: data.logs, count: data.logCount };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Full sync: láº¥y toÃ n bá»™ data Ä‘Ã£ nháº­n tá»« ADMS push
ipcMain.handle('zkteco:fullSync', async (event, config) => {
    try {
        console.log('ðŸ”„ [IPC] zkteco:fullSync (ADMS mode) â€” láº¥y data Ä‘Ã£ nháº­n');

        // Äáº£m báº£o server Ä‘ang cháº¡y
        if (!admsServer.getStatus().isRunning) {
            await admsServer.startServer(config?.port || 5005);
        }

        const data = admsServer.getData();

        if (data.logCount > 0) {
            void logActivity({
                module: 'attendance',
                action: 'SYNC',
                description: `Láº¥y dá»¯ liá»‡u ADMS: ${data.logCount} báº£n ghi, ${data.userCount} nhÃ¢n viÃªn`,
                userName: currentSession?.username || 'Admin',
            });
        }

        return data;
    } catch (error) {
        console.error('âŒ zkteco:fullSync error:', error.message);
        return { success: false, error: error.message };
    }
});

// ZKBridge: Goi ZKBridge.exe (C# + Zkemkeeper.dll) de keo data truc tiep tu may
ipcMain.handle('zkteco:zkbridge', async (event, config) => {
    const { execFile } = require('child_process');
    const path = require('path');
    const fs = require('fs');

    const ip = config && config.ip ? config.ip : '192.168.0.225';
    const port = config && config.port ? config.port : 4370;

    const exePath = path.join(__dirname, '..', 'planing', 'zkteco-bridge', 'ZKBridge.exe');
    const outputPath = path.join(__dirname, '..', 'planing', 'zkteco-bridge', 'attendance_output.json');

    if (!fs.existsSync(exePath)) {
        return { success: false, error: 'ZKBridge.exe chua duoc build. Chay build.bat trong planing/zkteco-bridge/' };
    }

    return new Promise(function (resolve) {
        console.log('[ZKBridge] Goi ' + exePath + ' ' + ip + ':' + port);
        execFile(exePath, [ip, String(port)], { timeout: 30000 }, function (err, stdout, stderr) {
            if (stdout) console.log('[ZKBridge stdout]', stdout);
            if (stderr) console.error('[ZKBridge stderr]', stderr);

            if (fs.existsSync(outputPath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
                    const logs = (data.logs || []).map(function (l) {
                        return Object.assign({}, l, {
                            time: l.timestamp,
                            empId: parseInt(l.odUserId, 10) || 0,
                            empNameFallback: 'NV #' + l.odUserId,
                            status: 'OK',
                            source: 'ZKBridge',
                        });
                    });
                    resolve({ success: data.success, logs: logs, logCount: logs.length, userCount: 0, syncTime: data.syncTime });
                } catch (e) {
                    resolve({ success: false, error: 'Loi parse JSON: ' + e.message });
                }
            } else {
                resolve({ success: false, error: (err && err.message) || 'ZKBridge.exe khong tao duoc output file' });
            }
        });
    });
});

// ========================================
// ATTENDANCE / CHáº¤M CÃ”NG KHUÃ”N Máº¶T
// On-demand: Python chá»‰ cháº¡y khi vÃ o tab Äiá»ƒm danh
// Tá»± táº¯t sau 10 phÃºt ko dÃ¹ng
// ========================================

const net = require('net');

const FACE_SERVICE_URL = 'http://127.0.0.1:5001';
const FACE_SERVICE_PORT = 5001;
const FACE_SERVICE_IDLE_TIMEOUT = 30 * 60 * 1000; // TÄƒng lÃªn 30 phÃºt thay vÃ¬ 10 phÃºt
const FACE_SERVICE_NAME = 'attendance';

let faceServiceProcess = null;   // child_process reference
let faceServiceReady = false;
let faceServiceIdleTimer = null;
let faceExeDisabled = false;

// Reset idle timer má»—i khi cÃ³ request â†’ tá»± kill sau 30 phÃºt idle
function resetFaceServiceIdleTimer() {
    if (faceServiceIdleTimer) clearTimeout(faceServiceIdleTimer);
    faceServiceIdleTimer = setTimeout(async () => {
        if (faceServiceProcess) {
            console.log('[Face] â¹ Tá»± táº¯t Python service sau 30 phÃºt khÃ´ng dÃ¹ng');
            try {
                await faceServiceFetch('/shutdown', { method: 'POST' });
            } catch { /* Python Ä‘Ã£ táº¯t hoáº·c khÃ´ng pháº£n há»“i */ }
            // Chá» 2s cho Python tá»± thoÃ¡t
            await new Promise(r => setTimeout(r, 2000));
            // Náº¿u váº«n cÃ²n sá»‘ng thÃ¬ force kill
            if (faceServiceProcess) {
                faceServiceProcess.kill();
                faceServiceProcess = null;
            }
            faceServiceReady = false;
        }
    }, FACE_SERVICE_IDLE_TIMEOUT);
}

// Spawn Python service on-demand
let _faceLastSpawnFail = 0;      // Timestamp láº§n spawn tháº¥t báº¡i cuá»‘i
let _ensurePromise = null;       // Promise quáº£n lÃ½ viá»‡c spawn chá»‘ng race condition

function isLiveFaceService(data) {
    // Service Ä‘Ã£ sá»‘ng (cÃ³ thá»ƒ Ä‘ang initializing hoáº·c ready)
    return Boolean(
        data &&
        data.ok === true &&
        data.service === FACE_SERVICE_NAME &&
        (data.status === 'ready' || data.status === 'initializing') &&
        data.version !== undefined
    );
}

function isValidFaceServiceStatus(data) {
    // Service Ä‘Ã£ sá»‘ng VÃ€ sáºµn sÃ ng xá»­ lÃ½ request
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
        console.log(`[Face] Chá» port ${FACE_SERVICE_PORT} free... láº§n ${attempt}/${maxAttempts}`);
        await sleep(delayMs);
    }
    return false;
}

function ensureFaceService() {
    // Náº¿u Ä‘ang cÃ³ 1 tiáº¿n trÃ¬nh spawn dang dá»Ÿ, tráº£ vá» luÃ´n tiáº¿n trÃ¬nh Ä‘Ã³ (Chá»‘ng Race Condition)
    if (_ensurePromise) return _ensurePromise;

    _ensurePromise = (async () => {
        try {
            // 1. ÄÃ£ cháº¡y vÃ  ready â†’ dÃ¹ng luÃ´n
            if (faceServiceProcess && faceServiceReady) {
                resetFaceServiceIdleTimer();
                return true;
            }

            // 2. Kiá»ƒm tra port 5001 Ä‘Ã£ cÃ³ service sáºµn chÆ°a (zombie hoáº·c process tá»« láº§n trÆ°á»›c)
            try {
                const data = await faceServiceFetch('/status');
                if (isValidFaceServiceStatus(data)) {
                    console.log('[Face] âœ… PhÃ¡t hiá»‡n service Ä‘ang cháº¡y sáºµn trÃªn port 5001');
                    faceServiceReady = true;
                    resetFaceServiceIdleTimer();
                    return true;
                }
                console.warn('[Face] âš ï¸ Port 5001 cÃ³ pháº£n há»“i nhÆ°ng khÃ´ng Ä‘Ãºng attendance service, sáº½ thay tháº¿ báº±ng service ná»™i bá»™');
            } catch {
                // Port chÆ°a cÃ³ service â†’ sáº½ spawn bÃªn dÆ°á»›i
            }

            // 3. Cooldown: trÃ¡nh spawn loop (Ä‘á»£i 10s giá»¯a cÃ¡c láº§n tháº¥t báº¡i)
            const cooldown = Date.now() - _faceLastSpawnFail;
            if (cooldown < 10000) {
                throw new Error(`Äá»£i ${Math.ceil((10000 - cooldown) / 1000)}s trÆ°á»›c khi thá»­ láº¡i`);
            }

            // 4. Spawn má»›i
            const { spawn, execSync } = require('child_process');

            // Kill process Ä‘ang giá»¯ port 5001 rá»“i chá» Windows nháº£ port tháº­t sá»±.
            try {
                killProcessOnFacePort(execSync);
            } catch {
                /* Bá» qua náº¿u lá»‡nh kill lá»—i hoáº·c khÃ´ng cÃ³ ai dÃ¹ng port */
            }
            if (!(await waitForFacePortFree())) {
                throw new Error(`Port ${FACE_SERVICE_PORT} khÃ´ng giáº£i phÃ³ng Ä‘Æ°á»£c sau 10s`);
            }

            // â”€â”€ XÃ¡c Ä‘á»‹nh cÃ¡ch cháº¡y: EXE (Æ°u tiÃªn) hoáº·c Python (fallback) â”€â”€â”€â”€â”€â”€
            const exePath = path.join(__dirname, '..', 'python', 'dist', 'attendance_service.exe');
            const scriptPath = path.join(__dirname, '..', 'python', 'attendance_service.py');
            let spawnCmd, spawnArgs;

            const preferFaceExe = app.isPackaged && !faceExeDisabled;
            if (preferFaceExe && fs.existsSync(exePath)) {
                console.log('[Face] ðŸš€ DÃ¹ng attendance_service.exe (standalone)');
                spawnCmd = exePath;
                spawnArgs = [];
            } else if (fs.existsSync(scriptPath)) {
                if (!app.isPackaged && fs.existsSync(exePath)) {
                    console.log('[Face] ðŸ›  Dev mode â†’ bá» qua attendance_service.exe, dÃ¹ng Python script Ä‘á»ƒ debug á»•n Ä‘á»‹nh hÆ¡n');
                } else if (faceExeDisabled) {
                    console.log('[Face] âš ï¸ attendance_service.exe Ä‘Ã£ bá»‹ vÃ´ hiá»‡u hÃ³a cho phiÃªn nÃ y â†’ fallback sang Python script');
                }
                console.log('[Face] ðŸ KhÃ´ng cÃ³ EXE â†’ tÃ¬m Python...');
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

                    console.log(`[Face] ðŸ” TÃ¬m Python cÃ³ face_recognition (${candidates.length} candidates, users: ${usernames.join(',')})`);

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

                            console.log(`[Face]   âœ… CHá»ŒN: ${c.exe} ${c.args.join(' ')} â†’ cÃ³ face_recognition`);
                            return c;
                        } catch (err) { }
                    }
                    return null;
                }
                const pyFound = findPythonForFace();
                if (!pyFound) {
                    throw new Error('KhÃ´ng cÃ³ EXE vÃ  khÃ´ng tÃ¬m tháº¥y Python. LiÃªn há»‡ ká»¹ thuáº­t.');
                }
                spawnCmd = pyFound.exe;
                spawnArgs = [...pyFound.args, scriptPath];
            } else {
                throw new Error('KhÃ´ng tÃ¬m tháº¥y attendance_service.exe hoáº·c .py');
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
                console.error('[Face] âŒ KhÃ´ng thá»ƒ cháº¡y Python:', err.message);
                faceServiceProcess = null;
                faceServiceReady = false;
                _faceLastSpawnFail = Date.now();
            });

            faceServiceProcess.on('exit', (code) => {
                console.log(`[Face] Python service exited (code ${code})`);
                if (spawnCmd === exePath && code !== 0) {
                    faceExeDisabled = true;
                    console.warn('[Face] âš ï¸ attendance_service.exe lá»—i, sáº½ fallback sang Python script á»Ÿ láº§n thá»­ tiáº¿p theo');
                }
                faceServiceProcess = null;
                faceServiceReady = false;
                if (code !== 0) _faceLastSpawnFail = Date.now();
                if (faceServiceIdleTimer) { clearTimeout(faceServiceIdleTimer); faceServiceIdleTimer = null; }
            });

            // Poll chá» service sá»‘ng (initializing hoáº·c ready Ä‘á»u OK)
            // KHÃ”NG Ä‘á»£i ready vÃ¬ rebuild encodings cÃ³ thá»ƒ > 30s trÃªn mÃ¡y cháº­m
            return await new Promise((res, rej) => {
                let attempts = 0;
                const maxAttempts = 180; // 180 x 500ms = 90s (mÃ¡y khÃ¡ch cháº­m cáº§n thÃªm thá»i gian load)
                const pollReady = setInterval(async () => {
                    attempts++;
                    if (!faceServiceProcess) {
                        clearInterval(pollReady);
                        _faceLastSpawnFail = Date.now();
                        return rej(new Error('Python process thoÃ¡t báº¥t ngá»'));
                    }
                    try {
                        const statusData = await faceServiceFetch('/status');
                        if (isLiveFaceService(statusData)) {
                            clearInterval(pollReady);
                            // Náº¿u Ä‘Ã£ ready thÃ¬ set luÃ´n, náº¿u initializing thÃ¬ chÆ°a set ready
                            if (statusData.status === 'ready') {
                                faceServiceReady = true;
                                console.log(`[Face] âœ… Python face service sáºµn sÃ ng sau ${attempts * 0.5}s!`);
                            } else {
                                console.log(`[Face] âœ… Python service Ä‘Ã£ má»Ÿ port sau ${attempts * 0.5}s (Ä‘ang load encodings...)`);
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
                            console.error('[Face] âŒ Python service khÃ´ng pháº£n há»“i sau 90s');
                            if (faceServiceProcess) { faceServiceProcess.kill(); faceServiceProcess = null; }
                            rej(new Error('Python service khá»Ÿi Ä‘á»™ng tháº¥t báº¡i (Timeout 90s)'));
                        }
                    }
                }, 500);
            });

        } catch (err) {
            _faceLastSpawnFail = Date.now();
            throw err;
        } finally {
            // Khi spawn thÃ nh cÃ´ng hoáº·c tháº¥t báº¡i, giáº£i phÃ³ng Promise Ä‘á»ƒ lá»‡nh sau cÃ³ thá»ƒ thá»­ láº¡i
            _ensurePromise = null;
        }
    })();

    return _ensurePromise;
}

// Tá»± dá»n process khi app thoÃ¡t
app.on('before-quit', () => {
    if (faceServiceProcess) {
        console.log('[Face] ðŸ§¹ Táº¯t Python service khi app thoÃ¡t');
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
        // /register: 120s (50 áº£nh Ã— HOG + encoding), /recognize: 15s, /profile (delete+rebuild): 60s, cÃ²n láº¡i: 5s
        const timeout = urlPath.includes('/register') ? 120000 : urlPath.includes('/recognize') ? 15000 : urlPath.includes('/profile') ? 60000 : 5000;
        req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

// XÃ¡c Ä‘á»‹nh loáº¡i cháº¥m cÃ´ng theo giá» hiá»‡n táº¡i
function getCheckType() {
    const h = new Date().getHours();
    const m = new Date().getMinutes();
    const total = h * 60 + m;

    // Ca sÃ¡ng
    // Check-in: 07:00 Ä‘áº¿n trÆ°á»›c 11:50
    // Check-out: 11:50 Ä‘áº¿n 12:30
    if (total >= 7 * 60 && total <= 12 * 60 + 30) {
        if (total < 11 * 60 + 50) return 'morning_in';
        return 'morning_out';
    }

    // Ca chiá»u
    // Check-in: 13:00 Ä‘áº¿n trÆ°á»›c 17:30
    // Check-out: 17:30 Ä‘áº¿n 20:30
    if (total >= 13 * 60 && total <= 20 * 60 + 30) {
        if (total < 17 * 60 + 30) return 'afternoon_in';
        return 'evening_out';
    }

    // DEBUG: Táº¡m bá» giá»›i háº¡n giá» â€” luÃ´n cho phÃ©p cháº¥m cÃ´ng
    // NgoÃ i khung giá» â†’ tá»± chá»n ca gáº§n nháº¥t thay vÃ¬ block
    if (total < 7 * 60) return 'morning_in';           // TrÆ°á»›c 7h â†’ coi nhÆ° sÃ¡ng vÃ o sá»›m
    if (total <= 13 * 60) return 'morning_out';         // 12:30-13:00 (nghá»‰ trÆ°a) â†’ sÃ¡ng ra
    return 'evening_out';                               // Sau 20:30 â†’ tá»‘i ra
}

// Kiá»ƒm tra + tá»± khá»Ÿi Ä‘á»™ng Python service khi vÃ o tab Äiá»ƒm danh
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
        // Tá»± Ä‘á»™ng spawn Python náº¿u chÆ°a cháº¡y
        await ensureFaceService();
        const data = await faceServiceFetch('/status');
        if (!isLiveFaceService(data)) {
            throw new Error('Attendance service tráº£ vá» /status khÃ´ng há»£p lá»‡: ' + JSON.stringify(data));
        }
        // Náº¿u Ä‘ang initializing â†’ váº«n bÃ¡o success nhÆ°ng ghi nháº­n chÆ°a ready
        if (data.status === 'ready' && !faceServiceReady) {
            faceServiceReady = true;
        }
        console.log('[Face:status] OK â†’', data.status);
        return { success: true, data, debug };
    } catch (err) {
        console.warn('[Face:status] FAILED:', err.message);
        return { success: false, error: err.message || 'Python service chÆ°a sáºµn sÃ ng', debug };
    }
});

// PhÃ¡t hiá»‡n khuÃ´n máº·t (khÃ´ng so khá»›p) â€” dÃ¹ng cho modal Ä‘Äƒng kÃ½
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
        console.error('âŒ attendance:detect error:', err.message);
        return { success: false, error: err.message };
    }
});

// Nháº­n diá»‡n khuÃ´n máº·t + ghi cháº¥m cÃ´ng
ipcMain.handle('attendance:recognize', async (event, { image }) => {
    try {
        await ensureFaceService();
        resetFaceServiceIdleTimer();
        const result = await faceServiceFetch('/recognize', {
            method: 'POST',
            body: JSON.stringify({ image }),
        });

        // â”€â”€ DEBUG LOG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        console.log('[Face DEBUG] Python result:', JSON.stringify({
            found: result.found,
            face_id: result.face_id,
            reason: result.reason,
            confidence: result.confidence,
            dist: result.dist,
            _debug: result._debug,
        }));

        // LuÃ´n Ä‘Ã­nh kÃ¨m face_box Ä‘á»ƒ frontend váº½ overlay real-time
        const faceInfo = {
            face_box: result.face_box || null,
            img_width: result.img_width || 640,
            img_height: result.img_height || 480,
        };

        // KhÃ´ng phÃ¡t hiá»‡n máº·t
        if (!result.found) return { success: false, reason: result.reason, ...faceInfo };

        // PhÃ¡t hiá»‡n máº·t nhÆ°ng khÃ´ng khá»›p profile nÃ o
        if (!result.face_id) return { success: false, reason: 'no_match', ...faceInfo };

        // Láº¥y thÃ´ng tin user tá»« FaceProfile (cáº§n trÆ°á»›c cáº£ out_of_hours Ä‘á»ƒ cÃ³ userName)
        const profile = await prisma.faceProfile.findUnique({ where: { faceId: result.face_id } });
        const userName = profile?.userName || result.face_id;
        const userId = profile?.userId || null;

        const checkType = getCheckType();
        if (!checkType) return { success: false, reason: 'out_of_hours', face_id: result.face_id, userName, ...faceInfo };

        // Kiá»ƒm tra trÃ¹ng trong 30 phÃºt
        const since = new Date(Date.now() - 30 * 60 * 1000);
        const today = new Date().toISOString().slice(0, 10);
        const existing = await prisma.attendanceLog.findFirst({
            where: { faceId: result.face_id, checkType, date: today, timestamp: { gte: since } }
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
        console.error('âŒ attendance:recognize error:', err.message);
        return { success: false, error: err.message };
    }
});

// ÄÄƒng kÃ½ khuÃ´n máº·t nhÃ¢n viÃªn
ipcMain.handle('attendance:register', async (event, { face_id, user_name, user_id, images }) => {
    try {
        await ensureFaceService();
        resetFaceServiceIdleTimer();
        const result = await faceServiceFetch('/register', {
            method: 'POST',
            body: JSON.stringify({ face_id, user_name, images }),
        });
        if (!result.ok) throw new Error('Python register failed');

        // LÆ°u FaceProfile vÃ o DB
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

// Láº¥y lá»‹ch sá»­ cháº¥m cÃ´ng
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

// Kiá»ƒm tra toÃ n bá»™ profiles â€” so sÃ¡nh DB, disk, Python memory
// Tráº£ vá» danh sÃ¡ch profiles á»Ÿ tá»«ng nÆ¡i vÃ  highlight mismatch
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

    // So sÃ¡nh tÃ¬m mismatch
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

// Láº¥y danh sÃ¡ch profiles khuÃ´n máº·t
ipcMain.handle('attendance:getProfiles', async () => {
    try {
        const profiles = await prisma.faceProfile.findMany({ where: { isActive: true } });
        return { success: true, data: profiles };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// XÃ³a profile khuÃ´n máº·t
ipcMain.handle('attendance:deleteProfile', async (event, { face_id }) => {
    // XÃ³a Python encodings qua service
    try {
        await faceServiceFetch(`/profile/${encodeURIComponent(face_id)}`, { method: 'DELETE' });
    } catch (err) {
        console.warn('[attendance] Python delete failed, fallback to direct fs delete:', err.message);
        // Fallback: service offline â†’ xÃ³a folder áº£nh trá»±c tiáº¿p báº±ng fs
        // TrÃ¡nh trÆ°á»ng há»£p DB xÃ³a thÃ nh cÃ´ng nhÆ°ng áº£nh váº«n cÃ²n trÃªn disk
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
    // LuÃ´n xÃ³a DB record
    try {
        await prisma.faceProfile.updateMany({ where: { faceId: face_id }, data: { isActive: false } });
    } catch (err) {
        console.error('[attendance] DB delete failed:', err.message);
        return { success: false, error: err.message };
    }

    // Verify sau khi xÃ³a â€” kiá»ƒm tra cáº£ 3 nÆ¡i Ä‘á»ƒ cháº¯c cháº¯n sáº¡ch
    const verify = { db: false, disk: false, pythonMemory: false };
    try {
        const dbRecord = await prisma.faceProfile.findFirst({ where: { faceId: face_id, isActive: true } });
        verify.db = dbRecord === null; // true = khÃ´ng cÃ²n record active
    } catch (_) { }
    try {
        const facesDir = path.join(app.getPath('userData'), 'faces', face_id);
        verify.disk = !fs.existsSync(facesDir); // true = folder Ä‘Ã£ bá»‹ xÃ³a
    } catch (_) { }
    try {
        const status = await faceServiceFetch('/status');
        if (!isValidFaceServiceStatus(status)) {
            throw new Error('Invalid attendance service status payload');
        }
        verify.pythonMemory = !status.face_ids?.includes(face_id); // true = khÃ´ng cÃ²n trong memory
    } catch (_) {
        verify.pythonMemory = null; // null = service offline, khÃ´ng kiá»ƒm tra Ä‘Æ°á»£c
    }

    const allClean = verify.db && verify.disk && (verify.pythonMemory === true || verify.pythonMemory === null);
    console.log(`[attendance] Delete verify for '${face_id}':`, verify);
    return { success: true, verify, allClean };
});



//                                                                              
// OFFLINE QUEUE  Sync & Status handlers
//                                                                              

// Tr� v� s� �n ang ch� sync
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
                // Unknown type  b� qua, x�a � kh�ng b� loop
                offlineQueue.remove(item._filename);
            }
        } catch (err) {
            failed++;
            errors.push({ file: item._filename, error: err.message });
            console.error('[OfflineQueue] Sync failed for', item._filename, ':', err.message);
            // Kh�ng x�a file  gi� l�i � retry l�n sau
        }
    }

    console.log('[OfflineQueue] Sync complete  synced:', synced, '| failed:', failed, '| remaining:', offlineQueue.count());
    return { success: true, synced, failed, remaining: offlineQueue.count(), errors };
});
