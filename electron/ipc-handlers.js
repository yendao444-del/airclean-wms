const { ipcMain, dialog, shell, app } = require('electron');
const path = require('path');

// ✅ PRODUCTION CONFIG - Không cần .env nữa
const config = require('./config');

// Set environment variables từ config
process.env.DATABASE_URL = config.DATABASE_URL;
process.env.DIRECT_URL = config.DIRECT_URL;

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const XLSX = require('xlsx');
const https = require('https');

// ========================================
// PRISMA CLIENT - BẮT BUỘC SUPABASE
// ========================================

let prisma;

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
// PRODUCTS
// ========================================

ipcMain.handle('products:getAll', async () => {
    try {
        if (!prisma) {
            throw new Error('Database chưa được khởi tạo. Vui lòng khởi động lại ứng dụng.');
        }

        const products = await prisma.product.findMany({
            include: {
                category: true
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
        if (!prisma) throw new Error('Prisma not available');
        await prisma.product.delete({ where: { id } });
        console.log(`✅ Deleted product ID: ${id}`);
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

        // 🔍 Phát hiện nguồn (TikTok vs Shopee)
        const firstRow = jsonData[0] || {};
        const isTikTok = 'Order ID' in firstRow || 'Tracking ID' in firstRow;
        const isShopee = 'Mã đơn hàng' in firstRow || 'Mã vận đơn' in firstRow;

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
                const trackingId = normalizeStr(row['Mã vận đơn'] || '');
                const orderId = normalizeStr(row['Mã đơn hàng'] || '');
                const productName = normalizeStr(row['Tên sản phẩm'] || row['Tên Sản Phẩm'] || '');
                const variation = normalizeStr(row['Tên phân loại hàng'] || row['Phân loại hàng'] || '');
                const sku = normalizeStr(row['Mã phân loại hàng'] || row['SKU phân loại hàng'] || '');
                const quantity = parseInt(row['Số lượng'] || '1');
                const shippingProvider = normalizeStr(row['Đơn Vị Vận Chuyển'] || '');
                const totalAmount = parseFloat(row['Tổng giá bán (sản phẩm)'] || row['Tổng cộng'] || '0');
                const unitPrice = parseFloat(row['Giá gốc'] || row['Đơn giá'] || '0');

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
// INVENTORY - UPDATE STOCK
// ========================================

// Update stock khi export hoặc cân bằng kho
ipcMain.handle('products:updateStock', async (event, { sku, quantity, isAdd = false }) => {
    try {
        console.log(`📦 Update stock: SKU=${sku}, Qty=${quantity}, Add=${isAdd}`);

        if (!prisma) {
            throw new Error('Database chưa được khởi tạo.');
        }

        // 🎁 CHECK IF SKU IS A COMBO
        const combo = await prisma.comboProduct.findUnique({
            where: { sku }
        });

        if (combo && !isAdd) {
            // ⭐ THIS IS A COMBO - Deduct stock from components
            console.log(`🎁 Detected COMBO: ${combo.name}`);
            const items = JSON.parse(combo.items || '[]');

            const deductResults = [];
            for (const item of items) {
                const componentQty = item.quantity * quantity; // Qty per combo × combos sold
                console.log(`  → Deducting ${componentQty} from ${item.sku}`);

                // Deduct component stock (recursive call via same handler)
                const deductResult = await updateSingleProductStock(item.sku, componentQty, false);
                deductResults.push(deductResult);
            }

            console.log(`✅ Combo ${sku}: Deducted ${quantity} combo(s)`);
            return { success: true, isCombo: true, deductResults };
        }

        // Regular product/variant stock update
        return await updateSingleProductStock(sku, quantity, isAdd);
    } catch (error) {
        console.error('❌ Update stock error:', error);
        return { success: false, error: error.message };
    }
});

// Helper function to update single product/variant stock
async function updateSingleProductStock(sku, quantity, isAdd) {
    let product = await prisma.product.findUnique({ where: { sku } });
    let isVariant = false;

    if (!product) {
        // Tìm trong variants
        const products = await prisma.product.findMany({
            where: {
                variants: {
                    contains: sku
                }
            }
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
        return { success: false, error: `Không tìm thấy SKU: ${sku}` };
    }

    // Cập nhật stock
    if (isVariant) {
        const variants = JSON.parse(product.variants);
        const variantIndex = variants.findIndex(v => v.sku === sku);

        if (variantIndex < 0) {
            return { success: false, error: `Variant ${sku} không tìm thấy` };
        }

        const oldStock = variants[variantIndex].stock || 0;
        const newStock = isAdd ? oldStock + quantity : oldStock - quantity;
        variants[variantIndex].stock = Math.max(0, newStock);

        await prisma.product.update({
            where: { id: product.id },
            data: { variants: JSON.stringify(variants) }
        });

        console.log(`✅ [DATABASE] Updated variant ${sku}: ${oldStock} → ${variants[variantIndex].stock}`);
        product = await prisma.product.findUnique({ where: { id: product.id } });
    } else {
        const oldStock = product.stock;
        const newStock = isAdd ? oldStock + quantity : oldStock - quantity;

        product = await prisma.product.update({
            where: { id: product.id },
            data: { stock: Math.max(0, newStock) }
        });

        console.log(`✅ [DATABASE] Updated product ${sku}: ${oldStock} → ${product.stock}`);
    }

    return { success: true, data: product };
}

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

// Get all purchases
ipcMain.handle('purchases:getAll', async () => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        const purchases = await prisma.purchaseOrder.findMany({
            include: {
                supplier: true,
                items: {
                    include: {
                        product: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
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

            return {
                ...p,
                supplierName: p.supplier?.name,
                purchaseDate: p.receivedAt || p.createdAt,
                totalAmount: p.total, // Frontend expects 'totalAmount', DB has 'total'
                items: JSON.stringify(itemsFormatted), // Convert to JSON string for frontend
                notes: p.note
            };
        });

        return { success: true, data: formatted };
    } catch (error) {
        console.error('❌ Get purchases error:', error);
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

        // Validate all productIds exist
        for (const item of items) {
            const product = await prisma.product.findUnique({
                where: { id: item.productId }
            });
            if (!product) {
                throw new Error(`Product ID ${item.productId} not found. Item: ${item.productName}`);
            }
        }

        const purchase = await prisma.purchaseOrder.create({
            data: {
                poNumber: `PO${Date.now()}`,
                supplierId: data.supplierId,
                status: data.status || 'completed',
                subtotal: data.totalAmount,
                total: data.totalAmount,
                note: data.notes,
                receivedAt: new Date(data.purchaseDate),
                createdBy: data.createdBy || 'Admin', // 👤 Lưu người tạo
                items: {
                    create: items.map(item => ({
                        productId: item.productId,
                        quantity: item.quantity,
                        price: item.unitPrice,
                        subtotal: item.total,
                        variantSku: item.variantSku || null, // 🎨 Lưu SKU variant
                        color: item.color || null // 🎨 Lưu màu sắc
                    }))
                }
            },
            include: { supplier: true, items: true }
        });

        console.log(`✅ Created purchase order: ${purchase.poNumber}`);

        // 🔥 CẬP NHẬT TỒN KHO
        console.log('📊 Updating stock for purchased items...');
        for (const item of items) {
            const product = await prisma.product.findUnique({
                where: { id: item.productId }
            });

            if (!product) continue;

            // Nếu có variantSku (phân loại), cập nhật stock trong JSON
            if (item.variantSku && product.variants) {
                try {
                    const variants = JSON.parse(product.variants);
                    const variantIndex = variants.findIndex(v => v.sku === item.variantSku);

                    if (variantIndex >= 0) {
                        const oldStock = variants[variantIndex].stock || 0;
                        variants[variantIndex].stock = oldStock + item.quantity;

                        await prisma.product.update({
                            where: { id: item.productId },
                            data: { variants: JSON.stringify(variants) }
                        });

                        console.log(`  ✅ Updated variant stock: ${item.variantSku} (${oldStock} → ${variants[variantIndex].stock})`);
                    }
                } catch (err) {
                    console.error(`  ⚠️  Failed to update variant stock for ${item.variantSku}:`, err.message);
                }
            } else {
                // Sản phẩm không có variant → cập nhật stock trực tiếp
                const oldStock = product.stock;
                const newStock = oldStock + item.quantity;

                await prisma.product.update({
                    where: { id: item.productId },
                    data: { stock: newStock }
                });

                console.log(`  ✅ Updated product stock: ${product.sku} (${oldStock} → ${newStock})`);
            }
        }

        return { success: true, data: purchase };
    } catch (error) {
        console.error('❌ Create purchase error:', error);
        return { success: false, error: error.message };
    }
});

// Update purchase
ipcMain.handle('purchases:update', async (event, id, data) => {
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
                receivedAt: new Date(data.purchaseDate)
            }
        });

        console.log(`✅ Updated purchase order: ${purchase.poNumber}`);
        return { success: true, data: purchase };
    } catch (error) {
        console.error('❌ Update purchase error:', error);
        return { success: false, error: error.message };
    }
});

// Delete purchase
ipcMain.handle('purchases:delete', async (event, id) => {
    try {
        if (!prisma) throw new Error('Prisma not available');

        console.log(`🗑️  Deleting purchase order #${id}...`);

        // Dùng transaction để xóa an toàn
        await prisma.$transaction(async (tx) => {
            // Bước 1: Xóa tất cả PurchaseItems
            const deletedItems = await tx.purchaseItem.deleteMany({
                where: { purchaseOrderId: id }
            });
            console.log(`  ✅ Deleted ${deletedItems.count} purchase items`);

            // Bước 2: Xóa PurchaseOrder
            await tx.purchaseOrder.delete({
                where: { id }
            });
            console.log(`  ✅ Deleted purchase order #${id}`);
        });

        console.log(`✅ Successfully deleted purchase order #${id}`);
        return { success: true };
    } catch (error) {
        console.error('❌ Delete purchase error:', error);
        console.error('   Error code:', error.code);
        console.error('   Error meta:', error.meta);
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
        // Note: LocalStorage based system - just update the password directly
        const stored = localStorage.getItem('users');
        if (!stored) {
            return { success: false, error: 'Không tìm thấy dữ liệu người dùng' };
        }

        const users = JSON.parse(stored);
        const user = users.find(u => u.id === userId);

        if (!user) {
            return { success: false, error: 'Người dùng không tồn tại' };
        }

        // Verify old password
        if (user.password !== oldPassword) {
            return { success: false, error: 'Mật khẩu hiện tại không đúng' };
        }

        // Update password
        user.password = newPassword;
        localStorage.setItem('users', JSON.stringify(users));

        console.log(`✅ Changed password for user: ${user.username}`);
        return { success: true };
    } catch (error) {
        console.error('❌ Change password error:', error);
        return { success: false, error: error.message };
    }
});

// Reset password (admin resets another user's password)
ipcMain.handle('users:resetPassword', async (event, { userId, newPassword }) => {
    try {
        // Note: LocalStorage based system - just update the password directly
        const stored = localStorage.getItem('users');
        if (!stored) {
            return { success: false, error: 'Không tìm thấy dữ liệu người dùng' };
        }

        const users = JSON.parse(stored);
        const user = users.find(u => u.id === userId);

        if (!user) {
            return { success: false, error: 'Người dùng không tồn tại' };
        }

        // Update password
        user.password = newPassword;
        localStorage.setItem('users', JSON.stringify(users));

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

            // Nội dung ZIP
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

        const task = await prisma.dailyTask.update({
            where: { id },
            data: updateData
        });

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
            items.forEach(item => {
                const product = products.find(p => p.id === item.productId);
                if (product && product.variants) {
                    const variants = JSON.parse(product.variants);
                    const variant = variants[item.variantIndex];
                    if (variant) {
                        const possibleCombos = Math.floor((variant.stock || 0) / item.quantity);
                        availableStock = Math.min(availableStock, possibleCombos);
                    }
                } else if (product) {
                    const possibleCombos = Math.floor(product.stock / item.quantity);
                    availableStock = Math.min(availableStock, possibleCombos);
                }
            });
            return { ...combo, stock: availableStock === Infinity ? 0 : availableStock };
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
        const combo = await prisma.comboProduct.create({
            data: { sku: data.sku, name: data.name, items: JSON.stringify(data.items), price: data.price, cost: data.cost, status: 'active' }
        });
        return { success: true, data: combo };
    } catch (error) {
        console.error('Error creating combo:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('combos:update', async (event, id, data) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        const combo = await prisma.comboProduct.update({
            where: { id: parseInt(id) },
            data: { sku: data.sku, name: data.name, items: JSON.stringify(data.items), price: data.price, cost: data.cost }
        });
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
        return { success: true };
    } catch (error) {
        console.error('Error deleting combo:', error);
        return { success: false, error: error.message };
    }
});

// ========================================
// ECOMMERCE EXPORT - FOLDER IMPORT
// ========================================

// Chọn thư mục chứa file Excel xuất hàng TMDT
ipcMain.handle('ecommerceExport:selectFolder', async () => {
    try {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Chọn thư mục chứa file Excel xuất hàng TMDT',
        });

        if (result.canceled || result.filePaths.length === 0) {
            return { success: false, error: 'Không có thư mục được chọn' };
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

function saveUpdateHistory(history) {
    fs.writeFileSync(UPDATE_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
}

// Lấy version hiện tại từ package.json
ipcMain.handle('update:getCurrentVersion', async () => {
    try {
        const pkgPath = path.join(__dirname, '..', 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return { success: true, data: pkg.version };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Kiểm tra bản cập nhật mới
ipcMain.handle('update:check', async () => {
    try {
        const pkgPath = path.join(__dirname, '..', 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const currentVersion = pkg.version;

        // Gọi GitHub API
        const data = await new Promise((resolve, reject) => {
            https.get(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
                headers: { 'User-Agent': 'AircleanWMS' }
            }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve(JSON.parse(body));
                    } else {
                        reject(new Error(`GitHub API error: ${res.statusCode}`));
                    }
                });
            }).on('error', reject);
        });

        const latestVersion = data.tag_name.replace('v', '');
        const hasUpdate = latestVersion !== currentVersion;

        return {
            success: true,
            data: {
                currentVersion,
                latestVersion,
                hasUpdate,
                releaseNotes: data.body || data.name || '',
                publishedAt: data.published_at,
                downloadUrl: data.assets && data.assets[0] ? data.assets[0].browser_download_url : null,
                downloadSize: data.assets && data.assets[0] ? data.assets[0].size : 0,
            }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Tải và cài đặt bản cập nhật (OPTIMIZED VERSION)
ipcMain.handle('update:download', async (event, downloadUrl) => {
    try {
        const appPath = path.join(__dirname, '..');
        const tempDir = path.join(app.getPath('temp'), 'airclean-update');
        const zipPath = path.join(tempDir, 'update.zip');
        const extractDir = path.join(tempDir, 'extracted');

        // Tạo thư mục tạm
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
        fs.mkdirSync(tempDir, { recursive: true });

        console.log('⬇️ Starting download from:', downloadUrl);

        // Download file zip với progress tracking
        await new Promise((resolve, reject) => {
            const downloadFile = (url) => {
                https.get(url, {
                    headers: { 'User-Agent': 'AircleanWMS' }
                }, (res) => {
                    // Follow redirects
                    if (res.statusCode === 302 || res.statusCode === 301) {
                        console.log('↪️ Following redirect to:', res.headers.location);
                        downloadFile(res.headers.location);
                        return;
                    }
                    if (res.statusCode !== 200) {
                        reject(new Error(`Download failed: ${res.statusCode}`));
                        return;
                    }

                    const totalBytes = parseInt(res.headers['content-length'], 10);
                    let downloadedBytes = 0;
                    const startTime = Date.now();

                    console.log(`📦 File size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

                    const file = fs.createWriteStream(zipPath);

                    res.on('data', (chunk) => {
                        downloadedBytes += chunk.length;
                        const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
                        const elapsed = (Date.now() - startTime) / 1000;
                        const speed = (downloadedBytes / 1024 / 1024) / elapsed;

                        // Log mỗi 10%
                        if (downloadedBytes % Math.floor(totalBytes / 10) < chunk.length) {
                            console.log(`⬇️ Downloaded: ${percent}% (${speed.toFixed(2)} MB/s)`);
                        }
                    });

                    res.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
                        console.log(`✅ Download complete in ${totalTime}s`);
                        resolve();
                    });
                    file.on('error', reject);
                }).on('error', reject);
            };
            downloadFile(downloadUrl);
        });

        // Giải nén bằng adm-zip (NHANH HƠN PowerShell)
        console.log('📂 Extracting...');
        const AdmZip = require('adm-zip');
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(extractDir, true);
        console.log('✅ Extraction complete');

        // Copy đè vào thư mục app (trừ .env và database)
        console.log('📋 Copying files...');
        const copyRecursive = (src, dest) => {
            const entries = fs.readdirSync(src, { withFileTypes: true });
            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

            let copiedCount = 0;
            for (const entry of entries) {
                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);

                // Skip files that shouldn't be overwritten
                if (entry.name === '.env') continue;
                if (entry.name === 'dev.db') continue; // Không đè database
                if (entry.name === 'Backups') continue; // Không đè backups

                if (entry.isDirectory()) {
                    copyRecursive(srcPath, destPath);
                } else {
                    fs.copyFileSync(srcPath, destPath);
                    copiedCount++;
                    if (copiedCount % 100 === 0) {
                        console.log(`   Copied ${copiedCount} files...`);
                    }
                }
            }
        };
        copyRecursive(extractDir, appPath);
        console.log('✅ Files copied successfully');

        // Lưu lịch sử update
        const history = getUpdateHistory();
        let newVersion = 'unknown';
        try {
            const newPkg = JSON.parse(fs.readFileSync(path.join(appPath, 'package.json'), 'utf8'));
            newVersion = newPkg.version;
        } catch { }

        history.unshift({
            version: newVersion,
            date: new Date().toISOString(),
            status: 'success',
        });
        if (history.length > 50) history.length = 50;
        saveUpdateHistory(history);

        // Dọn dẹp
        console.log('🧹 Cleaning up...');
        fs.rmSync(tempDir, { recursive: true });

        console.log(`🎉 Update to v${newVersion} completed successfully!`);
        return { success: true, data: { version: newVersion } };
    } catch (error) {
        console.error('❌ Update error:', error);
        return { success: false, error: error.message };
    }
});

// Restart app
ipcMain.handle('update:restart', async () => {
    app.relaunch();
    app.exit(0);
});

// Lấy lịch sử update
ipcMain.handle('update:getHistory', async () => {
    try {
        return { success: true, data: getUpdateHistory() };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// ========================================
// AUTO UPDATE HANDLERS
// ========================================
require('./update-handlers');

module.exports = { prisma };

