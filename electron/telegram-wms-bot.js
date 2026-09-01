const https = require('https');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TELEGRAM_WMS_BOT_TOKEN = process.env.TELEGRAM_WMS_BOT_TOKEN || '';
const TELEGRAM_WMS_DEFAULT_CHAT = '1397184795';
let telegramWmsLastUpdateId = 0;

const TELEGRAM_MAIN_KEYBOARD = {
    keyboard: [
        [{ text: '📦 RÚT HÀNG NHANH ⚡' }, { text: '📊 XEM TỒN KHO' }],
        [{ text: '🔓 KHUI KIỆN MỚI' }, { text: '🔍 DANH SÁCH KIỆN' }],
    ],
    resize_keyboard: true,
};

let inMemoryHandlingUnits = [
    { code: 'KN-UPFDEN-01', sku: '1-UPF-DEN', color: 'Đen', packagingName: 'Gói lẻ', baseUnit: 'Gói', initialQuantity: 50, remainingQuantity: 50, status: 'sealed', zone: 'Hàng lẻ' },
    { code: 'KN-5DTR-01', sku: '1-5DUNI-TRANG', color: 'Trắng', packagingName: 'Tải dứa', baseUnit: 'Gói', initialQuantity: 1200, remainingQuantity: 1200, status: 'sealed', zone: 'A1 - Kệ 01' },
    { code: 'KN-5DTR-02', sku: '1-5DUNI-TRANG', color: 'Trắng', packagingName: 'Tải dứa', baseUnit: 'Gói', initialQuantity: 1200, remainingQuantity: 1200, status: 'sealed', zone: 'A1 - Kệ 01' },
    { code: 'KN-5DTR-03', sku: '1-5DUNI-TRANG', color: 'Trắng', packagingName: 'Tải dứa', baseUnit: 'Gói', initialQuantity: 1200, remainingQuantity: 610, status: 'opened', zone: 'A1 - Kệ 02' },
    { code: 'KN-5DTR-04', sku: '1-5DUNI-TRANG', color: 'Trắng', packagingName: 'Thùng carton', baseUnit: 'Gói', initialQuantity: 250, remainingQuantity: 250, status: 'sealed', zone: 'A1 - Kệ 04' },
    { code: 'KN-5DTR-05', sku: '1-5DUNI-TRANG', color: 'Trắng', packagingName: 'Túi lẻ', baseUnit: 'Gói', initialQuantity: 300, remainingQuantity: 300, status: 'sealed', zone: 'A1 - Kệ 05' },
    { code: 'KN-5DDEN-01', sku: '1-5DUNI-DEN', color: 'Đen', packagingName: 'Thùng carton', baseUnit: 'Gói', initialQuantity: 50, remainingQuantity: 50, status: 'sealed', zone: 'A2 - Kệ 02' },
    { code: 'KN-5DHG-01', sku: '1-5DUNI-HONG', color: 'Hồng', packagingName: 'Tải dứa', baseUnit: 'Gói', initialQuantity: 1200, remainingQuantity: 1200, status: 'sealed', zone: 'A2 - Kệ 03' },
];

async function getAllHandlingUnitsFromStore() {
    try {
        const units = await prisma.handlingUnit.findMany();
        if (units && units.length > 0) return units;
    } catch {}
    try {
        const cfg = await prisma.appConfig.findUnique({ where: { key: 'handlingUnitsRegisterJson' } });
        if (cfg?.value) {
            const parsed = JSON.parse(cfg.value);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch {}
    return inMemoryHandlingUnits;
}

async function saveHandlingUnitsToStore(units) {
    inMemoryHandlingUnits = units;
    try {
        await prisma.appConfig.upsert({
            where: { key: 'handlingUnitsRegisterJson' },
            create: { key: 'handlingUnitsRegisterJson', value: JSON.stringify(units) },
            update: { value: JSON.stringify(units) }
        });
    } catch {}
}

async function appendTransactionToStore(txRecord) {
    try {
        const cfg = await prisma.appConfig.findUnique({ where: { key: 'handlingUnitsTransactionsJson' } });
        let list = [];
        if (cfg?.value) {
            try { list = JSON.parse(cfg.value); } catch {}
        }
        if (!Array.isArray(list)) list = [];
        list.unshift(txRecord);
        if (list.length > 500) list = list.slice(0, 500);
        await prisma.appConfig.upsert({
            where: { key: 'handlingUnitsTransactionsJson' },
            create: { key: 'handlingUnitsTransactionsJson', value: JSON.stringify(list) },
            update: { value: JSON.stringify(list) }
        });
    } catch (e) {
        console.warn('Error saving transaction to config:', e.message);
    }
}

async function executeKhuiKien(code, actor = 'Telegram Bot') {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode) throw new Error('Vui lòng cung cấp mã kiện.');
    
    const list = await getAllHandlingUnitsFromStore();
    const idx = list.findIndex(u => (u.code || u.id || '').toUpperCase() === normalizedCode);
    if (idx === -1) throw new Error(`Không tìm thấy kiện [${normalizedCode}] trong hệ thống.`);
    
    const target = list[idx];
    if (target.status === 'opened' || target.status === 'Đang sử dụng') throw new Error(`Kiện [${normalizedCode}] đang mở sẵn rồi.`);
    if (target.status === 'pending_check' || target.status === 'Chờ kiểm') throw new Error(`Kiện [${normalizedCode}] đang chờ kiểm thực tế.`);
    if (target.status === 'empty' || target.status === 'Đã hết') throw new Error(`Kiện [${normalizedCode}] đã hết hàng.`);
    
    // Quy tắc kiểm soát kho nghiêm ngặt: Mỗi SKU chỉ được phép mở 1 kiện tại 1 thời điểm
    const targetSku = (target.sku || target.skuName || '').toUpperCase();
    const pendingSameSku = list.find(u =>
        (u.sku || u.skuName || '').toUpperCase() === targetSku &&
        (u.status === 'pending_check' || u.status === 'Chờ kiểm') &&
        (u.code || u.id || '').toUpperCase() !== normalizedCode
    );
    if (pendingSameSku) {
        const pendingCode = pendingSameSku.code || pendingSameSku.id;
        throw new Error(`Không thể khui kiện mới. SKU [${target.sku || target.skuName}] đang có kiện [${pendingCode}] chờ kiểm thực tế. Vui lòng vào Quản lý kiện hàng > Chờ kiểm, nhập số lượng thực tế và chốt kiện này trước.`);
    }
    const openedSameSku = list.find(u => 
        (u.sku || u.skuName || '').toUpperCase() === targetSku && 
        (u.status === 'opened' || u.status === 'Đang sử dụng') &&
        (u.code || u.id || '').toUpperCase() !== normalizedCode
    );
    if (openedSameSku) {
        const openedCode = openedSameSku.code || openedSameSku.id;
        const openedRemaining = (openedSameSku.remainingQuantity ?? openedSameSku.currentPcs ?? 0).toLocaleString('vi-VN');
        const unitName = openedSameSku.baseUnit || openedSameSku.unitName || 'Gói';
        throw new Error(`⚠️ SKU [${target.sku || target.skuName}] đang có kiện [${openedCode}] đang mở (còn ${openedRemaining} ${unitName}). Vui lòng rút hết kiện cũ trước khi khui kiện mới!`);
    }
    
    try {
        await prisma.$transaction(async tx => {
            const dbTarget = await tx.handlingUnit.findUnique({ where: { code: normalizedCode } });
            if (!dbTarget) throw new Error(`Không tìm thấy kiện [${normalizedCode}] trong hệ thống.`);
            try {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`handling-unit-open:${dbTarget.sku}`}))`;
            } catch {}
            const pendingConflict = await tx.handlingUnit.findFirst({
                where: { sku: dbTarget.sku, code: { not: normalizedCode }, status: 'pending_check' },
                select: { code: true },
            });
            if (pendingConflict) {
                throw new Error(`Không thể khui kiện mới. SKU [${dbTarget.sku}] đang có kiện [${pendingConflict.code}] chờ kiểm thực tế. Vui lòng vào Quản lý kiện hàng > Chờ kiểm, nhập số lượng thực tế và chốt kiện này trước.`);
            }
            const openedConflict = await tx.handlingUnit.findFirst({
                where: { sku: dbTarget.sku, code: { not: normalizedCode }, status: 'opened' },
                select: { code: true, remainingQuantity: true, baseUnit: true },
            });
            if (openedConflict) {
                throw new Error(`SKU [${dbTarget.sku}] đang có kiện [${openedConflict.code}] đang mở (còn ${openedConflict.remainingQuantity} ${openedConflict.baseUnit}). Vui lòng rút hết kiện cũ trước khi khui kiện mới!`);
            }
            await tx.handlingUnit.update({
                where: { code: normalizedCode },
                data: { status: 'opened', updatedAt: new Date() }
            });
        });
    } catch (error) {
        if (error.message.includes('chờ kiểm thực tế') || error.message.includes('đang mở')) throw error;
    }
    
    target.status = 'opened';
    target.updatedAt = new Date();
    list[idx] = target;
    await saveHandlingUnitsToStore(list);

    // Ghi nhận lịch sử khui kiện
    await appendTransactionToStore({
        id: `TR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        unitId: target.code || target.id,
        sku: target.sku || target.skuName,
        type: 'Khui kiện',
        quantity: target.initialQuantity ?? target.initialPcs ?? 1200,
        remaining: target.remainingQuantity ?? target.currentPcs ?? 1200,
        actor: actor || 'Telegram Bot',
        note: `Mở niêm phong kiện để xuất lẻ`,
        createdAt: new Date().toISOString(),
    });
    
    return target;
}

async function executeRutHang(code, quantity, actor = 'Telegram Bot') {
    const normalizedCode = String(code || '').trim().toUpperCase();
    const qty = Math.max(0, Math.floor(Number(quantity || 0)));
    if (!normalizedCode || qty <= 0) throw new Error('Vui lòng nhập mã kiện và số lượng cần rút hợp lệ.');
    
    let result = null;
    try {
        const res = await prisma.$transaction(async tx => {
            const unit = await tx.handlingUnit.findUnique({ where: { code: normalizedCode } });
            if (!unit) return null;
            try {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`handling-unit-open:${unit.sku}`}))`;
            } catch {}
            const pendingConflict = await tx.handlingUnit.findFirst({
                where: {
                    sku: unit.sku,
                    code: { not: normalizedCode },
                    status: 'pending_check',
                },
                select: { code: true },
            });
            if (pendingConflict) {
                throw new Error(`Không thể rút hàng. SKU [${unit.sku}] đang có kiện [${pendingConflict.code}] chờ kiểm thực tế. Vui lòng vào Quản lý kiện hàng > Chờ kiểm, nhập số lượng thực tế và chốt kiện này trước.`);
            }
            if (unit.status === 'pending_check') {
                throw new Error(`Không thể rút hàng. Kiện [${normalizedCode}] đang chờ kiểm thực tế. Vui lòng vào Quản lý kiện hàng > Chờ kiểm, nhập số lượng thực tế và chốt kiện này trước.`);
            }
            if (unit.status !== 'opened') throw new Error(`Kiện [${normalizedCode}] chưa khui (trạng thái: ${unit.status}). Hãy khui kiện trước.`);
            if (qty > unit.remainingQuantity) throw new Error(`Số lượng rút (${qty}) lớn hơn tồn còn lại trong kiện (${unit.remainingQuantity} ${unit.baseUnit}).`);
            
            const nextRemaining = unit.remainingQuantity - qty;
            const nextStatus = nextRemaining === 0 ? 'pending_check' : 'opened';
            
            const updated = await tx.handlingUnit.update({
                where: { code: normalizedCode },
                data: { remainingQuantity: nextRemaining, status: nextStatus, updatedAt: new Date() }
            });
            
            let packingAreaPcs = 0;
            try {
                const cfg = await tx.appConfig.findUnique({ where: { key: 'handlingUnitsPackingAreaPcs' } });
                packingAreaPcs = Math.max(0, Number(cfg?.value || 0)) + qty;
                await tx.appConfig.upsert({
                    where: { key: 'handlingUnitsPackingAreaPcs' },
                    create: { key: 'handlingUnitsPackingAreaPcs', value: String(packingAreaPcs) },
                    update: { value: String(packingAreaPcs) }
                });
            } catch {}
            
            return { unit: updated, picked: qty, remaining: nextRemaining, packingAreaPcs };
        });
        if (res) result = res;
    } catch (dbErr) {
        if (dbErr.message.includes('chưa khui') || dbErr.message.includes('lớn hơn tồn') || dbErr.message.includes('chờ kiểm thực tế')) throw dbErr;
    }
    
    if (!result) {
        const list = await getAllHandlingUnitsFromStore();
        const idx = list.findIndex(u => (u.code || u.id || '').toUpperCase() === normalizedCode);
        if (idx === -1) throw new Error(`Không tìm thấy kiện [${normalizedCode}] trong kho.`);
        
        const target = list[idx];
        const currentStatus = target.status;
        const targetSku = String(target.sku || target.skuName || '').trim().toUpperCase();
        const pendingConflict = list.find(candidate =>
            String(candidate.code || candidate.id || '').trim().toUpperCase() !== normalizedCode &&
            String(candidate.sku || candidate.skuName || '').trim().toUpperCase() === targetSku &&
            (candidate.status === 'pending_check' || candidate.status === 'Chờ kiểm')
        );
        if (pendingConflict) {
            throw new Error(`Không thể rút hàng. SKU [${target.sku || target.skuName}] đang có kiện [${pendingConflict.code || pendingConflict.id}] chờ kiểm thực tế. Vui lòng vào Quản lý kiện hàng > Chờ kiểm, nhập số lượng thực tế và chốt kiện này trước.`);
        }
        if (currentStatus === 'pending_check' || currentStatus === 'Chờ kiểm') {
            throw new Error(`Không thể rút hàng. Kiện [${normalizedCode}] đang chờ kiểm thực tế. Vui lòng vào Quản lý kiện hàng > Chờ kiểm, nhập số lượng thực tế và chốt kiện này trước.`);
        }
        if (currentStatus !== 'opened' && currentStatus !== 'Đang sử dụng') {
            throw new Error(`Kiện [${normalizedCode}] chưa khui! Hãy khui kiện trước.`);
        }
        
        const currentQty = target.remainingQuantity ?? target.currentPcs ?? 0;
        if (qty > currentQty) {
            throw new Error(`Số lượng rút (${qty}) lớn hơn tồn còn lại (${currentQty} ${target.baseUnit || target.unitName || 'Gói'}).`);
        }
        
        const nextRemaining = currentQty - qty;
        const nextStatus = nextRemaining === 0 ? 'pending_check' : 'opened';
        target.remainingQuantity = nextRemaining;
        target.currentPcs = nextRemaining;
        target.status = nextStatus;
        list[idx] = target;
        await saveHandlingUnitsToStore(list);
        
        let packingAreaPcs = qty;
        try {
            const cfg = await prisma.appConfig.findUnique({ where: { key: 'handlingUnitsPackingAreaPcs' } });
            packingAreaPcs = Math.max(0, Number(cfg?.value || 0)) + qty;
            await prisma.appConfig.upsert({
                where: { key: 'handlingUnitsPackingAreaPcs' },
                create: { key: 'handlingUnitsPackingAreaPcs', value: String(packingAreaPcs) },
                update: { value: String(packingAreaPcs) }
            });
        } catch {}
        
        result = { unit: target, picked: qty, remaining: nextRemaining, packingAreaPcs };
    }

    // Ghi nhận lịch sử rút hàng
    await appendTransactionToStore({
        id: `TR-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        unitId: result.unit.code || result.unit.id,
        sku: result.unit.sku || result.unit.skuName,
        type: 'Rút hàng',
        quantity: -qty,
        remaining: result.remaining,
        actor: actor || 'Telegram Bot',
        note: `Rút ${qty} ${result.unit.baseUnit || result.unit.unitName || 'Gói'} sang Khu đóng gói (còn ${result.remaining})`,
        createdAt: new Date().toISOString(),
    });
    
    return result;
}

async function executeBaoCaoTon() {
    const list = await getAllHandlingUnitsFromStore();
    const totalPkgs = list.length;
    const sealed = list.filter(u => u.status === 'sealed' || u.status === 'Nguyên niêm phong').length;
    const opened = list.filter(u => u.status === 'opened' || u.status === 'Đang sử dụng').length;
    const empty = list.filter(u => u.status === 'empty' || u.status === 'Đã hết').length;
    const totalPcs = list.reduce((s, u) => s + (u.remainingQuantity ?? u.currentPcs ?? 0), 0);
    
    let packingAreaPcs = 0;
    try {
        const cfg = await prisma.appConfig.findUnique({ where: { key: 'handlingUnitsPackingAreaPcs' } });
        packingAreaPcs = Math.max(0, Number(cfg?.value || 0));
    } catch {}
    
    return { totalPkgs, sealed, opened, empty, totalPcs, packingAreaPcs, units: list };
}

async function setupTelegramCommands() {
    if (!TELEGRAM_WMS_BOT_TOKEN) return;
    try {
        const commandsPayload = JSON.stringify({
            commands: [
                { command: 'rut', description: '📦 Rút hàng nhanh ⚡' },
                { command: 'khui', description: '🔓 Khui kiện mới' },
                { command: 'ton', description: '📊 Xem tồn kho' },
                { command: 'danhsach', description: '🔍 Danh sách kiện' },
            ]
        });
        
        await new Promise((resolve) => {
            const req = https.request({
                hostname: 'api.telegram.org',
                path: `/bot${TELEGRAM_WMS_BOT_TOKEN}/setMyCommands`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(commandsPayload),
                },
                timeout: 10000,
            }, (res) => {
                let b = '';
                res.on('data', c => b += c);
                res.on('end', () => resolve(b));
            });
            req.on('error', () => resolve(null));
            req.write(commandsPayload);
            req.end();
        });

        const menuBtnPayload = JSON.stringify({
            menu_button: { type: 'commands' }
        });
        await new Promise((resolve) => {
            const req = https.request({
                hostname: 'api.telegram.org',
                path: `/bot${TELEGRAM_WMS_BOT_TOKEN}/setChatMenuButton`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(menuBtnPayload),
                },
                timeout: 10000,
            }, (res) => {
                let b = '';
                res.on('data', c => b += c);
                res.on('end', () => resolve(b));
            });
            req.on('error', () => resolve(null));
            req.write(menuBtnPayload);
            req.end();
        });
        console.log('✅ [TelegramWMS] Native Menu commands registered successfully');
    } catch (e) {
        console.warn('Set commands error:', e.message);
    }
}

function sendTelegramWmsMessage(chatId, text, replyMarkup = null) {
    if (!TELEGRAM_WMS_BOT_TOKEN) return Promise.resolve(null);
    return new Promise((resolve) => {
        const targetChat = chatId || TELEGRAM_WMS_DEFAULT_CHAT;
        const payload = { chat_id: targetChat, text, parse_mode: 'HTML' };
        if (replyMarkup) {
            payload.reply_markup = replyMarkup;
        }
        const data = JSON.stringify(payload);
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_WMS_BOT_TOKEN}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
            },
            timeout: 10000,
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch { resolve(null); }
            });
        });
        req.on('error', (err) => {
            console.warn('[TelegramWMS] Send error:', err.message);
            resolve(null);
        });
        req.write(data);
        req.end();
    });
}

function answerTelegramCallbackQuery(callbackQueryId, text = null) {
    if (!TELEGRAM_WMS_BOT_TOKEN || !callbackQueryId) return Promise.resolve(null);
    return new Promise((resolve) => {
        const payload = { callback_query_id: callbackQueryId };
        if (text) payload.text = text;
        const data = JSON.stringify(payload);
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_WMS_BOT_TOKEN}/answerCallbackQuery`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
            },
            timeout: 10000,
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.write(data);
        req.end();
    });
}

function editTelegramWmsMessage(chatId, messageId, text, replyMarkup = null) {
    if (!TELEGRAM_WMS_BOT_TOKEN || !chatId || !messageId) return Promise.resolve(null);
    return new Promise((resolve) => {
        const payload = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        const data = JSON.stringify(payload);
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_WMS_BOT_TOKEN}/editMessageText`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
            },
            timeout: 10000,
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.write(data);
        req.end();
    });
}

function clearTelegramWmsInlineKeyboard(chatId, messageId) {
    if (!TELEGRAM_WMS_BOT_TOKEN || !chatId || !messageId) return Promise.resolve(null);
    return new Promise((resolve) => {
        const data = JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [] }
        });
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_WMS_BOT_TOKEN}/editMessageReplyMarkup`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
            },
            timeout: 10000,
        }, (res) => {
            res.resume();
            res.on('end', () => resolve(true));
        });
        req.on('error', () => resolve(null));
        req.write(data);
        req.end();
    });
}

async function sendRutHangMenu(chatId, messageId = null) {
    const list = await getAllHandlingUnitsFromStore();
    const openedUnits = list.filter(u => u.status === 'opened' || u.status === 'Đang sử dụng');
    const pendingSkuCodes = new Map();
    list.forEach(unit => {
        if (unit.status !== 'pending_check' && unit.status !== 'Chờ kiểm') return;
        const sku = String(unit.sku || unit.skuName || '').trim().toUpperCase();
        if (sku && !pendingSkuCodes.has(sku)) pendingSkuCodes.set(sku, unit.code || unit.id);
    });
    const availableOpenedUnits = openedUnits.filter(unit =>
        !pendingSkuCodes.has(String(unit.sku || unit.skuName || '').trim().toUpperCase())
    );

    if (openedUnits.length > 0 && availableOpenedUnits.length === 0) {
        const pendingCodes = [...new Set(pendingSkuCodes.values())].filter(Boolean).join(', ');
        const text = `⛔ <b>CHƯA THỂ RÚT HÀNG</b>\n\nCác SKU đang mở vẫn còn kiện đã về 0 chờ kiểm thực tế: <b>${pendingCodes || 'vui lòng xem tab Chờ kiểm'}</b>.\n\n👉 Vào <b>Quản lý kiện hàng &gt; Chờ kiểm</b>, nhập số lượng thực tế và chốt hết các kiện này trước khi rút tiếp.`;
        const markup = { inline_keyboard: [[{ text: '📊 Xem báo cáo tồn', callback_data: 'menu_ton' }]] };
        if (messageId) await editTelegramWmsMessage(chatId, messageId, text, markup);
        else await sendTelegramWmsMessage(chatId, text, markup);
        return;
    }
    
    if (openedUnits.length === 0) {
        const sealedUnits = list.filter(u => u.status === 'sealed' || u.status === 'Nguyên niêm phong');
        const keyboard = sealedUnits.slice(0, 6).map(u => [
            { text: `🔓 Khui ${u.code || u.id} (${u.sku || u.skuName})`, callback_data: `unseal_unit:${u.code || u.id}` }
        ]);
        const text = `⚠️ <b>HIỆN CHƯA CÓ KIỆN NÀO ĐANG MỞ ĐỂ RÚT HÀNG!</b>\n\n👉 Bạn hãy chạm vào kiện nguyên bên dưới để <b>khui kiện ngay</b>:`;
        const markup = { inline_keyboard: keyboard };
        if (messageId) {
            await editTelegramWmsMessage(chatId, messageId, text, markup);
        } else {
            await sendTelegramWmsMessage(chatId, text, markup);
        }
        return;
    }

    // Chỉ có một kiện đang mở thì vào thẳng màn hình chọn số lượng.
    if (availableOpenedUnits.length === 1) {
        await sendPickQuantityMenu(chatId, availableOpenedUnits[0].code || availableOpenedUnits[0].id, messageId);
        return;
    }
    
    const inlineKeyboard = availableOpenedUnits.map(u => {
        const code = u.code || u.id;
        const remaining = u.remainingQuantity ?? u.currentPcs ?? 0;
        const unit = u.baseUnit || u.unitName || 'Gói';
        const sku = u.sku || u.skuName || '';
        return [{
            text: `📦 ${code} · ${sku} (Tồn: ${remaining.toLocaleString('vi-VN')} ${unit})`,
            callback_data: `pick_unit:${code}`
        }];
    });
    
    inlineKeyboard.push([
        { text: '📊 Xem báo cáo tồn', callback_data: 'menu_ton' },
        { text: '🔓 Khui thêm kiện', callback_data: 'menu_khui' }
    ]);
    
    const blockedNote = openedUnits.length > availableOpenedUnits.length
        ? `\n\n⚠️ Một số SKU đang bị khóa vì còn kiện chờ kiểm thực tế.`
        : '';
    const text = `📦 <b>CHỌN KIỆN CẦN RÚT HÀNG:</b>\n<i>(Chạm vào kiện bên dưới để chọn nhanh số lượng rút)</i>${blockedNote}`;
    const markup = { inline_keyboard: inlineKeyboard };
    
    if (messageId) {
        await editTelegramWmsMessage(chatId, messageId, text, markup);
    } else {
        await sendTelegramWmsMessage(chatId, text, markup);
    }
}

async function sendKhuiKienMenu(chatId, messageId = null) {
    const list = await getAllHandlingUnitsFromStore();
    const openedSkus = new Set(
        list.filter(u => u.status === 'opened' || u.status === 'Đang sử dụng')
            .map(u => (u.sku || u.skuName || '').toUpperCase())
    );
    
    // Chỉ những kiện nguyên thuộc SKU chưa có kiện mở nào mới được phép khui
    const canUnsealUnits = list.filter(u => 
        (u.status === 'sealed' || u.status === 'Nguyên niêm phong') &&
        !openedSkus.has((u.sku || u.skuName || '').toUpperCase())
    );
    
    if (canUnsealUnits.length === 0) {
        const text = `⚠️ <b>KHÔNG CÓ KIỆN HỢP LỆ ĐỂ KHUI MỚI!</b>\n\n` +
            `👉 Các SKU trong kho hiện <b>đều đang có kiện mở sẵn</b> hoặc đã xuất hết.\n` +
            `<i>(Quy tắc kho: Phải rút hết kiện đang mở trước khi khui kiện mới cùng SKU)</i>`;
        const markup = { inline_keyboard: [[{ text: '📦 Rút hàng từ kiện đang mở', callback_data: 'menu_rut' }]] };
        if (messageId) {
            await editTelegramWmsMessage(chatId, messageId, text, markup);
        } else {
            await sendTelegramWmsMessage(chatId, text, markup);
        }
        return;
    }
    
    const inlineKeyboard = canUnsealUnits.map(u => {
        const code = u.code || u.id;
        const qty = u.initialQuantity ?? u.initialPcs ?? 0;
        const unit = u.baseUnit || u.unitName || 'Gói';
        const sku = u.sku || u.skuName || '';
        return [{
            text: `🔓 Khui ${code} · ${sku} (${qty.toLocaleString('vi-VN')} ${unit})`,
            callback_data: `unseal_unit:${code}`
        }];
    });
    
    inlineKeyboard.push([{ text: '🔙 Quay lại', callback_data: 'menu_rut' }]);
    
    const text = `🔓 <b>CHỌN KIỆN NGUYÊN ĐỂ MỞ NIÊM PHONG (KHUI KIỆN):</b>\n<i>(Chỉ hiển thị các SKU chưa có kiện mở nào)</i>`;
    const markup = { inline_keyboard: inlineKeyboard };
    
    if (messageId) {
        await editTelegramWmsMessage(chatId, messageId, text, markup);
    } else {
        await sendTelegramWmsMessage(chatId, text, markup);
    }
}

const userPendingPickCode = {};

function pendingPickKey(chatId, userId) {
    return `${chatId}:${userId}`;
}

function formatLocation(rawLocation) {
    if (!rawLocation) return 'Chưa xếp vị trí';
    try {
        const parsed = typeof rawLocation === 'string' ? JSON.parse(rawLocation) : rawLocation;
        const parts = [parsed.zone, parsed.rack, parsed.level, parsed.bin].filter(Boolean);
        return parts.length ? parts.join(' · ') : 'Chưa xếp vị trí';
    } catch {
        return String(rawLocation);
    }
}

async function sendPickQuantityMenu(chatId, code, messageId = null) {
    const list = await getAllHandlingUnitsFromStore();
    const unit = list.find(u => (u.code || u.id || '').toUpperCase() === String(code).toUpperCase());
    
    if (!unit) {
        await sendTelegramWmsMessage(chatId, `❌ Không tìm thấy kiện <code>${code}</code>.`);
        return;
    }

    const pendingConflict = list.find(candidate =>
        String(candidate.code || candidate.id || '').trim().toUpperCase() !== String(code).trim().toUpperCase() &&
        String(candidate.sku || candidate.skuName || '').trim().toUpperCase() === String(unit.sku || unit.skuName || '').trim().toUpperCase() &&
        (candidate.status === 'pending_check' || candidate.status === 'Chờ kiểm')
    );
    if (pendingConflict || unit.status === 'pending_check' || unit.status === 'Chờ kiểm') {
        const blocker = pendingConflict || unit;
        const text = `⛔ <b>KHÔNG THỂ RÚT HÀNG</b>\n\nSKU <b>${unit.sku || unit.skuName}</b> đang có kiện <b>${blocker.code || blocker.id}</b> chờ kiểm thực tế. Vào <b>Quản lý kiện hàng &gt; Chờ kiểm</b>, nhập số lượng thực tế và chốt kiện trước.`;
        const markup = { inline_keyboard: [[{ text: '🔙 Chọn kiện khác', callback_data: 'menu_rut' }]] };
        if (messageId) await editTelegramWmsMessage(chatId, messageId, text, markup);
        else await sendTelegramWmsMessage(chatId, text, markup);
        return;
    }

    const remaining = unit.remainingQuantity ?? unit.currentPcs ?? 0;
    const baseUnit = unit.baseUnit || unit.unitName || 'Gói';
    
    // Giữ các mức rút nhanh; số lượng lớn được nhập qua nút tùy chọn.
    const presetQtys = [10, 20, 40, 50];
    const availablePresets = presetQtys.filter(q => q <= remaining);
    
    const row1 = [];
    const row2 = [];
    
    availablePresets.forEach((q) => {
        const btn = {
            text: `➖ Rút ${q} ${baseUnit}`,
            callback_data: `do_pick:${code}:${q}`
        };
        if (row1.length < 3) row1.push(btn);
        else row2.push(btn);
    });
    
    // Nút rút hết kiện nếu số tồn khác các mức trên
    if (!availablePresets.includes(remaining) && remaining > 0 && remaining < 100) {
        row2.push({
            text: `➖ Rút hết (${remaining.toLocaleString('vi-VN')} ${baseUnit})`,
            callback_data: `do_pick:${code}:${remaining}`
        });
    }
    
    const inlineKeyboard = [];
    if (row1.length) inlineKeyboard.push(row1);
    if (row2.length) inlineKeyboard.push(row2);
    inlineKeyboard.push([
        { text: '✏️ Nhập số lượng tùy chọn', callback_data: `custom_pick:${code}` }
    ]);
    inlineKeyboard.push([{ text: '🔙 Chọn kiện khác', callback_data: 'menu_rut' }]);
    
    const text = `📦 <b>RÚT HÀNG TỪ KIỆN:</b> <code>${code}</code>\n` +
        `🏷️ <b>SKU:</b> <code>${unit.sku || unit.skuName}</code>\n` +
        `📊 <b>Tồn trong kiện:</b> <b>${remaining.toLocaleString('vi-VN')} ${baseUnit}</b>\n` +
        `📍 <b>Vị trí:</b> ${formatLocation(unit.zone || unit.location)}\n\n` +
        `👉 <b>CHỌN MỨC RÚT NHANH (10 · 20 · 40 · 50) HOẶC TỰ NHẬP:</b>`;
        
    const markup = { inline_keyboard: inlineKeyboard };
    if (messageId) {
        await editTelegramWmsMessage(chatId, messageId, text, markup);
    } else {
        await sendTelegramWmsMessage(chatId, text, markup);
    }
}

const processedEventIds = new Set();
function isEventAlreadyHandled(id) {
    if (!id) return false;
    if (processedEventIds.has(id)) return true;
    processedEventIds.add(id);
    if (processedEventIds.size > 2000) {
        const first = processedEventIds.values().next().value;
        processedEventIds.delete(first);
    }
    return false;
}

function formatTelegramUser(fromUser) {
    if (!fromUser) return 'Nhân viên kho';
    const fullName = [fromUser.first_name, fromUser.last_name].filter(Boolean).join(' ').trim();
    const username = fromUser.username ? `@${fromUser.username}` : '';
    if (fullName && username) return `${fullName} (${username})`;
    if (fullName) return fullName;
    if (username) return username;
    return `User #${fromUser.id}`;
}

async function handleTelegramWmsCallbackQuery(callbackQuery) {
    if (!callbackQuery || !callbackQuery.data) return;
    const queryId = callbackQuery.id;
    if (isEventAlreadyHandled(queryId)) {
        console.log('⚠️ [TelegramWMS] Ignored duplicate callback query:', queryId);
        return;
    }
    
    const chatId = callbackQuery.message?.chat?.id;
    const messageId = callbackQuery.message?.message_id;
    const data = callbackQuery.data;
    const userLabel = formatTelegramUser(callbackQuery.from);
    const actor = userLabel;
    
    if (data.startsWith('pick_unit:')) {
        const code = data.split(':')[1];
        await answerTelegramCallbackQuery(queryId, `Đã chọn kiện ${code}`);
        await sendPickQuantityMenu(chatId, code, messageId);
        return;
    }
    
    if (data.startsWith('custom_pick:')) {
        const code = data.split(':')[1];
        userPendingPickCode[pendingPickKey(chatId, callbackQuery.from?.id)] = code;
        await answerTelegramCallbackQuery(queryId, 'Hãy gửi số lượng bạn muốn rút');
        const text = `✏️ <b>BẠN ĐANG CHỌN RÚT TỪ KIỆN:</b> <code>${code}</code>\n\n` +
            `👉 <b>Hãy gửi một số nguyên dương không vượt tồn còn lại</b> (Ví dụ: <code>100</code>, <code>200</code>, <code>500</code>...)\n` +
            `<i>Bot sẽ tự động rút đúng số lượng bạn vừa gửi!</i>`;
        const markup = {
            inline_keyboard: [[{ text: '🔙 Quay lại danh sách mức rút', callback_data: `pick_unit:${code}` }]]
        };
        await editTelegramWmsMessage(chatId, messageId, text, markup);
        return;
    }
    
    if (data.startsWith('do_pick:')) {
        const [, code, qtyStr] = data.split(':');
        const qty = parseInt(qtyStr, 10);
        if (!Number.isInteger(qty) || qty < 1) {
            await answerTelegramCallbackQuery(queryId, 'Số lượng rút phải là số nguyên dương');
            await sendPickQuantityMenu(chatId, code, messageId);
            return;
        }
        try {
            const res = await executeRutHang(code, qty, actor);
            await answerTelegramCallbackQuery(queryId, `✅ Đã rút ${qty} sản phẩm!`);
            const unit = res.unit;
            const resHtml = `✅ <b>${userLabel} rút hàng thành công ${code}</b>\n` +
                `📉 <b>Đã rút:</b> ${res.picked.toLocaleString('vi-VN')} ${unit.baseUnit || unit.unitName || 'Gói'}\n` +
                `📊 <b>Còn lại:</b> ${res.remaining.toLocaleString('vi-VN')} ${unit.baseUnit || unit.unitName || 'Gói'}`;
                
            const markup = {
                inline_keyboard: [
                    [{ text: '📦 Rút tiếp từ kiện này', callback_data: `pick_unit:${code}` }],
                    [{ text: '📦 Rút kiện khác', callback_data: 'menu_rut' }, { text: '📊 Xem tồn kho', callback_data: 'menu_ton' }]
                ]
            };
            await clearTelegramWmsInlineKeyboard(chatId, messageId);
            await sendTelegramWmsMessage(chatId, resHtml, markup);
        } catch (err) {
            await answerTelegramCallbackQuery(queryId, `❌ Lỗi: ${err.message}`);
            await sendTelegramWmsMessage(chatId, `❌ <b>Lỗi rút hàng:</b> ${err.message}`);
        }
        return;
    }
    
    if (data.startsWith('unseal_unit:')) {
        const code = data.split(':')[1];
        try {
            const unit = await executeKhuiKien(code, actor);
            await answerTelegramCallbackQuery(queryId, `✅ Đã khui kiện ${code}!`);
            const resHtml = `✅ <b>KHUI KIỆN 1 CHẠM THÀNH CÔNG!</b>\n\n` +
                `👤 <b>Thực hiện bởi:</b> <b>${userLabel}</b>\n` +
                `📦 <b>Mã Kiện:</b> <code>${unit.code || unit.id}</code>\n` +
                `🏷️ <b>SKU:</b> <code>${unit.sku || unit.skuName}</code>\n` +
                `📊 <b>Số lượng:</b> <b>${(unit.remainingQuantity ?? unit.currentPcs ?? 0).toLocaleString('vi-VN')} ${unit.baseUnit || unit.unitName || 'Gói'}</b>\n` +
                `👉 Trạng thái mới: <b>Đang sử dụng (Đang mở)</b>`;
                
            const markup = {
                inline_keyboard: [
                    [{ text: `📦 Rút hàng ngay từ kiện ${unit.code || unit.id}`, callback_data: `pick_unit:${unit.code || unit.id}` }],
                    [{ text: '🔙 Danh sách kiện mở', callback_data: 'menu_rut' }]
                ]
            };
            await editTelegramWmsMessage(chatId, messageId, resHtml, markup);
        } catch (err) {
            await answerTelegramCallbackQuery(queryId, `❌ Lỗi: ${err.message}`);
            await sendTelegramWmsMessage(chatId, `❌ <b>Lỗi khui kiện:</b> ${err.message}`);
        }
        return;
    }
    
    if (data === 'menu_rut') {
        await answerTelegramCallbackQuery(queryId);
        await sendRutHangMenu(chatId, messageId);
        return;
    }
    
    if (data === 'menu_khui') {
        await answerTelegramCallbackQuery(queryId);
        await sendKhuiKienMenu(chatId, messageId);
        return;
    }
    
    if (data === 'menu_ton') {
        await answerTelegramCallbackQuery(queryId);
        const rep = await executeBaoCaoTon();
        const resHtml = `📊 <b>BÁO CÁO TỒN KHO KIỆN HÀNG WMS</b>\n\n` +
            `📦 <b>Tổng số kiện:</b> ${rep.totalPkgs} kiện\n` +
            `🟢 <b>Nguyên niêm phong:</b> ${rep.sealed} kiện\n` +
            `🟠 <b>Đang sử dụng (mở):</b> ${rep.opened} kiện\n` +
            `⚪ <b>Đã xuất hết:</b> ${rep.empty} kiện\n` +
            `───────────────\n` +
            `📈 <b>Tổng sản phẩm trong kiện:</b> <b>${rep.totalPcs.toLocaleString('vi-VN')} đơn vị</b>\n` +
            `🛒 <b>Hàng tại Khu đóng gói:</b> <b>${rep.packingAreaPcs.toLocaleString('vi-VN')} đơn vị</b>`;
        const markup = {
            inline_keyboard: [
                [{ text: '📦 Rút hàng nhanh', callback_data: 'menu_rut' }],
                [{ text: '🔓 Khui thêm kiện', callback_data: 'menu_khui' }]
            ]
        };
        await editTelegramWmsMessage(chatId, messageId, resHtml, markup);
        return;
    }
    
    await answerTelegramCallbackQuery(queryId);
}

async function handleTelegramWmsIncomingMessage(message) {
    if (!message || !message.text) return;
    const chatId = message.chat.id;
    const text = message.text.trim();
    const parts = text.split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const userLabel = formatTelegramUser(message.from);
    
    // Nếu người dùng gửi tin nhắn là 1 con số (Tự nhập số lượng)
    if (/^\d+$/.test(text)) {
        const qty = parseInt(text, 10);
        const pendingKey = pendingPickKey(chatId, message.from?.id);
        const code = userPendingPickCode[pendingKey];
        if (code && qty > 0) {
            delete userPendingPickCode[pendingKey];
            try {
                const res = await executeRutHang(code, qty, userLabel);
                const unit = res.unit;
                const resHtml = `✅ <b>${userLabel} rút hàng thành công ${code}</b>\n` +
                    `📉 <b>Đã rút:</b> ${res.picked.toLocaleString('vi-VN')} ${unit.baseUnit || unit.unitName || 'Gói'}\n` +
                    `📊 <b>Còn lại:</b> ${res.remaining.toLocaleString('vi-VN')} ${unit.baseUnit || unit.unitName || 'Gói'}`;
                    
                const markup = {
                    inline_keyboard: [
                        [{ text: '📦 Rút tiếp từ kiện này', callback_data: `pick_unit:${code}` }],
                        [{ text: '📦 Rút kiện khác', callback_data: 'menu_rut' }, { text: '📊 Xem tồn kho', callback_data: 'menu_ton' }]
                    ]
                };
                await sendTelegramWmsMessage(chatId, resHtml, markup);
                return;
            } catch (err) {
                await sendTelegramWmsMessage(chatId, `❌ <b>Lỗi rút hàng:</b> ${err.message}`);
                return;
            }
        }
    }
    
    if (text.includes('RÚT HÀNG NHANH') || text === 'Rút hàng' || text === 'Rút' || cmd === '/rut') {
        if (parts.length === 1 || text.includes('RÚT HÀNG NHANH')) {
            await sendRutHangMenu(chatId);
            return;
        }
        const code = parts[1];
        const qty = parseInt(parts[2], 10);
        if (!code || isNaN(qty) || qty <= 0) {
            await sendPickQuantityMenu(chatId, code);
            return;
        }
        try {
            const result = await executeRutHang(code, qty, userLabel);
            const resHtml = `🚀 <b>RÚT HÀNG SANG KHU ĐÓNG GÓI THÀNH CÔNG!</b>\n\n` +
                `👤 <b>Thực hiện bởi:</b> <b>${userLabel}</b>\n` +
                `📦 <b>Mã Kiện:</b> <code>${result.unit.code || result.unit.id}</code>\n` +
                `🏷️ <b>SKU:</b> <code>${result.unit.sku || result.unit.skuName}</code>\n` +
                `📉 <b>Đã rút:</b> <b>${result.picked.toLocaleString('vi-VN')} ${result.unit.baseUnit || result.unit.unitName || 'Gói'}</b>\n` +
                `📊 <b>Còn lại trong kiện:</b> <b>${result.remaining.toLocaleString('vi-VN')} ${result.unit.baseUnit || result.unit.unitName || 'Gói'}</b>\n` +
                `🛒 <b>Tổng chờ xuất tại Khu đóng gói:</b> <b>${result.packingAreaPcs.toLocaleString('vi-VN')} đơn vị</b>`;
            const markup = {
                inline_keyboard: [[{ text: '📦 Rút tiếp kiện khác', callback_data: 'menu_rut' }]]
            };
            await sendTelegramWmsMessage(chatId, resHtml, markup);
        } catch (err) {
            await sendTelegramWmsMessage(chatId, `❌ <b>Lỗi rút hàng:</b> ${err.message}`);
        }
        return;
    }
    
    if (text.includes('XEM TỒN KHO') || text === 'Tồn kho' || text === 'Tồn' || cmd === '/ton') {
        const rep = await executeBaoCaoTon();
        const resHtml = `📊 <b>BÁO CÁO TỒN KHO KIỆN HÀNG WMS</b>\n\n` +
            `📦 <b>Tổng số kiện:</b> ${rep.totalPkgs} kiện\n` +
            `🟢 <b>Nguyên niêm phong:</b> ${rep.sealed} kiện\n` +
            `🟠 <b>Đang sử dụng (mở):</b> ${rep.opened} kiện\n` +
            `⚪ <b>Đã xuất hết:</b> ${rep.empty} kiện\n` +
            `───────────────\n` +
            `📈 <b>Tổng sản phẩm trong kiện:</b> <b>${rep.totalPcs.toLocaleString('vi-VN')} đơn vị</b>\n` +
            `🛒 <b>Hàng tại Khu đóng gói:</b> <b>${rep.packingAreaPcs.toLocaleString('vi-VN')} đơn vị</b>`;
        const markup = {
            inline_keyboard: [
                [{ text: '📦 RÚT HÀNG NHANH ⚡', callback_data: 'menu_rut' }],
                [{ text: '🔓 KHUI KIỆN MỚI', callback_data: 'menu_khui' }]
            ]
        };
        await sendTelegramWmsMessage(chatId, resHtml, markup);
        return;
    }
    
    if (text.includes('KHUI KIỆN MỚI') || text === 'Khui kiện' || text === 'Khui' || cmd === '/khui') {
        if (parts.length === 1 || text.includes('KHUI KIỆN MỚI')) {
            await sendKhuiKienMenu(chatId);
            return;
        }
        const code = parts[1];
        try {
            const unit = await executeKhuiKien(code, userLabel);
            const resHtml = `✅ <b>KHUI KIỆN THÀNH CÔNG!</b>\n\n` +
                `👤 <b>Thực hiện bởi:</b> <b>${userLabel}</b>\n` +
                `📦 <b>Mã Kiện:</b> <code>${unit.code || unit.id}</code>\n` +
                `🏷️ <b>SKU:</b> <code>${unit.sku || unit.skuName}</code>\n` +
                `📊 <b>Số lượng:</b> <b>${(unit.remainingQuantity ?? unit.currentPcs ?? 0).toLocaleString('vi-VN')} ${unit.baseUnit || unit.unitName || 'Gói'}</b>\n` +
                `👉 Trạng thái mới: <b>Đang sử dụng (Đang mở)</b>`;
            const markup = {
                inline_keyboard: [[{ text: `📦 Rút hàng từ ${unit.code || unit.id}`, callback_data: `pick_unit:${unit.code || unit.id}` }]]
            };
            await sendTelegramWmsMessage(chatId, resHtml, markup);
        } catch (err) {
            await sendTelegramWmsMessage(chatId, `❌ <b>Lỗi khui kiện:</b> ${err.message}`);
        }
        return;
    }
    
    if (text.includes('DANH SÁCH KIỆN') || text.includes('TRA CỨU KIỆN') || cmd === '/danhsach' || cmd === '/kiem') {
        const list = await getAllHandlingUnitsFromStore();
        let body = `📦 <b>DANH SÁCH TẤT CẢ KIỆN HÀNG (${list.length}):</b>\n\n`;
        list.forEach((u) => {
            const st = u.status === 'opened' || u.status === 'Đang sử dụng' ? '🟠' : u.status === 'empty' ? '⚪' : '🟢';
            const qty = (u.remainingQuantity ?? u.currentPcs ?? 0).toLocaleString('vi-VN');
            const unit = u.baseUnit || u.unitName || 'Gói';
            body += `${st} <code>${u.code || u.id}</code> · ${u.sku || u.skuName} (${qty} ${unit})\n`;
        });
        const markup = {
            inline_keyboard: [
                [{ text: '📦 Rút hàng nhanh', callback_data: 'menu_rut' }],
                [{ text: '🔓 Khui kiện mới', callback_data: 'menu_khui' }]
            ]
        };
        await sendTelegramWmsMessage(chatId, body, markup);
        return;
    }
    
    if (cmd === '/start') {
        const payload = parts[1];
        if (payload) {
            const p = payload.trim();
            if (p.startsWith('khui_') || p.startsWith('khui-')) {
                const code = p.replace(/^khui[_-]/i, '').replace(/_/g, '-');
                try {
                    const unit = await executeKhuiKien(code, `QR: ${userLabel}`);
                    const resHtml = `📷 <b>ĐÃ QUÉT MÃ QR & KHUI KIỆN THÀNH CÔNG!</b>\n\n` +
                        `👤 <b>Thực hiện bởi:</b> <b>${userLabel}</b>\n` +
                        `📦 <b>Mã Kiện:</b> <code>${unit.code || unit.id}</code>\n` +
                        `🏷️ <b>SKU:</b> <code>${unit.sku || unit.skuName}</code>\n` +
                        `📊 <b>Số lượng:</b> <b>${(unit.remainingQuantity ?? unit.currentPcs ?? 0).toLocaleString('vi-VN')} ${unit.baseUnit || unit.unitName || 'Gói'}</b>\n` +
                        `👉 Trạng thái mới: <b>Đang sử dụng (Đang mở)</b>`;
                    const markup = {
                        inline_keyboard: [
                            [{ text: `📦 Rút hàng ngay từ kiện ${unit.code || unit.id}`, callback_data: `pick_unit:${unit.code || unit.id}` }]
                        ]
                    };
                    await sendTelegramWmsMessage(chatId, resHtml, markup);
                    return;
                } catch (err) {
                    await sendTelegramWmsMessage(chatId, `❌ <b>Lỗi quét khui kiện:</b> ${err.message}`);
                    return;
                }
            } else if (p.startsWith('rut_') || p.startsWith('rut-')) {
                const subParts = p.replace(/^rut[_-]/i, '').split('_');
                const code = subParts[0]?.replace(/_/g, '-');
                const qty = parseInt(subParts[1] || '50', 10);
                try {
                    const result = await executeRutHang(code, qty, `QR: ${userLabel}`);
                    const resHtml = `📷 <b>ĐÃ QUÉT MÃ QR & RÚT HÀNG THÀNH CÔNG!</b>\n\n` +
                        `👤 <b>Thực hiện bởi:</b> <b>${userLabel}</b>\n` +
                        `📦 <b>Mã Kiện:</b> <code>${result.unit.code || result.unit.id}</code>\n` +
                        `📉 <b>Đã rút:</b> <b>${result.picked.toLocaleString('vi-VN')} ${result.unit.baseUnit || result.unit.unitName || 'Gói'}</b>\n` +
                        `📊 <b>Còn lại:</b> <b>${result.remaining.toLocaleString('vi-VN')} ${result.unit.baseUnit || result.unit.unitName || 'Gói'}</b>\n` +
                        `🛒 <b>Chờ xuất tại Khu đóng gói:</b> <b>${result.packingAreaPcs.toLocaleString('vi-VN')} đơn vị</b>`;
                    const markup = {
                        inline_keyboard: [
                            [{ text: '📦 Rút tiếp kiện khác', callback_data: 'menu_rut' }],
                            [{ text: '📊 Xem tồn kho', callback_data: 'menu_ton' }]
                        ]
                    };
                    await sendTelegramWmsMessage(chatId, resHtml, markup);
                    return;
                } catch (err) {
                    await sendTelegramWmsMessage(chatId, `❌ <b>Lỗi quét rút hàng:</b> ${err.message}`);
                    return;
                }
            }
        }
        
        const welcomeHtml = `👋 <b>Xin chào ${message.from?.first_name || 'bạn'}!</b>\n\n` +
            `🤖 <b>HỆ THỐNG QUẢN LÝ KHO KIỆN HÀNG WMS 1 CHẠM:</b>\n` +
            `👉 Bạn hãy chạm vào nút <b>[ ≡ Menu ]</b> ở góc trái bên cạnh ô nhập / kẹp ghim hoặc bấm nút trực tiếp trong tin nhắn để thao tác nhanh!`;
        await sendTelegramWmsMessage(chatId, welcomeHtml, { remove_keyboard: true });
        await sendRutHangMenu(chatId);
        return;
    }
    
    // Mặc định: hiện menu rút hàng nhanh
    await sendRutHangMenu(chatId);
}

console.log('🤖 [TelegramWMS] Polling worker starting with Native Menu Commands...');

async function runPollingLoop() {
    await setupTelegramCommands();
    while (true) {
        try {
            const path = `/bot${TELEGRAM_WMS_BOT_TOKEN}/getUpdates?offset=${telegramWmsLastUpdateId}&timeout=20`;
            const json = await new Promise((resolve) => {
                const req = https.request({
                    hostname: 'api.telegram.org',
                    path,
                    method: 'GET',
                    timeout: 25000,
                }, (res) => {
                    let b = '';
                    res.on('data', chunk => b += chunk);
                    res.on('end', () => {
                        try { resolve(JSON.parse(b)); } catch { resolve(null); }
                    });
                });
                req.on('error', () => resolve(null));
                req.on('timeout', () => { req.destroy(); resolve(null); });
                req.end();
            });
            
            if (json && json.ok && Array.isArray(json.result)) {
                for (const update of json.result) {
                    telegramWmsLastUpdateId = update.update_id + 1;
                    if (update.callback_query) {
                        await handleTelegramWmsCallbackQuery(update.callback_query);
                    } else if (update.message) {
                        await handleTelegramWmsIncomingMessage(update.message);
                    }
                }
            }
        } catch (e) {
            console.warn('[TelegramWMS] Loop error:', e.message);
        }
        await new Promise(r => setTimeout(r, 600));
    }
}

runPollingLoop();
