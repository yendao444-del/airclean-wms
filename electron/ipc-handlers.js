const { ipcMain, dialog, shell, app, nativeImage } = require("electron");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// ✅ PRODUCTION CONFIG - Không cần .env nữa
const config = require("./config");
const { reconcileLateAttendanceFines } = require("./attendance-fines");

// 📦 Offline Queue — lưu scan khi mất mạng, sync lại khi có mạng
const offlineQueue = require("./offline-queue");
try {
  offlineQueue.init(app.getPath("userData"));
} catch (e) {
  console.error("[OfflineQueue] Init failed:", e.message);
}

// Set environment variables từ config
const isPostgresUrl = (value) =>
  typeof value === "string" && /^postgres(?:ql)?:\/\//i.test(value.trim());
// A shell or another local project can leave DATABASE_URL/DIRECT_URL behind.
// Never pass a non-PostgreSQL value to Prisma; use the packaged fallback instead.
const databaseUrl = isPostgresUrl(config.DATABASE_URL)
  ? config.DATABASE_URL
  : process.env.DATABASE_URL;
const directDatabaseUrl = isPostgresUrl(config.DIRECT_URL)
  ? config.DIRECT_URL
  : databaseUrl || process.env.DIRECT_URL;
process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_URL = directDatabaseUrl;

const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const zlib = require("zlib");
const { createClient } = require("@supabase/supabase-js");

function getEvidenceStorageConfigPath() {
  return path.join(app.getPath("userData"), "supabase-storage.json");
}

function readEvidenceStorageConfig(configPath) {
  try {
    if (!fs.existsSync(configPath)) return {};
    return JSON.parse(fs.readFileSync(configPath, "utf8")) || {};
  } catch (error) {
    console.warn(
      `Unable to read Supabase Storage configuration at ${configPath}:`,
      error.message,
    );
    return {};
  }
}

function loadEvidenceStorageConfig() {
  // Generated from .env by the release scripts and included in each patch.
  const bundled = readEvidenceStorageConfig(
    path.join(__dirname, "supabase-storage.json"),
  );
  const fallback = {
    url:
      process.env.SUPABASE_URL ||
      bundled.supabaseUrl ||
      config.SUPABASE_URL ||
      "",
    serviceRoleKey:
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      bundled.serviceRoleKey ||
      config.SUPABASE_SERVICE_ROLE_KEY ||
      "",
    bucket:
      process.env.SUPABASE_EVIDENCE_BUCKET ||
      bundled.bucket ||
      config.SUPABASE_EVIDENCE_BUCKET ||
      "daily-task-evidence",
  };
  const saved = readEvidenceStorageConfig(getEvidenceStorageConfigPath());
  return {
    url: String(saved.supabaseUrl || fallback.url || "").trim(),
    serviceRoleKey: String(
      saved.serviceRoleKey || fallback.serviceRoleKey || "",
    ).trim(),
    bucket: String(
      saved.bucket || fallback.bucket || "daily-task-evidence",
    ).trim(),
  };
}

const evidenceStorageConfig = loadEvidenceStorageConfig();
const evidenceStorage =
  evidenceStorageConfig.url && evidenceStorageConfig.serviceRoleKey
    ? createClient(
        evidenceStorageConfig.url,
        evidenceStorageConfig.serviceRoleKey,
        {
          auth: { autoRefreshToken: false, persistSession: false },
        },
      )
    : null;
const EVIDENCE_BUCKET = evidenceStorageConfig.bucket || "daily-task-evidence";
const MAX_EVIDENCE_STORAGE_BYTES = 900 * 1024;

function getEvidenceStorageUnavailableMessage() {
  return `Supabase Storage chưa được cấu hình. Mở file ${getEvidenceStorageConfigPath()} và điền Supabase URL cùng Service Role Key.`;
}

// ========================================
// 🔒 STOCK MUTEX — Serialize stock operations
// Ngăn race condition khi nhiều scan/import chạy đồng thời
// Đảm bảo Tồn đầu/Tồn cuối trong Thẻ Kho luôn đúng
// ========================================
const _stockQueue = [];
let _stockLocked = false;

function acquireStockLock() {
  return new Promise((resolve) => {
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

// Process-local locking is not enough when two desktop clients share the
// same PostgreSQL database. This transaction-scoped advisory lock is the
// database-wide serialization point for every stock mutation. It deliberately
// uses one global key: variant stock is stored as one JSON document, so locking
// by SKU alone could still let two variants of the same product overwrite one
// another.
async function lockGlobalInventoryMutation(tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('inventory-global-stock-mutation'))`;
}

// ⚡ LAZY LOADING — Module nặng chỉ load khi cần, không block startup
// googleapis (~3-5s), xlsx (~1-2s), bcryptjs (~0.5s) → tiết kiệm ~5-7s
function lazyRequire(moduleName) {
  let mod = null;
  return new Proxy(
    {},
    {
      get(_, prop) {
        if (!mod) {
          console.time(`âš¡ lazy-load ${moduleName}`);
          mod = require(moduleName);
          console.timeEnd(`âš¡ lazy-load ${moduleName}`);
        }
        return mod[prop];
      },
    },
  );
}

const XLSX = lazyRequire("xlsx");
const bcrypt = lazyRequire("bcryptjs");

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
let driveLastErrorMessage = "";

function getGoogleTokenPath() {
  return path.join(app.getPath("userData"), "gdrive-token.json");
}

function getLegacyGoogleTokenPath() {
  return path.join(__dirname, "gdrive-token.json");
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
      console.log("[Drive] Token bundle moi hon AppData - cap nhat token moi.");
    }
    return tokenPath;
  }

  if (appDataExists) return tokenPath;

  if (legacyExists) {
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.copyFileSync(legacyPath, tokenPath);
    console.warn(
      "[Drive] Migrated Google token from app source to userData. Remove legacy token before building:",
      legacyPath,
    );
    return tokenPath;
  }

  return tokenPath;
}

function getDriveClient() {
  try {
    const tokenPath = ensureGoogleTokenPath();
    if (!fs.existsSync(tokenPath)) {
      console.warn("[Drive] Token not found:", tokenPath);
      driveClient = null;
      return null;
    }
    // Force reinit neáu token file thay doi (sau reauth)
    const tokenMtime = fs.statSync(tokenPath).mtimeMs;
    if (driveClient && tokenMtime === driveClientTokenMtime) {
      return driveClient;
    }
    if (tokenMtime !== driveClientTokenMtime) {
      console.log("[Drive] Token file changed, reinit client...");
      driveClient = null;
    }
    const { google } = require("googleapis");
    const tokens = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
    const oauth2Client = new google.auth.OAuth2(
      OAUTH_CLIENT_ID,
      OAUTH_CLIENT_SECRET,
    );
    oauth2Client.setCredentials(tokens);
    oauth2Client.on("tokens", (newTokens) => {
      try {
        const saved = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
        const updated = { ...saved, ...newTokens };
        fs.writeFileSync(tokenPath, JSON.stringify(updated, null, 2));
        driveClientTokenMtime = fs.statSync(tokenPath).mtimeMs;
        console.log("[Drive] Token refreshed & saved");
      } catch (saveErr) {
        console.error(
          "[Drive] Failed to save refreshed token:",
          saveErr.message,
        );
      }
    });
    driveClient = google.drive({ version: "v3", auth: oauth2Client });
    driveClientTokenMtime = tokenMtime;
    console.log("[Drive] Client initialized (OAuth2)");
    return driveClient;
  } catch (err) {
    console.error("[Drive] Init error:", err.message);
    driveClient = null;
    driveClientTokenMtime = 0;
    return null;
  }
}

function resetDriveClient() {
  driveClient = null;
  driveClientTokenMtime = 0;
  console.log("[Drive] Client reset - se tai khoi tao voi token moi nhat");
}

// Tìm hoặc tạo subfolder theo tháng: HDDT-AIRCLEAN/2026-03/
async function getOrCreateMonthFolder(drive, parentFolderId, monthStr) {
  try {
    // Tìm folder đã có
    const res = await drive.files.list({
      q: `'${parentFolderId}' in parents and name='${monthStr}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, name)",
    });
    if (res.data.files.length > 0) {
      return res.data.files[0].id;
    }
    // Tạo mới
    const folder = await drive.files.create({
      requestBody: {
        name: monthStr,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentFolderId],
      },
      fields: "id",
    });
    console.log(`📁 Created Drive folder: ${monthStr}`);
    return folder.data.id;
  } catch (err) {
    console.error("❌ Create month folder error:", err.message);
    return parentFolderId; // Fallback: upload vào root folder
  }
}

// Upload file lên Google Drive
async function uploadToDrive(drive, folderId, fileName, content, mimeType) {
  try {
    const { Readable } = require("stream");
    const bufferStream = new Readable();
    bufferStream.push(
      Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8"),
    );
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
      fields: "id, webViewLink, webContentLink",
    });

    // Set quyền "Anyone with link can view" — fire-and-forget, không block upload
    drive.permissions
      .create({
        fileId: file.data.id,
        requestBody: { role: "reader", type: "anyone" },
      })
      .catch((permErr) =>
        console.warn(
          `⚠️ Could not set public permission for ${fileName}:`,
          permErr.message,
        ),
      );

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
      const boundary =
        "----FormBoundary" + Math.random().toString(36).substring(2);
      const parts = [];

      // chat_id
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${TELEGRAM_CHAT_ID}`,
      );
      // caption
      if (caption) {
        parts.push(
          `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}`,
        );
      }
      // document
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      );

      const header = Buffer.from(parts.join("\r\n") + "\r\n", "utf-8");
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
      const fileBuffer = Buffer.isBuffer(buffer)
        ? buffer
        : Buffer.from(buffer, "utf-8");
      const body = Buffer.concat([header, fileBuffer, footer]);

      const options = {
        hostname: "api.telegram.org",
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendDocument`,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
        timeout: 15000,
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            console.log(`📱 Telegram sent: ${fileName}`);
            resolve({ success: true });
          } else {
            console.error(
              `❌ Telegram error ${res.statusCode}:`,
              data.substring(0, 200),
            );
            resolve({ success: false, error: `HTTP ${res.statusCode}` });
          }
        });
      });

      req.on("error", (e) => resolve({ success: false, error: e.message }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ success: false, error: "Timeout" });
      });
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
    const postData = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
    });
    const options = {
      hostname: "api.telegram.org",
      path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
      timeout: 5000,
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ success: res.statusCode === 200 }));
    });
    req.on("error", (e) => resolve({ success: false, error: e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ success: false, error: "Timeout" });
    });
    req.write(postData);
    req.end();
  });
}

// Tạo XML hóa đơn (chuẩn bị — khi tích hợp MISA sẽ lấy từ API)
function generateInvoiceXML(order, invoiceNumber, taxCode) {
  const items =
    typeof order.items === "string"
      ? JSON.parse(order.items)
      : order.items || [];
  const itemsXml = items
    .map(
      (item, idx) => `
        <Item>
            <LineNumber>${idx + 1}</LineNumber>
            <ItemName>${escapeXml(item.productName || "")}</ItemName>
            <Quantity>${item.quantity || 1}</Quantity>
            <UnitPrice>${item.unitPrice || 0}</UnitPrice>
            <Amount>${item.total || 0}</Amount>
        </Item>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice>
    <InvoiceNumber>${invoiceNumber}</InvoiceNumber>
    <InvoiceDate>${new Date().toISOString().split("T")[0]}</InvoiceDate>
    <TaxCode>${taxCode}</TaxCode>
    <Seller>
        <Name>AIRCLEAN</Name>
        <TaxID>MST_COMPANY</TaxID>
    </Seller>
    <Buyer>
        <Name>${escapeXml(order.customerName || "")}</Name>
        <Phone>${order.customerPhone || ""}</Phone>
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
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Upload + gửi 1 hóa đơn lên Drive & Telegram (chạy ngầm, không block)
async function backupInvoiceToCloudAndTelegram(order, invoiceNumber, taxCode) {
  const results = {
    drive: { xml: null, pdf: null },
    telegram: { xml: false, pdf: false },
  };

  try {
    const xmlContent = generateInvoiceXML(order, invoiceNumber, taxCode);
    const xmlFileName = `${invoiceNumber}_${order.orderId}.xml`;

    // Tạo nội dung text đơn giản thay cho PDF (vì chưa có MISA API trả PDF thật)
    const pdfContent =
      `HÓA ĐƠN ĐIỆN TỬ - BẢN THỂ HIỆN\n` +
      `========================================\n` +
      `Số HĐ: ${invoiceNumber}\n` +
      `Ngày: ${new Date().toLocaleDateString("vi-VN")}\n` +
      `Mã tra cứu: ${taxCode}\n` +
      `\nNGƯỜI BÁN: AIRCLEAN\n` +
      `\nNGƯỜI MUA: ${order.customerName}\n` +
      `SĐT: ${order.customerPhone || "N/A"}\n` +
      `Sàn: ${order.platform}\n` +
      `Mã đơn: ${order.orderId}\n` +
      `\nTỔNG TIỀN: ${Number(order.totalAmount).toLocaleString("vi-VN")}đ\n` +
      `========================================\n` +
      `✅ Đã ký số điện tử\n` +
      `📋 Lưu ý: Đây là bản thể hiện. File XML gốc có giá trị pháp lý.`;
    const pdfFileName = `${invoiceNumber}_${order.orderId}.txt`; // .txt vì chưa có PDF thật

    const monthStr = new Date().toISOString().slice(0, 7); // 2026-03

    // === GOOGLE DRIVE ===
    const drive = getDriveClient();
    if (drive) {
      const monthFolderId = await getOrCreateMonthFolder(
        drive,
        GDRIVE_FOLDER_ID,
        monthStr,
      );

      const [xmlResult, pdfResult] = await Promise.all([
        uploadToDrive(
          drive,
          monthFolderId,
          xmlFileName,
          xmlContent,
          "application/xml",
        ),
        uploadToDrive(
          drive,
          monthFolderId,
          pdfFileName,
          pdfContent,
          "text/plain",
        ),
      ]);
      results.drive.xml = xmlResult;
      results.drive.pdf = pdfResult;
    }

    // === TELEGRAM ===
    const caption =
      `🧾 ${invoiceNumber}\n` +
      `👤 ${order.customerName}\n` +
      `💰 ${Number(order.totalAmount).toLocaleString("vi-VN")}đ\n` +
      `🛒 ${order.platform} | ${order.orderId}\n` +
      `📅 ${new Date().toLocaleDateString("vi-VN")}`;

    const [tgXml, tgPdf] = await Promise.all([
      sendTelegramDocument(
        Buffer.from(xmlContent, "utf-8"),
        xmlFileName,
        `📎 XML gốc — ${caption}`,
      ),
      sendTelegramDocument(
        Buffer.from(pdfContent, "utf-8"),
        pdfFileName,
        `📄 Bản thể hiện — ${caption}`,
      ),
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
    console.time("âš¡ lazy-init prismaDirectTx");
    prismaDirectTx = new PrismaClient({
      log: ["error", "warn"],
      datasources: { db: { url: directDatabaseUrl } },
    });
    prismaDirectTx
      .$connect()
      .then(() => console.log("✅ Connected Prisma Direct (for transactions)"))
      .catch((err) =>
        console.error("⚠️ Prisma Direct connect failed:", err.message),
      );
    console.timeEnd("âš¡ lazy-init prismaDirectTx");
  }
  return prismaDirectTx;
}

try {
  console.log("🔄 Initializing Prisma Client...");
  console.log("   🆕 CODE VERSION: 3.0 (Production with embedded config)");
  console.log("   APP:", config.APP_NAME, config.APP_VERSION);
  console.log("   ENVIRONMENT:", config.ENVIRONMENT);
  console.log(
    "   DATABASE_URL:",
    config.DATABASE_URL.split("@")[1] || "Invalid",
  ); // Chỉ log domain, không log password

  prisma = new PrismaClient({
    log: ["error", "warn"],
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
  console.log("✅ Prisma Client initialized successfully");

  // Test connection - REQUIRED
  prisma
    .$connect()
    .then(() => {
      console.log("✅ Connected to Supabase PostgreSQL");
    })
    .catch((err) => {
      console.error("❌ CRITICAL: Database connection failed!");
      console.error("   Error:", err.message);
      console.error("   Stack:", err.stack);

      // Show error dialog to user
      const { dialog } = require("electron");
      dialog.showErrorBox(
        "Lỗi kết nối Database",
        `Không thể kết nối đến database.\n\nChi tiết: ${err.message}\n\nVui lòng kiểm tra kết nối internet và thử lại.`,
      );

      // Exit app if can't connect to database
      app.quit();
    });
} catch (error) {
  console.error("❌ CRITICAL: Prisma Client initialization failed!");
  console.error("   Error:", error.message);
  console.error("   Stack:", error.stack);

  // Show error dialog
  const { dialog } = require("electron");
  dialog.showErrorBox(
    "Lỗi khởi tạo Database",
    `Không thể khởi tạo kết nối database.\n\nChi tiết: ${error.message}\n\nỨng dụng sẽ thoát.`,
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
const REMEMBER_TOKENS_KEY = "authRememberTokensV1";
const REMEMBER_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_ROTATION_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_CHANGE_ALLOWED_CHANNELS = new Set([
  "users:changePassword",
  "users:updateProfile",
  "users:getCurrentSession",
  "users:logout",
]);
const SESSION_STATUS_EXEMPT_CHANNELS = new Set([
  "users:login",
  "users:logout",
  "users:getCurrentSession",
  "users:restoreSession",
  "users:heartbeat",
  "users:changePassword",
  "users:updateProfile",
]);
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const TEST_OPERATOR_USERNAME = "test";

const ipcHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) =>
  ipcHandle(channel, async (...args) => {
    // Sessions live in each Electron process. Re-check account status before
    // mutations so an account marked "resigned" by an admin is blocked even
    // when that employee still has an already-open app window.
    if (
      currentSession?.id &&
      !SESSION_STATUS_EXEMPT_CHANNELS.has(channel) &&
      prisma
    ) {
      const sessionUser = await prisma.user.findUnique({
        where: { id: currentSession.id },
        select: { status: true },
      });
      if (!sessionUser || sessionUser.status !== "active") {
        const resigned = sessionUser?.status === "resigned";
        currentSession = null;
        throw new Error(
          resigned
            ? "Tài khoản đã nghỉ việc và không còn quyền sử dụng hệ thống."
            : "Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên.",
        );
      }
    }
    if (
      currentSession?.mustChangePassword &&
      !PASSWORD_CHANGE_ALLOWED_CHANNELS.has(channel)
    ) {
      throw new Error(
        "Bạn cần đổi mật khẩu trước khi tiếp tục sử dụng hệ thống.",
      );
    }
    return listener(...args);
  });

function isPasswordRotationRequired(user) {
  const passwordChangedAt = user?.passwordChangedAt
    ? new Date(user.passwordChangedAt)
    : null;
  return (
    Boolean(user?.forcePasswordChange) ||
    (user?.role !== "admin" &&
      (!passwordChangedAt ||
        Date.now() - passwordChangedAt.getTime() >= PASSWORD_ROTATION_MS))
  );
}

function getDriveAuthMessage(error) {
  if (isGoogleReauthError(error)) {
    return "Google Drive đã hết hạn hoặc bị thu hồi quyền. Vui lòng đăng nhập lại Google Drive rồi tải lại file.";
  }
  return error?.message || "Không thể kết nối Google Drive.";
}

// Creating a Drive client does not prove that its OAuth token is still valid.
// Verify it before accepting documents, otherwise another machine may show a
// fake “uploaded” state for a file it cannot ever open.
async function ensureDriveReady() {
  const drive = getDriveClient();
  if (!drive) {
    driveLastErrorMessage =
      "Chưa có phiên đăng nhập Google Drive hợp lệ. Vui lòng đăng nhập lại Google Drive.";
    return { success: false, error: driveLastErrorMessage };
  }
  try {
    await drive.about.get({ fields: "user(permissionId)" });
    driveLastErrorMessage = "";
    return { success: true, drive };
  } catch (error) {
    resetDriveClient();
    driveLastErrorMessage = getDriveAuthMessage(error);
    console.error(
      "[Drive] Authentication check failed:",
      error?.message || error,
    );
    return { success: false, error: driveLastErrorMessage };
  }
}

const EVIDENCE_DRIVE_FOLDER_NAME = "BANGCHUNG-CONGVIEC";
let evidenceDriveFolderId = null;

// Evidence must remain available for audit, so it lives in Drive rather than
// the short-retention object store used by the temporary image flow.
async function getOrCreateEvidenceDriveFolder() {
  if (evidenceDriveFolderId) return evidenceDriveFolderId;
  const driveStatus = await ensureDriveReady();
  if (!driveStatus.success) throw new Error(driveStatus.error);

  const { drive } = driveStatus;
  const search = await drive.files.list({
    q: `name='${EVIDENCE_DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
  });
  if (search.data.files?.[0]?.id) {
    evidenceDriveFolderId = search.data.files[0].id;
    return evidenceDriveFolderId;
  }
  const folder = await drive.files.create({
    requestBody: {
      name: EVIDENCE_DRIVE_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });
  evidenceDriveFolderId = folder.data.id;
  return evidenceDriveFolderId;
}

function assertStrongPassword(password) {
  const value = String(password || "");
  if (
    value.length < 8 ||
    value.length > 72 ||
    !/[A-Za-z]/.test(value) ||
    !/\d/.test(value)
  ) {
    throw new Error("Mật khẩu cần tối thiểu 8 ký tự, gồm chữ và số.");
  }
  return value;
}

async function recordFailedLogin(user) {
  if (!user || !prisma) return;
  const expiredLock =
    user.loginLockedUntil &&
    new Date(user.loginLockedUntil).getTime() <= Date.now();
  const attempts =
    (expiredLock ? 0 : Number(user.loginFailedAttempts || 0)) + 1;
  await prisma.user.update({
    where: { id: user.id },
    data: {
      loginFailedAttempts: attempts,
      loginLockedUntil:
        attempts >= LOGIN_MAX_FAILURES
          ? new Date(Date.now() + LOGIN_LOCK_MS)
          : null,
    },
  });
}

async function revokeRememberTokensForUser(userId) {
  const tokens = await readRememberTokens();
  await writeRememberTokens(tokens.filter((token) => token?.userId !== userId));
}

function requireRole(...roles) {
  if (!currentSession) {
    throw new Error("Chưa đăng nhập");
  }
  const canTestAsOperationalRole =
    isTestOperatorSession() && roles.some((role) => role !== "admin");
  if (
    roles.length > 0 &&
    !roles.includes(currentSession.role) &&
    !canTestAsOperationalRole
  ) {
    throw new Error(
      `Không có quyền thực hiện thao tác này (yêu cầu: ${roles.join("/")})`,
    );
  }
}

function isTestOperatorSession(session = currentSession) {
  return (
    String(session?.username || "")
      .trim()
      .toLocaleLowerCase("vi-VN") === TEST_OPERATOR_USERNAME &&
    session?.role !== "admin"
  );
}

function isTestOperatorActor(actor) {
  return (
    String(actor?.username || "")
      .trim()
      .toLocaleLowerCase("vi-VN") === TEST_OPERATOR_USERNAME &&
    actor?.role !== "admin"
  );
}

function sanitizeUserForClient(user) {
  if (!user) return null;
  const { password, ...safeUser } = user;
  const mustChangePassword = isPasswordRotationRequired(user);
  return {
    ...safeUser,
    isActive: user.status === "active",
    mustChangePassword,
    isTestAccount: isTestOperatorSession(user),
  };
}

function requireInventoryLedgerReadAccess() {
  requireRole();
  // The dedicated test operator mirrors admin permissions in the renderer;
  // keep the backend read boundary consistent so its ledger tab can load.
  if (currentSession.role === "admin" || isTestOperatorSession()) return;
  throw new Error("Khong co quyen xem The kho.");
}

function hashRememberToken(token) {
  return crypto
    .createHash("sha256")
    .update(String(token || ""), "utf8")
    .digest("hex");
}

async function readRememberTokens() {
  if (!prisma) return [];
  const config = await prisma.appConfig.findUnique({
    where: { key: REMEMBER_TOKENS_KEY },
  });
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
    create: { key: REMEMBER_TOKENS_KEY, value: JSON.stringify(tokens) },
  });
}

async function issueRememberToken(userId) {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = new Date(now + REMEMBER_TOKEN_TTL_MS).toISOString();
  const tokenHash = hashRememberToken(rawToken);
  const tokens = (await readRememberTokens()).filter(
    (t) =>
      t &&
      t.expiresAt &&
      new Date(t.expiresAt).getTime() > now &&
      t.userId !== userId,
  );
  tokens.push({
    id: crypto.randomUUID(),
    userId,
    tokenHash,
    createdAt: new Date(now).toISOString(),
    expiresAt,
  });
  await writeRememberTokens(tokens.slice(-50));
  return rawToken;
}

async function revokeRememberToken(rawToken) {
  if (!rawToken) return;
  const tokenHash = hashRememberToken(rawToken);
  const tokens = await readRememberTokens();
  await writeRememberTokens(tokens.filter((t) => t?.tokenHash !== tokenHash));
}

// ========================================
// ACTIVITY LOG HELPER
// ========================================
// Serialize audit inserts so busy renderer actions cannot exhaust Prisma's pool.
let activityLogQueue = Promise.resolve();
function logActivity({
  module,
  action,
  description,
  recordId,
  recordName,
  changes,
  userName,
  userId,
  severity,
  ipAddress,
  deviceInfo,
}) {
  activityLogQueue = activityLogQueue
    .catch(() => undefined)
    .then(async () => {
      if (!prisma) return null;
      try {
        return await prisma.activityLog.create({
          data: {
            module: module || "system",
            action: action || "UPDATE",
            description: description || "",
            recordId:
              recordId != null
                ? Number.isInteger(recordId)
                  ? recordId
                  : parseInt(recordId, 10) || null
                : null,
            recordName: recordName || null,
            changes: changes
              ? typeof changes === "string"
                ? changes
                : JSON.stringify(changes)
              : null,
            userName: userName || currentSession?.username || "System",
            userId: userId ?? null,
            severity: severity || "INFO",
            ipAddress: ipAddress || null,
            deviceInfo: deviceInfo || null,
          },
        });
      } catch (err) {
        console.error("⚠️ Activity log failed:", err.message);
        return null;
      }
    });
  return activityLogQueue;
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
      where: { timestamp: { lt: logCutoff } },
    });
    if (logResult.count > 0) {
      console.log(
        `🧹 Cleanup: Đã xóa ${logResult.count} activity log cũ hơn 30 ngày`,
      );
    }

    // 2. Xóa EcommerceExport đã hoàn thành cũ hơn 2 tháng
    const exportCutoff = new Date();
    exportCutoff.setMonth(exportCutoff.getMonth() - 2);
    const exportResult = await prisma.ecommerceExport.deleteMany({
      where: {
        status: "completed",
        ecommerceExportDate: { lt: exportCutoff },
      },
    });
    if (exportResult.count > 0) {
      console.log(
        `🧹 Cleanup: Đã xóa ${exportResult.count} đơn TMDT hoàn thành cũ hơn 2 tháng`,
      );
    }
  } catch (err) {
    console.error("⚠️ Cleanup failed:", err.message);
  }
}

// Chạy cleanup khi app khởi động (delay 10s để DB sẵn sàng)
setTimeout(cleanupOldLogs, 10000);

// Lặp lại mỗi 24 tiếng
setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);

// ========================================
// SYSTEM INFO
// ========================================

const os = require("os");

ipcMain.handle("system:getInfo", async () => {
  try {
    let dbStatus = "disconnected";
    try {
      if (prisma) {
        await prisma.$queryRawUnsafe("SELECT 1");
        dbStatus = "connected";
      }
    } catch {}

    const packageJson = require("../package.json");

    return {
      success: true,
      data: {
        dbStatus,
        machineName: os.hostname(),
        environment: app.isPackaged ? "production" : "development",
        platform: `${os.type()} ${os.release()}`,
        appVersion: packageJson.version,
        nodeVersion: process.version,
        electronVersion: process.versions.electron || "N/A",
      },
    };
  } catch (error) {
    console.error("❌ system:getInfo error:", error.message);
    return { success: false, error: error.message };
  }
});

// ========================================
// DASHBOARD SUMMARY
// ========================================

ipcMain.handle("dashboard:getSummary", async (event, params = {}) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");

    const startedAt = Date.now();
    const toDate = (value, fallback) => {
      const d = value ? new Date(value) : fallback;
      return Number.isNaN(d.getTime()) ? fallback : d;
    };
    const now = new Date();
    const from = toDate(
      params.from,
      new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    );
    const to = toDate(params.to, now);
    const prevFrom = toDate(params.prevFrom, from);
    const prevTo = toDate(params.prevTo, to);
    const chartFrom = toDate(params.chartFrom, from);
    const chartTo = toDate(params.chartTo, to);

    const parseItems = (value) => {
      try {
        return typeof value === "string"
          ? JSON.parse(value || "[]")
          : value || [];
      } catch {
        return [];
      }
    };
    const dateIn = (date, start, end) => date >= start && date <= end;
    const dayKey = (date) => {
      const d = new Date(date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const pickSku = (item) =>
      item?.sku || item?.variantSku || item?.productSku || "";
    const pickName = (item) =>
      item?.productName || item?.name || item?.product || "N/A";
    const pickQty = (item) => Number(item?.quantity ?? item?.qty ?? 0) || 0;
    const pickPrice = (item) =>
      Number(item?.price ?? item?.unitPrice ?? 0) || 0;

    const [
      products,
      exportOrders,
      ecommerceExports,
      prevExportSummary,
      prevEcommerceSummary,
      chartExportRows,
      chartEcommerceRows,
      purchases,
      recentPurchases,
    ] = await Promise.all([
      prisma.product.findMany({
        select: {
          sku: true,
          stock: true,
          minStock: true,
          cost: true,
          variants: true,
        },
        where: { status: { not: "inactive" } },
      }),
      prisma.exportOrder.findMany({
        where: { exportDate: { gte: from, lte: to } },
        select: { exportDate: true, totalAmount: true, items: true },
      }),
      prisma.ecommerceExport.findMany({
        where: {
          status: "completed",
          ecommerceExportDate: { gte: from, lte: to },
        },
        select: { ecommerceExportDate: true, totalAmount: true, items: true },
      }),
      prisma.exportOrder.aggregate({
        where: { exportDate: { gte: prevFrom, lte: prevTo } },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      prisma.ecommerceExport.aggregate({
        where: {
          status: "completed",
          ecommerceExportDate: { gte: prevFrom, lte: prevTo },
        },
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
          status: { not: "cancelled" },
          createdAt: { gte: from, lte: to },
        },
        select: {
          id: true,
          total: true,
          createdAt: true,
          receivedAt: true,
          supplier: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.purchaseOrder.findMany({
        where: { status: { not: "cancelled" } },
        select: {
          id: true,
          total: true,
          createdAt: true,
          receivedAt: true,
          supplier: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
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
        productStock = variants.reduce(
          (sum, v) => sum + (Number(v?.stock) || 0),
          0,
        );
        lowStock = variants.some(
          (v) => (Number(v?.stock) || 0) <= (product.minStock || 10),
        );
        for (const variant of variants) {
          if (variant?.sku) {
            costMap[variant.sku] =
              variant.cost != null && Number(variant.cost) > 0
                ? Number(variant.cost)
                : product.cost || 0;
          }
        }
      }
      totalStock += productStock;
      if (lowStock) lowStockCount += 1;
    }

    const emptyTotals = () => ({
      revenue: 0,
      count: 0,
      posRevenue: 0,
      posCount: 0,
      ecomRevenue: 0,
      ecomCount: 0,
      cogs: 0,
    });
    const current = emptyTotals();
    const previous = emptyTotals();
    const dailyRevenueByDate = {};
    const topMap = new Map();

    const addSalesRow = (row, source, date, bucket) => {
      const amount = Number(row.totalAmount || 0);
      bucket.revenue += amount;
      bucket.count += 1;
      if (source === "pos") {
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
      ...exportOrders.map((row) => ({
        row,
        source: "pos",
        date: row.exportDate,
      })),
      ...ecommerceExports.map((row) => ({
        row,
        source: "ecom",
        date: row.ecommerceExportDate,
      })),
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
      const key = String(row.day || "");
      if (key)
        dailyRevenueByDate[key] =
          (dailyRevenueByDate[key] || 0) + Number(row.revenue || 0);
    }

    const rangePurchases = purchases.filter((p) =>
      dateIn(p.receivedAt || p.createdAt, from, to),
    );
    const purchaseAmount = rangePurchases.reduce(
      (sum, p) => sum + Number(p.total || 0),
      0,
    );
    const formatPurchase = (p) => ({
      id: p.id,
      supplierName: p.supplier?.name || "",
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
      topProducts: Array.from(topMap.values())
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 10),
    };

    console.log(
      `[Perf] dashboard:getSummary sales=${salesRows.length} chart=${chartRows.length} products=${products.length} ms=${Date.now() - startedAt}`,
    );
    return { success: true, data };
  } catch (error) {
    console.error("dashboard:getSummary error:", error);
    return { success: false, error: error.message };
  }
});

// ========================================
// PRODUCTS
// ========================================

function parseJsonArray(value) {
  try {
    const parsed =
      typeof value === "string" ? JSON.parse(value || "[]") : value || [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isAdminSession() {
  return currentSession?.role === "admin";
}

function getProductTotalStock(product) {
  const variants = parseJsonArray(product?.variants);
  if (variants.length > 0)
    return variants.reduce(
      (sum, variant) => sum + Number(variant?.stock || 0),
      0,
    );
  return Number(product?.stock || 0);
}

function stripStockFromVariants(variants) {
  if (!variants) return variants;
  return JSON.stringify(
    parseJsonArray(variants).map((variant) => {
      const { stock, cost, minStock, maxStock, ...safeVariant } = variant || {};
      return { ...safeVariant, available: Number(stock || 0) > 0 };
    }),
  );
}

function sanitizeProductForNonAdmin(product) {
  if (!product) return product;
  const { stock, minStock, maxStock, cost, variants, ...safeProduct } = product;
  return {
    ...safeProduct,
    variants: stripStockFromVariants(variants),
    available: getProductTotalStock(product) > 0,
  };
}

// Purchase users need the latest import price as a suggestion, but never the
// stock fields that are hidden from non-admin accounts.
function purchaseCatalogProductForNonAdmin(product) {
  if (!product) return product;
  const { stock, minStock, maxStock, variants, ...safeProduct } = product;
  const safeVariants = parseJsonArray(variants).map((variant) => {
    const {
      stock: variantStock,
      minStock: variantMinStock,
      maxStock: variantMaxStock,
      ...safeVariant
    } = variant || {};
    return safeVariant;
  });
  return { ...safeProduct, variants: JSON.stringify(safeVariants) };
}

function productNeedsStockAlert(product) {
  const minStock = Number(product?.minStock ?? 0);
  const variants = parseJsonArray(product?.variants);
  if (variants.length > 0)
    return variants.some((variant) => Number(variant?.stock || 0) <= minStock);
  return Number(product?.stock || 0) <= minStock;
}

function stockAlertProductForNonAdmin(product) {
  const minStock = Number(product?.minStock ?? 0);
  const { cost, maxStock, variants, stock, ...safeProduct } = product;
  const variantList = parseJsonArray(variants);
  if (variantList.length > 0) {
    const allowedVariants = variantList
      .filter((variant) => Number(variant?.stock || 0) <= minStock)
      .map((variant) => {
        const {
          cost: variantCost,
          maxStock: variantMaxStock,
          ...safeVariant
        } = variant || {};
        return safeVariant;
      });
    return { ...safeProduct, variants: JSON.stringify(allowedVariants) };
  }
  return { ...safeProduct, stock };
}

function parseConfigObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function getInventoryStatus(stock, threshold, paused) {
  if (paused) return "ok";
  const quantity = Number(stock || 0);
  const minStock = Math.max(0, Number(threshold || 0));
  if (quantity === 0) return "out";
  if (minStock > 0 && quantity <= minStock) return "low";
  if (minStock > 0 && quantity <= Math.ceil(minStock * 1.1))
    return "approaching";
  return "ok";
}

async function getInventoryVisibilityConfig() {
  const configs = await prisma.appConfig.findMany({
    where: { key: { in: ["variantMinStocks", "pausedVariants"] } },
    select: { key: true, value: true },
  });
  const values = Object.fromEntries(
    configs.map((config) => [config.key, parseConfigObject(config.value)]),
  );
  return {
    variantMinStocks: values.variantMinStocks || {},
    pausedVariants: values.pausedVariants || {},
  };
}

function inventoryCatalogProductForNonAdmin(product, visibilityConfig) {
  const { stock, minStock, maxStock, cost, variants, ...safeProduct } = product;
  const variantList = parseJsonArray(variants);
  if (variantList.length > 0) {
    const safeVariants = variantList.map((variant) => {
      const {
        stock: variantStock,
        cost: variantCost,
        minStock: variantMinStock,
        maxStock: variantMaxStock,
        ...safeVariant
      } = variant || {};
      const threshold =
        visibilityConfig.variantMinStocks[safeVariant.sku] ?? minStock;
      const inventoryStatus = getInventoryStatus(
        variantStock,
        threshold,
        visibilityConfig.pausedVariants[safeVariant.sku],
      );
      return {
        ...safeVariant,
        inventoryStatus,
        ...(inventoryStatus !== "ok"
          ? { stock: Number(variantStock || 0) }
          : {}),
      };
    });
    return { ...safeProduct, variants: JSON.stringify(safeVariants) };
  }

  const inventoryStatus = getInventoryStatus(stock, minStock, false);
  return {
    ...safeProduct,
    inventoryStatus,
    ...(inventoryStatus !== "ok" ? { stock: Number(stock || 0) } : {}),
  };
}

function productSelectForCatalog() {
  return {
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
    category: { select: { id: true, name: true } },
  };
}

ipcMain.handle("products:getAll", async () => {
  try {
    if (!prisma) {
      throw new Error(
        "Database chưa được khởi tạo. Vui lòng khởi động lại ứng dụng.",
      );
    }

    const products = await prisma.product.findMany({
      select: productSelectForCatalog(),
      orderBy: { createdAt: "desc" },
    });

    console.log(
      `✅ Loaded ${products.length} products from Supabase (${isAdminSession() ? "admin/full" : "sanitized"})`,
    );
    return {
      success: true,
      data: isAdminSession()
        ? products
        : products.map(sanitizeProductForNonAdmin),
    };
  } catch (error) {
    console.error("❌ Error loading products:", error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("products:getForAdmin", async () => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");
    const products = await prisma.product.findMany({
      select: productSelectForCatalog(),
      orderBy: { createdAt: "desc" },
    });
    return { success: true, data: products };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("products:getCatalogForPurchase", async () => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    const products = await prisma.product.findMany({
      select: productSelectForCatalog(),
      orderBy: { createdAt: "desc" },
    });
    return {
      success: true,
      data: isAdminSession()
        ? products
        : products.map(purchaseCatalogProductForNonAdmin),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("products:getCatalogForSale", async () => {
  try {
    if (!prisma) throw new Error("Prisma not available");
    const products = await prisma.product.findMany({
      select: productSelectForCatalog(),
      where: { status: "active" },
      orderBy: { createdAt: "desc" },
    });
    return {
      success: true,
      data: isAdminSession()
        ? products
        : products.map(sanitizeProductForNonAdmin),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("products:getForStockAlerts", async () => {
  try {
    // Exact alert quantities can be used to defeat blind stock checking.
    // Reorder/stock-alert data is therefore an admin-only boundary.
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");
    const products = await prisma.product.findMany({
      select: productSelectForCatalog(),
      orderBy: { createdAt: "desc" },
    });
    const alertProducts = products.filter(productNeedsStockAlert);
    return {
      success: true,
      data: isAdminSession()
        ? alertProducts
        : alertProducts.map(stockAlertProductForNonAdmin),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Non-admin inventory receives all products plus server-calculated alert state.
// Exact quantities are sent only for SKUs in a warning state.
ipcMain.handle("products:getInventoryCatalog", async () => {
  try {
    // The inventory catalogue contains exact quantities and feeds the
    // stock-card screen. Assigned checkers must never receive it.
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");
    const products = await prisma.product.findMany({
      select: productSelectForCatalog(),
      orderBy: { createdAt: "desc" },
    });
    return { success: true, data: products };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("products:getTopSelling", async (event, { limit = 10 } = {}) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");

    const parseItems = (value) => {
      try {
        return typeof value === "string" ? JSON.parse(value) : value || [];
      } catch {
        return [];
      }
    };
    const pickSku = (item) =>
      item?.sku ||
      item?.variantSku ||
      item?.productSku ||
      item?.code ||
      item?.SKU ||
      "";
    const pickName = (item) =>
      item?.productName ||
      item?.name ||
      item?.product ||
      item?.product_name ||
      "";
    const pickQty = (item) =>
      Number(
        item?.quantity ?? item?.qty ?? item?.count ?? item?.soLuong ?? 0,
      ) || 0;
    const pickProductId = (item) =>
      item?.productId ?? item?.product_id ?? item?.productID ?? null;

    const since90Days = new Date();
    since90Days.setDate(since90Days.getDate() - 90);

    const [products, combos, posOrders, ecommerceExports, exportOrders] =
      await Promise.all([
        prisma.product.findMany({
          select: {
            id: true,
            sku: true,
            name: true,
            variants: true,
            isCombo: true,
            comboItems: true,
          },
        }),
        prisma.comboProduct.findMany({ select: { sku: true, items: true } }),
        prisma.order.findMany({
          where: {
            source: "pos",
            status: "completed",
            createdAt: { gte: since90Days },
          },
          include: { items: true },
        }),
        prisma.ecommerceExport.findMany({
          where: { status: "completed", createdAt: { gte: since90Days } },
        }),
        prisma.exportOrder.findMany({
          where: { status: "completed", createdAt: { gte: since90Days } },
        }),
      ]);

    const productById = new Map();
    const productBySku = new Map();
    const comboBySku = new Map();
    for (const product of products) {
      productById.set(String(product.id), {
        id: product.id,
        name: product.name,
      });
      if (product.sku)
        productBySku.set(product.sku, { id: product.id, name: product.name });
      for (const variant of parseItems(product.variants)) {
        if (variant?.sku)
          productBySku.set(variant.sku, { id: product.id, name: product.name });
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
      const current = totals.get(product.id) || {
        productId: product.id,
        productName: product.name,
        soldQty: 0,
      };
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
          const componentQty =
            Number(component?.quantity ?? component?.qty ?? 1) || 1;
          addProductSale(
            productBySku.get(componentSku) ||
              (componentProductId
                ? productById.get(String(componentProductId))
                : null),
            quantity * componentQty,
          );
        }
        return;
      }

      const product =
        productBySku.get(sku) ||
        (productId ? productById.get(String(productId)) : null);
      if (product) addProductSale(product, quantity);
      else if (fallbackName)
        addProductSale(
          { id: `unknown:${sku || fallbackName}`, name: fallbackName },
          quantity,
        );
    };

    for (const order of posOrders) {
      for (const item of order.items || [])
        addSale(item.sku, item.productName, item.quantity, item.productId);
    }
    for (const doc of ecommerceExports) {
      for (const item of parseItems(doc.items))
        addSale(
          pickSku(item),
          pickName(item),
          pickQty(item),
          pickProductId(item),
        );
    }
    for (const doc of exportOrders) {
      for (const item of parseItems(doc.items))
        addSale(
          pickSku(item),
          pickName(item),
          pickQty(item),
          pickProductId(item),
        );
    }

    const ranked = Array.from(totals.values())
      .sort(
        (a, b) =>
          b.soldQty - a.soldQty ||
          String(a.productName).localeCompare(String(b.productName), "vi"),
      )
      .slice(0, limit);

    return { success: true, data: ranked };
  } catch (error) {
    console.error("❌ Get top selling products error:", error);
    return { success: false, error: error.message };
  }
});

// Activity signal used by the daily stock-check scheduler. A sale is derived
// from the immutable inventory ledger so the cadence is not affected by the
// current product stock value.
ipcMain.handle("products:getStockCheckActivity", async () => {
  try {
    requireRole("manager");
    if (!prisma) throw new Error("Prisma not available");
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const logs = await prisma.inventoryLog.findMany({
      where: {
        createdAt: { gte: since },
        quantity: { lt: 0 },
        referenceType: { in: ["POS", "TMDT"] },
      },
      select: { productId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    const latestByProduct = new Map();
    logs.forEach((log) => {
      const key = String(log.productId);
      if (!latestByProduct.has(key))
        latestByProduct.set(key, log.createdAt.toISOString());
    });
    return {
      success: true,
      data: Array.from(latestByProduct.entries()).map(
        ([productId, lastSaleAt]) => ({ productId, lastSaleAt }),
      ),
    };
  } catch (error) {
    console.error("❌ Get stock-check activity error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("products:getById", async (event, id) => {
  try {
    if (!prisma) throw new Error("Prisma not available");
    const product = await prisma.product.findUnique({
      where: { id },
      include: { category: true },
    });
    return {
      success: true,
      data: isAdminSession() ? product : sanitizeProductForNonAdmin(product),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("products:getBySkus", async (_event, rawSkus = []) => {
  try {
    if (!prisma) throw new Error("Prisma not available");
    const skus = [
      ...new Set(
        (Array.isArray(rawSkus) ? rawSkus : [])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    ].slice(0, 100);
    if (skus.length === 0) return { success: true, data: [] };

    const products = await prisma.product.findMany({
      where: {
        OR: [
          { sku: { in: skus } },
          ...skus.map((sku) => ({ variants: { contains: sku } })),
        ],
      },
      select: productSelectForCatalog(),
    });
    return {
      success: true,
      data: isAdminSession()
        ? products
        : products.map(sanitizeProductForNonAdmin),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle("products:create", async (event, data) => {
  try {
    requireRole("admin", "manager");
    console.log(
      "📝 Create product called with:",
      JSON.stringify(data, null, 2),
    );
    if (!prisma) throw new Error("Prisma not available");

    const isAdmin = isAdminSession();
    const requestedStock = Number(data?.stock || 0);
    const rawVariants = data?.variants ? parseJsonArray(data.variants) : [];
    const variantSkus = rawVariants
      .map((variant) => String(variant?.sku || "").trim())
      .filter(Boolean);
    if (new Set(variantSkus).size !== variantSkus.length) {
      throw new Error("Duplicate variant SKU is not allowed.");
    }
    if (
      requestedStock !== 0 ||
      rawVariants.some((variant) => Number(variant?.stock || 0) !== 0)
    ) {
      throw new Error(
        "Khởi tạo tồn phải thực hiện qua phiếu nhập hoặc điều chỉnh tồn có lý do.",
      );
    }
    const safeVariants = rawVariants.length
      ? JSON.stringify(
          rawVariants.map(({ stock, ...variant }) => ({
            ...variant,
            stock: 0,
          })),
        )
      : data.variants || null;
    const product = await prisma.product.create({
      data: {
        sku: data.sku,
        barcode: data.barcode || null,
        name: data.name,
        categoryId: data.categoryId,
        price: data.price !== undefined ? data.price : 0,
        cost: data.cost !== undefined ? data.cost : 0,
        stock: 0,
        minStock: isAdmin ? data.minStock || 10 : 0,
        unit: data.unit || "Cái",
        status: data.status || "active",
        variants: safeVariants,
      },
      include: { category: true },
    });
    console.log(`✅ Created product: ${product.name} (ID: ${product.id})`);
    void logActivity({
      module: "products",
      action: "CREATE",
      description: `Tạo sản phẩm "${product.name}" (SKU: ${product.sku})`,
      recordId: product.id,
      recordName: product.name,
      userName: data.userName || "Admin",
    });
    return {
      success: true,
      data: isAdminSession() ? product : sanitizeProductForNonAdmin(product),
    };
  } catch (error) {
    console.error("❌ Create product ERROR:", error.code, error.message);

    // Prisma unique constraint error
    if (error.code === "P2002") {
      const field = error.meta?.target?.[0] || "unknown";
      if (field === "sku") {
        return {
          success: false,
          error: `Mã SKU "${data.sku}" đã tồn tại. Vui lòng sử dụng mã khác.`,
        };
      }
      if (field === "barcode") {
        return {
          success: false,
          error: `Mã vạch "${data.barcode}" đã tồn tại. Vui lòng sử dụng mã khác.`,
        };
      }
      return { success: false, error: `Dữ liệu trùng lặp (${field})` };
    }

    return { success: false, error: error.message || "Lỗi khi tạo sản phẩm" };
  }
});

ipcMain.handle("products:update", async (event, id, data) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    const isAdmin = isAdminSession();
    if (
      !isAdmin &&
      ["stock", "minStock", "variants"].some((field) =>
        Object.prototype.hasOwnProperty.call(data || {}, field),
      )
    ) {
      throw new Error(
        "Managers cannot change inventory, stock thresholds, or variant inventory.",
      );
    }
    const existingProduct = await prisma.product.findUnique({ where: { id } });
    if (!existingProduct) throw new Error("Không tìm thấy sản phẩm.");

    if (
      Object.prototype.hasOwnProperty.call(data || {}, "stock") &&
      Number(data.stock) !== Number(existingProduct.stock)
    ) {
      throw new Error(
        "Không được sửa tồn tại màn hình Sửa sản phẩm. Dùng Nhập hàng hoặc Cân bằng kho.",
      );
    }

    let protectedVariants;
    if (data.variants !== undefined) {
      const previousVariants = parseJsonArray(existingProduct.variants);
      const nextVariants = parseJsonArray(data.variants);
      const nextVariantSkus = nextVariants
        .map((variant) => String(variant?.sku || "").trim())
        .filter(Boolean);
      if (new Set(nextVariantSkus).size !== nextVariantSkus.length) {
        throw new Error("Duplicate variant SKU is not allowed.");
      }
      const previousBySku = new Map(
        previousVariants
          .filter((variant) => String(variant?.sku || "").trim())
          .map((variant) => [String(variant.sku).trim(), variant]),
      );
      const nextSkus = new Set(
        nextVariants
          .map((variant) => String(variant?.sku || "").trim())
          .filter(Boolean),
      );
      const removedWithStock = previousVariants.filter((variant) => {
        const sku = String(variant?.sku || "").trim();
        return sku && !nextSkus.has(sku) && Number(variant?.stock || 0) !== 0;
      });
      if (removedWithStock.length > 0) {
        throw new Error(
          `Không thể xóa phân loại còn tồn: ${removedWithStock.map((variant) => variant.sku).join(", ")}.`,
        );
      }
      protectedVariants = JSON.stringify(
        nextVariants.map((variant) => {
          const sku = String(variant?.sku || "").trim();
          const existingVariant = previousBySku.get(sku);
          return {
            ...variant,
            stock: existingVariant ? Number(existingVariant.stock || 0) : 0,
          };
        }),
      );
    }

    const updateData = isAdmin
      ? {
          ...(data.sku && { sku: data.sku }),
          ...(data.barcode && { barcode: data.barcode }),
          ...(data.name && { name: data.name }),
          ...(data.categoryId && { categoryId: data.categoryId }),
          ...(data.price !== undefined && { price: data.price }),
          ...(data.cost !== undefined && { cost: data.cost }),
          ...(data.minStock !== undefined && { minStock: data.minStock }),
          ...(data.unit && { unit: data.unit }),
          ...(data.status && { status: data.status }),
          ...(protectedVariants !== undefined && {
            variants: protectedVariants,
            stock: parseJsonArray(protectedVariants).reduce(
              (total, variant) => total + Number(variant?.stock || 0),
              0,
            ),
          }),
        }
      : {
          ...(data.name && { name: data.name }),
          ...(data.categoryId && { categoryId: data.categoryId }),
          ...(data.price !== undefined && { price: data.price }),
          ...(data.unit && { unit: data.unit }),
        };
    const product = await prisma.product.update({
      where: { id },
      data: updateData,
      include: { category: true },
    });
    console.log(`✅ Updated product: ${product.name}`);
    void logActivity({
      module: "products",
      action: "UPDATE",
      description: `Cập nhật sản phẩm "${product.name}"`,
      recordId: product.id,
      recordName: product.name,
      changes: data,
      userName: data.userName || "Admin",
    });
    return {
      success: true,
      data: isAdminSession() ? product : sanitizeProductForNonAdmin(product),
    };
  } catch (error) {
    console.error("❌ Update product error:", error.code, error.message);

    if (error.code === "P2002") {
      const field = error.meta?.target?.[0] || "unknown";
      if (field === "sku") {
        return {
          success: false,
          error: `Mã SKU "${data.sku}" đã tồn tại. Vui lòng sử dụng mã khác.`,
        };
      }
      if (field === "barcode") {
        return {
          success: false,
          error: `Mã vạch "${data.barcode}" đã tồn tại. Vui lòng sử dụng mã khác.`,
        };
      }
    }

    return {
      success: false,
      error: error.message || "Lỗi khi cập nhật sản phẩm",
    };
  }
});

ipcMain.handle("products:delete", async (event, id) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");
    const product = await prisma.product.findUnique({ where: { id } });
    await prisma.product.delete({ where: { id } });
    console.log(`✅ Deleted product ID: ${id}`);
    void logActivity({
      module: "products",
      action: "DELETE",
      description: `Xóa sản phẩm "${product?.name || id}"`,
      recordId: id,
      recordName: product?.name,
    });
    return { success: true };
  } catch (error) {
    console.error("❌ Delete product error:", error.message);
    return { success: false, error: error.message };
  }
});

// ========================================
// CATEGORIES - Danh mục sản phẩm (PRISMA)
// ========================================

ipcMain.handle("categories:getAll", async () => {
  try {
    if (!prisma) {
      throw new Error("Database chưa được khởi tạo.");
    }

    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
    });
    return { success: true, data: categories };
  } catch (error) {
    console.error("❌ Error getting categories:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("categories:create", async (event, data) => {
  try {
    if (!prisma) {
      throw new Error("Database chưa được khởi tạo.");
    }

    const newCategory = await prisma.category.create({
      data: {
        name: data.name,
      },
    });

    console.log("✅ Category created:", newCategory);
    void logActivity({
      module: "products",
      action: "CREATE",
      description: `Tạo danh mục "${newCategory.name}"`,
      recordName: newCategory.name,
    });
    return { success: true, data: newCategory };
  } catch (error) {
    console.error("❌ Error creating category:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("categories:update", async (event, id, data) => {
  try {
    if (!prisma) {
      throw new Error("Database chưa được khởi tạo.");
    }

    const updatedCategory = await prisma.category.update({
      where: { id: parseInt(id) },
      data: {
        name: data.name,
      },
    });

    console.log("✅ Category updated:", updatedCategory);
    void logActivity({
      module: "products",
      action: "UPDATE",
      description: `Cập nhật danh mục "${updatedCategory.name}"`,
      recordName: updatedCategory.name,
    });
    return { success: true, data: updatedCategory };
  } catch (error) {
    console.error("❌ Error updating category:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("categories:delete", async (event, id) => {
  try {
    if (!prisma) {
      throw new Error("Database chưa được khởi tạo.");
    }

    // Check if category is being used by any products
    const productsCount = await prisma.product.count({
      where: { categoryId: parseInt(id) },
    });

    if (productsCount > 0) {
      return {
        success: false,
        error: `Không thể xóa danh mục này vì đang có ${productsCount} sản phẩm sử dụng!`,
      };
    }

    await prisma.category.delete({
      where: { id: parseInt(id) },
    });

    console.log("✅ Category deleted:", id);
    void logActivity({
      module: "products",
      action: "DELETE",
      description: `Xóa danh mục #${id}`,
    });
    return { success: true };
  } catch (error) {
    console.error("❌ Error deleting category:", error);
    return { success: false, error: error.message };
  }
});

// ========================================
// PICKUP - Quét mã vận đơn
// ========================================

// In-memory state
let pickupTrackingData = []; // { trackingNumber, source, file }
let pickupHistory = []; // { trackingNumber, source, file, scannedAt }
let pickupDataFolder = "";
let pickupLogFile = "";

const HEADER_FILTER_REGEX =
  /tracking|order|number|the |description|seller|sku|vận chuyển/i;

function normalizeStr(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeHeaderKey(value) {
  return normalizeSearchText(value).replace(/[^a-z0-9]+/g, "");
}

function getPickupRowValue(row, candidates) {
  if (!row || typeof row !== "object") return "";
  const keys = Object.keys(row);
  const normalizedCandidates = candidates.map(normalizeHeaderKey);
  const key = keys.find((k) =>
    normalizedCandidates.includes(normalizeHeaderKey(k)),
  );
  return key ? row[key] : "";
}

function extractTrackingNumbers(folderPath) {
  const combined = [];
  const files = fs.readdirSync(folderPath).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return [".xlsx", ".xls", ".csv"].includes(ext) && !f.startsWith("~$");
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
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    if (jsonData.length === 0) continue;

    // 🔍 Phát hiện nguồn (TikTok vs Shopee)
    const firstRow = jsonData[0] || {};
    const isTikTok =
      getPickupRowValue(firstRow, ["Order ID", "Tracking ID"]) !== "";
    const firstRawRow = rawRows[0] || [];
    const isShopee =
      normalizeHeaderKey(firstRawRow[0]) === "madonhang" &&
      normalizeHeaderKey(firstRawRow[7]) === "mavandon" &&
      normalizeHeaderKey(firstRawRow[20]) === "skuphanloaihang";

    console.log(
      `[Pickup] Processing ${file}: TikTok=${isTikTok}, Shopee=${isShopee}`,
    );

    if (isTikTok) {
      // ===== PARSE TIKTOK =====
      jsonData.forEach((row) => {
        const trackingId = normalizeStr(
          getPickupRowValue(row, ["Tracking ID", "Tracking Number"]),
        );
        const orderId = normalizeStr(getPickupRowValue(row, ["Order ID"]));
        const productName = normalizeStr(
          getPickupRowValue(row, ["Product Name"]),
        );
        const variation = normalizeStr(getPickupRowValue(row, ["Variation"]));
        const sku = normalizeStr(getPickupRowValue(row, ["SKU", "Sku"]));
        const quantity = parseInt(
          getPickupRowValue(row, ["Quantity", "Quantity of return"]) || "1",
        );
        const shippingProvider = normalizeStr(
          getPickupRowValue(row, ["Shipping Provider Name"]),
        );
        const orderRefundAmount = parseFloat(
          getPickupRowValue(row, ["Order Refund Amount", "Total Amount"]) ||
            "0",
        );
        const unitPrice = parseFloat(
          getPickupRowValue(row, [
            "SKU Unit Original Price",
            "Product Price",
          ]) || "0",
        );

        if (!trackingId || HEADER_FILTER_REGEX.test(trackingId)) return;

        combined.push({
          trackingNumber: trackingId,
          orderNumber: orderId,
          source: "TikTok",
          file,
          items: JSON.stringify([
            {
              sku: sku,
              variantSku: sku,
              productName: productName,
              color: variation || "",
              quantity: quantity,
              unitPrice: unitPrice,
              total: quantity * unitPrice,
            },
          ]),
          shippingProvider: shippingProvider,
          totalAmount: orderRefundAmount,
          status: "pending",
        });
      });
    } else if (isShopee) {
      // ===== PARSE SHOPEE =====
      // Shopee: column U is the only source of truth for SKU phan loai hang.
      rawRows.slice(1).forEach((row) => {
        const trackingId = normalizeStr(row[7] || ""); // H - Ma van don
        const orderId = normalizeStr(row[0] || ""); // A - Ma don hang
        const productName = normalizeStr(row[16] || ""); // Q - Ten san pham
        const sku = normalizeStr(row[20] || ""); // U - SKU phan loai hang
        const variation = normalizeStr(row[21] || ""); // V - Ten phan loai hang
        const quantity = parseInt(row[27] || "1"); // AB - So luong
        const shippingProvider = normalizeStr(row[8] || ""); // I - Don vi van chuyen
        const totalAmount = parseFloat(row[29] || row[30] || "0");
        const unitPrice = parseFloat(row[26] || row[22] || "0");

        if (!trackingId || HEADER_FILTER_REGEX.test(trackingId)) return;
        if (!sku) {
          console.warn(
            `[Pickup] Skip Shopee row without column U SKU: order=${orderId}, tracking=${trackingId}`,
          );
          return;
        }

        combined.push({
          trackingNumber: trackingId,
          orderNumber: orderId,
          source: "Shopee",
          file,
          items: JSON.stringify([
            {
              sku: sku,
              variantSku: sku,
              productName: productName,
              color: variation || "",
              quantity: quantity,
              unitPrice: unitPrice,
              total: unitPrice * quantity,
            },
          ]),
          shippingProvider: shippingProvider,
          totalAmount: totalAmount,
          status: "pending",
        });
      });
    }
  }

  console.log(
    `[Pickup] Extracted ${combined.length} orders from ${files.length} files`,
  );
  return { data: combined, fileCount: files.length };
}

function loadPickupLog(logFilePath) {
  if (!fs.existsSync(logFilePath)) return [];
  try {
    const wb = XLSX.readFile(logFilePath);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);
    return rows.map((row) => ({
      trackingNumber: normalizeStr(row["Mã vận đơn"] || ""),
      orderNumber: normalizeStr(row["Order ID"] || ""),
      source: normalizeStr(row["Nguồn"] || row["Cột nguồn"] || ""),
      file: normalizeStr(row["File"] || ""),
      scannedAt: normalizeStr(row["Thời gian quét"] || ""),
      items: normalizeStr(row["Items"] || "[]"),
      shippingProvider: normalizeStr(row["Shipping Provider"] || ""),
      totalAmount: parseFloat(row["Tổng tiền"] || "0"),
      status: normalizeStr(row["Trạng thái"] || "scanned"),
    }));
  } catch (e) {
    console.error("[Pickup] Error reading pickup log:", e.message);
    return [];
  }
}

function savePickupLog(logFilePath, history) {
  const wsData = history.map((item) => ({
    "Mã vận đơn": item.trackingNumber,
    "Order ID": item.orderNumber || "",
    Nguồn: item.source,
    File: item.file,
    "Thời gian quét": item.scannedAt,
    Items: item.items || "[]",
    "Shipping Provider": item.shippingProvider || "",
    "Tổng tiền": item.totalAmount || 0,
    "Trạng thái": item.status || "scanned",
  }));
  const ws = XLSX.utils.json_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Pickup");
  XLSX.writeFile(wb, logFilePath);
}

// Chọn thư mục
ipcMain.handle("pickup:selectFolder", async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Chọn thư mục chứa file đơn hàng",
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: "Không có thư mục được chọn" };
    }
    return { success: true, data: result.filePaths[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Tải dữ liệu từ thư mục
ipcMain.handle("pickup:loadData", async (event, folderPath) => {
  try {
    if (!folderPath || !fs.existsSync(folderPath)) {
      return { success: false, error: "Thư mục không tồn tại" };
    }

    pickupDataFolder = folderPath;
    pickupLogFile = path.join(folderPath, "Pickup.xlsx");

    const { data, fileCount } = extractTrackingNumbers(folderPath);
    pickupTrackingData = data;
    pickupHistory = loadPickupLog(pickupLogFile);

    const shopeeCount = data.filter((d) => d.source === "Shopee").length;
    const tiktokCount = data.filter((d) => d.source.includes("TikTok")).length;

    console.log(
      `[Pickup] Loaded ${data.length} tracking numbers from ${fileCount} files`,
    );

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
ipcMain.handle("pickup:scan", async (event, trackingNumber) => {
  try {
    const trimmed = normalizeStr(trackingNumber);
    if (!trimmed) {
      return {
        success: false,
        error: "Vui lòng nhập mã vận đơn",
        errorType: "empty",
      };
    }

    if (pickupTrackingData.length === 0) {
      return {
        success: false,
        error: "Chưa có dữ liệu. Vui lòng chọn thư mục và tải dữ liệu",
        errorType: "no_data",
      };
    }

    // Kiểm tra đã quét chưa
    const alreadyScanned = pickupHistory.some(
      (h) => h.trackingNumber === trimmed,
    );
    if (alreadyScanned) {
      return {
        success: false,
        error: `Mã ${trimmed} đã pickup rồi!`,
        errorType: "duplicate",
      };
    }

    // Tìm kiếm
    const matches = pickupTrackingData.filter(
      (d) => d.trackingNumber === trimmed,
    );
    if (matches.length === 0) {
      return {
        success: false,
        error: `Không tìm thấy: ${trimmed}`,
        errorType: "not_found",
      };
    }

    // Ưu tiên Shopee
    const shopeeMatch = matches.find((m) => m.source === "Shopee");
    const match = shopeeMatch || matches[0];

    const scannedAt = new Date()
      .toISOString()
      .replace("T", " ")
      .substring(0, 19);

    const historyEntry = {
      trackingNumber: trimmed,
      orderNumber: match.orderNumber || "",
      source: match.source,
      file: match.file,
      scannedAt,
      items: match.items || "[]",
      shippingProvider: match.shippingProvider || "",
      totalAmount: match.totalAmount || 0,
      status: "scanned",
    };

    pickupHistory.push(historyEntry);

    // Lưu vào Pickup.xlsx
    try {
      savePickupLog(pickupLogFile, pickupHistory);
    } catch (e) {
      console.error("[Pickup] Error saving:", e.message);
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
    return { success: false, error: error.message, errorType: "system" };
  }
});

// Lấy lịch sử quét
ipcMain.handle("pickup:getHistory", async (event, limit = 10) => {
  try {
    const recent = [...pickupHistory].reverse().slice(0, limit);
    return { success: true, data: recent };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Lấy thống kê
ipcMain.handle("pickup:getStats", async () => {
  try {
    const shopeeCount = pickupTrackingData.filter(
      (d) => d.source === "Shopee",
    ).length;
    const tiktokCount = pickupTrackingData.filter((d) =>
      d.source.includes("TikTok"),
    ).length;

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

// Gửi thông báo Telegram cho Nhặt hàng. Token/chat ID luôn ở Electron,
// không trả về renderer cho nhân viên hoặc quản lý.
ipcMain.handle("pickup:sendTelegram", async (event, { message } = {}) => {
  try {
    requireRole("admin", "manager");
    if (!message) {
      return { success: false, error: "Thiếu nội dung Telegram" };
    }

    if (!prisma) throw new Error("Prisma not available");
    const configs = await prisma.appConfig.findMany({
      where: { key: { in: ["telegramApiToken", "telegramChatId"] } },
      select: { key: true, value: true },
    });
    const configValues = Object.fromEntries(
      configs.map((item) => {
        try {
          return [item.key, JSON.parse(item.value)];
        } catch {
          return [item.key, item.value];
        }
      }),
    );
    const token = String(configValues.telegramApiToken || "").trim();
    const chatId = String(configValues.telegramChatId || "").trim();
    if (!token || !chatId) {
      return { success: false, error: "Telegram chưa được admin cấu hình" };
    }

    return new Promise((resolve) => {
      const postData = JSON.stringify({ chat_id: chatId, text: message });
      const options = {
        hostname: "api.telegram.org",
        path: `/bot${token}/sendMessage`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
        timeout: 5000,
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ success: res.statusCode === 200 }));
      });

      req.on("error", (e) => resolve({ success: false, error: e.message }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ success: false, error: "Timeout" });
      });
      req.write(postData);
      req.end();
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Xuất file Pickup
ipcMain.handle("pickup:exportPickup", async () => {
  try {
    const result = await dialog.showSaveDialog({
      title: "Xuất file Pickup",
      defaultPath: `Pickup_${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: "Đã hủy xuất file" };
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
let pickupWatchFolder = "";
let pickupKnownFiles = new Set();

// Chọn thư mục + bắt đầu theo dõi
ipcMain.handle("pickup:selectAndWatch", async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Chọn thư mục chứa file đơn hàng (sẽ tự động import)",
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: "Không có thư mục được chọn" };
    }

    const folderPath = result.filePaths[0];

    // Lấy danh sách file hiện có
    const existingFiles = fs.readdirSync(folderPath).filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return [".xlsx", ".xls", ".csv"].includes(ext) && !f.startsWith("~$");
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
      if (![".xlsx", ".xls", ".csv"].includes(ext)) return;
      if (filename.startsWith("~$")) return; // File tạm Excel

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
            const base64 = fileBuffer.toString("base64");

            // Gửi event về tất cả cửa sổ
            const { BrowserWindow } = require("electron");
            const windows = BrowserWindow.getAllWindows();
            for (const win of windows) {
              win.webContents.send("pickup:newFile", {
                name: filename,
                base64: base64,
                path: filePath,
              });
            }
            console.log(`✅ [AutoWatch] Đã gửi ${filename} về frontend`);
          } catch (readErr) {
            console.error(
              `❌ [AutoWatch] Lỗi đọc file ${filename}:`,
              readErr.message,
            );
          }
        }
      }, 2000);
    });

    console.log(
      `👁️ [AutoWatch] Đang theo dõi: ${folderPath} (${existingFiles.length} file có sẵn)`,
    );

    return {
      success: true,
      data: {
        folderPath,
        existingFiles: existingFiles.length,
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Dừng theo dõi
ipcMain.handle("pickup:stopWatch", async () => {
  if (pickupWatcher) {
    pickupWatcher.close();
    pickupWatcher = null;
    pickupWatchFolder = "";
    pickupKnownFiles.clear();
    console.log("🛑 [AutoWatch] Đã dừng theo dõi");
    return { success: true };
  }
  return { success: false, error: "Không có watcher nào đang chạy" };
});

// Đọc tất cả file Excel trong thư mục (trả về base64, không mở dialog)
ipcMain.handle("pickup:readFolderFiles", async (event, folderPath) => {
  try {
    if (!folderPath || !fs.existsSync(folderPath)) {
      return { success: false, error: "Thư mục không tồn tại" };
    }

    const excelFiles = fs.readdirSync(folderPath).filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return [".xlsx", ".xls", ".csv"].includes(ext) && !f.startsWith("~$");
    });

    const files = [];
    for (const filename of excelFiles) {
      try {
        const filePath = path.join(folderPath, filename);
        const buffer = fs.readFileSync(filePath);
        files.push({
          name: filename,
          base64: buffer.toString("base64"),
        });
      } catch (e) {
        console.warn(`⚠️ Không đọc được ${filename}:`, e.message);
      }
    }

    console.log(
      `📂 [ReadFolder] Đọc ${files.length}/${excelFiles.length} files từ ${folderPath}`,
    );
    return { success: true, data: files };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Bắt đầu theo dõi trực tiếp (không dialog — dùng khi auto-restore)
ipcMain.handle("pickup:startWatch", async (event, folderPath) => {
  try {
    if (!folderPath || !fs.existsSync(folderPath)) {
      return { success: false, error: "Thư mục không tồn tại" };
    }

    // Lấy danh sách file hiện có
    const existingFiles = fs.readdirSync(folderPath).filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return [".xlsx", ".xls", ".csv"].includes(ext) && !f.startsWith("~$");
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
      if (![".xlsx", ".xls", ".csv"].includes(ext)) return;
      if (filename.startsWith("~$")) return;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const filePath = path.join(folderPath, filename);
        if (!pickupKnownFiles.has(filename) && fs.existsSync(filePath)) {
          console.log(`📁 [AutoWatch] File mới: ${filename}`);
          pickupKnownFiles.add(filename);
          try {
            const fileBuffer = fs.readFileSync(filePath);
            const base64 = fileBuffer.toString("base64");
            const { BrowserWindow } = require("electron");
            const windows = BrowserWindow.getAllWindows();
            for (const win of windows) {
              win.webContents.send("pickup:newFile", {
                name: filename,
                base64,
                path: filePath,
              });
            }
            console.log(`✅ [AutoWatch] Đã gửi ${filename} về frontend`);
          } catch (readErr) {
            console.error(
              `❌ [AutoWatch] Lỗi đọc file ${filename}:`,
              readErr.message,
            );
          }
        }
      }, 2000);
    });

    console.log(
      `👁️ [AutoWatch-Restore] Đang theo dõi: ${folderPath} (${existingFiles.length} file có sẵn)`,
    );

    return {
      success: true,
      data: { folderPath, existingFiles: existingFiles.length },
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
    const { BrowserWindow } = require("electron");
    const eventPayload = { ...payload, at: new Date().toISOString() };
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed())
        win.webContents.send("products:stockChanged", eventPayload);
    });
  } catch (error) {
    console.warn("[stock-sync] emit failed:", error.message);
  }
}

function validateStockMutationPayload(data, allowedReferenceTypes) {
  const sku = String(data?.sku || "").trim();
  const quantity = Number(data?.quantity);
  const logContext = data?.logContext || {};
  const referenceType = String(logContext.referenceType || "")
    .trim()
    .toUpperCase();
  const reference = String(logContext.reference || "").trim();
  const note = String(logContext.note || "").trim();

  if (!sku) throw new Error("Thiếu SKU cần cập nhật.");
  if (!Number.isFinite(quantity) || quantity <= 0)
    throw new Error("Số lượng cập nhật phải lớn hơn 0.");
  if (!allowedReferenceTypes.includes(referenceType)) {
    throw new Error(
      `Loại chứng từ "${referenceType || "trống"}" không được phép trên API này.`,
    );
  }
  if (!reference) throw new Error("Thiếu mã chứng từ tham chiếu.");
  if (!note) throw new Error("Bắt buộc nhập lý do cập nhật tồn kho.");
  if (!currentSession?.username)
    throw new Error("Phiên đăng nhập không hợp lệ.");

  return {
    sku,
    quantity,
    isAdd: Boolean(data?.isAdd),
    allowMissing: Boolean(data?.allowMissing),
    logContext: {
      ...logContext,
      referenceType,
      reference,
      note,
      createdBy: currentSession.username,
    },
  };
}

function emitStockChangedForSkus(skus, payload = {}) {
  const normalized = [
    ...new Set(
      (skus || []).map((sku) => String(sku || "").trim()).filter(Boolean),
    ),
  ];
  if (normalized.length === 0) return;
  emitStockChanged({ ...payload, skus: normalized, count: normalized.length });
}

async function performStockUpdate({
  sku,
  quantity,
  isAdd = false,
  logContext,
  allowMissing = false,
}) {
  if (!prisma) throw new Error("Database chưa được khởi tạo.");
  const delta = isAdd ? quantity : -quantity;

  const response = await withStockLock(() =>
    getPrismaDirectTx().$transaction(
      async (tx) => {
        // Manual warehouse exports must never drive stock negative. This check
        // runs inside the same transaction/DB lock as the mutation and also
        // validates every component when the requested SKU is a combo.
        if (
          !isAdd &&
          String(logContext?.referenceType || "").toUpperCase() === "XUAT"
        ) {
          await assertSaleStockAvailable(tx, sku, quantity);
        }
        const combo = await tx.comboProduct.findUnique({ where: { sku } });
        if (combo) {
          const items = JSON.parse(combo.items || "[]");
          const updateResults = [];
          for (const item of items) {
            const componentQty = Number(item.quantity || 0) * quantity;
            const componentDelta = isAdd ? componentQty : -componentQty;
            updateResults.push(
              await updateProductStockInTx(
                tx,
                item.sku,
                componentDelta,
                logContext,
                { allowMissing },
              ),
            );
          }
          return { success: true, isCombo: true, deductResults: updateResults };
        }

        const result = await updateProductStockInTx(
          tx,
          sku,
          delta,
          logContext,
          { allowMissing },
        );
        if (result === false) {
          return {
            success: false,
            skipped: true,
            error: `SKU "${sku}" không tìm thấy trong kho`,
          };
        }
        return { success: true, data: result };
      },
      { timeout: 30000, maxWait: 10000 },
    ),
  );

  if (response?.success) {
    emitStockChanged({
      sku,
      quantity,
      isAdd,
      referenceType: logContext.referenceType,
      reference: logContext.reference,
    });
  }
  return response;
}

async function handleDedicatedStockMutation(data, roles, referenceTypes) {
  requireRole(...roles);
  return performStockUpdate(validateStockMutationPayload(data, referenceTypes));
}

// Compatibility endpoint: direct/manual adjustment is admin-only.
ipcMain.handle("products:updateStock", async (event, data) => {
  try {
    requireRole("admin");
    const payload = validateStockMutationPayload(data, ["MANUAL_ADJUST"]);
    const response = await performStockUpdate(payload);
    if (response?.success) {
      void logActivity({
        module: "inventory",
        action: "MANUAL_ADJUST",
        description: `ĐIỀU CHỈNH TỒN TRỰC TIẾP ${payload.sku}: ${payload.isAdd ? "+" : "-"}${payload.quantity}. ${payload.logContext.note}`,
        recordName: payload.logContext.reference,
        userName: currentSession.username,
        severity: "WARNING",
      });
    }
    return response;
  } catch (error) {
    console.error("❌ Manual stock adjustment rejected:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("inventory:manualAdjust", async (event, data) => {
  try {
    requireRole("admin");
    const payload = validateStockMutationPayload(data, ["MANUAL_ADJUST"]);
    const response = await performStockUpdate(payload);
    if (response?.success) {
      void logActivity({
        module: "inventory",
        action: "MANUAL_ADJUST",
        description: `ĐIỀU CHỈNH TỒN TRỰC TIẾP ${payload.sku}: ${payload.isAdd ? "+" : "-"}${payload.quantity}. ${payload.logContext.note}`,
        recordName: payload.logContext.reference,
        userName: currentSession.username,
        severity: "WARNING",
      });
    }
    return response;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("exportOrders:adjustStock", async (event, data) => {
  try {
    // Export/refund screens are administrative workflows. Do not expose a
    // generic stock mutation API to operational roles: a forged reference
    // would otherwise be indistinguishable from a real document.
    return await handleDedicatedStockMutation(data, ["admin"], ["XUAT"]);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("refunds:adjustStock", async (event, data) => {
  try {
    return await handleDedicatedStockMutation(data, ["admin"], ["HOAN"]);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Complete a refund only after every stock movement succeeds. This keeps a
// failed combo restore visible for retry instead of silently marking it done.
ipcMain.handle("refunds:completeAndRestore", async (event, data = {}) => {
  try {
    requireRole("admin", "manager");
    const refundId = Number(data.refundId);
    if (!Number.isInteger(refundId) || refundId <= 0)
      throw new Error("Mã hàng hoàn không hợp lệ.");

    const response = await withStockLock(() =>
      getPrismaDirectTx().$transaction(
        async (tx) => {
          const refund = await tx.refund.findUnique({
            where: { id: refundId },
          });
          if (!refund) throw new Error("Không tìm thấy phiếu hàng hoàn.");
          if (refund.status === "completed")
            throw new Error("Phiếu hàng hoàn này đã được xác nhận trước đó.");

          // Stock restoration must be based on the persisted return receipt,
          // never a caller-controlled items payload from the renderer.
          let items = [];
          try {
            items = JSON.parse(refund.items || "[]");
          } catch {
            items = [];
          }

          const normalizedItems = items
            .map((item) => ({
              sku: String(item?.sku || item?.variantSku || "").trim(),
              quantity: Number(item?.quantity ?? item?.qty ?? 0),
              name: String(item?.name || item?.productName || "").trim(),
            }))
            .filter(
              (item) =>
                item.sku && Number.isFinite(item.quantity) && item.quantity > 0,
            );
          if (normalizedItems.length === 0)
            throw new Error("Phiếu hoàn không có SKU hợp lệ để cộng kho.");

          const reference = String(
            refund.orderNumber || refund.refundCode || `P.Hoan ${refund.id}`,
          ).trim();
          const note = data.isCustom
            ? `Xác nhận hàng hoàn lệch/custom (${refund.customerName})`
            : `Xác nhận nhận hàng hoàn/trả về kho (${refund.customerName})`;

          for (const item of normalizedItems) {
            await deductItemOrCombo(tx, item.sku, item.quantity, {
              type: "refund",
              referenceType: "HOAN",
              reference,
              note,
              createdBy: currentSession.username,
            });
          }

          const nextNotes =
            data.notes === undefined ? refund.notes : String(data.notes || "");
          const updatedRefund = await tx.refund.update({
            where: { id: refund.id },
            data: { status: "completed", notes: nextNotes },
          });
          return { refund: updatedRefund, items: normalizedItems, reference };
        },
        { timeout: 30000, maxWait: 10000 },
      ),
    );

    for (const item of response.items) {
      emitStockChanged({
        sku: item.sku,
        quantity: item.quantity,
        isAdd: true,
        referenceType: "HOAN",
        reference: response.reference,
      });
    }
    return { success: true, data: response };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("stockBalance:adjustStock", async (event, data) => {
  try {
    return await handleDedicatedStockMutation(data, ["admin"], ["CAN_BANG"]);
  } catch (error) {
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
    select: {
      id: true,
      sku: true,
      name: true,
      stock: true,
      unit: true,
      cost: true,
      variants: true,
    },
  });
  const allCombos = await tx.comboProduct.findMany({
    select: { id: true, sku: true, name: true, items: true },
  });

  const productMap = new Map(); // sku → { product, isVariant, variantIndex }
  const comboMap = new Map(); // sku → { combo, items[] }

  for (const p of allProducts) {
    productMap.set(p.sku, { product: p, isVariant: false, variantIndex: -1 });
    if (p.variants) {
      try {
        const variants = JSON.parse(p.variants);
        for (let i = 0; i < variants.length; i++) {
          if (variants[i].sku) {
            productMap.set(variants[i].sku, {
              product: p,
              isVariant: true,
              variantIndex: i,
            });
          }
        }
      } catch {}
    }
  }

  for (const c of allCombos) {
    let items = [];
    try {
      items = typeof c.items === "string" ? JSON.parse(c.items) : c.items || [];
    } catch {}
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
  await lockGlobalInventoryMutation(tx);
  // Rebuild after acquiring the database lock. A cache created before the
  // lock could contain a stale variants JSON document from another client.
  const lockedSkuCache = await buildSkuCache(tx);
  const { productMap, comboMap } = lockedSkuCache;

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
    if (typeof logContext.createdBy === "string") {
      const user = await tx.user.findUnique({
        where: { username: logContext.createdBy },
      });
      createdById = user ? user.id : null;
    } else if (typeof logContext.createdBy === "number") {
      createdById = logContext.createdBy;
    }
  }

  // Bước 3: Update stock + create log cho mỗi SKU (đã gom)
  for (const [sku, totalQty] of flatChanges) {
    const info = productMap.get(sku);
    if (!info) {
      // Never silently create an export without reducing inventory. The
      // caller runs this inside a transaction, so throwing rolls back the
      // export and keeps the stock ledger/product stock in sync.
      throw new Error(`SKU TMDT không tồn tại trong kho: ${sku}`);
    }

    const { product, isVariant, variantIndex } = info;
    let oldStock = 0,
      newStock = 0,
      variantColor = null;

    if (isVariant) {
      // ⚠️ Đọc variants MỚI NHẤT từ cache (có thể đã bị update bởi variant khác cùng product)
      let variants = JSON.parse(product.variants);
      oldStock = variants[variantIndex].stock || 0;
      newStock = oldStock + totalQty;
      if (newStock < 0) {
        throw new Error(
          `Không đủ tồn SKU ${sku} (còn ${oldStock}, cần ${Math.abs(totalQty)}).`,
        );
      }
      variants[variantIndex].stock = newStock;
      variantColor =
        variants[variantIndex].color || variants[variantIndex].name || null;

      const updatedVariantsStr = JSON.stringify(variants);
      const parentStock = variants.reduce(
        (total, variant) => total + Number(variant?.stock || 0),
        0,
      );
      await tx.product.update({
        where: { id: product.id },
        data: { variants: updatedVariantsStr, stock: parentStock },
      });
      // 🔧 SYNC CACHE: cập nhật product.variants trong cache
      // để variant khác cùng product đọc đúng data mới nhất
      product.variants = updatedVariantsStr;
    } else {
      oldStock = product.stock || 0;
      if (oldStock + totalQty < 0) {
        throw new Error(
          `Không đủ tồn SKU ${sku} (còn ${oldStock}, cần ${Math.abs(totalQty)}).`,
        );
      }
      const op =
        totalQty >= 0
          ? { increment: totalQty }
          : { decrement: Math.abs(totalQty) };
      const updated = await tx.product.update({
        where: { id: product.id },
        data: { stock: op },
      });
      newStock = updated.stock;
      // 🔧 SYNC CACHE cho non-variant
      product.stock = newStock;
    }

    await tx.inventoryLog.create({
      data: {
        productId: product.id,
        productName: product.name,
        variantColor,
        sku,
        type: logContext.type,
        referenceType: logContext.referenceType,
        reference: logContext.reference,
        quantity: totalQty,
        oldStock,
        newStock,
        note: logContext.note || "",
        createdBy: createdById,
      },
    });
  }

  return flatChanges.size;
}

/**
 * Deduct/restore stock cho 1 item — tự động expand nếu là ComboProduct.
 * Dùng thay cho updateProductStockInTx khi xử lý TMDT/POS items.
 */
async function deductItemOrCombo(
  tx,
  variantSku,
  quantity,
  logContext,
  options = {},
) {
  const combo = await tx.comboProduct.findUnique({
    where: { sku: variantSku },
  });
  if (combo) {
    let comboItems = [];
    try {
      comboItems =
        typeof combo.items === "string"
          ? JSON.parse(combo.items)
          : combo.items || [];
    } catch {}
    for (const ci of comboItems) {
      const componentQty = ci.quantity * Math.abs(quantity);
      const delta = quantity < 0 ? -componentQty : componentQty;
      await updateProductStockInTx(tx, ci.sku, delta, logContext, options);
    }
  } else {
    await updateProductStockInTx(tx, variantSku, quantity, logContext, options);
  }
}

async function assertSaleStockAvailable(tx, sku, quantity) {
  const requested = Number(quantity);
  if (!Number.isFinite(requested) || requested <= 0)
    throw new Error(`Số lượng xuất không hợp lệ cho SKU ${sku}.`);
  const combo = await tx.comboProduct.findUnique({
    where: { sku },
    select: { items: true },
  });
  if (combo) {
    let items = [];
    try {
      items = JSON.parse(combo.items || "[]");
    } catch {
      throw new Error(`Combo ${sku} có cấu hình thành phần không hợp lệ.`);
    }
    for (const item of items) {
      const componentSku = String(item?.sku || "").trim();
      const required = Number(item?.quantity || 0) * requested;
      if (!componentSku || !Number.isFinite(required) || required <= 0) {
        throw new Error(`Combo ${sku} có thành phần không hợp lệ.`);
      }
      const available = await getSkuStockForOrder(tx, componentSku);
      if (available < required)
        throw new Error(
          `Không đủ tồn SKU ${componentSku} (còn ${available}, cần ${required}).`,
        );
    }
    return;
  }
  const available = await getSkuStockForOrder(tx, sku);
  if (available < requested)
    throw new Error(
      `Không đủ tồn SKU ${sku} (còn ${available}, cần ${requested}).`,
    );
}

/**
 * Hàm lõi do AI Agent cập nhật theo "Mệnh lệnh tối cao":
 * Bắt buộc 100% chạy trong Prisma Transaction, kèm logContext.
 */
async function updateProductStockInTx(
  tx,
  sku,
  quantity,
  logContext,
  options = {},
) {
  if (
    !logContext ||
    !logContext.type ||
    !logContext.referenceType ||
    !logContext.reference
  ) {
    throw new Error(
      `[Inventory Error] Thiếu logContext cho SKU: ${sku}. Không thể cập nhật kho mà không có lý do.`,
    );
  }
  if (!String(logContext.note || "").trim()) {
    throw new Error(`[Inventory Error] Thiếu ghi chú cho SKU: ${sku}.`);
  }
  const mutationActor =
    logContext.createdBy ?? currentSession?.id ?? currentSession?.username;
  if (
    mutationActor === null ||
    mutationActor === undefined ||
    mutationActor === ""
  ) {
    throw new Error(
      `[Inventory Error] Không xác định được người cập nhật SKU: ${sku}.`,
    );
  }

  // Must happen before reading stock/variants. The lock spans the whole
  // surrounding transaction, so all clients see a serialized read-modify-
  // write sequence, including variants stored in a shared JSON column.
  await lockGlobalInventoryMutation(tx);

  let product = await tx.product.findUnique({ where: { sku } });
  let isVariant = false;

  if (!product) {
    const products = await tx.product.findMany({
      where: { variants: { contains: sku } },
    });
    for (const p of products) {
      if (p.variants) {
        try {
          const variants = JSON.parse(p.variants);
          if (variants.some((v) => v.sku === sku)) {
            product = p;
            isVariant = true;
            break;
          }
        } catch {}
      }
    }
  }

  if (!product) {
    if (options.allowMissing) {
      console.warn(
        `⚠️ [Inventory Warning] Bỏ qua trừ kho - Sản phẩm với SKU ${sku} không tồn tại.`,
      );
      return false;
    }
    throw new Error(`Sản phẩm với SKU ${sku} không tồn tại.`);
  }

  let oldStock = 0;
  let newStock = 0;
  let variantColor = null;

  if (isVariant) {
    let variants = JSON.parse(product.variants);
    const variantIndex = variants.findIndex((v) => v.sku === sku);
    if (variantIndex < 0) throw new Error(`Variant ${sku} không tìm thấy`);

    oldStock = variants[variantIndex].stock || 0;
    newStock = oldStock + quantity;
    if (newStock < 0) {
      throw new Error(
        `Không đủ tồn SKU ${sku} (còn ${oldStock}, cần ${Math.abs(quantity)}).`,
      );
    }
    variants[variantIndex].stock = newStock;
    variantColor =
      variants[variantIndex].color || variants[variantIndex].name || null;

    // Lưu biến thể: Bắt buộc serialize xuống JSON, phó thác cho Transaction Sequential của SQLite
    const parentStock = variants.reduce(
      (total, variant) => total + Number(variant?.stock || 0),
      0,
    );
    await tx.product.update({
      where: { id: product.id },
      data: { variants: JSON.stringify(variants), stock: parentStock },
    });
  } else {
    // [VÁ LỖI RACE CONDITION] Dùng cơ chế Atomic Increment của Database cho trường Integer Native
    oldStock = product.stock || 0;
    if (oldStock + quantity < 0) {
      throw new Error(
        `Không đủ tồn SKU ${sku} (còn ${oldStock}, cần ${Math.abs(quantity)}).`,
      );
    }
    const op =
      quantity >= 0
        ? { increment: quantity }
        : { decrement: Math.abs(quantity) };
    const updatedProduct = await tx.product.update({
      where: { id: product.id },
      data: { stock: op },
    });
    newStock = updatedProduct.stock;
  }

  // Tạo bản ghi Thẻ kho NẰM TRONG TRANSACTION
  let createdById = null;
  if (mutationActor) {
    if (typeof mutationActor === "string") {
      const user = await tx.user.findFirst({
        where: {
          OR: [{ username: mutationActor }, { fullName: mutationActor }],
        },
        select: { id: true },
      });
      createdById = user?.id ?? currentSession?.id ?? null;
    } else if (typeof mutationActor === "number") {
      createdById = mutationActor;
    }
  }
  if (!createdById) {
    throw new Error(
      `[Inventory Error] Không ánh xạ được người cập nhật SKU: ${sku}.`,
    );
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
      note: logContext.note || "",
      createdBy: createdById,
    },
  });

  return { oldStock, newStock };
}

// ========================================
// POS ORDER - BÁN HÀNG TẠI QUẦY
// ========================================

// Tạo đơn hàng POS (thanh toán)
async function getSkuCostForOrder(db, sku) {
  const product = await db.product.findUnique({
    where: { sku },
    select: { cost: true, variants: true },
  });
  if (product) return Number(product.cost || 0);

  const candidates = await db.product.findMany({
    where: { variants: { contains: sku } },
    select: { cost: true, variants: true },
  });
  for (const candidate of candidates) {
    for (const variant of parseJsonArray(candidate.variants)) {
      if (variant?.sku === sku)
        return Number(variant.cost ?? candidate.cost ?? 0) || 0;
    }
  }
  return 0;
}

async function getSkuStockForOrder(db, sku) {
  const product = await db.product.findUnique({
    where: { sku },
    select: { stock: true, variants: true },
  });
  if (product) return Number(product.stock || 0);

  const candidates = await db.product.findMany({
    where: { variants: { contains: sku } },
    select: { variants: true },
  });
  for (const candidate of candidates) {
    for (const variant of parseJsonArray(candidate.variants)) {
      if (variant?.sku === sku) return Number(variant.stock || 0);
    }
  }
  return 0;
}

ipcMain.handle("posOrder:create", async (event, data) => {
  try {
    if (!prisma) throw new Error("Database chưa được khởi tạo.");
    console.log("💰 [POS] Creating order...", JSON.stringify(data, null, 2));

    // 1. Generate order number: POS-YYYYMMDD-XXX (unique)
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
    const prefix = `POS-${dateStr}-`;

    // Find the highest existing order number for today
    const lastOrder = await prisma.order.findFirst({
      where: {
        orderNumber: { startsWith: prefix },
      },
      orderBy: { orderNumber: "desc" },
      select: { orderNumber: true },
    });

    let nextNum = 1;
    if (lastOrder && lastOrder.orderNumber) {
      const lastNumStr = lastOrder.orderNumber.replace(prefix, "");
      const lastNum = parseInt(lastNumStr, 10);
      if (!isNaN(lastNum)) nextNum = lastNum + 1;
    }
    const orderNumber = `${prefix}${String(nextNum).padStart(3, "0")}`;

    // 2. Calculate totals
    const rawItems = data.items || [];
    const items = await Promise.all(
      rawItems.map(async (item) => ({
        ...item,
        cost: await getSkuCostForOrder(prisma, item.sku),
      })),
    );
    const subtotal = items.reduce(
      (sum, item) => sum + item.price * item.qty,
      0,
    );
    const totalCost = items.reduce(
      (sum, item) => sum + item.cost * item.qty,
      0,
    );
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
            OR: [{ username: data.userName }, { fullName: data.userName }],
          },
          select: { id: true },
        });
        if (user) createdByUserId = user.id;
      } catch (e) {
        console.log("  ⚠️ Could not find user:", data.userName);
      }
    }

    const paidAmount = data.paidAmount || 0;
    const paymentStatus =
      paidAmount >= total ? "paid" : paidAmount > 0 ? "partial" : "unpaid";

    // 🔒 StockMutex: serialize stock operations — tránh race condition Thẻ Kho
    const order = await withStockLock(() =>
      getPrismaDirectTx().$transaction(
        async (tx) => {
          // Create Order
          const newOrder = await tx.order.create({
            data: {
              orderNumber,
              customerId: data.customerId || null,
              source: "pos",
              status: "completed",
              paymentStatus,
              paymentMethod: data.paymentMethod || "cash",
              subtotal,
              discount,
              total,
              profit,
              note: data.note || null,
              createdBy: createdByUserId,
            },
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
              },
            });
          }

          // Create Payment
          await tx.payment.create({
            data: {
              orderId: newOrder.id,
              method: data.paymentMethod || "cash",
              amount: data.paidAmount || total,
              note: data.paymentNote || null,
            },
          });

          // 4. Deduct stock and log inside transaction (atomic)
          for (const item of items) {
            try {
              const availableStock = await getSkuStockForOrder(tx, item.sku);
              if (availableStock < Number(item.qty || 0)) {
                throw new Error("Không đủ hàng trong kho");
              }
              await updateProductStockInTx(tx, item.sku, -item.qty, {
                type: "pos_sale",
                referenceType: "POS",
                reference: orderNumber,
                note: `Bán POS: ${item.name} x${item.qty}`,
                createdBy: createdByUserId,
              });
            } catch (stockErr) {
              throw new Error(`Lỗi kho SKU ${item.sku}: ${stockErr.message}`);
            }
          }

          return newOrder;
        },
        { timeout: 30000, maxWait: 10000 },
      ),
    );

    emitStockChangedForSkus(
      items.map((item) => item.sku),
      {
        referenceType: "POS",
        reference: orderNumber,
      },
    );

    // 5. Activity Log
    try {
      await prisma.activityLog.create({
        data: {
          module: "sales",
          action: "CREATE",
          description: `Bán hàng POS: ${orderNumber} - ${items.length} SP - ${new Intl.NumberFormat("vi-VN").format(total)}đ (${data.paymentMethod || "cash"})`,
          userName: data.userName || "System",
          severity: "INFO",
          details: JSON.stringify({
            orderNumber,
            itemCount: items.length,
            total,
            profit,
            paymentMethod: data.paymentMethod,
          }),
        },
      });
    } catch (logErr) {
      console.error("  ⚠️ Activity log failed:", logErr.message);
    }

    console.log(`✅ [POS] Order created: ${orderNumber}, Total: ${total}`);
    return { success: true, data: { ...order, orderNumber } };
  } catch (error) {
    console.error("❌ [POS] Create order error:", error.message);
    return { success: false, error: error.message };
  }
});

// Lấy danh sách đơn hàng POS
ipcMain.handle("posOrder:getAll", async (event, filters = {}) => {
  try {
    // Order history is a read operation for operational users too. Write
    // actions remain protected by their own handlers below.
    requireRole("admin", "manager", "staff");
    if (!prisma) throw new Error("Database chưa được khởi tạo.");

    const where = { source: "pos" };

    // Mặc định ẩn đơn đã hủy — trừ khi explicitly yêu cầu status cụ thể
    if (filters.status) {
      where.status = filters.status;
    } else {
      where.status = { not: "cancelled" };
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
        { orderNumber: { contains: filters.search, mode: "insensitive" } },
        { customerName: { contains: filters.search, mode: "insensitive" } },
        { trackingNumber: { contains: filters.search, mode: "insensitive" } },
        ...(numericId ? [{ id: numericId }] : []),
      ];
    }

    const orders = await prisma.order.findMany({
      where,
      select: {
        id: true,
        orderNumber: true,
        source: true,
        status: true,
        total: true,
        subtotal: true,
        discount: true,
        note: true,
        trackingNumber: true,
        paymentMethod: true,
        createdAt: true,
        updatedAt: true,
        customer: { select: { name: true } },
        user: { select: { username: true, fullName: true } },
        items: {
          select: {
            productId: true,
            productName: true,
            sku: true,
            variant: true,
            quantity: true,
            price: true,
            subtotal: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: filters.search ? 50 : filters.limit || 200,
    });

    // Map userName from user relation for frontend
    const ordersWithUser = orders.map((o) => ({
      ...o,
      userName: o.user?.username || o.user?.fullName || null,
    }));

    console.log(`✅ [POS] Loaded ${orders.length} POS orders`);
    return { success: true, data: ordersWithUser };
  } catch (error) {
    console.error("❌ [POS] Get orders error:", error.message);
    return { success: false, error: error.message };
  }
});

// Xem chi tiết đơn hàng POS
ipcMain.handle("posOrder:getById", async (event, id) => {
  try {
    if (!prisma) throw new Error("Database chưa được khởi tạo.");
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
ipcMain.handle(
  "posOrder:update",
  async (event, { id, note, discount, items, paymentMethod, userName }) => {
    try {
      if (!prisma) throw new Error("Database chưa được khởi tạo.");

      // Lấy đơn cũ
      const oldOrder = await prisma.order.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!oldOrder) throw new Error("Không tìm thấy đơn hàng.");
      if (oldOrder.status === "cancelled")
        throw new Error("Đơn hàng đã hủy, không thể sửa.");

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
          select: { id: true },
        });
        resolvedCreatedById = resolvedUser ? resolvedUser.id : null;
      }

      // 🔒 StockMutex: serialize stock operations — tránh race condition Thẻ Kho
      await withStockLock(() =>
        getPrismaDirectTx().$transaction(
          async (tx) => {
            // 1. Hoàn lại kho theo items cũ
            for (const oldItem of oldOrder.items) {
              await updateProductStockInTx(tx, oldItem.sku, oldItem.quantity, {
                type: "adjustment",
                referenceType: "POS_EDIT",
                reference: oldOrder.orderNumber,
                note: `Hoàn tồn (sửa đơn POS #${oldOrder.orderNumber})`,
                createdBy: resolvedCreatedById,
              });
            }

            // 2. Cập nhật order
            await tx.order.update({
              where: { id },
              data: {
                note: note ?? null,
                discount: disc,
                subtotal,
                total,
                profit,
                paymentMethod: paymentMethod || oldOrder.paymentMethod,
              },
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
                type: "pos_sale",
                referenceType: "POS_EDIT",
                reference: oldOrder.orderNumber,
                note: `Trừ tồn mới (sửa đơn POS #${oldOrder.orderNumber})`,
                createdBy: resolvedCreatedById,
              });
            }

            // 5. Cập nhật payment
            await tx.payment.updateMany({
              where: { orderId: id },
              data: {
                method: paymentMethod || oldOrder.paymentMethod,
                amount: total,
              },
            });
          },
          { timeout: 30000, maxWait: 10000 },
        ),
      );

      void logActivity({
        module: "sales",
        action: "UPDATE",
        description: `Sửa đơn POS #${oldOrder.orderNumber}`,
        userName: userName || "System",
      });
      return { success: true };
    } catch (error) {
      console.error("❌ [POS] Update order error:", error.message);
      return { success: false, error: error.message };
    }
  },
);

// Xóa đơn hàng POS (hoàn kho) - KHÔNG XÓA CỨNG (Soft Cancel)
ipcMain.handle("posOrder:delete", async (event, { id, userName }) => {
  console.log(
    `🗑️ [DELETE] posOrder:delete called, id=${id}, type=${typeof id}`,
  );
  try {
    if (!prisma) throw new Error("Database chưa được khởi tạo.");

    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    console.log(
      `🗑️ [DELETE] order found:`,
      order
        ? `#${order.orderNumber} status=${order.status} items=${order.items.length}`
        : "NOT FOUND",
    );
    if (!order) throw new Error("Không tìm thấy đơn hàng.");
    if (order.status === "cancelled") return { success: true };
    const posRevertedSkus = order.items.map((item) => item.sku);

    // 🔒 StockMutex: serialize stock operations — tránh race condition Thẻ Kho
    await withStockLock(() =>
      getPrismaDirectTx().$transaction(
        async (tx) => {
          // Hoàn kho — dùng deductItemOrCombo để xử lý cả combo SKU
          const logCtx = {
            type: "adjustment",
            referenceType: "POS_CANCEL",
            reference: order.orderNumber,
            note: `Hoàn tồn do hủy đơn POS ${order.orderNumber}`,
            createdBy: userName || "System",
          };
          for (const item of order.items) {
            // +quantity = cộng lại kho (vì đang hủy đơn bán)
            await deductItemOrCombo(tx, item.sku, item.quantity, logCtx);
          }
          // Cập nhật trạng thái phiếu thay vì xóa cứng
          await tx.order.update({
            where: { id },
            data: { status: "cancelled" },
          });

          // Xóa payment liên quan nếu cần thiết hoặc đánh dấu hủy (tạm comment delete payment)
          // await tx.payment.deleteMany({ where: { orderId: id } });
        },
        { timeout: 30000, maxWait: 10000 },
      ),
    );

    emitStockChangedForSkus(posRevertedSkus, {
      referenceType: "POS_CANCEL",
      reference: order.orderNumber,
    });
    void logActivity({
      module: "sales",
      action: "DELETE",
      description: `Hủy đơn POS #${order.orderNumber}`,
      userName: userName || "System",
    });
    return { success: true };
  } catch (error) {
    console.error("❌ [POS] Cancel order error:", error.message);
    return { success: false, error: error.message };
  }
});

// ========================================
// ACTIVITY LOG HANDLERS
// ========================================

// Get all activity logs with filters
ipcMain.handle("activityLog:getAll", async (event, filters = {}) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");

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
      orderBy: { timestamp: "desc" },
      take: limit,
    });

    return { success: true, data: logs };
  } catch (error) {
    console.error("❌ Get activity logs error:", error);
    return { success: false, error: error.message };
  }
});

// Create activity log
ipcMain.handle("activityLog:create", async (event, data) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");

    const log = await logActivity(data);

    console.log(`✅ Created activity log: ${data.description}`);
    return { success: true, data: log };
  } catch (error) {
    console.error("❌ Create activity log error:", error);
    return { success: false, error: error.message };
  }
});

// Get logs for specific record
ipcMain.handle(
  "activityLog:getByRecord",
  async (event, { module, recordId }) => {
    try {
      requireRole("admin");
      if (!prisma) throw new Error("Prisma not available");

      const logs = await prisma.activityLog.findMany({
        where: {
          module,
          recordId,
        },
        orderBy: { timestamp: "desc" },
      });

      return { success: true, data: logs };
    } catch (error) {
      console.error("❌ Get record logs error:", error);
      return { success: false, error: error.message };
    }
  },
);

// Get stats
ipcMain.handle("activityLog:getStats", async () => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");

    const [total, byModule, byAction, recent] = await Promise.all([
      prisma.activityLog.count(),
      prisma.activityLog.groupBy({
        by: ["module"],
        _count: true,
      }),
      prisma.activityLog.groupBy({
        by: ["action"],
        _count: true,
      }),
      prisma.activityLog.findMany({
        orderBy: { timestamp: "desc" },
        take: 10,
      }),
    ]);

    return {
      success: true,
      data: {
        total,
        byModule,
        byAction,
        recent,
      },
    };
  } catch (error) {
    console.error("❌ Get activity stats error:", error);
    return { success: false, error: error.message };
  }
});

// ========================================
// PURCHASES HANDLERS
// ========================================

const PURCHASE_VAT_GROUPS_KEY = "purchaseVatGroups_v1";
const PURCHASE_VAT_FILE_META_KEY = "purchaseVatFileMeta_v1";
const PURCHASE_ITEM_COMPANIES_KEY = "purchaseItemCompanies_v1";
const PURCHASE_ITEM_PACKAGING_KEY = "purchaseItemPackaging_v1";
const PURCHASE_COMPANY_VAT_KEY = "purchaseCompanyVat_v1";

// A short-lived compatibility repair for names entered while the old renderer
// wrote Vietnamese diacritics as question marks.  Do this at the data boundary
// so historical receipts still group with the corrected company name.
function repairLegacyCompanyName(value) {
  const name = String(value || "").trim();
  return name === "TH?NH PH?T" ? "THỊNH PHÁT" : name;
}

function getPurchaseItemCompanyKey(item) {
  if (Number(item?.id) > 0) return `item:${Number(item.id)}`;
  return `${Number(item?.productId) || 0}::${String(item?.variantSku || item?.color || item?.sku || "")}`;
}

function resolvePurchaseVatCompanies(
  purchase,
  purchaseItemCompanies = {},
  goodsCompanies = [],
) {
  const itemCompanyMap = purchaseItemCompanies[String(purchase?.id)] || {};
  const byItemId = itemCompanyMap.byItemId || {};
  const companies = (purchase?.items || [])
    .map((item) => {
      const explicit =
        byItemId[getPurchaseItemCompanyKey(item)] ||
        itemCompanyMap[getPurchaseItemCompanyKey({ ...item, id: null })];
      if (explicit) return repairLegacyCompanyName(explicit);
      const matched = goodsCompanies.find(
        (company) =>
          Array.isArray(company.productIds) &&
          company.productIds.map(Number).includes(Number(item.productId)),
      );
      return matched ? repairLegacyCompanyName(matched.name) : "";
    })
    .filter(
      (name) => name && name.toLocaleLowerCase("vi") !== "chưa chọn công ty",
    );
  return [...new Set(companies)];
}

function getRelevantPurchaseCompanyVat(
  purchaseId,
  requiredCompanies,
  companyVat = {},
) {
  const stored = companyVat[String(purchaseId)] || {};
  if (requiredCompanies.length > 0) {
    return requiredCompanies.map(
      (required) =>
        Object.entries(stored).find(
          ([name]) =>
            repairLegacyCompanyName(name).toLocaleLowerCase("vi") ===
            required.toLocaleLowerCase("vi"),
        )?.[1] || { status: "pending" },
    );
  }
  return Object.entries(stored)
    .filter(
      ([name]) =>
        repairLegacyCompanyName(name).toLocaleLowerCase("vi") !==
        "chưa chọn công ty",
    )
    .map(([, vat]) => vat);
}

function addVatChargeableDays(date, count) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  let added = 0;
  while (added < Math.max(0, count)) {
    result.setDate(result.getDate() + 1);
    if (result.getDay() !== 0) added += 1;
  }
  return result;
}

function getVatFineDateForStage(purchaseDate, stage, policyStart) {
  const normalFirstFineDate = new Date(purchaseDate);
  normalFirstFineDate.setHours(0, 0, 0, 0);
  normalFirstFineDate.setDate(normalFirstFineDate.getDate() + 5);
  const firstFineDate =
    normalFirstFineDate < policyStart
      ? new Date(policyStart)
      : normalFirstFineDate;
  if (firstFineDate.getDay() === 0)
    firstFineDate.setDate(firstFineDate.getDate() + 1);
  return addVatChargeableDays(
    firstFineDate,
    stage <= 3 ? (stage - 1) * 2 : stage + 1,
  );
}

function getVatFineStageForDate(purchaseDate, now, policyStart) {
  let stage = 0;
  while (
    stage < 366 &&
    getVatFineDateForStage(purchaseDate, stage + 1, policyStart) <= now
  )
    stage += 1;
  return stage;
}

async function getPurchaseItemCompanies() {
  if (!prisma) return {};
  const config = await prisma.appConfig.findUnique({
    where: { key: PURCHASE_ITEM_COMPANIES_KEY },
  });
  if (!config?.value) return {};
  try {
    const parsed = JSON.parse(config.value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function savePurchaseItemCompanies(companies) {
  if (!prisma) throw new Error("Prisma not available");
  await prisma.appConfig.upsert({
    where: { key: PURCHASE_ITEM_COMPANIES_KEY },
    update: { value: JSON.stringify(companies) },
    create: {
      key: PURCHASE_ITEM_COMPANIES_KEY,
      value: JSON.stringify(companies),
    },
  });
}

async function getPurchaseItemPackaging() {
  if (!prisma) return {};
  const config = await prisma.appConfig.findUnique({
    where: { key: PURCHASE_ITEM_PACKAGING_KEY },
  });
  if (!config?.value) return {};
  try {
    const parsed = JSON.parse(config.value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function savePurchaseItemPackaging(purchaseId, items) {
  const packaging = await getPurchaseItemPackaging();
  const byLineKey = Object.fromEntries(
    (items || [])
      .map((item) => {
        const levels = Array.isArray(item?.packagingLevels)
          ? item.packagingLevels
              .map((level) => ({
                id: String(level?.id || ""),
                name: String(level?.name || ""),
                factor: Number(level?.factor || 1),
              }))
              .filter(
                (level) =>
                  level.id &&
                  level.name &&
                  Number.isFinite(level.factor) &&
                  level.factor > 0,
              )
          : [];
        const counts =
          item?.packagingCounts && typeof item.packagingCounts === "object"
            ? Object.fromEntries(
                Object.entries(item.packagingCounts).map(([key, value]) => [
                  key,
                  Math.max(0, Number(value || 0)),
                ]),
              )
            : {};
        return [
          getPurchaseItemCompanyKey({ ...item, id: null }),
          levels.length > 0
            ? { packagingLevels: levels, packagingCounts: counts }
            : null,
        ];
      })
      .filter(([, value]) => value),
  );
  if (Object.keys(byLineKey).length > 0)
    packaging[String(purchaseId)] = { byLineKey };
  else delete packaging[String(purchaseId)];
  await prisma.appConfig.upsert({
    where: { key: PURCHASE_ITEM_PACKAGING_KEY },
    update: { value: JSON.stringify(packaging) },
    create: {
      key: PURCHASE_ITEM_PACKAGING_KEY,
      value: JSON.stringify(packaging),
    },
  });
}

// VAT belongs to a goods company within a purchase receipt.  Keep this
// separate from the legacy receipt-level VAT fields so one receipt can have
// one warehouse receipt but several independent supplier invoices.
async function getPurchaseCompanyVat() {
  if (!prisma) return {};
  const config = await prisma.appConfig.findUnique({
    where: { key: PURCHASE_COMPANY_VAT_KEY },
  });
  if (!config?.value) return {};
  try {
    const parsed = JSON.parse(config.value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function savePurchaseCompanyVat(companyVat) {
  if (!prisma) throw new Error("Prisma not available");
  await prisma.appConfig.upsert({
    where: { key: PURCHASE_COMPANY_VAT_KEY },
    update: { value: JSON.stringify(companyVat) },
    create: {
      key: PURCHASE_COMPANY_VAT_KEY,
      value: JSON.stringify(companyVat),
    },
  });
}

async function getPurchaseVatGroups() {
  if (!prisma) return {};
  const config = await prisma.appConfig.findUnique({
    where: { key: PURCHASE_VAT_GROUPS_KEY },
  });
  if (!config?.value) return {};
  try {
    return JSON.parse(config.value) || {};
  } catch {
    return {};
  }
}

async function savePurchaseVatGroups(groups) {
  if (!prisma) throw new Error("Prisma not available");
  await prisma.appConfig.upsert({
    where: { key: PURCHASE_VAT_GROUPS_KEY },
    update: { value: JSON.stringify(groups) },
    create: { key: PURCHASE_VAT_GROUPS_KEY, value: JSON.stringify(groups) },
  });
}

async function getPurchaseVatFileMeta() {
  if (!prisma) return {};
  const config = await prisma.appConfig.findUnique({
    where: { key: PURCHASE_VAT_FILE_META_KEY },
  });
  if (!config?.value) return {};
  try {
    return JSON.parse(config.value) || {};
  } catch {
    return {};
  }
}

async function savePurchaseVatFileMeta(meta) {
  if (!prisma) throw new Error("Prisma not available");
  await prisma.appConfig.upsert({
    where: { key: PURCHASE_VAT_FILE_META_KEY },
    update: { value: JSON.stringify(meta) },
    create: { key: PURCHASE_VAT_FILE_META_KEY, value: JSON.stringify(meta) },
  });
}

function generatePurchaseVatGroupId(existingGroups = {}) {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
  const sameDayCount = Object.keys(existingGroups).filter((id) =>
    String(id).startsWith(`VATG-${datePart}-`),
  ).length;
  return `VATG-${datePart}-${String(sameDayCount + 1).padStart(3, "0")}`;
}

function generateVatIdFromFile(fileName = "", fileSize = 0) {
  const normalizedName = String(fileName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const raw = `${normalizedName}|${Number(fileSize) || 0}`;
  const digest = crypto
    .createHash("sha1")
    .update(raw)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return `VAT-${digest}`;
}

// Get all purchases
ipcMain.handle("purchases:getAll", async (event, { since, limit } = {}) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    const [
      vatGroups,
      vatFileMeta,
      purchaseItemCompanies,
      purchaseItemPackaging,
      purchaseCompanyVat,
      goodsCompanies,
    ] = await Promise.all([
      getPurchaseVatGroups(),
      getPurchaseVatFileMeta(),
      getPurchaseItemCompanies(),
      getPurchaseItemPackaging(),
      getPurchaseCompanyVat(),
      readGoodsCompanies(),
    ]);

    const purchases = await prisma.purchaseOrder.findMany({
      where: {
        status: { not: "cancelled" },
        ...(since ? { createdAt: { gte: new Date(since) } } : {}),
      },
      select: {
        id: true,
        poNumber: true,
        supplierId: true,
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
            product: { select: { name: true, sku: true, unit: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      // Không tự cắt lịch sử: màn hình Nhập hàng cần xem được toàn bộ phiếu.
      // Caller nào cần giới hạn vẫn có thể truyền `limit`.
      ...(Number.isFinite(Number(limit)) ? { take: Number(limit) } : {}),
    });

    // One-time-compatible VAT migration: older receipts stored VAT at
    // receipt level, while the new UI reads it per goods company. Build
    // the current companies from the immutable purchase line + current
    // product mapping, then persist a company record for every company
    // still missing one. Existing company-specific states (including a
    // deliberate `pending`/`no_vat`) are never overwritten.
    let companyVatAliasesChanged = false;
    purchases.forEach((p) => {
      const itemCompanyMap = purchaseItemCompanies[String(p.id)] || {};
      const byItemId = itemCompanyMap.byItemId || {};
      const currentCompanies = [
        ...new Set(
          p.items
            .map((item) => {
              const explicit =
                byItemId[getPurchaseItemCompanyKey(item)] ||
                itemCompanyMap[
                  getPurchaseItemCompanyKey({ ...item, id: null })
                ];
              if (explicit) return repairLegacyCompanyName(explicit);
              const matched = goodsCompanies.find(
                (company) =>
                  Array.isArray(company.productIds) &&
                  company.productIds
                    .map(Number)
                    .includes(Number(item.productId)),
              );
              return matched ? repairLegacyCompanyName(matched.name) : "";
            })
            .filter(Boolean),
        ),
      ];
      if (currentCompanies.length === 0) return;

      const fileMeta = vatFileMeta[String(p.id)] || {};
      const group =
        Object.values(vatGroups || {}).find(
          (entry) =>
            Array.isArray(entry?.purchaseIds) &&
            entry.purchaseIds.map(Number).includes(Number(p.id)),
        ) || null;
      const hasLegacyVat =
        ["uploaded", "verified"].includes(
          String(p.vatInvoiceStatus || "").toLowerCase(),
        ) ||
        Boolean(
          p.vatInvoiceNumber ||
          p.vatInvoiceFile ||
          p.vatInvoiceDriveUrl ||
          fileMeta.vatId,
        ) ||
        Boolean(
          group?.vatInvoiceFile ||
          group?.vatInvoiceNumber ||
          group?.vatInvoiceDriveUrl,
        );
      if (!hasLegacyVat) return;

      const storedVat = purchaseCompanyVat[String(p.id)] || {};
      const fallbackVat = {
        status: "uploaded",
        invoiceNumber:
          p.vatInvoiceNumber ||
          group?.vatInvoiceNumber ||
          fileMeta.vatId ||
          null,
        invoiceDate: p.vatInvoiceDate || group?.vatInvoiceDate || null,
        localPaths: p.vatInvoiceFile ? [p.vatInvoiceFile] : [],
        driveUrls: p.vatInvoiceDriveUrl
          ? String(p.vatInvoiceDriveUrl).split("\n").filter(Boolean)
          : group?.vatInvoiceDriveUrl
            ? String(group.vatInvoiceDriveUrl).split("\n").filter(Boolean)
            : [],
        migratedFromReceiptVat: true,
        migratedAt: new Date().toISOString(),
      };
      const nextVat = { ...storedVat };
      let changed = false;
      currentCompanies.forEach((company) => {
        if (!nextVat[company]) {
          nextVat[company] = fallbackVat;
          changed = true;
        }
      });
      if (changed) {
        purchaseCompanyVat[String(p.id)] = nextVat;
        companyVatAliasesChanged = true;
      }
    });
    if (companyVatAliasesChanged)
      await savePurchaseCompanyVat(purchaseCompanyVat);

    // Older edit flows could reset vatInvoiceStatus to `pending` while
    // leaving the invoice file/Drive metadata intact. Restore the derived
    // state before formatting so existing VAT invoices are not lost.
    const recoverableVatIds = purchases
      .filter(
        (p) =>
          p.vatInvoiceStatus === "pending" &&
          (p.vatInvoiceFile ||
            p.vatInvoiceDriveUrl ||
            vatFileMeta[String(p.id)]?.fileName),
      )
      .map((p) => p.id);
    if (recoverableVatIds.length > 0) {
      await prisma.purchaseOrder.updateMany({
        where: { id: { in: recoverableVatIds }, vatInvoiceStatus: "pending" },
        data: { vatInvoiceStatus: "uploaded" },
      });
      purchases.forEach((p) => {
        if (recoverableVatIds.includes(p.id)) p.vatInvoiceStatus = "uploaded";
      });
      console.log(
        `♻️ Recovered VAT status for ${recoverableVatIds.length} purchase receipt(s).`,
      );
    }

    const purchaseMap = new Map(purchases.map((p) => [p.id, p]));
    const purchaseGroupMeta = new Map();

    // Detect purchases cùng vatId (chỉ để hiển thị, không ảnh hưởng logic VAT)
    const sameVatIdMap = new Map(); // purchaseId → [other purchase IDs]
    const vatIdGroups = new Map();
    purchases.forEach((p) => {
      if (p.vatInvoiceStatus !== "uploaded") return; // chỉ xét phiếu đang có VAT thực sự
      const fileMeta = vatFileMeta[String(p.id)];
      if (!fileMeta?.vatId) return;
      const key = `${p.supplierId || "x"}::${fileMeta.vatId}`;
      if (!vatIdGroups.has(key)) vatIdGroups.set(key, []);
      vatIdGroups.get(key).push(p.id);
    });
    vatIdGroups.forEach((ids) => {
      if (ids.length < 2) return;
      ids.forEach((id) =>
        sameVatIdMap.set(
          id,
          ids.filter((pid) => pid !== id),
        ),
      );
    });

    Object.entries(vatGroups || {}).forEach(([groupId, group]) => {
      const purchaseIds = Array.isArray(group?.purchaseIds)
        ? group.purchaseIds
            .map((id) => Number(id))
            .filter((id) => purchaseMap.has(id))
        : [];
      if (purchaseIds.length === 0) return;

      purchaseIds.forEach((id) => {
        purchaseGroupMeta.set(id, {
          vatGroupId: groupId,
          vatGroupNote: group?.note || "",
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
    const formatted = purchases.map((p) => {
      // Convert PurchaseItem[] to frontend format
      const companyByItem = purchaseItemCompanies[String(p.id)] || {};
      const companyByItemId = companyByItem.byItemId || {};
      const packagingByLine =
        purchaseItemPackaging[String(p.id)]?.byLineKey || {};
      const itemsFormatted = p.items.map((item) => {
        const explicitCompany =
          companyByItemId[getPurchaseItemCompanyKey(item)] ||
          companyByItem[getPurchaseItemCompanyKey({ ...item, id: null })];
        const catalogCompany = goodsCompanies.find(
          (company) =>
            Array.isArray(company.productIds) &&
            company.productIds.map(Number).includes(Number(item.productId)),
        );
        return {
          productId: item.productId,
          productName: item.product.name,
          sku: item.product.sku,
          quantity: item.quantity,
          unitPrice: item.price,
          total: item.subtotal,
          color: item.color || null, // 🎨 Đọc từ database
          variantSku: item.variantSku || null, // 🎨 Đọc từ database
          unit: item.product.unit || "Cái", // Thêm unit
          // New receipts use the immutable PurchaseItem ID.  Fall back
          // to the old SKU-based map so existing receipts keep working.
          companyGroup:
            repairLegacyCompanyName(explicitCompany || catalogCompany?.name) ||
            null,
          ...(packagingByLine[
            getPurchaseItemCompanyKey({ ...item, id: null })
          ] || {}),
        };
      });

      const vatGroupMeta = purchaseGroupMeta.get(p.id) || {};
      const fileMeta = vatFileMeta[String(p.id)] || {};
      const companyVatByGroup = Object.fromEntries(
        Object.entries(purchaseCompanyVat[String(p.id)] || {}).map(
          ([company, vat]) => {
            const driveUrls = Array.isArray(vat?.driveUrls)
              ? vat.driveUrls.filter(Boolean)
              : String(vat?.driveUrls || "")
                  .split("\n")
                  .filter(Boolean);
            // Previous versions treated a file saved only on an
            // employee's computer as uploaded. It cannot be reviewed
            // on another computer, therefore it must be re-uploaded.
            const isLocalOnlyUpload =
              vat?.status === "uploaded" && driveUrls.length === 0;
            return [
              repairLegacyCompanyName(company),
              {
                ...vat,
                driveUrls,
                status: isLocalOnlyUpload ? "pending" : vat?.status,
                needsReupload: isLocalOnlyUpload,
              },
            ];
          },
        ),
      );
      const itemCompanies = [
        ...new Set(
          itemsFormatted
            .map((item) => item.companyGroup)
            .filter(
              (company) =>
                company &&
                String(company).toLocaleLowerCase("vi") !== "chưa chọn công ty",
            ),
        ),
      ];
      // Legacy receipts stored one VAT invoice on the purchase itself.
      // If the catalog now assigns exactly one goods company and there
      // is no company-specific record yet, expose that legacy invoice
      // under the current company instead of asking for a duplicate.
      const legacyVatStatus = String(p.vatInvoiceStatus || "").toLowerCase();
      const hasLegacyVat =
        ["uploaded", "verified"].includes(legacyVatStatus) ||
        Boolean(
          p.vatInvoiceNumber ||
          p.vatInvoiceFile ||
          p.vatInvoiceDriveUrl ||
          fileMeta.vatId,
        ) ||
        Boolean(
          vatGroupMeta.vatGroupHasVat ||
          vatGroupMeta.vatGroupInvoiceNumber ||
          vatGroupMeta.vatGroupDriveUrl,
        );
      if (
        itemCompanies.length === 1 &&
        !companyVatByGroup[itemCompanies[0]] &&
        hasLegacyVat
      ) {
        companyVatByGroup[itemCompanies[0]] = {
          status: "uploaded",
          invoiceNumber:
            p.vatInvoiceNumber ||
            vatGroupMeta.vatGroupInvoiceNumber ||
            fileMeta.vatId ||
            null,
          invoiceDate:
            p.vatInvoiceDate || vatGroupMeta.vatGroupInvoiceDate || null,
          localPaths: p.vatInvoiceFile ? [p.vatInvoiceFile] : [],
          driveUrls: p.vatInvoiceDriveUrl
            ? String(p.vatInvoiceDriveUrl).split("\n").filter(Boolean)
            : vatGroupMeta.vatGroupDriveUrl
              ? String(vatGroupMeta.vatGroupDriveUrl)
                  .split("\n")
                  .filter(Boolean)
              : [],
          migratedFromReceiptVat: true,
        };
      }

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
        vatId:
          p.vatInvoiceStatus === "uploaded" ? fileMeta.vatId || null : null,
        vatFileName:
          p.vatInvoiceStatus === "uploaded" ? fileMeta.fileName || null : null,
        vatFileSize:
          p.vatInvoiceStatus === "uploaded" ? fileMeta.fileSize || null : null,
        vatGroupId: vatGroupMeta.vatGroupId || null,
        vatGroupNote: vatGroupMeta.vatGroupNote || "",
        vatGroupPurchaseIds: vatGroupMeta.vatGroupPurchaseIds || [],
        vatGroupHasVat: !!vatGroupMeta.vatGroupHasVat,
        vatGroupSourcePurchaseId: vatGroupMeta.vatGroupSourcePurchaseId || null,
        vatGroupStatus: vatGroupMeta.vatGroupHasVat ? "uploaded" : "pending",
        vatGroupInvoiceNumber: vatGroupMeta.vatGroupInvoiceNumber || null,
        vatGroupInvoiceDate: vatGroupMeta.vatGroupInvoiceDate || null,
        vatGroupDriveUrl: vatGroupMeta.vatGroupDriveUrl || null,
        vatGroupVatId: vatGroups[vatGroupMeta.vatGroupId]?.vatId || null,
        vatGroupVatFileName:
          vatGroups[vatGroupMeta.vatGroupId]?.vatFileName || null,
        vatGroupVatFileSize:
          vatGroups[vatGroupMeta.vatGroupId]?.vatFileSize || null,
        sharedVatPurchaseIds: sameVatIdMap.get(p.id) || [],
        companyVatByGroup,
        vatRequiredCompanies: itemCompanies,
        // Phiếu nhập kho
        importReceiptStatus: p.importReceiptStatus,
        importReceiptFile: p.importReceiptFile,
        importReceiptDriveUrl: p.importReceiptDriveUrl,
      };
    });

    return { success: true, data: formatted };
  } catch (error) {
    console.error("❌ Get purchases error:", error);
    return { success: false, error: error.message };
  }
});

// Tồn SKU/variant của phần mềm chỉ dùng làm số liệu tham khảo đối chiếu.
// Số dư thực tế của workspace kiện hàng được quản lý độc lập trong HandlingUnit.
ipcMain.handle("handlingUnits:getWorkspace", async () => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");

    const [products, purchases, packagingStore, dbRegister] =
      await Promise.all([
        prisma.product.findMany({
          where: { status: "active" },
          select: {
            id: true,
            name: true,
            sku: true,
            unit: true,
            stock: true,
            variants: true,
          },
        }),
        prisma.purchaseOrder.findMany({
          where: { status: { not: "cancelled" } },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            poNumber: true,
            createdAt: true,
            supplier: { select: { name: true } },
            items: {
              select: {
                id: true,
                productId: true,
                quantity: true,
                color: true,
                variantSku: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                    sku: true,
                    unit: true,
                    stock: true,
                    variants: true,
                  },
                },
              },
            },
          },
        }),
        getPurchaseItemPackaging(),
        (async () => {
          try {
            return await prisma.handlingUnit.findMany({
              orderBy: { createdAt: "asc" },
            });
          } catch (error) {
            console.warn(
              "HandlingUnit table is not available yet:",
              error.message,
            );
            return [];
          }
        })(),
      ]);

    const catalog = new Map();
    purchases.forEach((purchase) => {
      const byLine = packagingStore[String(purchase.id)]?.byLineKey || {};
      // Prisma always returns an array here, but legacy imports may
      // return a partial purchase object. A broken line must not take
      // down the entire warehouse workspace.
      (Array.isArray(purchase.items) ? purchase.items : []).forEach((item) => {
        const sku = String(item.variantSku || item.product?.sku || "").trim();
        if (!sku || !item.product) return;
        const packaging =
          byLine[getPurchaseItemCompanyKey({ ...item, id: null })] || {};
        const rawLevels = Array.isArray(packaging.packagingLevels)
          ? packaging.packagingLevels
          : [];
        const levels = rawLevels
          .map((level) => ({
            id: String(level?.id || ""),
            name: String(level?.name || "").trim(),
            factor: Math.max(1, Number(level?.factor || 1)),
          }))
          .filter((level) => level.id && level.name);
        const base =
          levels.find(
            (level) =>
              level.id === "lo" ||
              level.name.toLocaleLowerCase("vi-VN") === "lẻ",
          ) || levels.find((level) => level.factor === 1);
        if (base) base.factor = 1;
        else
          levels.unshift({
            id: "lo",
            name: item.product.unit || "Lẻ",
            factor: 1,
          });
        if (levels.length < 2 || !levels.some((level) => level.factor > 1))
          return;

        let stock = Number(item.product.stock || 0);
        if (item.variantSku) {
          const variant = parseJsonArray(item.product.variants).find(
            (entry) => String(entry?.sku || "") === String(item.variantSku),
          );
          stock = Number(variant?.stock || 0);
        }
        catalog.set(sku, {
          sku,
          productId: item.productId,
          purchaseOrderId: purchase.id,
          purchaseItemId: item.id,
          productGroup: item.product.name || "Sản phẩm",
          variantName: `${item.product.name || "Sản phẩm"}${item.color ? ` - ${item.color}` : ""}`,
          color: item.color || "",
          unitName: item.product.unit || "Lẻ",
          factory: purchase.supplier?.name || "Nhà cung cấp",
          levels,
          stock: Math.max(0, stock),
          purchaseNumber: purchase.poNumber || `PN-${purchase.id}`,
        });
      });
    });

    // Pilot scope: use the live Product catalogue, limited to the two
    // UNICARE families agreed for the handling-units rollout.
    const isPilotUnicareProduct = (name) => {
      const normalized = String(name || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .toLowerCase();
      return normalized.includes("5d unicare") || normalized.includes("unicare upf uv");
    };
    products.filter((product) => isPilotUnicareProduct(product.name)).forEach((product) => {
      const variants = parseJsonArray(product.variants);
      const entries = variants.length > 0 ? variants : [{ sku: product.sku, stock: product.stock }];
      entries.forEach((variant) => {
        const sku = String(variant?.sku || product.sku || "").trim();
        if (!sku) return;
        const existing = catalog.get(sku);
        catalog.set(sku, {
          ...existing,
          sku,
          productId: product.id,
          productGroup: product.name,
          variantName: `${product.name}${variant?.color ? ` - ${variant.color}` : ""}`,
          color: variant?.color || existing?.color || "",
          unitName: product.unit || "Lẻ",
          stock: Math.max(0, Number(variant?.stock ?? product.stock ?? 0)),
          levels: existing?.levels || [{ id: "lo", name: product.unit || "Lẻ", factor: 1 }],
        });
      });
    });

    const decodeLocation = (value) => {
      try {
        const parsed = JSON.parse(String(value || ""));
        if (parsed && typeof parsed === "object") return parsed;
      } catch {}
      return { zone: value || "Chưa phân khu", rack: "", level: "", bin: "" };
    };
    let register = dbRegister.map((row) => ({
      id: row.code,
      productId: row.productId,
      purchaseOrderId: row.purchaseOrderId,
      purchaseItemId: row.purchaseItemId,
      productGroup: catalog.get(row.sku)?.productGroup || "Sản phẩm",
      variantName: catalog.get(row.sku)?.variantName || row.sku,
      skuName: row.sku,
      color: row.color || catalog.get(row.sku)?.color || "",
      packageType: row.packagingName,
      packageLabel: `1 ${row.packagingName} (${row.conversionFactor.toLocaleString("vi-VN")} ${row.baseUnit})`,
      unitName: row.baseUnit,
      factory: catalog.get(row.sku)?.factory || "Nhà cung cấp",
          status:
            row.status === "opened"
              ? "Đang sử dụng"
              : row.status === "pending_check"
                ? "Chờ kiểm"
              : row.status === "empty"
            ? "Đã hết"
            : "Nguyên niêm phong",
      location: decodeLocation(row.zone),
      initialPcs: row.initialQuantity,
      currentPcs: row.remainingQuantity,
      note: "",
      updatedAt: row.updatedAt,
    }));
    // The pilot workspace must not surface handling units outside its catalog.
    const pilotSkuSet = new Set(
      [...catalog.values()]
        .filter((item) => isPilotUnicareProduct(item.productGroup))
        .map((item) => item.sku),
    );
    register = register.filter((unit) => pilotSkuSet.has(unit.skuName));

    let recentTransactions = [];
    try {
      const txCfg = await prisma.appConfig.findUnique({
        where: { key: "handlingUnitsTransactionsJson" },
      });
      if (txCfg?.value) {
        recentTransactions = JSON.parse(txCfg.value);
      }
    } catch (txErr) {
      console.warn("Load transactions error:", txErr.message);
    }

    return {
      success: true,
      data: {
        catalog: [...catalog.values()].filter((item) =>
          isPilotUnicareProduct(item.productGroup),
        ),
        register: register,
        recentTransactions: Array.isArray(recentTransactions)
          ? recentTransactions
          : [],
      },
    };
  } catch (error) {
    console.error("Handling units workspace error:", error);
    return { success: false, error: error.message };
  }
});

// The handling-unit register is deliberately exposed through its own IPC
// contract. It is not a user-editable application setting, so the renderer
// must never access it via appConfig:get/appConfig:set.
ipcMain.handle("handlingUnits:saveRegister", async (_event, records = []) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    if (!Array.isArray(records)) throw new Error("Sổ kiện không hợp lệ.");

    const register = records
      .map((item) => ({
        id: String(item?.id || "").trim(),
        productGroup: String(item?.productGroup || "").trim(),
        variantName: String(item?.variantName || "").trim(),
        skuName: String(item?.skuName || "").trim(),
        color: String(item?.color || "").trim(),
        packageType: String(item?.packageType || "").trim(),
        packageLabel: String(item?.packageLabel || "").trim(),
        unitName: String(item?.unitName || "").trim(),
        factory: String(item?.factory || "").trim(),
        status: String(item?.status || "Nguyên niêm phong").trim(),
        location: {
          zone: String(item?.location?.zone || "Chưa phân khu").trim(),
          rack: String(item?.location?.rack || "").trim(),
          level: String(item?.location?.level || "").trim(),
          bin: String(item?.location?.bin || "").trim(),
        },
        initialPcs: Math.max(0, Number(item?.initialPcs || 0)),
        currentPcs: Math.max(0, Number(item?.currentPcs || 0)),
        note: String(item?.note || "").trim(),
        updatedAt: String(item?.updatedAt || new Date().toISOString()),
        purchaseOrderId: Number(item?.purchaseOrderId || 0) || null,
        purchaseItemId: Number(item?.purchaseItemId || 0) || null,
      }))
      .filter((item) => item.id && item.skuName);

    if (new Set(register.map((item) => item.id)).size !== register.length) {
      throw new Error("Mã kiện bị trùng.");
    }

    const products = await prisma.product.findMany({
      select: { id: true, sku: true, variants: true },
    });
    const productIdBySku = new Map();
    products.forEach((product) => {
      productIdBySku.set(String(product.sku), product.id);
      try {
        (JSON.parse(product.variants || "[]") || []).forEach((variant) => {
          productIdBySku.set(String(variant?.sku || ""), product.id);
        });
      } catch {}
    });
    register.forEach((item) => {
      if (item.currentPcs > item.initialPcs)
        throw new Error(`Số dư kiện ${item.id} không thể lớn hơn tồn ban đầu.`);
    });
    await prisma.$transaction(async (tx) => {
      const existing = await tx.handlingUnit.findMany({
        select: { code: true },
      });
      const incomingCodes = new Set(register.map((item) => item.id));
      for (const code of existing.map((item) => item.code)) {
        if (!incomingCodes.has(code))
          await tx.handlingUnit.delete({ where: { code } });
      }
      for (const item of register) {
        const productId = Number(
          item.productId || productIdBySku.get(item.skuName) || 0,
        );
        if (!productId)
          throw new Error(
            `Không xác định được sản phẩm cho SKU ${item.skuName}.`,
          );
        const status =
          item.status === "Đang sử dụng"
            ? "opened"
            : item.status === "Chờ kiểm"
              ? "pending_check"
            : item.status === "Đã hết"
              ? "empty"
              : "sealed";
        await tx.handlingUnit.upsert({
          where: { code: item.id },
          update: {
            productId,
            purchaseOrderId: item.purchaseOrderId,
            purchaseItemId: item.purchaseItemId,
            sku: item.skuName,
            color: item.color || null,
            packagingName: item.packageType || "Kiện",
            baseUnit: item.unitName || "Cái",
            conversionFactor: Math.max(1, Number(item.initialPcs || 1)),
            initialQuantity: item.initialPcs,
            remainingQuantity: item.currentPcs,
            status,
            zone: JSON.stringify(item.location || { zone: "Chưa phân khu" }),
          },
          create: {
            code: item.id,
            productId,
            purchaseOrderId: item.purchaseOrderId,
            purchaseItemId: item.purchaseItemId,
            sku: item.skuName,
            color: item.color || null,
            packagingName: item.packageType || "Kiện",
            baseUnit: item.unitName || "Cái",
            conversionFactor: Math.max(1, Number(item.initialPcs || 1)),
            initialQuantity: item.initialPcs,
            remainingQuantity: item.currentPcs,
            status,
            zone: JSON.stringify(item.location || { zone: "Chưa phân khu" }),
          },
        });
      }
    });
    return { success: true, data: register };
  } catch (error) {
    console.error("Save handling units register error:", error);
    return { success: false, error: error.message };
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Handling-units workspace commands (V2)
// The legacy saveRegister contract above remains read-compatible while data is
// migrated. New screens must use these intent-based commands only: they write
// immutable transaction/audit records and never alter Product.stock directly.
// ────────────────────────────────────────────────────────────────────────────
function handlingUnitsFoundationError(error) {
  const message = String(error?.message || error || "");
  return /does not exist|Unknown arg|undefined.*find|Cannot read properties/i.test(
    message,
  );
}

async function requireHandlingUnitsFoundation() {
  if (!prisma) throw new Error("Prisma not available");
  try {
    await prisma.packagingSpec.findFirst({ select: { id: true } });
  } catch (error) {
    if (handlingUnitsFoundationError(error)) {
      throw new Error(
        "Dữ liệu Quản lý kiện hàng chưa được khởi tạo. Cần chạy migration 20260816120000_handling_units_workspace_foundation trước khi thao tác.",
      );
    }
    throw error;
  }
}

function normalizeHandlingLocation(input = {}) {
  return {
    zone: String(input?.zone || "Chưa phân khu").trim() || "Chưa phân khu",
    rack: String(input?.rack || "").trim(),
    level: String(input?.level || "").trim(),
    bin: String(input?.bin || "").trim(),
  };
}

function toHandlingUnitLocationCode(location) {
  return [location.zone, location.rack, location.level, location.bin]
    .filter(Boolean)
    .join(" / ");
}

async function resolveProductForHandlingSku(tx, sku) {
  const products = await tx.product.findMany({
    select: { id: true, sku: true, stock: true, variants: true },
  });
  const normalizedSku = String(sku || "").trim();
  for (const product of products) {
    if (String(product.sku) === normalizedSku) {
      return {
        productId: product.id,
        stock: Math.max(0, Number(product.stock || 0)),
      };
    }
    const variants = parseJsonArray(product.variants);
    const variant = variants.find(
      (entry) => String(entry?.sku || "") === normalizedSku,
    );
    if (variant)
      return {
        productId: product.id,
        stock: Math.max(0, Number(variant?.stock || 0)),
      };
  }
  throw new Error(
    `Không tìm thấy SKU ${normalizedSku} trong danh mục sản phẩm.`,
  );
}

function newHandlingUnitCode(sku, position) {
  const compactSku =
    String(sku || "SKU")
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(-14)
      .toUpperCase() || "SKU";
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  return `HU-${compactSku}-${stamp}-${String(position).padStart(3, "0")}`;
}

ipcMain.handle("handlingUnits:createLocation", async (_event, payload = {}) => {
  try {
    requireRole("admin", "manager");
    await requireHandlingUnitsFoundation();
    const code = String(payload.code || "")
      .trim()
      .toUpperCase();
    const name = String(payload.name || "").trim();
    const type = String(payload.type || "zone").trim();
    if (!code || !name) throw new Error("Cần nhập mã và tên vị trí kho.");
    const location = await prisma.$transaction(async (tx) => {
      const created = await tx.warehouseLocation.create({
        data: {
          code,
          name,
          type,
          parentId: Number(payload.parentId || 0) || null,
          note: String(payload.note || "").trim() || null,
        },
      });
      await tx.handlingUnitAudit.create({
        data: {
          entityType: "warehouse_location",
          entityId: String(created.id),
          action: "CREATE",
          after: JSON.stringify(created),
          actorId: currentSession?.id || null,
        },
      });
      return created;
    });
    return { success: true, data: location };
  } catch (error) {
    console.error("Create handling location error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  "handlingUnits:createPackagingSpec",
  async (_event, payload = {}) => {
    try {
      requireRole("admin", "manager");
      await requireHandlingUnitsFoundation();
      const sku = String(payload.sku || "").trim();
      const name = String(payload.name || "").trim();
      const baseUnit = String(payload.baseUnit || "").trim();
      const conversionFactor = Math.max(
        1,
        Math.floor(Number(payload.conversionFactor || 0)),
      );
      if (!sku || !name || !baseUnit || conversionFactor <= 1) {
        throw new Error(
          "Quy cách phải có SKU, tên, đơn vị cơ sở và hệ số quy đổi lớn hơn 1.",
        );
      }
      const spec = await prisma.$transaction(async (tx) => {
        const product = await resolveProductForHandlingSku(tx, sku);
        const previous = await tx.packagingSpec.findFirst({
          where: { sku },
          orderBy: { version: "desc" },
        });
        if (
          previous &&
          previous.status === "active" &&
          previous.name === name &&
          previous.baseUnit === baseUnit &&
          previous.conversionFactor === conversionFactor
        ) {
          return previous;
        }
        if (previous?.status === "active") {
          await tx.packagingSpec.update({
            where: { id: previous.id },
            data: { status: "retired", retiredAt: new Date() },
          });
        }
        const created = await tx.packagingSpec.create({
          data: {
            sku,
            productId: product.productId,
            name,
            baseUnit,
            conversionFactor,
            version: Number(previous?.version || 0) + 1,
            status: "active",
            note: String(payload.note || "").trim() || null,
            createdBy: currentSession?.id || null,
          },
        });
        await tx.handlingUnitAudit.create({
          data: {
            entityType: "packaging_spec",
            entityId: String(created.id),
            action: "CREATE_VERSION",
            after: JSON.stringify(created),
            actorId: currentSession?.id || null,
          },
        });
        return created;
      });
      return { success: true, data: spec };
    } catch (error) {
      console.error("Create packaging spec error:", error);
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle("handlingUnits:allocate", async (_event, payload = {}) => {
  try {
    requireRole("admin", "manager");
    await requireHandlingUnitsFoundation();
    const sku = String(payload.sku || "").trim();
    const specId = Number(payload.packagingSpecId || 0);
    const fullUnits = Math.max(0, Math.floor(Number(payload.fullUnits || 0)));
    const looseQuantity = Math.max(
      0,
      Math.floor(Number(payload.looseQuantity || 0)),
    );
    const location = normalizeHandlingLocation(payload.location);
    const idempotencyKey = String(payload.idempotencyKey || "").trim() || null;
    if (!sku || !specId || (!fullUnits && !looseQuantity))
      throw new Error("Thiếu SKU, quy cách hoặc số lượng phân kiện.");

    const result = await prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const replay = await tx.handlingUnitTransaction.findFirst({
          where: { idempotencyKey },
        });
        if (replay) return { replayed: true, createdCodes: [], quantity: 0 };
      }
      const spec = await tx.packagingSpec.findFirst({
        where: { id: specId, sku, status: "active" },
      });
      if (!spec)
        throw new Error(
          "Quy cách không còn hiệu lực hoặc không thuộc SKU đã chọn.",
        );
      const product = await resolveProductForHandlingSku(tx, sku);
      const totalQuantity = fullUnits * spec.conversionFactor + looseQuantity;

      const createdCodes = [];
      const locationCode = toHandlingUnitLocationCode(location);
      for (let index = 0; index < fullUnits; index += 1) {
        const code = newHandlingUnitCode(sku, index + 1);
        await tx.handlingUnit.create({
          data: {
            code,
            productId: product.productId,
            sku,
            packagingName: spec.name,
            baseUnit: spec.baseUnit,
            conversionFactor: spec.conversionFactor,
            initialQuantity: spec.conversionFactor,
            remainingQuantity: spec.conversionFactor,
            status: "sealed",
            zone: JSON.stringify(location),
          },
        });
        createdCodes.push(code);
        await tx.handlingUnitAudit.create({
          data: {
            entityType: "handling_unit",
            entityId: code,
            action: "ALLOCATE",
            after: JSON.stringify({
              sku,
              specId,
              quantity: spec.conversionFactor,
              location,
            }),
            actorId: currentSession?.id || null,
          },
        });
      }
      if (looseQuantity > 0) {
        const code = newHandlingUnitCode(sku, fullUnits + 1);
        await tx.handlingUnit.create({
          data: {
            code,
            productId: product.productId,
            sku,
            packagingName: `${spec.baseUnit} lẻ`,
            baseUnit: spec.baseUnit,
            conversionFactor: 1,
            initialQuantity: looseQuantity,
            remainingQuantity: looseQuantity,
            status: "opened",
            zone: JSON.stringify(location),
          },
        });
        createdCodes.push(code);
        await tx.handlingUnitAudit.create({
          data: {
            entityType: "handling_unit",
            entityId: code,
            action: "ALLOCATE_LOOSE",
            after: JSON.stringify({
              sku,
              specId,
              quantity: looseQuantity,
              location,
            }),
            actorId: currentSession?.id || null,
          },
        });
      }
      await tx.handlingUnitTransaction.create({
        data: {
          handlingUnitCode: createdCodes.join(","),
          sku,
          productId: product.productId,
          type: "allocate",
          quantity: totalQuantity,
          toLocationCode: locationCode || null,
          referenceType: "HANDLING_UNIT_ALLOCATION",
          referenceId: String(spec.id),
          idempotencyKey,
          note: String(payload.note || "").trim() || null,
          createdBy: currentSession?.id || null,
        },
      });
      return { replayed: false, createdCodes, quantity: totalQuantity };
    });
    return { success: true, data: result };
  } catch (error) {
    console.error("Allocate handling units error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("handlingUnits:move", async (_event, payload = {}) => {
  try {
    requireRole("admin", "manager");
    await requireHandlingUnitsFoundation();
    const code = String(payload.code || "").trim();
    const location = normalizeHandlingLocation(payload.location);
    if (!code) throw new Error("Thiếu mã kiện cần chuyển.");
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.handlingUnit.findUnique({ where: { code } });
      if (!existing) throw new Error("Không tìm thấy kiện hàng.");
      const before = existing.zone;
      const moved = await tx.handlingUnit.update({
        where: { code },
        data: { zone: JSON.stringify(location) },
      });
      await tx.handlingUnitTransaction.create({
        data: {
          handlingUnitCode: code,
          sku: moved.sku,
          productId: moved.productId,
          type: "move",
          quantity: moved.remainingQuantity,
          fromLocationCode: before,
          toLocationCode: toHandlingUnitLocationCode(location) || null,
          referenceType: "HANDLING_UNIT_MOVE",
          referenceId: code,
          note: String(payload.note || "").trim() || null,
          createdBy: currentSession?.id || null,
        },
      });
      await tx.handlingUnitAudit.create({
        data: {
          entityType: "handling_unit",
          entityId: code,
          action: "MOVE",
          before,
          after: JSON.stringify(location),
          actorId: currentSession?.id || null,
        },
      });
      return moved;
    });
    broadcastHandlingUnitsChanged("MOVE", { code, location });
    return { success: true, data: updated };
  } catch (error) {
    console.error("Move handling unit error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("handlingUnits:updateUnit", async (_event, payload = {}) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");

    const code = String(payload.code || "").trim().toUpperCase();
    const packagingName = String(payload.packagingName || "").trim();
    const initialQuantity = Math.floor(Number(payload.initialQuantity));
    const remainingQuantity = Math.floor(Number(payload.remainingQuantity));
    const location = normalizeHandlingLocation(payload.location || {});
    const editNote = String(payload.note || "").trim();

    if (!code || !packagingName)
      throw new Error("Thiếu mã kiện hoặc loại kiện.");
    if (!Number.isFinite(initialQuantity) || initialQuantity < 1)
      throw new Error("Số lượng ban đầu phải lớn hơn 0.");
    if (!Number.isFinite(remainingQuantity) || remainingQuantity < 0)
      throw new Error("Số lượng còn lại không hợp lệ.");
    if (remainingQuantity > initialQuantity)
      throw new Error("Số lượng còn lại không thể lớn hơn số lượng ban đầu.");

    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.handlingUnit.findUnique({ where: { code } });
      if (!before) throw new Error(`Không tìm thấy kiện [${code}].`);

      let status = before.status;
      if (remainingQuantity === 0 && status !== "pending_check") status = "empty";
      if (
        remainingQuantity > 0 &&
        (status === "empty" || status === "pending_check")
      )
        status = "opened";

      const updated = await tx.handlingUnit.update({
        where: { code },
        data: {
          packagingName,
          conversionFactor: initialQuantity,
          initialQuantity,
          remainingQuantity,
          status,
          zone: JSON.stringify(location),
          updatedAt: new Date(),
        },
      });

      const quantityDelta = remainingQuantity - before.remainingQuantity;
      await appendHandlingUnitsTransaction(tx, {
        unitId: code,
        type: "Điều chỉnh thông tin kiện",
        quantity: quantityDelta,
        remaining: remainingQuantity,
        actor: currentSession?.username || "Renderer",
        note: [
          `Loại kiện: ${before.packagingName} → ${packagingName}`,
          `Ban đầu: ${before.initialQuantity} → ${initialQuantity}`,
          `Còn lại: ${before.remainingQuantity} → ${remainingQuantity}`,
          editNote,
        ]
          .filter(Boolean)
          .join(" · "),
      });

      return updated;
    });

    broadcastHandlingUnitsChanged("UPDATE", { code, unit: result });
    return { success: true, data: result };
  } catch (error) {
    console.error("Update handling unit error:", error);
    return { success: false, error: error.message };
  }
});

// ────────────────────────────────────────────────────────────────────────────
// TELEGRAM BOT SERVICE — QUẢN LÝ KIỆN HÀNG WMS (@quanlykienhang_bot)
// ────────────────────────────────────────────────────────────────────────────
const TELEGRAM_WMS_BOT_TOKEN = "8848101745:AAHqXEJimBslv1YoWWw9WH0XBJxv7uOMv_A";
const TELEGRAM_WMS_DEFAULT_CHAT = "1397184795";
const TELEGRAM_WMS_GROUP_CONFIG_KEY = "telegramWmsGroupConfig";
let telegramWmsBotRunning = false;
let telegramWmsLastUpdateId = 0;
let telegramWmsPollRequest = null;
let telegramWmsPollTimer = null;
let telegramWmsLastPollAt = null;
let telegramWmsLastError = null;
let telegramWmsGroupChatId = null;
let telegramWmsGroupTitle = "";
let telegramWmsGroupConfigLoaded = false;
const telegramWmsPendingCustomPicks = new Map();

function telegramWmsActorKey(chatId, userId) {
  return `${chatId}:${userId}`;
}

function formatTelegramWmsLocation(rawLocation) {
  if (!rawLocation) return "Chưa xếp vị trí";
  try {
    const parsed =
      typeof rawLocation === "string" ? JSON.parse(rawLocation) : rawLocation;
    const parts = [parsed.zone, parsed.rack, parsed.level, parsed.bin].filter(
      Boolean,
    );
    return parts.length ? parts.join(" · ") : "Chưa xếp vị trí";
  } catch {
    return String(rawLocation);
  }
}

function buildTelegramWmsPickResult(code, res) {
  const unit = res.unit;
  return (
    `🚀 <b>RÚT HÀNG THÀNH CÔNG!</b>\n\n` +
    `📦 <b>Mã Kiện:</b> <code>${code}</code>\n` +
    `🏷️ <b>SKU:</b> <code>${unit.sku || unit.skuName}</code>\n` +
    `📉 <b>Đã rút:</b> <b>${res.picked.toLocaleString("vi-VN")} ${unit.baseUnit || unit.unitName || "Gói"}</b>\n` +
    `📊 <b>Còn lại theo sổ:</b> <b>${res.remaining.toLocaleString("vi-VN")} ${unit.baseUnit || unit.unitName || "Gói"}</b> ${unit.status === "pending_check" ? "<i>(Chờ kiểm thực tế)</i>" : ""}\n` +
    `🛒 <b>Tổng tại Khu đóng gói:</b> <b>${Number(res.destinationPcs ?? res.packingAreaPcs ?? 0).toLocaleString("vi-VN")} đơn vị</b>`
  );
}

async function loadTelegramWmsGroupConfig() {
  if (telegramWmsGroupConfigLoaded) {
    return { chatId: telegramWmsGroupChatId, title: telegramWmsGroupTitle };
  }
  telegramWmsGroupConfigLoaded = true;
  if (!prisma) return { chatId: null, title: "" };
  try {
    const configRow = await prisma.appConfig.findUnique({
      where: { key: TELEGRAM_WMS_GROUP_CONFIG_KEY },
    });
    const configValue = JSON.parse(configRow?.value || "{}");
    telegramWmsGroupChatId = configValue.chatId
      ? String(configValue.chatId)
      : null;
    telegramWmsGroupTitle = String(configValue.title || "");
  } catch (error) {
    console.warn("[TelegramWMS] Cannot load group config:", error.message);
  }
  return { chatId: telegramWmsGroupChatId, title: telegramWmsGroupTitle };
}

async function saveTelegramWmsGroupConfig(chat) {
  if (!prisma) throw new Error("Database chưa sẵn sàng để lưu nhóm Telegram.");
  const configValue = {
    chatId: String(chat.id),
    title: String(chat.title || "Nhóm quản lý kiện hàng"),
    type: String(chat.type || "group"),
    connectedAt: new Date().toISOString(),
  };
  await prisma.appConfig.upsert({
    where: { key: TELEGRAM_WMS_GROUP_CONFIG_KEY },
    create: {
      key: TELEGRAM_WMS_GROUP_CONFIG_KEY,
      value: JSON.stringify(configValue),
    },
    update: { value: JSON.stringify(configValue) },
  });
  telegramWmsGroupChatId = configValue.chatId;
  telegramWmsGroupTitle = configValue.title;
  telegramWmsGroupConfigLoaded = true;
  return configValue;
}

async function isTelegramWmsContextAllowed(chat, from) {
  if (!chat) return false;
  const chatType = String(chat.type || "private");
  if (chatType === "private") {
    return String(from?.id || chat.id) === TELEGRAM_WMS_DEFAULT_CHAT;
  }
  const groupConfig = await loadTelegramWmsGroupConfig();
  return Boolean(
    groupConfig.chatId && String(chat.id) === String(groupConfig.chatId),
  );
}

async function isTelegramWmsGroupManager(chatId, userId) {
  if (!TELEGRAM_WMS_BOT_TOKEN || !chatId || !userId) return false;
  if (String(userId) === TELEGRAM_WMS_DEFAULT_CHAT) return true;

  return new Promise((resolve) => {
    const path =
      `/bot${TELEGRAM_WMS_BOT_TOKEN}/getChatMember` +
      `?chat_id=${encodeURIComponent(chatId)}` +
      `&user_id=${encodeURIComponent(userId)}`;
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path,
        method: "GET",
        timeout: 10000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            const status = String(json?.result?.status || "");
            resolve(status === "creator" || status === "administrator");
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function sendTelegramWmsMessage(chatId, text, replyMarkup = null) {
  if (!TELEGRAM_WMS_BOT_TOKEN) return Promise.resolve(null);
  const groupConfig = await loadTelegramWmsGroupConfig();
  const targetChat = chatId || groupConfig.chatId || TELEGRAM_WMS_DEFAULT_CHAT;
  return new Promise((resolve) => {
    const payload = { chat_id: targetChat, text, parse_mode: "HTML" };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    const data = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${TELEGRAM_WMS_BOT_TOKEN}/sendMessage`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: 10000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", (err) => {
      console.warn("[TelegramWMS] Send error:", err.message);
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
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${TELEGRAM_WMS_BOT_TOKEN}/answerCallbackQuery`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: 10000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.write(data);
    req.end();
  });
}

function editTelegramWmsMessage(chatId, messageId, text, replyMarkup = null) {
  if (!TELEGRAM_WMS_BOT_TOKEN || !chatId || !messageId)
    return Promise.resolve(null);
  return new Promise((resolve) => {
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    const data = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${TELEGRAM_WMS_BOT_TOKEN}/editMessageText`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: 10000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.write(data);
    req.end();
  });
}

function broadcastHandlingUnitsChanged(type, data) {
  try {
    const { BrowserWindow } = require("electron");
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send("handlingUnits:changed", {
          type,
          data,
          timestamp: new Date().toISOString(),
        });
      }
    });
  } catch (err) {
    console.warn("[TelegramWMS] Broadcast error:", err.message);
  }
}

let inMemoryHandlingUnits = [
  {
    code: "KN-UPFDEN-01",
    sku: "1-UPF-DEN",
    color: "Đen",
    packagingName: "Gói lẻ",
    baseUnit: "Gói",
    initialQuantity: 50,
    remainingQuantity: 50,
    status: "sealed",
    zone: "Hàng lẻ",
  },
  {
    code: "KN-5DTR-01",
    sku: "1-5DUNI-TRANG",
    color: "Trắng",
    packagingName: "Tải dứa",
    baseUnit: "Gói",
    initialQuantity: 1200,
    remainingQuantity: 1200,
    status: "sealed",
    zone: "A1 - Kệ 01",
  },
  {
    code: "KN-5DTR-02",
    sku: "1-5DUNI-TRANG",
    color: "Trắng",
    packagingName: "Tải dứa",
    baseUnit: "Gói",
    initialQuantity: 1200,
    remainingQuantity: 1200,
    status: "sealed",
    zone: "A1 - Kệ 01",
  },
  {
    code: "KN-5DTR-03",
    sku: "1-5DUNI-TRANG",
    color: "Trắng",
    packagingName: "Tải dứa",
    baseUnit: "Gói",
    initialQuantity: 1200,
    remainingQuantity: 740,
    status: "opened",
    zone: "A1 - Kệ 02",
  },
  {
    code: "KN-5DTR-04",
    sku: "1-5DUNI-TRANG",
    color: "Trắng",
    packagingName: "Thùng carton",
    baseUnit: "Gói",
    initialQuantity: 250,
    remainingQuantity: 250,
    status: "sealed",
    zone: "A1 - Kệ 04",
  },
  {
    code: "KN-5DTR-05",
    sku: "1-5DUNI-TRANG",
    color: "Trắng",
    packagingName: "Túi lẻ",
    baseUnit: "Gói",
    initialQuantity: 300,
    remainingQuantity: 300,
    status: "sealed",
    zone: "A1 - Kệ 05",
  },
  {
    code: "KN-5DDEN-01",
    sku: "1-5DUNI-DEN",
    color: "Đen",
    packagingName: "Thùng carton",
    baseUnit: "Gói",
    initialQuantity: 50,
    remainingQuantity: 50,
    status: "sealed",
    zone: "A2 - Kệ 02",
  },
  {
    code: "KN-5DHG-01",
    sku: "1-5DUNI-HONG",
    color: "Hồng",
    packagingName: "Tải dứa",
    baseUnit: "Gói",
    initialQuantity: 1200,
    remainingQuantity: 1200,
    status: "sealed",
    zone: "A2 - Kệ 03",
  },
];

async function getAllHandlingUnitsFromStore() {
  if (prisma) {
    try {
      const units = await prisma.handlingUnit.findMany();
      // An empty real table is valid. Do not replace it with legacy/demo units.
      return Array.isArray(units) ? units : [];
    } catch {}
    try {
      const cfg = await prisma.appConfig.findUnique({
        where: { key: "handlingUnitsRegisterJson" },
      });
      if (cfg?.value) {
        const parsed = JSON.parse(cfg.value);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
  }
  return inMemoryHandlingUnits;
}

async function saveHandlingUnitsToStore(units) {
  inMemoryHandlingUnits = units;
  if (prisma) {
    try {
      await prisma.appConfig.upsert({
        where: { key: "handlingUnitsRegisterJson" },
        create: {
          key: "handlingUnitsRegisterJson",
          value: JSON.stringify(units),
        },
        update: { value: JSON.stringify(units) },
      });
    } catch {}
  }
}

async function executeKhuiKien(code, actor = "Telegram Bot") {
  const normalizedCode = String(code || "")
    .trim()
    .toUpperCase();
  if (!normalizedCode) throw new Error("Vui lòng cung cấp mã kiện.");

  if (prisma) {
    try {
      const res = await prisma.$transaction(async (tx) => {
        const unit = await tx.handlingUnit.findUnique({
          where: { code: normalizedCode },
        });
        if (!unit) return null;
        if (unit.status === "opened")
          throw new Error(`Kiện [${normalizedCode}] đang mở sẵn rồi.`);
        if (unit.status === "pending_check")
          throw new Error(`Kiện [${normalizedCode}] đang chờ kiểm thực tế.`);
        if (unit.status === "empty")
          throw new Error(`Kiện [${normalizedCode}] đã hết hàng.`);

        const updated = await tx.handlingUnit.update({
          where: { code: normalizedCode },
          data: { status: "opened", updatedAt: new Date() },
        });
        broadcastHandlingUnitsChanged("UNSEAL", {
          code: normalizedCode,
          unit: updated,
          actor,
        });
        return updated;
      });
      if (res) return res;
    } catch (dbErr) {
      if (
        dbErr.message.includes("đang mở") ||
        dbErr.message.includes("đã hết") ||
        dbErr.message.includes("chờ kiểm")
      )
        throw dbErr;
    }
  }

  // Fallback store
  const list = await getAllHandlingUnitsFromStore();
  const idx = list.findIndex(
    (u) => (u.code || u.id || "").toUpperCase() === normalizedCode,
  );
  if (idx === -1)
    throw new Error(`Không tìm thấy kiện [${normalizedCode}] trong hệ thống.`);

  const target = list[idx];
  if (target.status === "opened" || target.status === "Đang sử dụng")
    throw new Error(`Kiện [${normalizedCode}] đang mở sẵn rồi.`);
  if (target.status === "pending_check" || target.status === "Chờ kiểm")
    throw new Error(`Kiện [${normalizedCode}] đang chờ kiểm thực tế.`);
  if (target.status === "empty" || target.status === "Đã hết")
    throw new Error(`Kiện [${normalizedCode}] đã hết hàng.`);

  target.status = "opened";
  target.updatedAt = new Date();
  list[idx] = target;
  await saveHandlingUnitsToStore(list);

  broadcastHandlingUnitsChanged("UNSEAL", {
    code: normalizedCode,
    unit: target,
    actor,
  });
  return target;
}

const HANDLING_PICK_DESTINATIONS = {
  PACKING: {
    label: "Khu đóng gói",
    configKey: "handlingUnitsPackingAreaPcs",
    transactionType: "Chuyển khu đóng gói",
  },
  LOOSE: {
    label: "Khu hàng lẻ",
    configKey: "handlingUnitsLooseAreaPcs",
    transactionType: "Chuyển hàng lẻ",
  },
  OUTBOUND: {
    label: "Chờ xuất kho",
    configKey: "handlingUnitsOutboundAreaPcs",
    transactionType: "Chuyển chờ xuất kho",
  },
  QUARANTINE: {
    label: "Khu kiểm hàng",
    configKey: "handlingUnitsQuarantineAreaPcs",
    transactionType: "Chuyển khu kiểm hàng",
  },
};

function normalizeHandlingPickDestination(value) {
  const key = String(value || "PACKING")
    .trim()
    .toUpperCase();
  return HANDLING_PICK_DESTINATIONS[key] ? key : "PACKING";
}

async function appendHandlingUnitsTransaction(tx, entry) {
  try {
    const key = "handlingUnitsTransactionsJson";
    const config = await tx.appConfig.findUnique({ where: { key } });
    let items = [];
    try {
      items = Array.isArray(JSON.parse(config?.value || "[]"))
        ? JSON.parse(config.value)
        : [];
    } catch {}
    items.unshift({
      id: `HU-TX-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      ...entry,
    });
    await tx.appConfig.upsert({
      where: { key },
      create: { key, value: JSON.stringify(items.slice(0, 500)) },
      update: { value: JSON.stringify(items.slice(0, 500)) },
    });
  } catch (error) {
    console.warn("Could not persist handling-unit history:", error.message);
  }
}

async function executeRutHang(
  code,
  quantity,
  actor = "Telegram Bot",
  note = "",
  destination = "PACKING",
) {
  const normalizedCode = String(code || "")
    .trim()
    .toUpperCase();
  const qty = Math.max(0, Math.floor(Number(quantity || 0)));
  const destinationCode = normalizeHandlingPickDestination(destination);
  const destinationMeta = HANDLING_PICK_DESTINATIONS[destinationCode];
  if (!normalizedCode || qty <= 0)
    throw new Error("Vui lòng nhập mã kiện và số lượng cần rút hợp lệ.");

  if (prisma) {
    try {
      const res = await prisma.$transaction(async (tx) => {
        const unit = await tx.handlingUnit.findUnique({
          where: { code: normalizedCode },
        });
        if (!unit) return null;
        if (unit.status !== "opened")
          throw new Error(
            `Kiện [${normalizedCode}] chưa khui (trạng thái: ${unit.status}). Hãy gửi /khui ${normalizedCode} trước.`,
          );
        if (qty > unit.remainingQuantity)
          throw new Error(
            `Số lượng rút (${qty}) lớn hơn tồn còn lại trong kiện (${unit.remainingQuantity} ${unit.baseUnit}).`,
          );

        const nextRemaining = unit.remainingQuantity - qty;
        const nextStatus = nextRemaining === 0 ? "pending_check" : "opened";

        const updated = await tx.handlingUnit.update({
          where: { code: normalizedCode },
          data: {
            remainingQuantity: nextRemaining,
            status: nextStatus,
            updatedAt: new Date(),
          },
        });

        let destinationPcs = 0;
        try {
          const cfg = await tx.appConfig.findUnique({
            where: { key: destinationMeta.configKey },
          });
          destinationPcs = Math.max(0, Number(cfg?.value || 0)) + qty;
          await tx.appConfig.upsert({
            where: { key: destinationMeta.configKey },
            create: {
              key: destinationMeta.configKey,
              value: String(destinationPcs),
            },
            update: { value: String(destinationPcs) },
          });
        } catch {}
        await appendHandlingUnitsTransaction(tx, {
          unitId: normalizedCode,
          type: destinationMeta.transactionType,
          quantity: -qty,
          remaining: nextRemaining,
          destination: destinationCode,
          actor,
          note: `Rút ${qty} ${unit.baseUnit} sang ${destinationMeta.label}${note ? ` · ${note}` : ""}${nextRemaining === 0 ? " · Kiện đã hết hàng" : ""}`,
        });

        broadcastHandlingUnitsChanged("PICK", {
          code: normalizedCode,
          quantity: qty,
          remaining: nextRemaining,
          status: nextStatus,
          destination: destinationCode,
          actor,
        });
        return {
          unit: updated,
          picked: qty,
          remaining: nextRemaining,
          destination: destinationCode,
          destinationPcs,
          packingAreaPcs: destinationCode === "PACKING" ? destinationPcs : 0,
        };
      });
      if (res) return res;
    } catch (dbErr) {
      if (
        dbErr.message.includes("chưa khui") ||
        dbErr.message.includes("lớn hơn tồn")
      )
        throw dbErr;
    }
  }

  // Fallback store
  const list = await getAllHandlingUnitsFromStore();
  const idx = list.findIndex(
    (u) => (u.code || u.id || "").toUpperCase() === normalizedCode,
  );
  if (idx === -1)
    throw new Error(`Không tìm thấy kiện [${normalizedCode}] trong kho.`);

  const target = list[idx];
  const currentStatus = target.status;
  if (currentStatus !== "opened" && currentStatus !== "Đang sử dụng") {
    throw new Error(
      `Kiện [${normalizedCode}] chưa khui! Hãy gửi lệnh /khui ${normalizedCode} trước.`,
    );
  }

  const currentQty = target.remainingQuantity ?? target.currentPcs ?? 0;
  if (qty > currentQty) {
    throw new Error(
      `Số lượng rút (${qty}) lớn hơn tồn còn lại (${currentQty} ${target.baseUnit || target.unitName || "Gói"}).`,
    );
  }

  const nextRemaining = currentQty - qty;
  const nextStatus = nextRemaining === 0 ? "pending_check" : "opened";
  target.remainingQuantity = nextRemaining;
  target.currentPcs = nextRemaining;
  target.status = nextStatus;
  list[idx] = target;
  await saveHandlingUnitsToStore(list);

  let destinationPcs = qty;
  if (prisma) {
    try {
      const cfg = await prisma.appConfig.findUnique({
        where: { key: destinationMeta.configKey },
      });
      destinationPcs = Math.max(0, Number(cfg?.value || 0)) + qty;
      await prisma.appConfig.upsert({
        where: { key: destinationMeta.configKey },
        create: {
          key: destinationMeta.configKey,
          value: String(destinationPcs),
        },
        update: { value: String(destinationPcs) },
      });
      await appendHandlingUnitsTransaction(prisma, {
        unitId: normalizedCode,
        type: destinationMeta.transactionType,
        quantity: -qty,
        remaining: nextRemaining,
        destination: destinationCode,
        actor,
        note: `Rút ${qty} ${target.baseUnit || target.unitName || "Gói"} sang ${destinationMeta.label}${note ? ` · ${note}` : ""}${nextRemaining === 0 ? " · Kiện đã hết hàng" : ""}`,
      });
    } catch {}
  }

  broadcastHandlingUnitsChanged("PICK", {
    code: normalizedCode,
    quantity: qty,
    remaining: nextRemaining,
    status: nextStatus,
    destination: destinationCode,
    actor,
  });
  return {
    unit: target,
    picked: qty,
    remaining: nextRemaining,
    destination: destinationCode,
    destinationPcs,
    packingAreaPcs: destinationCode === "PACKING" ? destinationPcs : 0,
  };
}

async function executeBaoCaoTon() {
  const list = await getAllHandlingUnitsFromStore();
  const totalPkgs = list.length;
  const sealed = list.filter(
    (u) => u.status === "sealed" || u.status === "Nguyên niêm phong",
  ).length;
  const opened = list.filter(
    (u) => u.status === "opened" || u.status === "Đang sử dụng",
  ).length;
  const empty = list.filter(
    (u) => u.status === "empty" || u.status === "Đã hết",
  ).length;
  const totalPcs = list.reduce(
    (s, u) => s + (u.remainingQuantity ?? u.currentPcs ?? 0),
    0,
  );

  let packingAreaPcs = 0;
  if (prisma) {
    try {
      const cfg = await prisma.appConfig.findUnique({
        where: { key: "handlingUnitsPackingAreaPcs" },
      });
      packingAreaPcs = Math.max(0, Number(cfg?.value || 0));
    } catch {}
  }
  return {
    totalPkgs,
    sealed,
    opened,
    empty,
    totalPcs,
    packingAreaPcs,
    units: list,
  };
}

const TELEGRAM_MAIN_KEYBOARD = {
  keyboard: [
    [{ text: "📦 RÚT HÀNG NHANH ⚡" }, { text: "📊 XEM TỒN KHO" }],
    [{ text: "🔓 KHUI KIỆN MỚI" }, { text: "🔍 DANH SÁCH KIỆN" }],
  ],
  resize_keyboard: true,
};

async function sendRutHangMenu(chatId, messageId = null) {
  const list = await getAllHandlingUnitsFromStore();
  const openedUnits = list.filter(
    (u) => u.status === "opened" || u.status === "Đang sử dụng",
  );

  if (openedUnits.length === 0) {
    const sealedUnits = list.filter(
      (u) => u.status === "sealed" || u.status === "Nguyên niêm phong",
    );
    const keyboard = sealedUnits.slice(0, 6).map((u) => [
      {
        text: `🔓 Khui ${u.code || u.id} (${u.sku || u.skuName})`,
        callback_data: `unseal_unit:${u.code || u.id}`,
      },
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

  // Chỉ có một kiện đang mở thì bỏ qua bước chọn kiện.
  if (openedUnits.length === 1) {
    await sendPickQuantityMenu(
      chatId,
      openedUnits[0].code || openedUnits[0].id,
      messageId,
    );
    return;
  }

  const inlineKeyboard = openedUnits.map((u) => {
    const code = u.code || u.id;
    const remaining = u.remainingQuantity ?? u.currentPcs ?? 0;
    const unit = u.baseUnit || u.unitName || "Gói";
    const sku = u.sku || u.skuName || "";
    return [
      {
        text: `📦 ${code} · ${sku} (Tồn: ${remaining.toLocaleString("vi-VN")} ${unit})`,
        callback_data: `pick_unit:${code}`,
      },
    ];
  });

  inlineKeyboard.push([
    { text: "📊 Xem báo cáo tồn", callback_data: "menu_ton" },
    { text: "🔓 Khui thêm kiện", callback_data: "menu_khui" },
  ]);

  const text = `📦 <b>CHỌN KIỆN CẦN RÚT HÀNG:</b>\n<i>(Chạm vào kiện bên dưới để chọn nhanh số lượng rút)</i>`;
  const markup = { inline_keyboard: inlineKeyboard };

  if (messageId) {
    await editTelegramWmsMessage(chatId, messageId, text, markup);
  } else {
    await sendTelegramWmsMessage(chatId, text, markup);
  }
}

async function sendKhuiKienMenu(chatId, messageId = null) {
  const list = await getAllHandlingUnitsFromStore();
  const sealedUnits = list.filter(
    (u) => u.status === "sealed" || u.status === "Nguyên niêm phong",
  );

  if (sealedUnits.length === 0) {
    const text = `✅ Tất cả các kiện trong kho hiện đã được khui hoặc đã xuất hết!`;
    const markup = {
      inline_keyboard: [
        [{ text: "📦 Rút hàng từ kiện đang mở", callback_data: "menu_rut" }],
      ],
    };
    if (messageId) {
      await editTelegramWmsMessage(chatId, messageId, text, markup);
    } else {
      await sendTelegramWmsMessage(chatId, text, markup);
    }
    return;
  }

  const inlineKeyboard = sealedUnits.map((u) => {
    const code = u.code || u.id;
    const qty = u.initialQuantity ?? u.initialPcs ?? 0;
    const unit = u.baseUnit || u.unitName || "Gói";
    const sku = u.sku || u.skuName || "";
    return [
      {
        text: `🔓 Khui ${code} · ${sku} (${qty.toLocaleString("vi-VN")} ${unit})`,
        callback_data: `unseal_unit:${code}`,
      },
    ];
  });

  inlineKeyboard.push([{ text: "🔙 Quay lại", callback_data: "menu_rut" }]);

  const text = `🔓 <b>CHỌN KIỆN NGUYÊN ĐỂ MỞ NIÊM PHONG (KHUI KIỆN):</b>\n<i>(Chạm vào kiện để mở lấy lẻ)</i>`;
  const markup = { inline_keyboard: inlineKeyboard };

  if (messageId) {
    await editTelegramWmsMessage(chatId, messageId, text, markup);
  } else {
    await sendTelegramWmsMessage(chatId, text, markup);
  }
}

async function sendPickQuantityMenu(chatId, code, messageId = null) {
  const list = await getAllHandlingUnitsFromStore();
  const unit = list.find(
    (u) => (u.code || u.id || "").toUpperCase() === String(code).toUpperCase(),
  );

  if (!unit) {
    await sendTelegramWmsMessage(
      chatId,
      `❌ Không tìm thấy kiện <code>${code}</code>.`,
    );
    return;
  }

  const remaining = unit.remainingQuantity ?? unit.currentPcs ?? 0;
  const baseUnit = unit.baseUnit || unit.unitName || "Gói";

  // Các lần xuất lẻ đều dưới 100; số khác được nhập qua nút tùy chọn.
  const qtyOptions = [10, 20, 40, 50].filter((qty) => qty <= remaining);
  if (remaining < 100 && !qtyOptions.includes(remaining)) {
    qtyOptions.push(remaining);
  }

  const qtyRow1 = [];
  const qtyRow2 = [];
  qtyOptions.forEach((q, i) => {
    const btn = {
      text: `➖ Rút ${q.toLocaleString("vi-VN")} ${q === remaining ? "(Hết kiện)" : baseUnit}`,
      callback_data: `do_pick:${code}:${q}`,
    };
    if (i < 2) qtyRow1.push(btn);
    else qtyRow2.push(btn);
  });

  const inlineKeyboard = [];
  if (qtyRow1.length) inlineKeyboard.push(qtyRow1);
  if (qtyRow2.length) inlineKeyboard.push(qtyRow2);
  inlineKeyboard.push([
    { text: "✍️ Nhập số lượng tùy chọn", callback_data: `custom_pick:${code}` },
  ]);
  inlineKeyboard.push([
    { text: "🔙 Chọn kiện khác", callback_data: "menu_rut" },
  ]);

  const text =
    `📦 <b>RÚT HÀNG TỪ KIỆN:</b> <code>${code}</code>\n` +
    `🏷️ <b>SKU:</b> <code>${unit.sku || unit.skuName}</code>\n` +
    `📊 <b>Tồn trong kiện:</b> <b>${remaining.toLocaleString("vi-VN")} ${baseUnit}</b>\n` +
    `📍 <b>Vị trí:</b> ${formatTelegramWmsLocation(unit.zone || unit.location)}\n\n` +
    `👉 <b>CHẠM VÀO SỐ LƯỢNG MUỐN RÚT:</b>`;

  const markup = { inline_keyboard: inlineKeyboard };
  if (messageId) {
    await editTelegramWmsMessage(chatId, messageId, text, markup);
  } else {
    await sendTelegramWmsMessage(chatId, text, markup);
  }
}

async function handleTelegramWmsCallbackQuery(callbackQuery) {
  if (!callbackQuery || !callbackQuery.data) return;
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;
  const data = callbackQuery.data;
  const queryId = callbackQuery.id;
  const actor = `Telegram: ${callbackQuery.from?.username || callbackQuery.from?.first_name || chatId}`;

  if (
    !(await isTelegramWmsContextAllowed(
      callbackQuery.message?.chat,
      callbackQuery.from,
    ))
  ) {
    await answerTelegramCallbackQuery(
      queryId,
      "Nhóm này chưa được kết nối với hệ thống kho.",
    );
    return;
  }

  if (data.startsWith("pick_unit:")) {
    const code = data.split(":")[1];
    await answerTelegramCallbackQuery(queryId, `Đã chọn kiện ${code}`);
    await sendPickQuantityMenu(chatId, code, messageId);
    return;
  }

  if (data.startsWith("custom_pick:")) {
    const code = data.slice("custom_pick:".length);
    const actorKey = telegramWmsActorKey(chatId, callbackQuery.from?.id);
    telegramWmsPendingCustomPicks.set(actorKey, {
      code,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    await answerTelegramCallbackQuery(queryId, "Hãy nhập số lượng muốn rút");
    await sendTelegramWmsMessage(
      chatId,
      `✍️ <b>NHẬP SỐ LƯỢNG TÙY CHỌN</b>\n\n📦 Kiện: <code>${code}</code>\n👉 Hãy trả lời tin nhắn này bằng một số từ <b>1 đến 99</b>.\n<i>Ví dụ: 15, 30, 45, 75...</i>`,
      {
        force_reply: true,
        selective: true,
        input_field_placeholder: "Nhập số lượng từ 1 đến 99",
      },
    );
    return;
  }

  if (data.startsWith("do_pick:")) {
    const [, code, qtyStr] = data.split(":");
    const qty = parseInt(qtyStr, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty >= 100) {
      await answerTelegramCallbackQuery(
        queryId,
        "Mỗi lần xuất phải từ 1 đến 99.",
      );
      await sendPickQuantityMenu(chatId, code, messageId);
      return;
    }
    try {
      const res = await executeRutHang(code, qty, actor);
      await answerTelegramCallbackQuery(queryId, `✅ Đã rút ${qty} sản phẩm!`);
      const resHtml = buildTelegramWmsPickResult(code, res);

      const markup = {
        inline_keyboard: [
          [{ text: "📦 Rút tiếp kiện khác", callback_data: "menu_rut" }],
          [{ text: "📊 Xem tồn kho", callback_data: "menu_ton" }],
        ],
      };
      await editTelegramWmsMessage(chatId, messageId, resHtml, markup);
    } catch (err) {
      await answerTelegramCallbackQuery(queryId, `❌ Lỗi: ${err.message}`);
      await sendTelegramWmsMessage(
        chatId,
        `❌ <b>Lỗi rút hàng:</b> ${err.message}`,
      );
    }
    return;
  }

  if (data.startsWith("unseal_unit:")) {
    const code = data.split(":")[1];
    try {
      const unit = await executeKhuiKien(code, actor);
      await answerTelegramCallbackQuery(queryId, `✅ Đã khui kiện ${code}!`);
      const resHtml =
        `✅ <b>KHUI KIỆN 1 CHẠM THÀNH CÔNG!</b>\n\n` +
        `📦 <b>Mã Kiện:</b> <code>${unit.code || unit.id}</code>\n` +
        `🏷️ <b>SKU:</b> <code>${unit.sku || unit.skuName}</code>\n` +
        `📊 <b>Số lượng:</b> <b>${(unit.remainingQuantity ?? unit.currentPcs ?? 0).toLocaleString("vi-VN")} ${unit.baseUnit || unit.unitName || "Gói"}</b>\n` +
        `👉 Trạng thái mới: <b>Đang sử dụng (Đang mở)</b>`;

      const markup = {
        inline_keyboard: [
          [
            {
              text: `📦 Rút hàng ngay từ kiện ${unit.code || unit.id}`,
              callback_data: `pick_unit:${unit.code || unit.id}`,
            },
          ],
          [{ text: "🔙 Danh sách kiện mở", callback_data: "menu_rut" }],
        ],
      };
      await editTelegramWmsMessage(chatId, messageId, resHtml, markup);
    } catch (err) {
      await answerTelegramCallbackQuery(queryId, `❌ Lỗi: ${err.message}`);
      await sendTelegramWmsMessage(
        chatId,
        `❌ <b>Lỗi khui kiện:</b> ${err.message}`,
      );
    }
    return;
  }

  if (data === "menu_rut") {
    await answerTelegramCallbackQuery(queryId);
    await sendRutHangMenu(chatId, messageId);
    return;
  }

  if (data === "menu_khui") {
    await answerTelegramCallbackQuery(queryId);
    await sendKhuiKienMenu(chatId, messageId);
    return;
  }

  if (data === "menu_ton") {
    await answerTelegramCallbackQuery(queryId);
    const rep = await executeBaoCaoTon();
    const resHtml =
      `📊 <b>BÁO CÁO TỒN KHO KIỆN HÀNG WMS</b>\n\n` +
      `📦 <b>Tổng số kiện:</b> ${rep.totalPkgs} kiện\n` +
      `🟢 <b>Nguyên niêm phong:</b> ${rep.sealed} kiện\n` +
      `🟠 <b>Đang sử dụng (mở):</b> ${rep.opened} kiện\n` +
      `⚪ <b>Đã xuất hết:</b> ${rep.empty} kiện\n` +
      `───────────────\n` +
      `📈 <b>Tổng sản phẩm trong kiện:</b> <b>${rep.totalPcs.toLocaleString("vi-VN")} đơn vị</b>\n` +
      `🛒 <b>Hàng tại Khu đóng gói:</b> <b>${rep.packingAreaPcs.toLocaleString("vi-VN")} đơn vị</b>`;
    const markup = {
      inline_keyboard: [
        [{ text: "📦 Rút hàng nhanh", callback_data: "menu_rut" }],
        [{ text: "🔓 Khui thêm kiện", callback_data: "menu_khui" }],
      ],
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
  const cmd = parts[0]?.split("@")[0]?.toLowerCase();
  const chatType = String(message.chat?.type || "private");
  const isGroup = chatType === "group" || chatType === "supergroup";

  if (cmd === "/ketnoi") {
    if (!isGroup) {
      await sendTelegramWmsMessage(
        chatId,
        "ℹ️ Hãy tạo nhóm Telegram, thêm bot làm quản trị viên rồi gửi <code>/ketnoi</code> ngay trong nhóm đó.",
      );
      return;
    }
    if (
      !(await isTelegramWmsGroupManager(chatId, message.from?.id))
    ) {
      await sendTelegramWmsMessage(
        chatId,
        "⛔ Chỉ chủ nhóm hoặc quản trị viên Telegram mới được phép kết nối nhóm này.",
      );
      return;
    }
    try {
      const connected = await saveTelegramWmsGroupConfig(message.chat);
      await sendTelegramWmsMessage(
        chatId,
        `✅ <b>ĐÃ KẾT NỐI NHÓM QUẢN LÝ KIỆN HÀNG</b>\n\n🏢 Nhóm: <b>${connected.title.replace(/[<>]/g, "")}</b>\n🆔 Group ID: <code>${connected.chatId}</code>\n👥 Nhân viên trong nhóm có thể dùng menu bên dưới để rút hàng. Mọi thao tác đều ghi lại tài khoản Telegram thực hiện.`,
        TELEGRAM_MAIN_KEYBOARD,
      );
      await sendRutHangMenu(chatId);
    } catch (error) {
      await sendTelegramWmsMessage(
        chatId,
        `❌ Không thể kết nối nhóm: ${error.message}`,
      );
    }
    return;
  }

  // Nếu chưa có nhóm nào được đăng ký, lệnh đầu tiên của chủ hệ thống trong
  // nhóm sẽ tự kết nối. Điều này tránh việc một poller cũ nuốt mất /ketnoi.
  if (
    isGroup &&
    (await isTelegramWmsGroupManager(chatId, message.from?.id))
  ) {
    const currentGroup = await loadTelegramWmsGroupConfig();
    if (!currentGroup.chatId) {
      const connected = await saveTelegramWmsGroupConfig(message.chat);
      await sendTelegramWmsMessage(
        chatId,
        `✅ Đã tự động kết nối nhóm <b>${connected.title.replace(/[<>]/g, "")}</b> với hệ thống quản lý kiện hàng.`,
      );
    }
  }

  if (!(await isTelegramWmsContextAllowed(message.chat, message.from))) {
    if (isGroup) {
      await sendTelegramWmsMessage(
        chatId,
        "🔒 Nhóm này chưa được cấp quyền. Chủ hệ thống hãy gửi <code>/ketnoi</code> để đăng ký nhóm.",
      );
    } else {
      await sendTelegramWmsMessage(
        chatId,
        "🔒 Bot chỉ nhận thao tác của nhân viên trong nhóm quản lý kiện hàng đã được kết nối.",
      );
    }
    return;
  }

  const actorKey = telegramWmsActorKey(chatId, message.from?.id);
  const pendingCustomPick = telegramWmsPendingCustomPicks.get(actorKey);
  if (pendingCustomPick) {
    if (pendingCustomPick.expiresAt < Date.now()) {
      telegramWmsPendingCustomPicks.delete(actorKey);
      await sendTelegramWmsMessage(
        chatId,
        "⌛ Yêu cầu nhập số lượng đã hết hạn. Vui lòng chọn lại kiện và bấm <b>Nhập số lượng tùy chọn</b>.",
      );
      return;
    }
    if (cmd === "/huy") {
      telegramWmsPendingCustomPicks.delete(actorKey);
      await sendTelegramWmsMessage(chatId, "✅ Đã hủy nhập số lượng tùy chọn.");
      return;
    }
    if (!/^\d+$/.test(text)) {
      await sendTelegramWmsMessage(
        chatId,
        "⚠️ Vui lòng chỉ nhập một số từ <b>1 đến 99</b>, hoặc gửi <code>/huy</code> để hủy.",
      );
      return;
    }

    const qty = Number(text);
    if (!Number.isInteger(qty) || qty < 1 || qty >= 100) {
      await sendTelegramWmsMessage(
        chatId,
        "⚠️ Mỗi lần xuất phải dưới 100. Vui lòng nhập số từ <b>1 đến 99</b>.",
      );
      return;
    }

    const actor = `Telegram: ${message.from?.username || message.from?.first_name || chatId}`;
    try {
      const res = await executeRutHang(pendingCustomPick.code, qty, actor);
      telegramWmsPendingCustomPicks.delete(actorKey);
      await sendTelegramWmsMessage(
        chatId,
        buildTelegramWmsPickResult(pendingCustomPick.code, res),
        {
          inline_keyboard: [
            [{ text: "📦 Rút tiếp kiện khác", callback_data: "menu_rut" }],
            [{ text: "📊 Xem tồn kho", callback_data: "menu_ton" }],
          ],
        },
      );
    } catch (error) {
      await sendTelegramWmsMessage(
        chatId,
        `❌ <b>Không thể rút hàng:</b> ${error.message}\n👉 Bạn có thể nhập lại số khác hoặc gửi <code>/huy</code>.`,
      );
    }
    return;
  }

  // Các phím bấm từ bàn phím dưới màn hình
  if (
    text === "📦 RÚT HÀNG NHANH ⚡" ||
    text === "Rút hàng" ||
    text === "Rút"
  ) {
    await sendRutHangMenu(chatId);
    return;
  }

  if (
    text === "📊 XEM TỒN KHO" ||
    text === "Tồn kho" ||
    text === "Tồn" ||
    cmd === "/ton"
  ) {
    const rep = await executeBaoCaoTon();
    const resHtml =
      `📊 <b>BÁO CÁO TỒN KHO KIỆN HÀNG WMS</b>\n\n` +
      `📦 <b>Tổng số kiện:</b> ${rep.totalPkgs} kiện\n` +
      `🟢 <b>Nguyên niêm phong:</b> ${rep.sealed} kiện\n` +
      `🟠 <b>Đang sử dụng (mở):</b> ${rep.opened} kiện\n` +
      `⚪ <b>Đã xuất hết:</b> ${rep.empty} kiện\n` +
      `───────────────\n` +
      `📈 <b>Tổng sản phẩm trong kiện:</b> <b>${rep.totalPcs.toLocaleString("vi-VN")} đơn vị</b>\n` +
      `🛒 <b>Hàng tại Khu đóng gói:</b> <b>${rep.packingAreaPcs.toLocaleString("vi-VN")} đơn vị</b>`;
    const markup = {
      inline_keyboard: [
        [{ text: "📦 RÚT HÀNG NHANH ⚡", callback_data: "menu_rut" }],
        [{ text: "🔓 KHUI KIỆN MỚI", callback_data: "menu_khui" }],
      ],
    };
    await sendTelegramWmsMessage(chatId, resHtml, markup);
    return;
  }

  if (text === "🔓 KHUI KIỆN MỚI" || text === "Khui kiện" || text === "Khui") {
    await sendKhuiKienMenu(chatId);
    return;
  }

  if (text === "🔍 DANH SÁCH KIỆN" || text === "🔍 TRA CỨU KIỆN") {
    const list = await getAllHandlingUnitsFromStore();
    let body = `📦 <b>DANH SÁCH TẤT CẢ KIỆN HÀNG (${list.length}):</b>\n\n`;
    list.forEach((u, i) => {
      const st =
        u.status === "opened" || u.status === "Đang sử dụng"
          ? "🟠"
          : u.status === "empty"
            ? "⚪"
            : "🟢";
      const qty = (u.remainingQuantity ?? u.currentPcs ?? 0).toLocaleString(
        "vi-VN",
      );
      const unit = u.baseUnit || u.unitName || "Gói";
      body += `${st} <code>${u.code || u.id}</code> · ${u.sku || u.skuName} (${qty} ${unit})\n`;
    });
    const markup = {
      inline_keyboard: [
        [{ text: "📦 Rút hàng nhanh", callback_data: "menu_rut" }],
        [{ text: "🔓 Khui kiện mới", callback_data: "menu_khui" }],
      ],
    };
    await sendTelegramWmsMessage(chatId, body, markup);
    return;
  }

  if (cmd === "/start") {
    const payload = parts[1];
    if (payload) {
      const p = payload.trim();
      if (p.startsWith("khui_") || p.startsWith("khui-")) {
        const code = p.replace(/^khui[_-]/i, "").replace(/_/g, "-");
        try {
          const unit = await executeKhuiKien(
            code,
            `Telegram QR: ${message.from?.username || message.from?.first_name || chatId}`,
          );
          let zoneName = unit.zone;
          try {
            zoneName = JSON.parse(unit.zone)?.zone || unit.zone;
          } catch {}
          const resHtml =
            `📷 <b>ĐÃ QUÉT MÃ QR & KHUI KIỆN THÀNH CÔNG!</b>\n\n` +
            `📦 <b>Mã Kiện:</b> <code>${unit.code || unit.id}</code>\n` +
            `🏷️ <b>SKU:</b> <code>${unit.sku || unit.skuName}</code>\n` +
            `📍 <b>Vị trí:</b> ${zoneName || "Khu A1"}\n` +
            `📊 <b>Số lượng:</b> <b>${(unit.remainingQuantity ?? unit.currentPcs ?? 0).toLocaleString("vi-VN")} ${unit.baseUnit || unit.unitName || "Gói"}</b>\n` +
            `👉 Trạng thái mới: <b>Đang sử dụng (Đang mở)</b>`;
          const markup = {
            inline_keyboard: [
              [
                {
                  text: `📦 Rút hàng ngay từ kiện ${unit.code || unit.id}`,
                  callback_data: `pick_unit:${unit.code || unit.id}`,
                },
              ],
            ],
          };
          await sendTelegramWmsMessage(chatId, resHtml, markup);
          return;
        } catch (err) {
          await sendTelegramWmsMessage(
            chatId,
            `❌ <b>Lỗi quét khui kiện:</b> ${err.message}`,
          );
          return;
        }
      } else if (p.startsWith("rut_") || p.startsWith("rut-")) {
        const subParts = p.replace(/^rut[_-]/i, "").split("_");
        const code = subParts[0]?.replace(/_/g, "-");
        const qty = parseInt(subParts[1] || "50", 10);
        if (!Number.isInteger(qty) || qty < 1 || qty >= 100) {
          await sendTelegramWmsMessage(
            chatId,
            "⚠️ Mỗi lần xuất qua Telegram phải từ <b>1 đến 99</b>.",
          );
          return;
        }
        try {
          const result = await executeRutHang(
            code,
            qty,
            `Telegram QR: ${message.from?.username || message.from?.first_name || chatId}`,
          );
          const resHtml =
            `📷 <b>ĐÃ QUÉT MÃ QR & RÚT HÀNG THÀNH CÔNG!</b>\n\n` +
            `📦 <b>Mã Kiện:</b> <code>${result.unit.code || result.unit.id}</code>\n` +
            `📉 <b>Đã rút:</b> <b>${result.picked.toLocaleString("vi-VN")} ${result.unit.baseUnit || result.unit.unitName || "Gói"}</b>\n` +
            `📊 <b>Còn lại theo sổ:</b> <b>${result.remaining.toLocaleString("vi-VN")} ${result.unit.baseUnit || result.unit.unitName || "Gói"}</b> ${result.unit.status === "pending_check" ? "<i>(Chờ kiểm thực tế)</i>" : ""}\n` +
            `🛒 <b>Chờ xuất tại Khu đóng gói:</b> <b>${Number(result.destinationPcs ?? result.packingAreaPcs ?? 0).toLocaleString("vi-VN")} đơn vị</b>`;
          const markup = {
            inline_keyboard: [
              [{ text: "📦 Rút tiếp kiện khác", callback_data: "menu_rut" }],
              [{ text: "📊 Xem tồn kho", callback_data: "menu_ton" }],
            ],
          };
          await sendTelegramWmsMessage(chatId, resHtml, markup);
          return;
        } catch (err) {
          await sendTelegramWmsMessage(
            chatId,
            `❌ <b>Lỗi quét rút hàng:</b> ${err.message}`,
          );
          return;
        }
      }
    }

    const welcomeHtml =
      `👋 <b>Xin chào ${message.from?.first_name || "bạn"}!</b>\n\n` +
      `🤖 <b>HỆ THỐNG QUẢN LÝ KHO KIỆN HÀNG WMS 1 CHẠM:</b>\n` +
      `Dưới kho bạn <b>không cần gõ lệnh</b>, chỉ cần bấm các nút menu bên dưới:\n\n` +
      `👉 <b>Bấm "📦 RÚT HÀNG NHANH ⚡"</b> để chọn kiện và chạm số lượng rút trong 1 giây!`;
    await sendTelegramWmsMessage(chatId, welcomeHtml, TELEGRAM_MAIN_KEYBOARD);
    await sendRutHangMenu(chatId);
    return;
  }

  if (cmd === "/rut") {
    if (parts.length === 1) {
      await sendRutHangMenu(chatId);
      return;
    }
    const code = parts[1];
    const qty = parseInt(parts[2], 10);
    if (!code || isNaN(qty) || qty <= 0) {
      await sendPickQuantityMenu(chatId, code);
      return;
    }
    if (qty >= 100) {
      await sendTelegramWmsMessage(
        chatId,
        "⚠️ Mỗi lần xuất qua Telegram phải dưới 100. Hãy nhập số từ <b>1 đến 99</b>.",
      );
      return;
    }
    try {
      const result = await executeRutHang(
        code,
        qty,
        `Telegram: ${message.from?.username || message.from?.first_name || chatId}`,
      );
      const resHtml =
        `🚀 <b>RÚT HÀNG SANG KHU ĐÓNG GÓI THÀNH CÔNG!</b>\n\n` +
        `📦 <b>Mã Kiện:</b> <code>${result.unit.code || result.unit.id}</code>\n` +
        `🏷️ <b>SKU:</b> <code>${result.unit.sku || result.unit.skuName}</code>\n` +
        `📉 <b>Đã rút:</b> <b>${result.picked.toLocaleString("vi-VN")} ${result.unit.baseUnit || result.unit.unitName || "Gói"}</b>\n` +
        `📊 <b>Còn lại trong kiện:</b> <b>${result.remaining.toLocaleString("vi-VN")} ${result.unit.baseUnit || result.unit.unitName || "Gói"}</b>\n` +
        `🛒 <b>Tổng chờ xuất tại Khu đóng gói:</b> <b>${Number(result.destinationPcs ?? result.packingAreaPcs ?? 0).toLocaleString("vi-VN")} đơn vị</b>`;
      const markup = {
        inline_keyboard: [
          [{ text: "📦 Rút tiếp kiện khác", callback_data: "menu_rut" }],
        ],
      };
      await sendTelegramWmsMessage(chatId, resHtml, markup);
    } catch (err) {
      await sendTelegramWmsMessage(
        chatId,
        `❌ <b>Lỗi rút hàng:</b> ${err.message}`,
      );
    }
    return;
  }

  if (cmd === "/khui") {
    if (parts.length === 1) {
      await sendKhuiKienMenu(chatId);
      return;
    }
    const code = parts[1];
    try {
      const unit = await executeKhuiKien(
        code,
        `Telegram: ${message.from?.username || message.from?.first_name || chatId}`,
      );
      const resHtml =
        `✅ <b>KHUI KIỆN THÀNH CÔNG!</b>\n\n` +
        `📦 <b>Mã Kiện:</b> <code>${unit.code || unit.id}</code>\n` +
        `🏷️ <b>SKU:</b> <code>${unit.sku || unit.skuName}</code>\n` +
        `📊 <b>Số lượng:</b> <b>${(unit.remainingQuantity ?? unit.currentPcs ?? 0).toLocaleString("vi-VN")} ${unit.baseUnit || unit.unitName || "Gói"}</b>\n` +
        `👉 Trạng thái mới: <b>Đang sử dụng (Đang mở)</b>`;
      const markup = {
        inline_keyboard: [
          [
            {
              text: `📦 Rút hàng từ ${unit.code || unit.id}`,
              callback_data: `pick_unit:${unit.code || unit.id}`,
            },
          ],
        ],
      };
      await sendTelegramWmsMessage(chatId, resHtml, markup);
    } catch (err) {
      await sendTelegramWmsMessage(
        chatId,
        `❌ <b>Lỗi khui kiện:</b> ${err.message}`,
      );
    }
    return;
  }

  // Mặc định: hiện menu rút hàng nhanh
  await sendRutHangMenu(chatId);
}

function startTelegramWmsPolling() {
  if (telegramWmsBotRunning || !TELEGRAM_WMS_BOT_TOKEN) return;
  telegramWmsBotRunning = true;
  telegramWmsLastError = null;
  console.log("🤖 [TelegramWMS] Starting Telegram Bot 1-Touch polling loop...");

  const scheduleNextPoll = (delay) => {
    if (!telegramWmsBotRunning) return;
    clearTimeout(telegramWmsPollTimer);
    telegramWmsPollTimer = setTimeout(pollUpdates, delay);
  };

  const pollUpdates = async () => {
    if (!telegramWmsBotRunning) return;
    try {
      const path = `/bot${TELEGRAM_WMS_BOT_TOKEN}/getUpdates?offset=${telegramWmsLastUpdateId}&timeout=25`;
      telegramWmsPollRequest = https.request(
        {
          hostname: "api.telegram.org",
          path,
          method: "GET",
          timeout: 30000,
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", async () => {
            telegramWmsPollRequest = null;
            try {
              const json = JSON.parse(body);
              if (json.ok && Array.isArray(json.result)) {
                telegramWmsLastPollAt = new Date().toISOString();
                telegramWmsLastError = null;
                for (const update of json.result) {
                  telegramWmsLastUpdateId = update.update_id + 1;
                  if (update.callback_query) {
                    await handleTelegramWmsCallbackQuery(update.callback_query);
                  } else if (update.message) {
                    await handleTelegramWmsIncomingMessage(update.message);
                  }
                }
              } else {
                telegramWmsLastError =
                  json.description || `Telegram HTTP ${res.statusCode}`;
                console.warn(
                  "[TelegramWMS] Polling rejected:",
                  telegramWmsLastError,
                );
              }
            } catch (e) {
              telegramWmsLastError = e.message;
              console.warn("[TelegramWMS] Parse update error:", e.message);
            }
            scheduleNextPoll(telegramWmsLastError ? 5000 : 500);
          });
        },
      );
      telegramWmsPollRequest.on("error", (error) => {
        telegramWmsPollRequest = null;
        if (!telegramWmsBotRunning) return;
        telegramWmsLastError = error.message;
        console.warn("[TelegramWMS] Polling request error:", error.message);
        scheduleNextPoll(5000);
      });
      telegramWmsPollRequest.on("timeout", () => {
        telegramWmsPollRequest?.destroy();
      });
      telegramWmsPollRequest.end();
    } catch (err) {
      telegramWmsPollRequest = null;
      telegramWmsLastError = err.message;
      console.warn("[TelegramWMS] Polling loop error:", err.message);
      scheduleNextPoll(5000);
    }
  };

  pollUpdates();
}

function stopTelegramWmsPolling() {
  telegramWmsBotRunning = false;
  clearTimeout(telegramWmsPollTimer);
  telegramWmsPollTimer = null;
  if (telegramWmsPollRequest) {
    telegramWmsPollRequest.destroy();
    telegramWmsPollRequest = null;
  }
}

// Electron is the single polling owner so inbound commands use the same live
// database/session service as the package-management screen.
startTelegramWmsPolling();

ipcMain.handle("handlingUnits:unsealUnit", async (_event, payload = {}) => {
  try {
    requireRole("admin", "manager");
    const code = String(payload.code || "").trim();
    const updated = await executeKhuiKien(
      code,
      currentSession?.username || "Renderer",
    );
    return { success: true, data: updated };
  } catch (error) {
    console.error("Unseal handling unit error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("handlingUnits:sealUnit", async (_event, payload = {}) => {
  try {
    requireRole("admin", "manager");
    const code = String(payload.code || "")
      .trim()
      .toUpperCase();
    try {
      await prisma.handlingUnit.update({
        where: { code },
        data: { status: "sealed" },
      });
    } catch {}
    try {
      const cfg = await prisma.appConfig.findUnique({
        where: { key: "handlingUnitsRegisterJson" },
      });
      if (cfg?.value) {
        const arr = JSON.parse(cfg.value);
        const item = arr.find((u) => (u.code || u.id) === code);
        if (item) {
          item.status = "sealed";
          await prisma.appConfig.update({
            where: { key: "handlingUnitsRegisterJson" },
            data: { value: JSON.stringify(arr) },
          });
        }
      }
    } catch {}
    return { success: true };
  } catch (error) {
    console.error("Seal handling unit error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("handlingUnits:deleteUnit", async (_event, payload = {}) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    const code = String(payload.code || "").trim().toUpperCase();
    const reason = String(payload.reason || "Xóa kiện tạo nhầm").trim();
    if (!code) throw new Error("Mã kiện không hợp lệ.");

    const deleted = await prisma.$transaction(async (tx) => {
      const unit = await tx.handlingUnit.findUnique({ where: { code } });
      if (!unit) throw new Error(`Không tìm thấy kiện [${code}].`);
      if (Number(unit.remainingQuantity) !== Number(unit.initialQuantity)) {
        throw new Error(
          `Không thể xóa kiện [${code}] vì đã phát sinh rút hoặc điều chỉnh số lượng.`,
        );
      }
      if (unit.status === "pending_check" || unit.status === "empty") {
        throw new Error(
          `Không thể xóa kiện [${code}] ở trạng thái chờ kiểm hoặc đã hết.`,
        );
      }

      await appendHandlingUnitsTransaction(tx, {
        unitId: code,
        type: "Xóa kiện",
        quantity: 0,
        remaining: unit.remainingQuantity,
        actor: currentSession?.username || "Renderer",
        note: reason,
      });
      try {
        await tx.handlingUnitAudit.create({
          data: {
            entityType: "handling_unit",
            entityId: code,
            action: "DELETE",
            before: JSON.stringify(unit),
            actorId: currentSession?.id || null,
          },
        });
      } catch {}

      const legacyConfig = await tx.appConfig.findUnique({
        where: { key: "handlingUnitsRegisterJson" },
      });
      if (legacyConfig?.value) {
        try {
          const legacyUnits = JSON.parse(legacyConfig.value);
          if (Array.isArray(legacyUnits)) {
            await tx.appConfig.update({
              where: { key: "handlingUnitsRegisterJson" },
              data: {
                value: JSON.stringify(
                  legacyUnits.filter(
                    (item) =>
                      String(item?.code || item?.id || "").toUpperCase() !== code,
                  ),
                ),
              },
            });
          }
        } catch {}
      }

      return tx.handlingUnit.delete({ where: { code } });
    });

    broadcastHandlingUnitsChanged("DELETE", { code });
    return { success: true, data: { code, unit: deleted } };
  } catch (error) {
    console.error("Delete handling unit error:", error);
    return { success: false, error: error.message };
  }
});

const handlingUnitPickRequests = new Set();

ipcMain.handle("handlingUnits:pickUnit", async (_event, payload = {}) => {
  const idempotencyKey = String(payload.idempotencyKey || "").trim();
  const requestKey = idempotencyKey ? `pick:${idempotencyKey}` : null;
  if (requestKey && handlingUnitPickRequests.has(requestKey)) {
    return { success: true, data: { duplicate: true } };
  }
  if (requestKey) handlingUnitPickRequests.add(requestKey);
  try {
    requireRole("admin", "manager");
    const code = String(payload.code || "").trim();
    const quantity = Number(payload.quantity || 0);
    const note = String(payload.note || "").trim();
    const destination = normalizeHandlingPickDestination(payload.destination);
    const result = await executeRutHang(
      code,
      quantity,
      currentSession?.username || "Renderer",
      note,
      destination,
    );
    return { success: true, data: result };
  } catch (error) {
    console.error("Pick handling unit error:", error);
    return { success: false, error: error.message };
  } finally {
    if (requestKey) handlingUnitPickRequests.delete(requestKey);
  }
});

ipcMain.handle("handlingUnits:requestFinalCheck", async (_event, payload = {}) => {
  const idempotencyKey = String(payload.idempotencyKey || "").trim();
  const requestKey = idempotencyKey ? `request-final-check:${idempotencyKey}` : null;
  if (requestKey && handlingUnitPickRequests.has(requestKey)) {
    return { success: true, data: { duplicate: true } };
  }
  if (requestKey) handlingUnitPickRequests.add(requestKey);
  try {
    requireRole("admin", "manager");
    const code = String(payload.code || "").trim().toUpperCase();
    if (!code) throw new Error("Mã kiện không hợp lệ.");
    if (prisma) {
      const result = await prisma.$transaction(async (tx) => {
        const unit = await tx.handlingUnit.findUnique({ where: { code } });
        if (!unit) return null;
        if (unit.status !== "opened") {
          throw new Error(`Kiện [${code}] chưa ở trạng thái đang sử dụng.`);
        }
        await appendHandlingUnitsTransaction(tx, {
          unitId: code,
          type: "Chờ kiểm chốt hết kiện",
          quantity: 0,
          remaining: unit.remainingQuantity,
          actor: currentSession?.username || "Renderer",
          note: `Chờ kiểm thực tế ${unit.remainingQuantity} ${unit.baseUnit} trước khi chốt hết kiện`,
        });
        return tx.handlingUnit.update({
          where: { code },
          data: { status: "pending_check", updatedAt: new Date() },
        });
      });
      if (result) {
        broadcastHandlingUnitsChanged("PENDING_FINAL_CHECK", { code, status: "pending_check" });
        return { success: true, data: { unit: result } };
      }
    }
    const list = await getAllHandlingUnitsFromStore();
    const index = list.findIndex((unit) => String(unit.code || unit.id || "").toUpperCase() === code);
    if (index === -1) throw new Error(`Không tìm thấy kiện [${code}] trong kho.`);
    const unit = list[index];
    if (unit.status !== "opened" && unit.status !== "Đang sử dụng") {
      throw new Error(`Kiện [${code}] chưa ở trạng thái đang sử dụng.`);
    }
    unit.status = "pending_check";
    unit.updatedAt = new Date();
    list[index] = unit;
    await saveHandlingUnitsToStore(list);
    if (prisma) {
      await appendHandlingUnitsTransaction(prisma, {
        unitId: code,
        type: "Chờ kiểm chốt hết kiện",
        quantity: 0,
        remaining: unit.remainingQuantity ?? unit.currentPcs ?? 0,
        actor: currentSession?.username || "Renderer",
        note: "Chờ kiểm thực tế trước khi chốt hết kiện",
      });
    }
    broadcastHandlingUnitsChanged("PENDING_FINAL_CHECK", { code, status: "pending_check" });
    return { success: true, data: { unit } };
  } catch (error) {
    console.error("Request final handling-unit check error:", error);
    return { success: false, error: error.message };
  } finally {
    if (requestKey) handlingUnitPickRequests.delete(requestKey);
  }
});

// The withdrawal has already reduced the package balance to zero. Final check
// either confirms zero or restores the physical remainder found in the package.
ipcMain.handle("handlingUnits:finalizePick", async (_event, payload = {}) => {
  const idempotencyKey = String(payload.idempotencyKey || "").trim();
  const requestKey = idempotencyKey ? `final-pick:${idempotencyKey}` : null;
  if (requestKey && handlingUnitPickRequests.has(requestKey)) {
    return { success: true, data: { duplicate: true } };
  }
  if (requestKey) handlingUnitPickRequests.add(requestKey);
  try {
    requireRole("admin", "manager");
    const code = String(payload.code || "").trim().toUpperCase();
    const actualQuantity = Math.max(0, Math.floor(Number(payload.actualQuantity)));
    const note = String(payload.note || "").trim();
    if (!code || !Number.isFinite(actualQuantity)) {
      throw new Error("Số lượng thực tế không hợp lệ.");
    }

    const recordFinalCheck = async (tx, unit) => {
      if (unit.status !== "pending_check" && unit.status !== "Chờ kiểm") {
        throw new Error(`Kiện [${code}] chưa ở trạng thái chờ kiểm.`);
      }
      const maximumQuantity = Math.max(
        0,
        Number(unit.initialQuantity ?? unit.initialPcs ?? 0),
      );
      if (maximumQuantity > 0 && actualQuantity > maximumQuantity) {
        throw new Error(
          `Số lượng thực tế (${actualQuantity}) không thể lớn hơn sức chứa ban đầu (${maximumQuantity}).`,
        );
      }
      await appendHandlingUnitsTransaction(tx, {
        unitId: code,
        type:
          actualQuantity === 0
            ? "Kiểm khớp - chốt hết kiện"
            : "Kiểm lệch - cập nhật tồn thực tế",
        quantity: actualQuantity,
        remaining: actualQuantity,
        actor: currentSession?.username || "Renderer",
        note:
          actualQuantity === 0
            ? `Kiểm thực tế khớp: kiện không còn hàng${note ? ` · ${note}` : ""}`
            : `Kiểm thực tế còn ${actualQuantity} ${unit.baseUnit || unit.unitName || "Gói"}; trả kiện về Đang sử dụng${note ? ` · ${note}` : ""}`,
      });
    };

    if (prisma) {
      const result = await prisma.$transaction(async (tx) => {
        const unit = await tx.handlingUnit.findUnique({ where: { code } });
        if (!unit) return null;
        await recordFinalCheck(tx, unit);
        const nextStatus = actualQuantity > 0 ? "opened" : "empty";
        const updated = await tx.handlingUnit.update({
          where: { code },
          data: {
            remainingQuantity: actualQuantity,
            status: nextStatus,
            updatedAt: new Date(),
          },
        });
        return { unit: updated, actualQuantity };
      });
      if (result) {
        broadcastHandlingUnitsChanged("FINAL_CHECK", {
          code,
          remaining: actualQuantity,
          status: actualQuantity > 0 ? "opened" : "empty",
          actualQuantity,
          actor: currentSession?.username || "Renderer",
        });
        return { success: true, data: result };
      }
    }

    const list = await getAllHandlingUnitsFromStore();
    const index = list.findIndex(
      (unit) => String(unit.code || unit.id || "").toUpperCase() === code,
    );
    if (index === -1) throw new Error(`Không tìm thấy kiện [${code}] trong kho.`);
    const unit = list[index];
    if (unit.status !== "pending_check" && unit.status !== "Chờ kiểm") {
      throw new Error(`Kiện [${code}] chưa ở trạng thái chờ kiểm.`);
    }
    const maximumQuantity = Math.max(
      0,
      Number(unit.initialQuantity ?? unit.initialPcs ?? 0),
    );
    if (maximumQuantity > 0 && actualQuantity > maximumQuantity)
      throw new Error(
        `Số lượng thực tế (${actualQuantity}) không thể lớn hơn sức chứa ban đầu (${maximumQuantity}).`,
      );
    if (prisma) {
      await recordFinalCheck(prisma, unit);
    }
    unit.remainingQuantity = actualQuantity;
    unit.currentPcs = actualQuantity;
    unit.status = actualQuantity > 0 ? "opened" : "empty";
    unit.updatedAt = new Date();
    list[index] = unit;
    await saveHandlingUnitsToStore(list);
    broadcastHandlingUnitsChanged("FINAL_CHECK", {
      code,
      remaining: actualQuantity,
      status: actualQuantity > 0 ? "opened" : "empty",
      actualQuantity,
      actor: currentSession?.username || "Renderer",
    });
    return { success: true, data: { unit, actualQuantity } };
  } catch (error) {
    console.error("Finalize handling-unit pick error:", error);
    return { success: false, error: error.message };
  } finally {
    if (requestKey) handlingUnitPickRequests.delete(requestKey);
  }
});

ipcMain.handle("handlingUnits:getTelegramStatus", async () => {
  const groupConfig = await loadTelegramWmsGroupConfig();
  return {
    success: true,
    data: {
      isRunning: telegramWmsBotRunning,
      botUsername: "quanlykienhang_bot",
      defaultChatId: TELEGRAM_WMS_DEFAULT_CHAT,
      groupChatId: groupConfig.chatId,
      groupTitle: groupConfig.title,
      isGroupConnected: Boolean(groupConfig.chatId),
      lastPollAt: telegramWmsLastPollAt,
      lastError: telegramWmsLastError,
    },
  };
});

ipcMain.handle(
  "handlingUnits:sendTelegramTest",
  async (_event, payload = {}) => {
    try {
      const text = String(payload.text || "Test message từ hệ thống POS");
      const chatId = payload.chatId || null;
      const res = await sendTelegramWmsMessage(chatId, text);
      return { success: !!res?.ok, data: res };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

// Header alerts only need VAT state and date. Never send purchase line items
// to every open desktop just to calculate a notification badge.
ipcMain.handle("purchases:getVatAlertSummary", async () => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    const [
      vatGroups,
      companyVat,
      purchaseItemCompanies,
      goodsCompanies,
      purchases,
    ] = await Promise.all([
      getPurchaseVatGroups(),
      getPurchaseCompanyVat(),
      getPurchaseItemCompanies(),
      readGoodsCompanies(),
      prisma.purchaseOrder.findMany({
        where: { status: { not: "cancelled" } },
        select: {
          id: true,
          vatInvoiceStatus: true,
          receivedAt: true,
          createdAt: true,
          items: {
            select: {
              id: true,
              productId: true,
              color: true,
              variantSku: true,
              product: { select: { sku: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    const groupByPurchaseId = new Map();
    Object.entries(vatGroups || {}).forEach(([groupId, group]) => {
      (Array.isArray(group?.purchaseIds) ? group.purchaseIds : []).forEach(
        (id) => {
          groupByPurchaseId.set(Number(id), {
            vatGroupId: groupId,
            vatGroupHasVat: Boolean(group?.vatInvoiceFile),
          });
        },
      );
    });
    return {
      success: true,
      data: purchases.map((purchase) => {
        const requiredCompanies = resolvePurchaseVatCompanies(
          purchase,
          purchaseItemCompanies,
          goodsCompanies,
        );
        const relevantVat = getRelevantPurchaseCompanyVat(
          purchase.id,
          requiredCompanies,
          companyVat,
        );
        return {
          vatInvoiceStatus: purchase.vatInvoiceStatus,
          purchaseDate: purchase.receivedAt || purchase.createdAt,
          companyVatByGroup: Object.fromEntries(
            requiredCompanies.map((name, index) => [name, relevantVat[index]]),
          ),
          vatRequiredCompanies: requiredCompanies,
          ...(groupByPurchaseId.get(purchase.id) || {}),
        };
      }),
    };
  } catch (error) {
    console.error("Get purchase VAT alert summary error:", error);
    return { success: false, error: error.message };
  }
});

// Targeted notice for the person who created a purchase. The payroll screen
// calculates this fine automatically, so the employee needs a durable alert
// rather than relying on an admin to tell them about it.
ipcMain.handle("purchases:getMyVatPenaltyAlerts", async () => {
  try {
    requireRole();
    if (!prisma) throw new Error("Prisma not available");
    const [
      vatGroups,
      companyVat,
      purchaseItemCompanies,
      goodsCompanies,
      purchases,
    ] = await Promise.all([
      getPurchaseVatGroups(),
      getPurchaseCompanyVat(),
      getPurchaseItemCompanies(),
      readGoodsCompanies(),
      prisma.purchaseOrder.findMany({
        where: {
          status: { not: "cancelled" },
          createdBy: currentSession.username,
        },
        select: {
          id: true,
          poNumber: true,
          createdAt: true,
          receivedAt: true,
          vatInvoiceStatus: true,
          supplier: { select: { name: true } },
          items: {
            select: {
              id: true,
              productId: true,
              color: true,
              variantSku: true,
              product: { select: { sku: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const vatUploadedPurchaseIds = new Set();
    Object.values(vatGroups || {}).forEach((group) => {
      if (!group?.vatInvoiceFile) return;
      (Array.isArray(group.purchaseIds) ? group.purchaseIds : []).forEach(
        (id) => vatUploadedPurchaseIds.add(Number(id)),
      );
    });
    // 10/08 is a full grace day. Receipts already overdue at rollout only
    // receive stage 1 from 00:00 on 11/08, never backdated.
    const policyStart = new Date("2026-08-11T00:00:00+07:00");
    const now = new Date();
    const alerts = purchases.flatMap((purchase) => {
      const vatStatus = String(
        purchase.vatInvoiceStatus || "pending",
      ).toLowerCase();
      const purchaseDate = purchase.receivedAt || purchase.createdAt;
      const requiredCompanies = resolvePurchaseVatCompanies(
        purchase,
        purchaseItemCompanies,
        goodsCompanies,
      );
      const companyVatEntries = getRelevantPurchaseCompanyVat(
        purchase.id,
        requiredCompanies,
        companyVat,
      );
      const hasCompanyVat =
        companyVatEntries.length > 0 &&
        companyVatEntries.every((vat) =>
          ["uploaded", "verified", "thht", "no_vat"].includes(
            String(vat?.status || "").toLowerCase(),
          ),
        );
      const hasVat =
        vatUploadedPurchaseIds.has(purchase.id) ||
        hasCompanyVat ||
        ["uploaded", "verified", "thht", "no_vat"].includes(vatStatus);
      const fineStage = getVatFineStageForDate(purchaseDate, now, policyStart);
      if (hasVat || fineStage === 0) return [];
      return Array.from({ length: fineStage }, (_, index) => {
        const stage = index + 1;
        const fineDate = getVatFineDateForStage(
          purchaseDate,
          stage,
          policyStart,
        );
        return {
          id: `purchase-${purchase.id}-vat-stage-${stage}`,
          poNumber: purchase.poNumber,
          supplierName: purchase.supplier?.name || "",
          purchaseDate: purchaseDate.toISOString(),
          fineDate: fineDate.toISOString(),
          fineStage: stage,
          // Late VAT fine escalates by 10,000đ for every new stage:
          // stage 1 = 30,000đ; stage 2 = 40,000đ; stage 3 = 50,000đ.
          fineAmount: 30000 + (stage - 1) * 10000,
        };
      });
    });
    return { success: true, data: alerts };
  } catch (error) {
    console.error("Get personal VAT penalty alerts error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  "purchases:createVatGroup",
  async (event, { purchaseIds = [], note = "" } = {}) => {
    try {
      if (!prisma) throw new Error("Prisma not available");
      requireRole("admin", "manager", "staff");

      const normalizedIds = [
        ...new Set((purchaseIds || []).map((id) => Number(id)).filter(Boolean)),
      ];
      if (normalizedIds.length < 2)
        throw new Error("Cần chọn ít nhất 2 phiếu để gộp hóa đơn");

      const purchases = await prisma.purchaseOrder.findMany({
        where: { id: { in: normalizedIds }, status: { not: "cancelled" } },
        select: { id: true, poNumber: true },
      });
      if (purchases.length !== normalizedIds.length) {
        throw new Error("Có phiếu nhập không hợp lệ hoặc đã bị hủy");
      }

      const vatGroups = await getPurchaseVatGroups();
      Object.keys(vatGroups).forEach((groupId) => {
        const currentIds = Array.isArray(vatGroups[groupId]?.purchaseIds)
          ? vatGroups[groupId].purchaseIds.map(Number)
          : [];
        const remainingIds = currentIds.filter(
          (id) => !normalizedIds.includes(id),
        );
        if (remainingIds.length >= 2) {
          vatGroups[groupId].purchaseIds = remainingIds;
        } else {
          delete vatGroups[groupId];
        }
      });

      const newGroupId = generatePurchaseVatGroupId(vatGroups);
      vatGroups[newGroupId] = {
        purchaseIds: normalizedIds,
        note: note || "",
        createdAt: new Date().toISOString(),
        vatInvoiceStatus: "pending",
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
        module: "purchases",
        action: "VAT_GROUP_CREATE",
        description: `Tạo nhóm HĐ gộp ${newGroupId} cho ${purchases.map((p) => p.poNumber || `#${p.id}`).join(", ")}`,
        userName: "System",
      });

      return {
        success: true,
        data: {
          vatGroupId: newGroupId,
          purchaseIds: normalizedIds,
          note: note || "",
        },
      };
    } catch (error) {
      console.error("❌ Create VAT group error:", error);
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "purchases:uploadVatGroupInvoice",
  async (
    event,
    {
      vatGroupId,
      invoiceNumber,
      invoiceDate,
      files = [],
      fileBase64,
      fileName,
    },
  ) => {
    try {
      if (!prisma) throw new Error("Prisma not available");
      requireRole("admin", "manager", "staff");

      const vatGroups = await getPurchaseVatGroups();
      const group = vatGroups[String(vatGroupId)];
      if (!group) throw new Error(`Không tìm thấy nhóm HĐ VAT ${vatGroupId}`);

      const purchaseIds = Array.isArray(group.purchaseIds)
        ? group.purchaseIds.map(Number).filter(Boolean)
        : [];
      if (purchaseIds.length < 2) throw new Error("Nhóm HĐ VAT không hợp lệ");

      const purchases = await prisma.purchaseOrder.findMany({
        where: { id: { in: purchaseIds }, status: { not: "cancelled" } },
        include: { supplier: true },
      });
      if (purchases.length === 0)
        throw new Error("Không tìm thấy phiếu nhập trong nhóm VAT");

      const filesList =
        files.length > 0 ? files : fileBase64 ? [{ fileBase64, fileName }] : [];
      if (filesList.length === 0)
        throw new Error("Vui lòng chọn ít nhất 1 file HĐ VAT cho nhóm");

      const userDataPath = app.getPath("userData");
      const vatDir = path.join(userDataPath, "vat-invoices");
      if (!fs.existsSync(vatDir)) fs.mkdirSync(vatDir, { recursive: true });

      const localPaths = [];
      const driveUrls = [];
      const savedBuffers = [];
      const savedFileNames = [];
      let primaryVatMeta = null;

      for (let i = 0; i < filesList.length; i++) {
        const { fileBase64: b64, fileName: fn } = filesList[i];
        const ext = (fn || "jpg").split(".").pop() || "jpg";
        const suffix = filesList.length > 1 ? `_${i + 1}` : "";
        const localFileName = `VAT_GROUP_${vatGroupId}_${Date.now()}${suffix}.${ext}`;
        const localPath = path.join(vatDir, localFileName);

        const fileBuffer = Buffer.from(b64, "base64");
        fs.writeFileSync(localPath, fileBuffer);
        localPaths.push(localPath);
        savedBuffers.push(fileBuffer);
        savedFileNames.push(localFileName);

        if (i === 0) {
          primaryVatMeta = {
            fileName: fn || localFileName,
            fileSize: fileBuffer.length,
            vatId: generateVatIdFromFile(
              fn || localFileName,
              fileBuffer.length,
            ),
          };
        }

        try {
          const drive = getDriveClient();
          if (drive) {
            const folderId = await getOrCreateVatDriveFolder();
            if (folderId) {
              const supplierName = purchases[0]?.supplier?.name || "NCC";
              const driveFileName = `HĐ_VAT_${supplierName}_${vatGroupId}_${invoiceNumber}${suffix}.${ext}`;
              const result = await uploadToDrive(
                drive,
                folderId,
                driveFileName,
                fileBuffer,
                ext === "pdf" ? "application/pdf" : "image/jpeg",
              );
              if (result) {
                driveUrls.push(result.webViewLink);
              }
            }
          }
        } catch (driveErr) {
          console.error(
            `⚠️ Drive upload group VAT failed for file ${i + 1}:`,
            driveErr.message,
          );
        }
      }

      vatGroups[String(vatGroupId)] = {
        ...group,
        vatInvoiceStatus: "uploaded",
        vatInvoiceNumber: invoiceNumber,
        vatInvoiceDate: new Date(invoiceDate).toISOString(),
        vatInvoiceFile:
          localPaths.length === 1 ? localPaths[0] : JSON.stringify(localPaths),
        vatInvoiceDriveUrl:
          driveUrls.length === 0
            ? null
            : driveUrls.length === 1
              ? driveUrls[0]
              : driveUrls.join("\n"),
        vatId: primaryVatMeta?.vatId || null,
        vatFileName: primaryVatMeta?.fileName || null,
        vatFileSize: primaryVatMeta?.fileSize || null,
        updatedAt: new Date().toISOString(),
      };
      await savePurchaseVatGroups(vatGroups);

      const purchaseNames = purchases
        .map((p) => p.poNumber || `#${p.id}`)
        .join(", ");
      const supplierName = purchases[0]?.supplier?.name || "NCC";
      const telegramMsg = [
        `🧾 <b>HĐ VAT gộp mới</b>`,
        ``,
        `🔗 Nhóm VAT: <b>${vatGroupId}</b>`,
        `🏢 NCC: <b>${supplierName}</b>`,
        `📋 Phiếu nhập: <b>${purchaseNames}</b>`,
        `🔢 Số HĐ: <b>${invoiceNumber}</b>`,
        `📅 Ngày HĐ: <b>${new Date(invoiceDate).toLocaleDateString("vi-VN")}</b>`,
        filesList.length > 1
          ? `📎 <b>${filesList.length} files đính kèm</b>`
          : "",
        driveUrls[0] ? `\n📎 <a href="${driveUrls[0]}">Xem trên Drive</a>` : "",
      ]
        .filter(Boolean)
        .join("\n");

      sendVatTelegramMessage(telegramMsg).catch((err) =>
        console.error("Telegram group VAT error:", err),
      );
      for (let i = 0; i < savedBuffers.length; i++) {
        sendVatTelegramDocument(
          savedBuffers[i],
          savedFileNames[i],
          `HĐ VAT nhóm ${vatGroupId} #${invoiceNumber}${savedBuffers.length > 1 ? ` [${i + 1}/${savedBuffers.length}]` : ""}`,
        ).catch((err) => console.error("Telegram group VAT doc error:", err));
      }

      if (savedBuffers.length > 0) {
        sendVatEmail({
          purchaseId: purchaseIds[0],
          supplierName,
          invoiceNumber,
          invoiceDate: new Date(invoiceDate).toLocaleDateString("vi-VN"),
          totalAmount:
            purchases
              .reduce((sum, p) => sum + Number(p.total || 0), 0)
              .toLocaleString("vi-VN") + "đ",
          driveUrl: driveUrls[0] || null,
          fileBuffer: savedBuffers[0],
          fileName: savedFileNames[0],
        }).catch((err) => console.error("Group VAT email error:", err));
      }

      void logActivity({
        module: "purchases",
        action: "VAT_GROUP_UPLOAD",
        description: `Upload ${filesList.length} file HĐ VAT cho nhóm ${vatGroupId} (${purchaseNames})`,
        userName: "System",
      });

      const driveWarning =
        driveUrls.length === 0
          ? "⚠️ File nhóm đã lưu local + Telegram, nhưng Google Drive upload thất bại. Kiểm tra lại Google Drive."
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
      console.error("❌ Upload group VAT invoice error:", error);
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "purchases:removeVatGroup",
  async (event, { purchaseId } = {}) => {
    try {
      if (!prisma) throw new Error("Prisma not available");
      requireRole("admin", "manager", "staff");
      const targetId = Number(purchaseId);
      if (!targetId) throw new Error("Thiếu purchaseId");

      const vatGroups = await getPurchaseVatGroups();
      let removedGroupId = null;

      Object.keys(vatGroups).forEach((groupId) => {
        const currentIds = Array.isArray(vatGroups[groupId]?.purchaseIds)
          ? vatGroups[groupId].purchaseIds.map(Number)
          : [];
        if (!currentIds.includes(targetId)) return;
        removedGroupId = groupId;
        const remainingIds = currentIds.filter((id) => id !== targetId);
        if (remainingIds.length >= 2) {
          vatGroups[groupId].purchaseIds = remainingIds;
        } else {
          delete vatGroups[groupId];
        }
      });

      if (!removedGroupId)
        throw new Error("Phiếu này chưa nằm trong nhóm HĐ gộp");
      await savePurchaseVatGroups(vatGroups);

      void logActivity({
        module: "purchases",
        action: "VAT_GROUP_REMOVE",
        description: `Tách phiếu nhập #${targetId} khỏi nhóm HĐ gộp ${removedGroupId}`,
        userName: "System",
      });

      return { success: true, data: { purchaseId: targetId, removedGroupId } };
    } catch (error) {
      console.error("❌ Remove VAT group error:", error);
      return { success: false, error: error.message };
    }
  },
);

// Create purchase
ipcMain.handle("purchases:create", async (event, data) => {
  let uploadedReceiptFileIds = [];
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");

    console.log("📦 Creating purchase order with data:", data);

    // Do not rely on renderer validation. Older clients can keep running
    // after an update and IPC calls can otherwise bypass form rules.
    const supplierId = Number(data?.supplierId);
    if (!Number.isInteger(supplierId) || supplierId <= 0) {
      throw new Error(
        "Vui lòng chọn nhà cung cấp hợp lệ trước khi tạo phiếu nhập.",
      );
    }
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, status: true },
    });
    if (!supplier || supplier.status === "inactive") {
      throw new Error("Nhà cung cấp không tồn tại hoặc đã ngừng sử dụng.");
    }

    const receiptFiles = Array.isArray(data?.importReceiptFiles)
      ? data.importReceiptFiles
      : [];
    if (receiptFiles.length === 0) {
      throw new Error(
        "Vui lòng đính kèm ít nhất 1 file Phiếu Nhập Kho trước khi tạo phiếu.",
      );
    }
    if (
      receiptFiles.some(
        (file) =>
          !file ||
          typeof file.fileBase64 !== "string" ||
          !file.fileBase64.trim() ||
          typeof file.fileName !== "string" ||
          !file.fileName.trim(),
      )
    ) {
      throw new Error(
        "File Phiếu Nhập Kho không hợp lệ. Vui lòng chọn lại file.",
      );
    }

    // Upload first, then persist the completed receipt. This avoids a
    // completed purchase existing without its mandatory document.
    const driveStatus = await ensureDriveReady();
    if (!driveStatus.success) throw new Error(driveStatus.error);
    const drive = driveStatus.drive;
    const receiptFolderId = await getOrCreateImportReceiptDriveFolder();
    if (!receiptFolderId)
      throw new Error(
        driveLastErrorMessage ||
          "Không mở được thư mục Phiếu Nhập Kho trên Google Drive.",
      );
    const receiptDriveUrls = [];
    const uploadReference = `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 7)}`;
    for (let index = 0; index < receiptFiles.length; index += 1) {
      const file = receiptFiles[index];
      const ext = (file.fileName.split(".").pop() || "jpg").toLowerCase();
      const suffix = receiptFiles.length > 1 ? `_${index + 1}` : "";
      const uploaded = await uploadToDrive(
        drive,
        receiptFolderId,
        `Phiếu_Nhập_${supplier.name}_${uploadReference}${suffix}.${ext}`,
        Buffer.from(file.fileBase64, "base64"),
        ext === "pdf" ? "application/pdf" : "image/jpeg",
      );
      if (!uploaded?.fileId || !uploaded?.webViewLink) {
        throw new Error(
          `Không thể tải file Phiếu Nhập Kho thứ ${index + 1} lên Google Drive.`,
        );
      }
      uploadedReceiptFileIds.push(uploaded.fileId);
      receiptDriveUrls.push(uploaded.webViewLink);
    }

    // Parse items and validate productIds
    const items = JSON.parse(data.items);
    console.log("📦 Items to create:", items);

    // Validate all productIds exist (single batch query)
    const productIds = items.map((i) => i.productId);
    const existingProducts = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true },
    });
    const existingIds = new Set(existingProducts.map((p) => p.id));
    for (const item of items) {
      if (!existingIds.has(item.productId)) {
        throw new Error(
          `Product ID ${item.productId} not found. Item: ${item.productName}`,
        );
      }
    }
    // 🔒 StockMutex: serialize stock operations — tránh race condition Thẻ Kho
    const purchase = await withStockLock(() =>
      getPrismaDirectTx().$transaction(
        async (tx) => {
          // Generate standard PN-YYMMDD-XXX
          const today = new Date();
          const dateStr = today.toISOString().slice(2, 10).replace(/-/g, "");
          const prefix = `PN-${dateStr}-`;

          const lastOrder = await tx.purchaseOrder.findFirst({
            where: { poNumber: { startsWith: prefix } },
            orderBy: { poNumber: "desc" },
            select: { poNumber: true },
          });

          let nextNum = 1;
          if (lastOrder && lastOrder.poNumber) {
            const lastNumStr = lastOrder.poNumber.replace(prefix, "");
            const lastNum = parseInt(lastNumStr, 10);
            if (!isNaN(lastNum)) nextNum = lastNum + 1;
          }
          const generatedPoNumber = `${prefix}${String(nextNum).padStart(3, "0")}`;

          const newOrder = await tx.purchaseOrder.create({
            data: {
              poNumber: generatedPoNumber,
              supplierId,
              status: data.status || "completed",
              subtotal: data.totalAmount,
              total: data.totalAmount,
              note: data.notes,
              receivedAt: new Date(data.purchaseDate),
              createdBy: data.createdBy || "Admin",
              importReceiptStatus: "uploaded",
              importReceiptFile: null,
              importReceiptDriveUrl: receiptDriveUrls.join("\n"),
              vatInvoiceStatus: data.isThht
                ? "thht"
                : data.isNoVat
                  ? "no_vat"
                  : "pending", // 📦 THHT / Không VAT flag
              items: {
                create: items.map((item) => ({
                  productId: item.productId,
                  quantity: item.quantity,
                  price: item.unitPrice,
                  subtotal: item.total,
                  variantSku: item.variantSku || null,
                  color: item.color || null,
                })),
              },
            },
            include: { supplier: true, items: true },
          });

          // 🌟 Lấy map Product SKU để cập nhật tồn
          const purchaseProducts = await tx.product.findMany({
            where: { id: { in: productIds } },
          });
          const productMap = new Map(purchaseProducts.map((p) => [p.id, p]));

          for (const item of items) {
            const product = productMap.get(item.productId);
            if (!product) continue;

            const skuToUpdate = item.variantSku || product.sku;
            if (!skuToUpdate) continue;

            // 🌟 Gọi hàm Mệnh lệnh tối cao để tăng tồn kho an toàn & sinh thẻ kho
            await updateProductStockInTx(tx, skuToUpdate, item.quantity, {
              type: "purchase",
              referenceType: "NHAP",
              reference: newOrder.poNumber,
              note: `Nhập hàng: ${item.productName || product.name} x${item.quantity}`,
              createdBy: data.createdBy || "Admin",
            });
          }

          return newOrder;
        },
        { timeout: 60000, maxWait: 10000 },
      ),
    );

    emitStockChangedForSkus(
      items.map((item) => item.variantSku || item.sku),
      {
        referenceType: "NHAP",
        reference: purchase.poNumber,
      },
    );

    // PurchaseItem has no free-text company column. Persist the explicitly
    // selected group per receipt line in AppConfig and return it on reads.
    try {
      const purchaseItemCompanies = await getPurchaseItemCompanies();
      const savedItems = [...(purchase.items || [])].sort(
        (a, b) => Number(a.id) - Number(b.id),
      );
      purchaseItemCompanies[String(purchase.id)] = {
        byItemId: Object.fromEntries(
          savedItems
            .map((savedItem, index) => [
              getPurchaseItemCompanyKey(savedItem),
              String(items[index]?.companyGroup || "").trim(),
            ])
            .filter(([, company]) => company),
        ),
      };
      await savePurchaseItemCompanies(purchaseItemCompanies);
    } catch (companyError) {
      console.error("Could not save purchase item companies:", companyError);
    }
    try {
      await savePurchaseItemPackaging(purchase.id, items);
    } catch (packagingError) {
      console.error("Could not save purchase item packaging:", packagingError);
    }

    console.log(`✅ Created purchase order: ${purchase.poNumber}`);
    void logActivity({
      module: "purchases",
      action: "CREATE",
      description: `Tạo phiếu nhập ${purchase.poNumber} - ${new Intl.NumberFormat("vi-VN").format(data.totalAmount)}đ`,
      recordName: purchase.poNumber,
      userName: data.createdBy || "Admin",
    });

    return { success: true, data: purchase };
  } catch (error) {
    // The database write did not complete, so remove documents uploaded
    // solely for this failed create attempt.
    if (uploadedReceiptFileIds.length > 0) {
      try {
        const drive = getDriveClient();
        if (drive)
          await Promise.all(
            uploadedReceiptFileIds.map((fileId) =>
              drive.files.delete({ fileId }).catch(() => null),
            ),
          );
      } catch (cleanupError) {
        console.error(
          "Could not clean up receipt files after failed purchase create:",
          cleanupError,
        );
      }
    }
    console.error("❌ Create purchase error:", error);
    return { success: false, error: error.message };
  }
});

// Update purchase
ipcMain.handle("purchases:update", async (event, { id, data }) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");

    const supplierId = Number(data?.supplierId);
    if (!Number.isInteger(supplierId) || supplierId <= 0) {
      throw new Error(
        "Vui lòng chọn nhà cung cấp hợp lệ trước khi lưu phiếu nhập.",
      );
    }
    const [existingPurchase, supplier] = await Promise.all([
      prisma.purchaseOrder.findUnique({
        where: { id: Number(id) },
        select: { id: true },
      }),
      prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { id: true, status: true },
      }),
    ]);
    if (!existingPurchase) throw new Error("Không tìm thấy phiếu nhập.");
    if (!supplier || supplier.status === "inactive")
      throw new Error("Nhà cung cấp không tồn tại hoặc đã ngừng sử dụng.");

    let nextItems;
    try {
      nextItems = JSON.parse(data.items || "[]");
    } catch {
      throw new Error("Danh sách sản phẩm của phiếu nhập không hợp lệ.");
    }
    if (!Array.isArray(nextItems) || nextItems.length === 0) {
      throw new Error("Phiếu nhập phải có ít nhất một sản phẩm.");
    }
    if (
      nextItems.some(
        (item) =>
          !Number.isInteger(Number(item?.productId)) ||
          Number(item?.quantity) <= 0,
      )
    ) {
      throw new Error("Mỗi sản phẩm phải có mã hợp lệ và số lượng lớn hơn 0.");
    }

    // Reconcile stock by the net change (new quantity minus the previous
    // quantity) and replace the receipt lines in the same transaction.
    // The former implementation only updated the header, so edits to a
    // SKU quantity appeared successful but were never persisted.
    const purchase = await withStockLock(() =>
      getPrismaDirectTx().$transaction(
        async (tx) => {
          const order = await tx.purchaseOrder.findUnique({
            where: { id: Number(id) },
            include: { items: true },
          });
          if (!order) throw new Error("Không tìm thấy phiếu nhập.");
          if (order.status === "cancelled")
            throw new Error("Không thể sửa phiếu nhập đã hủy.");

          const productIds = [
            ...new Set([
              ...order.items.map((item) => Number(item.productId)),
              ...nextItems.map((item) => Number(item.productId)),
            ]),
          ];
          const products = await tx.product.findMany({
            where: { id: { in: productIds } },
          });
          const productMap = new Map(
            products.map((product) => [product.id, product]),
          );
          if (productMap.size !== productIds.length)
            throw new Error("Có sản phẩm trong phiếu không còn tồn tại.");

          const stockDeltas = new Map();
          const addStockDelta = (item, multiplier) => {
            const product = productMap.get(Number(item.productId));
            const sku = item.variantSku || product?.sku;
            if (!sku)
              throw new Error(
                `Sản phẩm "${product?.name || item.productId}" chưa có SKU.`,
              );
            stockDeltas.set(
              sku,
              (stockDeltas.get(sku) || 0) + Number(item.quantity) * multiplier,
            );
          };
          order.items.forEach((item) => addStockDelta(item, -1));
          nextItems.forEach((item) => addStockDelta(item, 1));

          for (const [sku, delta] of stockDeltas) {
            if (!delta) continue;
            await updateProductStockInTx(tx, sku, delta, {
              type: "adjustment",
              referenceType: "NHAP_EDIT",
              reference: order.poNumber,
              note: `Điều chỉnh theo sửa phiếu nhập ${order.poNumber}: ${delta > 0 ? "+" : ""}${delta}`,
              createdBy: currentSession.username,
            });
          }

          await tx.purchaseItem.deleteMany({
            where: { purchaseOrderId: order.id },
          });
          return tx.purchaseOrder.update({
            where: { id: order.id },
            data: {
              supplierId,
              status: data.status,
              subtotal: Number(data.totalAmount || 0),
              total: Number(data.totalAmount || 0),
              note: data.notes,
              receivedAt: new Date(data.purchaseDate),
              // Only an explicit positive flag changes VAT state. A normal
              // edit must preserve an already-uploaded invoice.
              ...(data.isThht === true
                ? { vatInvoiceStatus: "thht" }
                : data.isNoVat === true
                  ? { vatInvoiceStatus: "no_vat" }
                  : {}),
              items: {
                create: nextItems.map((item) => ({
                  productId: Number(item.productId),
                  quantity: Number(item.quantity),
                  price: Number(item.unitPrice || 0),
                  subtotal: Number(item.total || 0),
                  variantSku: item.variantSku || null,
                  color: item.color || null,
                })),
              },
            },
            include: { supplier: true, items: true },
          });
        },
        { timeout: 60000, maxWait: 10000 },
      ),
    );

    console.log(`✅ Updated purchase order: ${purchase.poNumber}`);
    emitStockChangedForSkus(
      [...new Set(nextItems.map((item) => item.variantSku).filter(Boolean))],
      {
        referenceType: "NHAP_EDIT",
        reference: purchase.poNumber,
      },
    );
    try {
      await savePurchaseItemPackaging(purchase.id, nextItems);
    } catch (packagingError) {
      console.error(
        "Could not save updated purchase item packaging:",
        packagingError,
      );
    }
    void logActivity({
      module: "purchases",
      action: "UPDATE",
      description: `Cập nhật phiếu nhập ${purchase.poNumber}`,
      recordName: purchase.poNumber,
    });
    return { success: true, data: purchase };
  } catch (error) {
    console.error("❌ Update purchase error:", error);
    return { success: false, error: error.message };
  }
});

// One-time repair for purchase receipts created while the non-admin catalog did
// not expose import prices. Only zero-price rows are changed and every repair is
// recorded for audit.
ipcMain.handle("purchases:repairMissingPrices", async (event, purchaseId) => {
  try {
    requireRole("admin");
    const id = Number(purchaseId);
    if (!Number.isInteger(id) || id <= 0)
      throw new Error("Phiếu nhập không hợp lệ.");

    const result = await getPrismaDirectTx().$transaction(
      async (tx) => {
        const order = await tx.purchaseOrder.findUnique({
          where: { id },
          include: {
            items: {
              include: {
                product: { select: { id: true, cost: true, variants: true } },
              },
            },
          },
        });
        if (!order) throw new Error("Không tìm thấy phiếu nhập.");

        let repairedCount = 0;
        for (const item of order.items) {
          if (Number(item.price) > 0) continue;
          let suggestedPrice = Number(item.product?.cost || 0);
          if (item.variantSku) {
            const variant = parseJsonArray(item.product?.variants).find(
              (entry) => entry?.sku === item.variantSku,
            );
            suggestedPrice = Number(variant?.cost || 0);
          }
          if (!Number.isFinite(suggestedPrice) || suggestedPrice <= 0) continue;
          await tx.purchaseItem.update({
            where: { id: item.id },
            data: {
              price: suggestedPrice,
              subtotal: Number(item.quantity) * suggestedPrice,
            },
          });
          repairedCount += 1;
        }

        if (!repairedCount) return { order, repairedCount: 0 };
        const totals = await tx.purchaseItem.aggregate({
          where: { purchaseOrderId: order.id },
          _sum: { subtotal: true },
        });
        const total = Number(totals._sum.subtotal || 0);
        const updatedOrder = await tx.purchaseOrder.update({
          where: { id: order.id },
          data: { subtotal: total, total },
          include: {
            items: {
              include: {
                product: { select: { name: true, sku: true, unit: true } },
              },
            },
            supplier: true,
          },
        });
        return { order: updatedOrder, repairedCount };
      },
      { timeout: 30000, maxWait: 10000 },
    );

    if (result.repairedCount > 0) {
      void logActivity({
        module: "purchases",
        action: "REPAIR_MISSING_PRICES",
        description: `Khôi phục giá nhập cho ${result.repairedCount} dòng của phiếu ${result.order.poNumber}`,
        recordId: result.order.id,
        recordName: result.order.poNumber,
        userName: currentSession.username,
      });
    }
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Delete purchase (Soft-delete & Hoàn kho)
ipcMain.handle("purchases:delete", async (event, id) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");

    const purchaseId = Number(id);
    if (!Number.isInteger(purchaseId) || purchaseId <= 0) {
      throw new Error("Mã phiếu nhập không hợp lệ.");
    }

    console.log(`🗑️  Soft-deleting purchase order #${purchaseId}...`);

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseId },
      include: { items: true },
    });
    if (!order) throw new Error(`Không tìm thấy phiếu nhập #${id}`);
    if (order.status === "cancelled") return { success: true };
    const revertedSkus = order.items.map((item) => item.variantSku || item.sku);

    // 🔒 StockMutex: serialize stock operations — tránh race condition Thẻ Kho
    await withStockLock(() =>
      getPrismaDirectTx().$transaction(async (tx) => {
        const productIds = [...new Set(order.items.map((i) => i.productId))];
        const products = await tx.product.findMany({
          where: { id: { in: productIds } },
        });
        const productMap = new Map(products.map((p) => [p.id, p]));
        const quantitiesToRevert = new Map();
        for (const item of order.items) {
          const product = productMap.get(item.productId);
          const sku = item.variantSku || product?.sku;
          if (!sku) continue;
          quantitiesToRevert.set(
            sku,
            (quantitiesToRevert.get(sku) || 0) + Number(item.quantity || 0),
          );
        }

        const insufficientSkus = [];
        for (const [sku, quantity] of quantitiesToRevert) {
          const available = await getSkuStockForOrder(tx, sku);
          if (available < quantity)
            insufficientSkus.push(
              `${sku} (con ${available}, can hoan ${quantity})`,
            );
        }
        if (insufficientSkus.length > 0) {
          throw new Error(
            `Không thể hủy phiếu nhập ${order.poNumber} vì sẽ làm âm tồn: ${insufficientSkus.join("; ")}.`,
          );
        }

        // 1. Hoàn lượng tồn kho đã nhập (âm quantity) - ghi thẻ kho Reversal
        for (const item of order.items) {
          const product = productMap.get(item.productId);
          if (!product) continue;

          const skuToRevert = item.variantSku || product.sku;
          if (!skuToRevert) continue;

          await updateProductStockInTx(tx, skuToRevert, -item.quantity, {
            type: "adjustment",
            referenceType: "NHAP_CANCEL",
            reference: order.poNumber,
            note: `Hoàn tồn do hủy phiếu nhập ${order.poNumber}`,
            createdBy: "System",
          });
        }

        // 2. Chuyển trạng thái sang cancelled thay vì xóa vật lý khối item
        await tx.purchaseOrder.update({
          where: { id: purchaseId },
          data: { status: "cancelled" },
        });
      }),
    );

    console.log(`✅ Successfully cancelled purchase order #${id}`);
    emitStockChangedForSkus(revertedSkus, {
      referenceType: "NHAP_CANCEL",
      reference: order.poNumber,
    });
    void logActivity({
      module: "purchases",
      action: "DELETE",
      description: `Hủy phiếu nhập #${id}`,
      recordName: order.poNumber,
    });
    return { success: true };
  } catch (error) {
    console.error("❌ Delete purchase error:", error);
    console.error("   Error code:", error.code);
    console.error("   Error meta:", error.meta);
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
const VAT_DRIVE_FOLDER_NAME = "LUUTRU-HOADONVAT";
let vatDriveFolderId = null; // Cache folder ID

// Tìm hoặc tạo folder LUUTRU-HOADONVAT trên Drive
async function getOrCreateVatDriveFolder() {
  if (vatDriveFolderId) return vatDriveFolderId;
  const driveStatus = await ensureDriveReady();
  if (!driveStatus.success) return null;
  const drive = driveStatus.drive;

  try {
    // Tìm folder đã tồn tại
    const search = await drive.files.list({
      q: `name='${VAT_DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id)",
    });
    if (search.data.files && search.data.files.length > 0) {
      vatDriveFolderId = search.data.files[0].id;
      console.log(
        `📁 Found Drive folder ${VAT_DRIVE_FOLDER_NAME}: ${vatDriveFolderId}`,
      );
      return vatDriveFolderId;
    }

    // Tạo mới
    const folder = await drive.files.create({
      requestBody: {
        name: VAT_DRIVE_FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder",
      },
      fields: "id",
    });
    vatDriveFolderId = folder.data.id;
    console.log(
      `📁 Created Drive folder ${VAT_DRIVE_FOLDER_NAME}: ${vatDriveFolderId}`,
    );
    return vatDriveFolderId;
  } catch (err) {
    console.error("❌ VAT Drive folder error:", err.message);
    if (err.response) {
      console.error(
        "❌ Drive API response:",
        err.response.status,
        JSON.stringify(err.response.data),
      );
    }
    if (err.code) {
      console.error("❌ Drive error code:", err.code);
    }
    return null;
  }
}

const IMPORT_RECEIPT_DRIVE_FOLDER_NAME = "LUUTRU-PHIEUNHAPKHO";
let importReceiptDriveFolderId = null;

async function getOrCreateImportReceiptDriveFolder() {
  if (importReceiptDriveFolderId) return importReceiptDriveFolderId;
  const driveStatus = await ensureDriveReady();
  if (!driveStatus.success) return null;
  const drive = driveStatus.drive;

  try {
    const search = await drive.files.list({
      q: `name='${IMPORT_RECEIPT_DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id)",
    });
    if (search.data.files && search.data.files.length > 0) {
      importReceiptDriveFolderId = search.data.files[0].id;
      console.log(
        `📁 Found Drive folder ${IMPORT_RECEIPT_DRIVE_FOLDER_NAME}: ${importReceiptDriveFolderId}`,
      );
      return importReceiptDriveFolderId;
    }

    const folder = await drive.files.create({
      requestBody: {
        name: IMPORT_RECEIPT_DRIVE_FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder",
      },
      fields: "id",
    });
    importReceiptDriveFolderId = folder.data.id;
    console.log(
      `📁 Created Drive folder ${IMPORT_RECEIPT_DRIVE_FOLDER_NAME}: ${importReceiptDriveFolderId}`,
    );
    return importReceiptDriveFolderId;
  } catch (err) {
    console.error("❌ Import Receipt Drive folder error:", err.message);
    return null;
  }
}

// Gửi Telegram bằng bot HĐ cũ
function sendVatTelegramMessage(text) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      chat_id: VAT_TELEGRAM_CHAT,
      text,
      parse_mode: "HTML",
    });
    const options = {
      hostname: "api.telegram.org",
      path: `/bot${VAT_TELEGRAM_BOT}/sendMessage`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
      timeout: 5000,
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () =>
        resolve(
          res.statusCode === 200 ? { success: true } : { success: false },
        ),
      );
    });
    req.on("error", () => resolve({ success: false }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ success: false });
    });
    req.write(postData);
    req.end();
  });
}

// Gửi file qua Telegram bot HĐ cũ
function sendVatTelegramDocument(buffer, fileName, caption) {
  return new Promise((resolve) => {
    try {
      const boundary =
        "----FormBoundary" + Math.random().toString(36).substring(2);
      const parts = [];
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${VAT_TELEGRAM_CHAT}`,
      );
      if (caption)
        parts.push(
          `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}`,
        );
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      );

      const header = Buffer.from(parts.join("\r\n") + "\r\n", "utf-8");
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
      const fileBuffer = Buffer.isBuffer(buffer)
        ? buffer
        : Buffer.from(buffer, "utf-8");
      const body = Buffer.concat([header, fileBuffer, footer]);

      const options = {
        hostname: "api.telegram.org",
        path: `/bot${VAT_TELEGRAM_BOT}/sendDocument`,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
        timeout: 15000,
      };
      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve(
            res.statusCode === 200 ? { success: true } : { success: false },
          ),
        );
      });
      req.on("error", () => resolve({ success: false }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ success: false });
      });
      req.write(body);
      req.end();
    } catch {
      resolve({ success: false });
    }
  });
}

// Gửi email thông báo HĐ VAT qua Gmail (Nodemailer + OAuth2)
async function sendVatEmail(invoiceData) {
  try {
    const nodemailer = require("nodemailer");
    const tokenPath = ensureGoogleTokenPath();
    if (!fs.existsSync(tokenPath)) {
      console.warn("⚠️ No OAuth2 token — skip email");
      return { success: false };
    }
    const tokens = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
    const oauth2Client = new google.auth.OAuth2(
      OAUTH_CLIENT_ID,
      OAUTH_CLIENT_SECRET,
    );
    oauth2Client.setCredentials(tokens);

    // Lấy access token mới
    const { token } = await oauth2Client.getAccessToken();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: "yendao444@gmail.com",
        clientId: OAUTH_CLIENT_ID,
        clientSecret: OAUTH_CLIENT_SECRET,
        refreshToken: tokens.refresh_token,
        accessToken: token,
      },
    });

    const mailOptions = {
      from: '"Hệ thống Quản lý" <yendao444@gmail.com>',
      to: "yendao444@gmail.com",
      subject: `🧾 HĐ VAT mới: ${invoiceData.invoiceNumber} — ${invoiceData.supplierName}`,
      html: `
                <h2>🧾 Hóa đơn VAT nhà cung cấp</h2>
                <table style="border-collapse:collapse; font-size:14px;">
                    <tr><td style="padding:6px 12px;"><b>📋 Phiếu nhập:</b></td><td>#${invoiceData.purchaseId}</td></tr>
                    <tr><td style="padding:6px 12px;"><b>🏢 NCC:</b></td><td>${invoiceData.supplierName}</td></tr>
                    <tr><td style="padding:6px 12px;"><b>🔢 Số HĐ:</b></td><td>${invoiceData.invoiceNumber}</td></tr>
                    <tr><td style="padding:6px 12px;"><b>📅 Ngày:</b></td><td>${invoiceData.invoiceDate}</td></tr>
                    <tr><td style="padding:6px 12px;"><b>💰 Tổng tiền:</b></td><td>${invoiceData.totalAmount}</td></tr>
                    ${invoiceData.driveUrl ? `<tr><td style="padding:6px 12px;"><b>📎 Drive:</b></td><td><a href="${invoiceData.driveUrl}">Xem file</a></td></tr>` : ""}
                </table>
            `,
    };

    if (invoiceData.fileBuffer) {
      mailOptions.attachments = [
        {
          filename: invoiceData.fileName,
          content: invoiceData.fileBuffer,
        },
      ];
    }

    await transporter.sendMail(mailOptions);
    console.log("📧 VAT email sent successfully");
    return { success: true };
  } catch (err) {
    console.error("⚠️ VAT email error (non-blocking):", err.message);
    return { success: false, error: err.message };
  }
}

ipcMain.handle(
  "purchases:uploadCompanyVATInvoice",
  async (
    event,
    { purchaseId, companyGroup, invoiceNumber, invoiceDate, files = [] },
  ) => {
    try {
      if (!prisma) throw new Error("Prisma not available");
      requireRole("admin", "manager", "staff");
      const company = String(companyGroup || "").trim();
      if (!purchaseId || !company)
        throw new Error("Thiếu phiếu nhập hoặc công ty hàng hóa");
      if (!Array.isArray(files) || files.length === 0)
        throw new Error("Vui lòng chọn ít nhất 1 file hóa đơn VAT");

      const purchase = await prisma.purchaseOrder.findUnique({
        where: { id: Number(purchaseId) },
        include: { supplier: true },
      });
      if (!purchase)
        throw new Error(`Không tìm thấy phiếu nhập #${purchaseId}`);

      // VAT must be reachable by every machine. Do not save an "uploaded"
      // company invoice locally when Drive authentication has expired.
      const driveStatus = await ensureDriveReady();
      if (!driveStatus.success) throw new Error(driveStatus.error);
      const vatFolderId = await getOrCreateVatDriveFolder();
      if (!vatFolderId)
        throw new Error(
          driveLastErrorMessage ||
            "Không mở được thư mục Hóa đơn VAT trên Google Drive.",
        );

      const vatDir = path.join(app.getPath("userData"), "vat-invoices");
      if (!fs.existsSync(vatDir)) fs.mkdirSync(vatDir, { recursive: true });

      const safeCompany =
        company
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-zA-Z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "company";
      const localPaths = [];
      const driveUrls = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index] || {};
        const ext =
          String(file.fileName || "jpg")
            .split(".")
            .pop() || "jpg";
        const localFileName = `VAT_PO${purchaseId}_${safeCompany}_${Date.now()}_${index + 1}.${ext}`;
        const localPath = path.join(vatDir, localFileName);
        const fileBuffer = Buffer.from(file.fileBase64 || "", "base64");
        fs.writeFileSync(localPath, fileBuffer);
        localPaths.push(localPath);

        try {
          const driveFileName = `HD_VAT_${company}_PO${purchaseId}_${invoiceNumber || "no-number"}_${index + 1}.${ext}`;
          const uploaded = await uploadToDrive(
            driveStatus.drive,
            vatFolderId,
            driveFileName,
            fileBuffer,
            ext.toLowerCase() === "pdf" ? "application/pdf" : "image/jpeg",
          );
          if (!uploaded?.webViewLink)
            throw new Error(
              `Không tải được file HĐ VAT thứ ${index + 1} lên Google Drive.`,
            );
          driveUrls.push(uploaded.webViewLink);
        } catch (driveError) {
          console.error("Company VAT Drive upload failed:", driveError.message);
          throw driveError;
        }
      }

      const companyVat = await getPurchaseCompanyVat();
      const receiptVat = companyVat[String(purchaseId)] || {};
      receiptVat[company] = {
        status: "uploaded",
        invoiceNumber: String(invoiceNumber || "").trim(),
        invoiceDate: invoiceDate ? new Date(invoiceDate).toISOString() : null,
        localPaths,
        driveUrls,
        fileCount: files.length,
        updatedAt: new Date().toISOString(),
      };
      companyVat[String(purchaseId)] = receiptVat;
      await savePurchaseCompanyVat(companyVat);

      void logActivity({
        module: "purchases",
        action: "COMPANY_VAT_UPLOAD",
        description: `Upload HĐ VAT ${company} cho phiếu ${purchase.poNumber || "#" + purchaseId}`,
        userName: "System",
      });
      return {
        success: true,
        data: {
          localPaths,
          driveUrls,
          invoiceNumber: receiptVat[company].invoiceNumber,
        },
        driveWarning:
          driveUrls.length === 0
            ? "File đã lưu tại máy, nhưng chưa tải được lên Google Drive."
            : null,
      };
    } catch (error) {
      console.error("Upload company VAT invoice error:", error);
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "purchases:setCompanyVatStatus",
  async (event, { purchaseId, companyGroup, status }) => {
    try {
      if (!prisma) throw new Error("Prisma not available");
      requireRole("admin", "manager", "staff");
      const company = String(companyGroup || "").trim();
      const nextStatus = ["pending", "no_vat"].includes(status)
        ? status
        : "pending";
      if (!purchaseId || !company)
        throw new Error("Thiếu phiếu nhập hoặc công ty hàng hóa");
      const companyVat = await getPurchaseCompanyVat();
      const receiptVat = companyVat[String(purchaseId)] || {};
      receiptVat[company] = {
        ...(receiptVat[company] || {}),
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      };
      companyVat[String(purchaseId)] = receiptVat;
      await savePurchaseCompanyVat(companyVat);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "purchases:deleteCompanyVATInvoice",
  async (event, { purchaseId, companyGroup }) => {
    try {
      if (!prisma) throw new Error("Prisma not available");
      requireRole("admin", "manager", "staff");
      const id = String(purchaseId || "").trim();
      const company = String(companyGroup || "").trim();
      if (!id || !company)
        throw new Error("Thiếu phiếu nhập hoặc công ty hàng hóa.");
      const companyVat = await getPurchaseCompanyVat();
      const receiptVat = companyVat[id] || {};
      if (!receiptVat[company])
        return {
          success: false,
          error: "Không tìm thấy HĐ VAT của công ty này.",
        };
      delete receiptVat[company];
      if (Object.keys(receiptVat).length === 0) delete companyVat[id];
      else companyVat[id] = receiptVat;
      await savePurchaseCompanyVat(companyVat);
      void logActivity({
        module: "purchases",
        action: "COMPANY_VAT_DELETE",
        description: `Xóa HĐ VAT công ty ${company} của phiếu #${id}`,
        userName: currentSession?.username || "System",
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "purchases:uploadVATInvoice",
  async (
    event,
    {
      purchaseId,
      invoiceNumber,
      invoiceDate,
      files = [],
      fileBase64,
      fileName,
    },
  ) => {
    try {
      if (!prisma) throw new Error("Prisma not available");
      const vatFileMeta = await getPurchaseVatFileMeta();

      // 1. Lấy thông tin phiếu nhập
      const purchase = await prisma.purchaseOrder.findUnique({
        where: { id: purchaseId },
        include: { supplier: true },
      });
      if (!purchase)
        throw new Error(`Không tìm thấy phiếu nhập #${purchaseId}`);

      // Normalize: hỗ trợ cả nhiều file (files[]) và 1 file (fileBase64/fileName)
      const filesList =
        files.length > 0 ? files : fileBase64 ? [{ fileBase64, fileName }] : [];
      if (filesList.length === 0)
        throw new Error("Chưa chọn file Hóa đơn VAT.");

      const vatDriveStatus = await ensureDriveReady();
      if (!vatDriveStatus.success) throw new Error(vatDriveStatus.error);
      const vatFolderId = await getOrCreateVatDriveFolder();
      if (!vatFolderId)
        throw new Error(
          driveLastErrorMessage ||
            "Không mở được thư mục Hóa đơn VAT trên Google Drive.",
        );

      const userDataPath = app.getPath("userData");
      const vatDir = path.join(userDataPath, "vat-invoices");
      if (!fs.existsSync(vatDir)) fs.mkdirSync(vatDir, { recursive: true });

      const localPaths = [];
      const driveUrls = [];
      const savedBuffers = [];
      const savedFileNames = [];
      let primaryVatMeta = null;

      // 2. Lưu từng file local + upload Drive
      for (let i = 0; i < filesList.length; i++) {
        const { fileBase64: b64, fileName: fn } = filesList[i];
        const ext = (fn || "jpg").split(".").pop() || "jpg";
        const suffix = filesList.length > 1 ? `_${i + 1}` : "";
        const localFileName = `VAT_PO${purchaseId}_${Date.now()}${suffix}.${ext}`;
        const localPath = path.join(vatDir, localFileName);

        const fileBuffer = Buffer.from(b64, "base64");
        fs.writeFileSync(localPath, fileBuffer);
        console.log(
          `📁 Saved VAT invoice [${i + 1}/${filesList.length}]: ${localPath}`,
        );
        localPaths.push(localPath);
        savedBuffers.push(fileBuffer);
        savedFileNames.push(localFileName);
        if (i === 0) {
          primaryVatMeta = {
            fileName: fn || localFileName,
            fileSize: fileBuffer.length,
            vatId: generateVatIdFromFile(
              fn || localFileName,
              fileBuffer.length,
            ),
            updatedAt: new Date().toISOString(),
          };
        }

        // Upload lên Google Drive
        try {
          const drive = getDriveClient();
          if (drive) {
            const folderId = await getOrCreateVatDriveFolder();
            if (folderId) {
              const driveFileName = `HĐ_VAT_${purchase.supplier?.name || "NCC"}_PO${purchaseId}_${invoiceNumber}${suffix}.${ext}`;
              const result = await uploadToDrive(
                drive,
                folderId,
                driveFileName,
                fileBuffer,
                ext === "pdf" ? "application/pdf" : "image/jpeg",
              );
              if (result) {
                driveUrls.push(result.webViewLink);
                console.log(
                  `☁️ Uploaded to Drive [${i + 1}]: ${result.webViewLink}`,
                );
              } else {
                console.error(
                  `⚠️ Drive upload returned null for file ${i + 1}`,
                );
              }
            } else {
              console.error(
                "⚠️ Drive folder creation failed - folderId is null",
              );
            }
          } else {
            console.error(
              "⚠️ Google Drive client not available (token missing or expired)",
            );
          }
        } catch (driveErr) {
          console.error(
            `⚠️ Drive upload failed for file ${i + 1}:`,
            driveErr.message,
          );
        }
      }

      if (driveUrls.length !== filesList.length) {
        throw new Error(
          `Google Drive chỉ nhận ${driveUrls.length}/${filesList.length} file Hóa đơn VAT. Phiếu chưa được ghi nhận là đã upload.`,
        );
      }

      if (primaryVatMeta) {
        vatFileMeta[String(purchaseId)] = primaryVatMeta;
        await savePurchaseVatFileMeta(vatFileMeta);
      }

      // 3. Cập nhật DB
      const dbUpdate = {
        vatInvoiceNumber: invoiceNumber,
        vatInvoiceDate: new Date(invoiceDate),
        vatInvoiceStatus: "uploaded",
      };
      if (localPaths.length > 0) {
        dbUpdate.vatInvoiceFile =
          localPaths.length === 1 ? localPaths[0] : JSON.stringify(localPaths);
      }
      if (driveUrls.length > 0) {
        dbUpdate.vatInvoiceDriveUrl =
          driveUrls.length === 1 ? driveUrls[0] : driveUrls.join("\n");
      }
      await prisma.purchaseOrder.update({
        where: { id: purchaseId },
        data: dbUpdate,
      });

      // 4. Gá»­i Telegram
      const telegramMsg = [
        `🧾 <b>HĐ VAT mới — Nhập hàng</b>`,
        ``,
        `📋 Phiếu nhập: <b>#${purchaseId}</b>`,
        `🏢 NCC: <b>${purchase.supplier?.name || "N/A"}</b>`,
        `🔢 Số HĐ: <b>${invoiceNumber}</b>`,
        `📅 Ngày HĐ: <b>${new Date(invoiceDate).toLocaleDateString("vi-VN")}</b>`,
        `💰 Tổng tiền: <b>${purchase.total.toLocaleString("vi-VN")}đ</b>`,
        filesList.length > 1
          ? `📎 <b>${filesList.length} files đính kèm</b>`
          : "",
        driveUrls[0] ? `\n📎 <a href="${driveUrls[0]}">Xem trên Drive</a>` : "",
      ]
        .filter(Boolean)
        .join("\n");

      sendVatTelegramMessage(telegramMsg).catch((err) =>
        console.error("Telegram error:", err),
      );
      for (let i = 0; i < savedBuffers.length; i++) {
        sendVatTelegramDocument(
          savedBuffers[i],
          savedFileNames[i],
          `HĐ VAT #${invoiceNumber}${savedBuffers.length > 1 ? ` [${i + 1}/${savedBuffers.length}]` : ""} — ${purchase.supplier?.name || "NCC"}`,
        ).catch((err) => console.error("Telegram doc error:", err));
      }

      // 5. Gửi Email (file đầu tiên)
      if (savedBuffers.length > 0) {
        sendVatEmail({
          purchaseId,
          supplierName: purchase.supplier?.name || "N/A",
          invoiceNumber,
          invoiceDate: new Date(invoiceDate).toLocaleDateString("vi-VN"),
          totalAmount: purchase.total.toLocaleString("vi-VN") + "đ",
          driveUrl: driveUrls[0] || null,
          fileBuffer: savedBuffers[0],
          fileName: savedFileNames[0],
        }).catch((err) => console.error("Email error:", err));
      }

      void logActivity({
        module: "purchases",
        action: "VAT_UPLOAD",
        description: `Upload ${filesList.length} file HĐ VAT #${invoiceNumber} cho phiếu nhập #${purchaseId} (${purchase.supplier?.name})`,
        userName: "System",
      });

      const driveWarning =
        driveUrls.length === 0 && filesList.length > 0
          ? "⚠️ File đã lưu local + Telegram, nhưng Google Drive upload THẤT BẠI. Kiểm tra kết nối Google Drive."
          : null;
      if (driveWarning) console.warn(driveWarning);
      console.log(
        `✅ VAT invoice uploaded for PO#${purchaseId}: ${invoiceNumber} (${filesList.length} files, Drive: ${driveUrls.length > 0 ? "OK" : "FAILED"})`,
      );
      return {
        success: true,
        data: {
          localPaths,
          driveUrls,
          invoiceNumber,
          vatId: primaryVatMeta?.vatId || null,
        },
        driveWarning,
      };
    } catch (error) {
      console.error("❌ Upload VAT invoice error:", error);
      return { success: false, error: error.message };
    }
  },
);

// Upload Phiếu Nhập Kho
ipcMain.handle(
  "purchases:uploadImportReceipt",
  async (event, { purchaseId, files = [], fileBase64, fileName }) => {
    try {
      if (!prisma) throw new Error("Prisma not available");

      // 1. Lấy thông tin phiếu nhập
      const purchase = await prisma.purchaseOrder.findUnique({
        where: { id: purchaseId },
        include: { supplier: true },
      });
      if (!purchase)
        throw new Error(`Không tìm thấy phiếu nhập #${purchaseId}`);

      // Normalize: hỗ trợ cả nhiều file (files[]) và 1 file (fileBase64/fileName)
      const filesList =
        files.length > 0 ? files : fileBase64 ? [{ fileBase64, fileName }] : [];
      if (filesList.length === 0)
        throw new Error("Chưa chọn file Phiếu Nhập Kho.");

      const driveUrls = [];
      const driveFileIds = [];
      const driveStatus = await ensureDriveReady();
      if (!driveStatus.success) throw new Error(driveStatus.error);
      const drive = driveStatus.drive;
      const folderId = await getOrCreateImportReceiptDriveFolder();
      if (!folderId)
        throw new Error(
          driveLastErrorMessage ||
            "Không mở được thư mục Phiếu Nhập Kho trên Google Drive.",
        );

      // 2. Upload trực tiếp lên Drive; Phiếu Nhập Kho không dùng file local.
      for (let i = 0; i < filesList.length; i++) {
        const { fileBase64: b64, fileName: fn } = filesList[i];
        const ext = (fn || "jpg").split(".").pop() || "jpg";
        const suffix = filesList.length > 1 ? `_${i + 1}` : "";
        const fileBuffer = Buffer.from(b64, "base64");
        try {
          const driveFileName = `Phiếu_Nhập_${purchase.supplier?.name || "NCC"}_PO${purchaseId}${suffix}.${ext}`;
          const result = await uploadToDrive(
            drive,
            folderId,
            driveFileName,
            fileBuffer,
            ext === "pdf" ? "application/pdf" : "image/jpeg",
          );
          if (result?.fileId && result?.webViewLink) {
            driveFileIds.push(result.fileId);
            driveUrls.push(result.webViewLink);
            console.log(
              `☁️ Uploaded Receipt to Drive [${i + 1}]: ${result.webViewLink}`,
            );
          }
        } catch (driveErr) {
          console.error(
            `⚠️ Drive upload failed for Receipt file ${i + 1}:`,
            driveErr.message,
          );
        }
      }

      // 3. Cập nhật DB
      const driveUploadComplete = driveUrls.length === filesList.length;
      if (!driveUploadComplete) {
        // Không giữ một bộ chứng từ thiếu file trên Drive.
        await Promise.all(
          driveFileIds.map((fileId) =>
            drive.files.delete({ fileId }).catch(() => null),
          ),
        );
      }
      const dbUpdate = {
        importReceiptStatus: driveUploadComplete ? "uploaded" : "pending",
        importReceiptFile: null,
        importReceiptDriveUrl: driveUploadComplete
          ? driveUrls.join("\n")
          : null,
      };
      await prisma.purchaseOrder.update({
        where: { id: purchaseId },
        data: dbUpdate,
      });

      void logActivity({
        module: "purchases",
        action: "RECEIPT_UPLOAD",
        description: `Upload Phiếu Nhập của phiếu #${purchaseId} (${purchase.supplier?.name})`,
        userName: "System",
      });

      if (!driveUploadComplete) {
        return {
          success: false,
          data: { localPaths: [], driveUrls: [] },
          error: `Google Drive chỉ nhận ${driveUrls.length}/${filesList.length} file nên phiếu chưa được ghi nhận là đã upload. Vui lòng tải lại.`,
        };
      }
      return { success: true, data: { localPaths: [], driveUrls } };
    } catch (error) {
      console.error("❌ Upload Import Receipt error:", error);
      return { success: false, error: error.message };
    }
  },
);

// Xóa Phiếu Nhập Kho
ipcMain.handle("purchases:deleteImportReceipt", async (event, purchaseId) => {
  try {
    if (!prisma) throw new Error("Prisma not available");
    const purchase = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseId },
      include: { supplier: true },
    });
    if (!purchase) throw new Error(`Không tìm thấy phiếu nhập #${purchaseId}`);

    // Chỉ cập nhật DB để bỏ mapping
    await prisma.purchaseOrder.update({
      where: { id: purchaseId },
      data: {
        importReceiptStatus: "pending",
        importReceiptFile: null,
        importReceiptDriveUrl: null,
      },
    });

    void logActivity({
      module: "purchases",
      action: "RECEIPT_DELETE",
      description: `Xóa Phiếu Nhập của phiếu #${purchaseId} (${purchase.supplier?.name})`,
      userName: "System",
    });

    return { success: true };
  } catch (error) {
    console.error("❌ Delete Import Receipt error:", error);
    return { success: false, error: error.message };
  }
});
// Đánh dấu phiếu nhập là "Đơn THHT" (không cần HĐ VAT)
// Xóa HĐ VAT của phiếu nhập (đơn lẻ, không thuộc nhóm gộp)
ipcMain.handle("purchases:deleteVatInvoice", async (event, purchaseId) => {
  try {
    if (!prisma) throw new Error("Prisma not available");
    const purchase = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseId },
      include: { supplier: true },
    });
    if (!purchase) throw new Error(`Không tìm thấy phiếu nhập #${purchaseId}`);

    await prisma.purchaseOrder.update({
      where: { id: purchaseId },
      data: {
        vatInvoiceStatus: "pending",
        vatInvoiceNumber: null,
        vatInvoiceDate: null,
        vatInvoiceFile: null,
        vatInvoiceDriveUrl: null,
      },
    });

    // Xóa vatFileMeta để VAT ID không còn hiển thị
    const vatFileMeta = await getPurchaseVatFileMeta();
    if (vatFileMeta[String(purchaseId)]) {
      delete vatFileMeta[String(purchaseId)];
      await savePurchaseVatFileMeta(vatFileMeta);
    }

    void logActivity({
      module: "purchases",
      action: "VAT_DELETE",
      description: `Xóa HĐ VAT của phiếu #${purchaseId} (${purchase.supplier?.name})`,
      userName: "System",
    });

    return { success: true };
  } catch (error) {
    console.error("❌ Delete VAT Invoice error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  "purchases:markAsThht",
  async (event, { purchaseId, revert }) => {
    try {
      if (!prisma) throw new Error("Prisma not available");
      requireRole("admin", "manager", "staff");
      await prisma.purchaseOrder.update({
        where: { id: purchaseId },
        data: { vatInvoiceStatus: revert ? "pending" : "thht" },
      });
      void logActivity({
        module: "purchases",
        action: revert ? "THHT_REVERT" : "THHT_MARK",
        description: `${revert ? "Hoàn tác" : "Đánh dấu"} phiếu nhập #${purchaseId} là Đơn THHT`,
        userName: "System",
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

// 👁️ Đọc file HĐ VAT local → trả về base64 data URL để hiển thị trong app
ipcMain.handle("purchases:getVATFileData", async (event, { purchaseId }) => {
  try {
    if (!prisma) throw new Error("Prisma not available");
    const purchase = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseId },
    });
    if (!purchase || !purchase.vatInvoiceFile) {
      return { success: false, error: "Không tìm thấy file HĐ VAT" };
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
      const ext = path.extname(fp).toLowerCase().replace(".", "");
      const mimeType =
        ext === "pdf"
          ? "application/pdf"
          : `image/${ext === "jpg" ? "jpeg" : ext}`;
      const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
      filesData.push({ dataUrl, fileName: path.basename(fp), mimeType, ext });
    }

    if (filesData.length === 0) {
      return { success: false, error: "File không tồn tại trên máy" };
    }

    return { success: true, data: filesData };
  } catch (error) {
    console.error("❌ Get VAT file data error:", error);
    return { success: false, error: error.message };
  }
});

// 👁️ Đọc file Phiếu Nhập Kho local → trả về base64 data URL để hiển thị trong app
ipcMain.handle(
  "purchases:getImportReceiptFileData",
  async (event, { purchaseId }) => {
    return {
      success: false,
      error:
        "Phiếu Nhập Kho chỉ được xem từ Google Drive; ứng dụng không còn sử dụng file local.",
    };
  },
);

// ========================================
// SUPPLIERS HANDLERS
// ========================================

const GOODS_COMPANIES_CONFIG_KEY = "goodsCompanies";

async function readGoodsCompanies() {
  const config = await prisma.appConfig.findUnique({
    where: { key: GOODS_COMPANIES_CONFIG_KEY },
  });
  try {
    const companies = JSON.parse(config?.value || "[]");
    return Array.isArray(companies)
      ? companies
          .filter(
            (company) => company?.id && String(company?.name || "").trim(),
          )
          .map((company) => ({
            ...company,
            name: repairLegacyCompanyName(company.name),
          }))
      : [];
  } catch {
    return [];
  }
}

async function writeGoodsCompanies(companies) {
  await prisma.appConfig.upsert({
    where: { key: GOODS_COMPANIES_CONFIG_KEY },
    create: {
      key: GOODS_COMPANIES_CONFIG_KEY,
      value: JSON.stringify(companies),
    },
    update: { value: JSON.stringify(companies) },
  });
}

// Goods companies / product brands. Persisted in AppConfig so it works with
// the deployed database permissions without adding a new table.
ipcMain.handle("goodsCompanies:getAll", async () => {
  try {
    if (!prisma) throw new Error("Prisma not available");
    const companies = await readGoodsCompanies();
    companies.sort((a, b) =>
      String(a.name).localeCompare(String(b.name), "vi"),
    );
    return { success: true, data: companies };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Luôn đọc nguồn xem phiếu mới nhất từ DB thay vì dùng record cũ đang giữ trong modal.
ipcMain.handle(
  "purchases:getImportReceiptPreviewData",
  async (event, { purchaseId }) => {
    try {
      if (!prisma) throw new Error("Prisma not available");
      const purchase = await prisma.purchaseOrder.findUnique({
        where: { id: Number(purchaseId) },
        select: { importReceiptFile: true, importReceiptDriveUrl: true },
      });
      if (!purchase)
        return { success: false, error: "Không tìm thấy phiếu nhập kho." };

      const driveUrls = String(purchase.importReceiptDriveUrl || "")
        .split("\n")
        .map((url) => url.trim())
        .filter(Boolean);
      if (driveUrls.length > 0)
        return { success: true, data: { driveUrls, localFiles: [] } };
      return {
        success: false,
        error: "Phiếu chưa được upload thành công lên Google Drive.",
      };
    } catch (error) {
      console.error("❌ Get Import Receipt preview data error:", error);
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle("goodsCompanies:create", async (event, data) => {
  try {
    if (!prisma) throw new Error("Prisma not available");
    const name = String(data?.name || "").trim();
    if (!name)
      return { success: false, error: "Tên công ty không được để trống." };
    const companies = await readGoodsCompanies();
    if (
      companies.some(
        (company) =>
          String(company.name).toLocaleLowerCase("vi") ===
          name.toLocaleLowerCase("vi"),
      )
    ) {
      return { success: false, error: "Tên công ty đã tồn tại." };
    }
    const company = {
      id: `goods-company-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
    };
    companies.push(company);
    await writeGoodsCompanies(companies);
    return { success: true, data: company };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("goodsCompanies:update", async (event, id, data) => {
  try {
    if (!prisma) throw new Error("Prisma not available");
    const name = String(data?.name || "").trim();
    if (!name)
      return { success: false, error: "Tên công ty không được để trống." };
    const companies = await readGoodsCompanies();
    const company = companies.find((entry) => entry.id === id);
    if (!company)
      return { success: false, error: "Không tìm thấy công ty hàng hóa." };
    if (
      companies.some(
        (entry) =>
          entry.id !== id &&
          String(entry.name).toLocaleLowerCase("vi") ===
            name.toLocaleLowerCase("vi"),
      )
    ) {
      return { success: false, error: "Tên công ty đã tồn tại." };
    }
    company.name = name;
    await writeGoodsCompanies(companies);
    return { success: true, data: company };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("goodsCompanies:delete", async (event, id) => {
  try {
    if (!prisma) throw new Error("Prisma not available");
    const companies = await readGoodsCompanies();
    const nextCompanies = companies.filter((company) => company.id !== id);
    if (nextCompanies.length === companies.length)
      return { success: false, error: "Không tìm thấy công ty hàng hóa." };
    await writeGoodsCompanies(nextCompanies);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// One catalogue product belongs to one goods company/brand.  The association
// lives beside the company configuration instead of on Product so existing
// installations do not require a destructive schema migration.
ipcMain.handle(
  "goodsCompanies:setProductCompany",
  async (event, { productId, companyId }) => {
    try {
      if (!prisma) throw new Error("Prisma not available");
      const normalizedProductId = Number(productId);
      if (!Number.isInteger(normalizedProductId) || normalizedProductId <= 0) {
        return { success: false, error: "Sản phẩm không hợp lệ." };
      }

      const companies = await readGoodsCompanies();
      let selectedCompany = null;
      if (companyId) {
        selectedCompany = companies.find((company) => company.id === companyId);
        if (!selectedCompany)
          return { success: false, error: "Không tìm thấy công ty hàng hóa." };
      }

      const nextCompanies = companies.map((company) => {
        const productIds = Array.isArray(company.productIds)
          ? company.productIds.map(Number).filter(Number.isInteger)
          : [];
        const withoutProduct = productIds.filter(
          (id) => id !== normalizedProductId,
        );
        return company.id === companyId
          ? { ...company, productIds: [...withoutProduct, normalizedProductId] }
          : { ...company, productIds: withoutProduct };
      });
      await writeGoodsCompanies(nextCompanies);
      return {
        success: true,
        data: selectedCompany
          ? { companyId: selectedCompany.id, companyName: selectedCompany.name }
          : null,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

// Get all suppliers
ipcMain.handle("suppliers:getAll", async () => {
  try {
    if (!prisma) throw new Error("Prisma not available");

    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: "asc" },
    });

    return { success: true, data: suppliers };
  } catch (error) {
    console.error("❌ Get suppliers error:", error);
    return { success: false, error: error.message };
  }
});

// Create supplier
ipcMain.handle("suppliers:create", async (event, data) => {
  try {
    if (!prisma) throw new Error("Prisma not available");

    const supplier = await prisma.supplier.create({
      data: {
        code: data.code || `SUP${Date.now()}`,
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        address: data.address || null,
        taxCode: data.taxCode || null,
        status: data.status || "active",
      },
    });

    console.log(`✅ Created supplier: ${supplier.name}`);
    void logActivity({
      module: "purchases",
      action: "CREATE",
      description: `Tạo NCC "${supplier.name}"`,
      recordName: supplier.name,
    });
    return { success: true, data: supplier };
  } catch (error) {
    console.error("❌ Create supplier error:", error);
    return { success: false, error: error.message };
  }
});

// Update supplier
ipcMain.handle("suppliers:update", async (event, id, data) => {
  try {
    if (!prisma) throw new Error("Prisma not available");

    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        code: data.code,
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        address: data.address || null,
        taxCode: data.taxCode || null,
        status: data.status || "active",
      },
    });

    console.log(`✅ Updated supplier: ${supplier.name}`);
    void logActivity({
      module: "purchases",
      action: "UPDATE",
      description: `Cập nhật NCC "${supplier.name}"`,
      recordName: supplier.name,
    });
    return { success: true, data: supplier };
  } catch (error) {
    console.error("❌ Update supplier error:", error);
    return { success: false, error: error.message };
  }
});

// Delete supplier
ipcMain.handle("suppliers:delete", async (event, id) => {
  try {
    if (!prisma) throw new Error("Prisma not available");

    // Kiểm tra xem có phiếu nhập nào đang dùng supplier này không
    const purchaseCount = await prisma.purchaseOrder.count({
      where: { supplierId: id },
    });

    if (purchaseCount > 0) {
      return {
        success: false,
        error: `Không thể xóa! Nhà cung cấp này đang được sử dụng trong ${purchaseCount} phiếu nhập.`,
      };
    }

    await prisma.supplier.delete({
      where: { id },
    });

    console.log(`✅ Deleted supplier #${id}`);
    void logActivity({
      module: "purchases",
      action: "DELETE",
      description: `Xóa nhà cung cấp #${id}`,
    });
    return { success: true };
  } catch (error) {
    console.error("❌ Delete supplier error:", error);

    // Xử lý lỗi foreign key constraint
    if (error.code === "P2003") {
      return {
        success: false,
        error:
          "Không thể xóa! Nhà cung cấp đang được sử dụng trong các phiếu nhập.",
      };
    }

    return { success: false, error: error.message };
  }
});

// ========================================
// DATABASE EXPORT/IMPORT HANDLERS
// ========================================

// Export all database to Excel
ipcMain.handle("database:exportAll", async () => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");

    console.log("📤 Starting database export...");

    // Query all data from Prisma
    const [
      categories,
      products,
      suppliers,
      purchaseOrders,
      purchaseItems,
      customers,
      orders,
      orderItems,
      payments,
      users,
      expenses,
      inventoryLogs,
      activityLogs,
    ] = await Promise.all([
      prisma.category.findMany({ orderBy: { id: "asc" } }),
      prisma.product.findMany({ orderBy: { id: "asc" } }),
      prisma.supplier.findMany({ orderBy: { id: "asc" } }),
      prisma.purchaseOrder.findMany({ orderBy: { id: "desc" }, take: 2000 }),
      prisma.purchaseItem.findMany({ orderBy: { id: "desc" }, take: 5000 }),
      prisma.customer.findMany({ orderBy: { id: "asc" } }),
      prisma.order.findMany({ orderBy: { id: "desc" }, take: 5000 }),
      prisma.orderItem.findMany({ orderBy: { id: "desc" }, take: 10000 }),
      prisma.payment.findMany({ orderBy: { id: "desc" }, take: 5000 }),
      prisma.user.findMany({ orderBy: { id: "asc" } }),
      prisma.expense.findMany({ orderBy: { id: "desc" }, take: 2000 }),
      prisma.inventoryLog.findMany({ orderBy: { id: "desc" }, take: 1000 }),
      prisma.activityLog.findMany({ orderBy: { id: "desc" }, take: 1000 }),
    ]);

    console.log(
      `  ✅ Queried data: ${categories.length} categories, ${products.length} products, ${suppliers.length} suppliers`,
    );

    // Remove passwords from users for security
    const usersWithoutPasswords = users.map((user) => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });

    // Create Excel workbook
    const wb = XLSX.utils.book_new();

    // Helper function to convert Date objects to ISO strings for Excel
    const sanitizeForExcel = (data) => {
      return data.map((row) => {
        const sanitized = {};
        for (const [key, value] of Object.entries(row)) {
          if (value instanceof Date) {
            sanitized[key] = value.toISOString();
          } else if (value === null) {
            sanitized[key] = "";
          } else {
            sanitized[key] = value;
          }
        }
        return sanitized;
      });
    };

    // Add sheets with sanitized data
    const wsCategories = XLSX.utils.json_to_sheet(sanitizeForExcel(categories));
    XLSX.utils.book_append_sheet(wb, wsCategories, "Categories");

    const wsProducts = XLSX.utils.json_to_sheet(sanitizeForExcel(products));
    XLSX.utils.book_append_sheet(wb, wsProducts, "Products");

    const wsSuppliers = XLSX.utils.json_to_sheet(sanitizeForExcel(suppliers));
    XLSX.utils.book_append_sheet(wb, wsSuppliers, "Suppliers");

    const wsPurchaseOrders = XLSX.utils.json_to_sheet(
      sanitizeForExcel(purchaseOrders),
    );
    XLSX.utils.book_append_sheet(wb, wsPurchaseOrders, "PurchaseOrders");

    const wsPurchaseItems = XLSX.utils.json_to_sheet(
      sanitizeForExcel(purchaseItems),
    );
    XLSX.utils.book_append_sheet(wb, wsPurchaseItems, "PurchaseItems");

    const wsCustomers = XLSX.utils.json_to_sheet(sanitizeForExcel(customers));
    XLSX.utils.book_append_sheet(wb, wsCustomers, "Customers");

    const wsOrders = XLSX.utils.json_to_sheet(sanitizeForExcel(orders));
    XLSX.utils.book_append_sheet(wb, wsOrders, "Orders");

    const wsOrderItems = XLSX.utils.json_to_sheet(sanitizeForExcel(orderItems));
    XLSX.utils.book_append_sheet(wb, wsOrderItems, "OrderItems");

    const wsPayments = XLSX.utils.json_to_sheet(sanitizeForExcel(payments));
    XLSX.utils.book_append_sheet(wb, wsPayments, "Payments");

    const wsUsers = XLSX.utils.json_to_sheet(
      sanitizeForExcel(usersWithoutPasswords),
    );
    XLSX.utils.book_append_sheet(wb, wsUsers, "Users");

    const wsExpenses = XLSX.utils.json_to_sheet(sanitizeForExcel(expenses));
    XLSX.utils.book_append_sheet(wb, wsExpenses, "Expenses");

    const wsInventoryLogs = XLSX.utils.json_to_sheet(
      sanitizeForExcel(inventoryLogs),
    );
    XLSX.utils.book_append_sheet(wb, wsInventoryLogs, "InventoryLogs");

    const wsActivityLogs = XLSX.utils.json_to_sheet(
      sanitizeForExcel(activityLogs),
    );
    XLSX.utils.book_append_sheet(wb, wsActivityLogs, "ActivityLogs");

    // Show save dialog
    const { filePath } = await dialog.showSaveDialog({
      title: "Lưu file sao lưu dữ liệu",
      defaultPath: `DataBackup_${new Date().toISOString().split("T")[0]}.xlsx`,
      filters: [{ name: "Excel Files", extensions: ["xlsx"] }],
    });

    if (!filePath) {
      console.log("❌ User cancelled save dialog");
      return { success: false, error: "User cancelled" };
    }

    // Write file
    XLSX.writeFile(wb, filePath);
    console.log(`✅ Database exported successfully to: ${filePath}`);

    // Log activity
    await prisma.activityLog.create({
      data: {
        module: "database",
        action: "EXPORT",
        description: `Exported database to ${path.basename(filePath)}`,
        userName: "System",
        severity: "INFO",
        timestamp: new Date(),
      },
    });

    return { success: true, data: filePath };
  } catch (error) {
    console.error("❌ Database export error:", error);
    return { success: false, error: error.message };
  }
});

// Import all database from Excel
ipcMain.handle("database:importAll", async () => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");

    console.log("📥 Starting database import...");

    // Show open dialog
    const { filePaths } = await dialog.showOpenDialog({
      title: "Chọn file sao lưu để nhập",
      filters: [{ name: "Excel Files", extensions: ["xlsx"] }],
      properties: ["openFile"],
    });

    if (!filePaths || filePaths.length === 0) {
      console.log("❌ User cancelled open dialog");
      return { success: false, error: "No file selected" };
    }

    const filePath = filePaths[0];
    console.log(`📂 Reading file: ${filePath}`);

    // Read Excel file
    const wb = XLSX.readFile(filePath);

    // Parse sheets to JSON
    const categories = wb.Sheets["Categories"]
      ? XLSX.utils.sheet_to_json(wb.Sheets["Categories"])
      : [];
    const products = wb.Sheets["Products"]
      ? XLSX.utils.sheet_to_json(wb.Sheets["Products"])
      : [];
    const suppliers = wb.Sheets["Suppliers"]
      ? XLSX.utils.sheet_to_json(wb.Sheets["Suppliers"])
      : [];
    const purchaseOrders = wb.Sheets["PurchaseOrders"]
      ? XLSX.utils.sheet_to_json(wb.Sheets["PurchaseOrders"])
      : [];
    const purchaseItems = wb.Sheets["PurchaseItems"]
      ? XLSX.utils.sheet_to_json(wb.Sheets["PurchaseItems"])
      : [];
    const customers = wb.Sheets["Customers"]
      ? XLSX.utils.sheet_to_json(wb.Sheets["Customers"])
      : [];
    const orders = wb.Sheets["Orders"]
      ? XLSX.utils.sheet_to_json(wb.Sheets["Orders"])
      : [];
    const orderItems = wb.Sheets["OrderItems"]
      ? XLSX.utils.sheet_to_json(wb.Sheets["OrderItems"])
      : [];
    const payments = wb.Sheets["Payments"]
      ? XLSX.utils.sheet_to_json(wb.Sheets["Payments"])
      : [];
    const expenses = wb.Sheets["Expenses"]
      ? XLSX.utils.sheet_to_json(wb.Sheets["Expenses"])
      : [];

    console.log(
      `  ✅ Parsed data: ${categories.length} categories, ${products.length} products, ${suppliers.length} suppliers`,
    );

    // Import with transaction
    const result = await prisma.$transaction(async (tx) => {
      const stats = {
        categories: 0,
        products: 0,
        suppliers: 0,
        purchases: 0,
        customers: 0,
        orders: 0,
        expenses: 0,
      };

      // 1. Import Categories (parent categories first, then children)
      const parentCategories = categories.filter((c) => !c.parentId);
      const childCategories = categories.filter((c) => c.parentId);

      for (const cat of parentCategories) {
        await tx.category.upsert({
          where: { id: cat.id },
          update: {
            name: cat.name,
            description: cat.description || null,
            updatedAt: new Date(),
          },
          create: {
            id: cat.id,
            name: cat.name,
            description: cat.description || null,
            createdAt: cat.createdAt ? new Date(cat.createdAt) : new Date(),
            updatedAt: new Date(),
          },
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
            updatedAt: new Date(),
          },
          create: {
            id: cat.id,
            name: cat.name,
            description: cat.description || null,
            parentId: cat.parentId || null,
            createdAt: cat.createdAt ? new Date(cat.createdAt) : new Date(),
            updatedAt: new Date(),
          },
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
            status: sup.status || "active",
            updatedAt: new Date(),
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
            status: sup.status || "active",
            createdAt: sup.createdAt ? new Date(sup.createdAt) : new Date(),
            updatedAt: new Date(),
          },
        });
        stats.suppliers++;
      }

      // 3. Import Products
      for (const prod of products) {
        const importedVariants = parseJsonArray(prod.variants);
        const importedVariantSkus = importedVariants
          .map((variant) => String(variant?.sku || "").trim())
          .filter(Boolean);
        if (new Set(importedVariantSkus).size !== importedVariantSkus.length) {
          throw new Error(`Duplicate variant SKU in import: ${prod.sku}`);
        }
        const normalizedVariants = importedVariants.length
          ? JSON.stringify(importedVariants)
          : prod.variants || null;
        const normalizedStock = importedVariants.length
          ? importedVariants.reduce(
              (total, variant) => total + Number(variant?.stock || 0),
              0,
            )
          : Number(prod.stock || 0);
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
            stock: normalizedStock,
            minStock: prod.minStock || 0,
            maxStock: prod.maxStock || null,
            unit: prod.unit || "Cái",
            weight: prod.weight || null,
            images: prod.images || null,
            variants: normalizedVariants,
            status: prod.status || "active",
            updatedAt: new Date(),
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
            stock: normalizedStock,
            minStock: prod.minStock || 0,
            maxStock: prod.maxStock || null,
            unit: prod.unit || "Cái",
            weight: prod.weight || null,
            images: prod.images || null,
            variants: normalizedVariants,
            status: prod.status || "active",
            createdAt: prod.createdAt ? new Date(prod.createdAt) : new Date(),
            updatedAt: new Date(),
          },
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
            updatedAt: new Date(),
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
            updatedAt: new Date(),
          },
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
            status: po.status || "pending",
            subtotal: po.subtotal || 0,
            discount: po.discount || 0,
            tax: po.tax || 0,
            total: po.total || 0,
            paidAmount: po.paidAmount || 0,
            note: po.note || null,
            receivedAt: po.receivedAt ? new Date(po.receivedAt) : null,
            createdBy: po.createdBy || null,
            updatedAt: new Date(),
          },
          create: {
            id: po.id,
            poNumber: po.poNumber,
            supplierId: po.supplierId,
            status: po.status || "pending",
            subtotal: po.subtotal || 0,
            discount: po.discount || 0,
            tax: po.tax || 0,
            total: po.total || 0,
            paidAmount: po.paidAmount || 0,
            note: po.note || null,
            receivedAt: po.receivedAt ? new Date(po.receivedAt) : null,
            createdBy: po.createdBy || null,
            createdAt: po.createdAt ? new Date(po.createdAt) : new Date(),
            updatedAt: new Date(),
          },
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
            subtotal: item.subtotal || 0,
          },
          create: {
            id: item.id,
            purchaseOrderId: item.purchaseOrderId,
            productId: item.productId,
            quantity: item.quantity || 0,
            price: item.price || 0,
            subtotal: item.subtotal || 0,
          },
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
            source: order.source || "pos",
            status: order.status || "pending",
            paymentStatus: order.paymentStatus || "unpaid",
            paymentMethod: order.paymentMethod || null,
            subtotal: order.subtotal || 0,
            discount: order.discount || 0,
            tax: order.tax || 0,
            shippingFee: order.shippingFee || 0,
            total: order.total || 0,
            profit: order.profit || 0,
            trackingNumber: order.trackingNumber || null,
            note: order.note || null,
            updatedAt: new Date(),
          },
          create: {
            id: order.id,
            orderNumber: order.orderNumber,
            customerId: order.customerId || null,
            createdBy: order.createdBy || null,
            source: order.source || "pos",
            status: order.status || "pending",
            paymentStatus: order.paymentStatus || "unpaid",
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
            updatedAt: new Date(),
          },
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
            subtotal: item.subtotal || 0,
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
            subtotal: item.subtotal || 0,
          },
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
            paidAt: payment.paidAt ? new Date(payment.paidAt) : new Date(),
          },
          create: {
            id: payment.id,
            orderId: payment.orderId,
            method: payment.method,
            amount: payment.amount || 0,
            transactionId: payment.transactionId || null,
            note: payment.note || null,
            paidAt: payment.paidAt ? new Date(payment.paidAt) : new Date(),
          },
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
            createdBy: expense.createdBy || null,
          },
          create: {
            id: expense.id,
            category: expense.category,
            description: expense.description,
            amount: expense.amount || 0,
            date: expense.date ? new Date(expense.date) : new Date(),
            createdBy: expense.createdBy || null,
            createdAt: expense.createdAt
              ? new Date(expense.createdAt)
              : new Date(),
          },
        });
        stats.expenses++;
      }

      console.log("  ✅ Import stats:", stats);
      return stats;
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        module: "database",
        action: "IMPORT",
        description: `Imported data from ${path.basename(filePath)}: ${JSON.stringify(result)}`,
        userName: "System",
        severity: "INFO",
        timestamp: new Date(),
      },
    });

    console.log(`✅ Database imported successfully from: ${filePath}`);
    return { success: true, data: result };
  } catch (error) {
    console.error("❌ Database import error:", error);
    console.error("   Stack:", error.stack);
    return { success: false, error: error.message };
  }
});

// ========================================
// USER PASSWORD MANAGEMENT
// ========================================

ipcMain.handle("users:updateProfile", async (event, data = {}) => {
  try {
    requireRole();
    if (!prisma || !currentSession?.id)
      throw new Error("Phiên đăng nhập không hợp lệ.");

    const fullName = String(data.fullName || "").trim();
    const avatar =
      data.avatar === null || data.avatar === undefined
        ? data.avatar
        : String(data.avatar);
    if (fullName.length < 2 || fullName.length > 80)
      throw new Error("Họ tên phải có từ 2 đến 80 ký tự.");
    if (data.email !== undefined)
      throw new Error(
        "Email chỉ được quản trị viên cập nhật trong phần Quản trị.",
      );
    if (
      avatar &&
      (!/^data:image\/(jpeg|png|webp);base64,/.test(avatar) ||
        Buffer.byteLength(avatar, "utf8") > 220 * 1024)
    ) {
      throw new Error(
        "Ảnh đại diện phải là JPG, PNG hoặc WebP và không quá 160 KB sau khi nén.",
      );
    }

    const user = await prisma.user.update({
      where: { id: currentSession.id },
      data: {
        fullName,
        ...(avatar !== undefined ? { avatar: avatar || null } : {}),
      },
    });
    void logActivity({
      module: "users",
      action: "UPDATE",
      description: `Cập nhật hồ sơ: ${user.username}`,
      recordName: user.username,
      userName: user.username,
    });
    return { success: true, data: sanitizeUserForClient(user) };
  } catch (error) {
    console.error("Update profile error:", error);
    return { success: false, error: error.message };
  }
});

// Keep historical purchase receipts intact while removing a supplier from
// future selection lists.
ipcMain.handle("suppliers:deactivate", async (event, id) => {
  try {
    if (!prisma) throw new Error("Prisma not available");
    const supplier = await prisma.supplier.update({
      where: { id: Number(id) },
      data: { status: "inactive" },
    });
    void logActivity({
      module: "purchases",
      action: "SUPPLIER_DEACTIVATE",
      description: `Ngừng sử dụng NCC "${supplier.name}"`,
      recordName: supplier.name,
    });
    return { success: true, data: supplier };
  } catch (error) {
    console.error("Deactivate supplier error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("suppliers:reactivate", async (event, id) => {
  try {
    if (!prisma) throw new Error("Prisma not available");
    const supplier = await prisma.supplier.update({
      where: { id: Number(id) },
      data: { status: "active" },
    });
    return { success: true, data: supplier };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ========================================
// SUPPLIER DEBT / PAYABLES
// ========================================
const SUPPLIER_DEBT_PAYMENTS_KEY = "supplierPaymentLedgerV1";
const SUPPLIER_DEBT_BANKS_KEY = "supplierPaymentQrV1";
const SUPPLIER_DEBT_LEGACY_IMPORTS_KEY = "supplierPaymentLegacyImportsV1";
const SUPPLIER_DEBT_IMPORT_OVERRIDES_KEY = "supplierPaymentImportOverridesV1";
const SUPPLIER_DEBT_QR_IMAGE_KEY_PREFIX = "supplierPaymentQrImageV1:";
const SUPPLIER_DEBT_AUTO_IMPORT_START = new Date("2026-08-01T00:00:00+07:00");
const parseSupplierDebtConfig = (value, fallback = {}) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

async function readSupplierDebtConfig(key, fallback = {}) {
  const record = await prisma.appConfig.findUnique({ where: { key } });
  return parseSupplierDebtConfig(record?.value, fallback);
}

async function applyLegacySupplierQrMappings() {
  const legacyQrs = await readSupplierDebtConfig(
    "supplierPaymentLegacyQrsV1",
    [],
  );
  if (!Array.isArray(legacyQrs) || !legacyQrs.length) return;
  const suppliers = await prisma.supplier.findMany({
    where: { name: { in: ["Monji", "Duy Ngọc", "Duy Quân"] } },
    select: { id: true, name: true },
  });
  const supplierByName = new Map(
    suppliers.map((supplier) => [supplier.name, supplier]),
  );
  const mappings = [
    { supplierName: "Monji", qrName: "CÔNG TY MONJI", details: {} },
    {
      supplierName: "Duy Ngọc",
      qrName: "CÔNG TY DUY NGỌC",
      details: { bankName: "ICB", accountNumber: "117002909072" },
    },
    {
      supplierName: "Duy Quân",
      qrName: "DUY QUÂN",
      details: { bankName: "ICB", accountNumber: "113602191888" },
    },
  ];
  const banks = await readSupplierDebtConfig(SUPPLIER_DEBT_BANKS_KEY, {});
  let changed = false;
  for (const mapping of mappings) {
    const supplier = supplierByName.get(mapping.supplierName);
    const qr = legacyQrs.find((item) => item.name === mapping.qrName);
    if (!supplier || !qr?.image || banks[String(supplier.id)]?.qrImage)
      continue;
    banks[String(supplier.id)] = {
      ...banks[String(supplier.id)],
      ...mapping.details,
      accountName: banks[String(supplier.id)]?.accountName || supplier.name,
      qrImage: qr.image,
      source: "Ảnh QR từ QUAN LY TIEN NONG",
      updatedAt: new Date().toISOString(),
    };
    changed = true;
  }
  if (changed)
    await prisma.appConfig.upsert({
      where: { key: SUPPLIER_DEBT_BANKS_KEY },
      update: { value: JSON.stringify(banks) },
      create: { key: SUPPLIER_DEBT_BANKS_KEY, value: JSON.stringify(banks) },
    });
}

ipcMain.handle(
  "supplierDebt:getWorkbench",
  async (event, { supplierId } = {}) => {
    try {
      requireRole("admin", "manager");
      const [purchases, suppliers, legacyImports, importOverrides] =
        await Promise.all([
          prisma.purchaseOrder.findMany({
            where: {
              status: { not: "cancelled" },
              createdAt: { gte: SUPPLIER_DEBT_AUTO_IMPORT_START },
            },
            include: {
              supplier: {
                select: { id: true, code: true, name: true, taxCode: true },
              },
            },
            orderBy: { createdAt: "desc" },
          }),
          prisma.supplier.findMany({
            select: { id: true, code: true, name: true, taxCode: true },
            orderBy: { name: "asc" },
          }),
          readSupplierDebtConfig(SUPPLIER_DEBT_LEGACY_IMPORTS_KEY, []),
          readSupplierDebtConfig(SUPPLIER_DEBT_IMPORT_OVERRIDES_KEY, {}),
        ]);
      const legacySelected = supplierId === "legacy";
      const selectedId = legacySelected
        ? "legacy"
        : Number(supplierId) || "legacy";
      const supplier =
        selectedId === "legacy"
          ? {
              id: "legacy",
              code: "LICH-SU",
              name: "Dữ liệu lịch sử (tool cũ)",
              taxCode: null,
            }
          : suppliers.find((item) => item.id === selectedId) || null;
      const supplierPurchases = (
        selectedId === "legacy"
          ? Array.isArray(legacyImports)
            ? legacyImports
            : []
          : purchases
              .filter((p) => p.supplierId === selectedId)
              .map((p) => ({
                id: p.id,
                poNumber: p.poNumber,
                date: p.receivedAt || p.createdAt,
                total: Number(importOverrides[String(p.id)] ?? p.total ?? 0),
                note: p.note,
              }))
      )
        .slice()
        .sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        );
      const [banks, paymentHistory, qrImage] = await Promise.all([
        readSupplierDebtConfig(SUPPLIER_DEBT_BANKS_KEY, {}),
        readSupplierDebtConfig(SUPPLIER_DEBT_PAYMENTS_KEY, []),
        selectedId !== "legacy"
          ? readSupplierDebtConfig(
              `${SUPPLIER_DEBT_QR_IMAGE_KEY_PREFIX}${selectedId}`,
              null,
            )
          : null,
      ]);
      const payments = Array.isArray(paymentHistory)
        ? paymentHistory
            .filter((p) => String(p.supplierId) === String(selectedId))
            .sort(
              (a, b) =>
                new Date(b.paymentDate || b.createdAt).getTime() -
                new Date(a.paymentDate || a.createdAt).getTime(),
            )
        : [];
      const totalImports = supplierPurchases.reduce(
        (sum, purchase) => sum + Number(purchase.total || 0),
        0,
      );
      const totalPayments = payments.reduce(
        (sum, payment) => sum + Number(payment.amount || 0),
        0,
      );
      return {
        success: true,
        data: {
          suppliers: [
            {
              id: "legacy",
              code: "LICH-SU",
              name: "Dữ liệu lịch sử (tool cũ)",
            },
            ...suppliers,
          ],
          supplier,
          summary: {
            totalImports,
            totalPayments,
            balance: totalImports - totalPayments,
          },
          bankDetails:
            selectedId !== "legacy"
              ? {
                  ...(banks[String(selectedId)] || {}),
                  ...(qrImage ? { qrImage } : {}),
                }
              : null,
          purchases: supplierPurchases,
          payments,
        },
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle("supplierDebt:getLegacyQrs", async () => {
  try {
    requireRole("admin", "manager");
    const qrs = await readSupplierDebtConfig("supplierPaymentLegacyQrsV1", []);
    return {
      success: true,
      data: Array.isArray(qrs)
        ? qrs.map((item) => ({
            id: item.id,
            name: item.name,
            note: item.note || "",
            image: item.image || "",
          }))
        : [],
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("supplierDebt:updateImportAmount", async (event, data = {}) => {
  try {
    requireRole("admin", "manager");
    const id = String(data.id || "");
    const amount = Number(data.amount);
    if (!id || !Number.isFinite(amount) || amount < 0)
      throw new Error("Số tiền điều chỉnh không hợp lệ.");
    if (id.startsWith("legacy-import-")) {
      const imports = await readSupplierDebtConfig(
        SUPPLIER_DEBT_LEGACY_IMPORTS_KEY,
        [],
      );
      const index = imports.findIndex((item) => String(item.id) === id);
      if (index < 0) throw new Error("Không tìm thấy dòng dữ liệu lịch sử.");
      imports[index] = {
        ...imports[index],
        total: amount,
        editedAt: new Date().toISOString(),
        editedBy: currentSession.username,
      };
      await prisma.appConfig.upsert({
        where: { key: SUPPLIER_DEBT_LEGACY_IMPORTS_KEY },
        update: { value: JSON.stringify(imports) },
        create: {
          key: SUPPLIER_DEBT_LEGACY_IMPORTS_KEY,
          value: JSON.stringify(imports),
        },
      });
    } else {
      const order = await prisma.purchaseOrder.findFirst({
        where: {
          id: Number(id),
          status: { not: "cancelled" },
          createdAt: { gte: SUPPLIER_DEBT_AUTO_IMPORT_START },
        },
        select: { id: true },
      });
      if (!order)
        throw new Error("Chỉ được điều chỉnh phiếu nhập từ ngày 01/08/2026.");
      const overrides = await readSupplierDebtConfig(
        SUPPLIER_DEBT_IMPORT_OVERRIDES_KEY,
        {},
      );
      overrides[id] = amount;
      await prisma.appConfig.upsert({
        where: { key: SUPPLIER_DEBT_IMPORT_OVERRIDES_KEY },
        update: { value: JSON.stringify(overrides) },
        create: {
          key: SUPPLIER_DEBT_IMPORT_OVERRIDES_KEY,
          value: JSON.stringify(overrides),
        },
      });
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("supplierDebt:addLegacyImport", async (event, data = {}) => {
  try {
    requireRole("admin", "manager");
    const amount = Number(data.amount);
    const inputDate = data.date ? new Date(data.date) : new Date();
    if (!Number.isFinite(amount) || amount <= 0)
      throw new Error("Số tiền phải lớn hơn 0.");
    if (Number.isNaN(inputDate.getTime()))
      throw new Error("Ngày nhập không hợp lệ.");

    const dateKey = getLocalDateKey(inputDate);
    const note = String(data.note || "")
      .trim()
      .slice(0, 500);
    const result = await getPrismaDirectTx().$transaction(async (tx) => {
      // Serialize updates to the JSON-backed legacy ledger.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${5649001})`;
      const record = await tx.appConfig.findUnique({
        where: { key: SUPPLIER_DEBT_LEGACY_IMPORTS_KEY },
      });
      const imports = parseSupplierDebtConfig(record?.value, []);
      if (!Array.isArray(imports))
        throw new Error("Dữ liệu lịch sử công nợ không hợp lệ.");
      const maxSequence = imports.reduce((max, item) => {
        const match = String(item?.poNumber || "").match(/-(\d+)$/);
        return Math.max(max, match ? Number(match[1]) : 0);
      }, 0);
      const poNumber = `LS-${dateKey.replace(/-/g, "")}-${String(maxSequence + 1).padStart(3, "0")}`;
      const legacyImport = {
        id: `legacy-import-${crypto.randomUUID()}`,
        poNumber,
        date: dateKey,
        total: amount,
        note,
        createdAt: new Date().toISOString(),
        createdBy: currentSession.username,
        source: "manual_legacy_entry",
      };
      imports.push(legacyImport);
      await tx.appConfig.upsert({
        where: { key: SUPPLIER_DEBT_LEGACY_IMPORTS_KEY },
        update: { value: JSON.stringify(imports) },
        create: {
          key: SUPPLIER_DEBT_LEGACY_IMPORTS_KEY,
          value: JSON.stringify(imports),
        },
      });
      await tx.activityLog.create({
        data: {
          module: "supplier_debt",
          action: "LEGACY_IMPORT_CREATE",
          description: `Thêm khoản nhập lịch sử ${amount.toLocaleString("vi-VN")}đ`,
          recordName: poNumber,
          changes: JSON.stringify(legacyImport),
          userName: currentSession.username,
          userId: currentSession.id,
          severity: "INFO",
        },
      });
      return legacyImport;
    });
    return { success: true, data: result };
  } catch (error) {
    console.error("supplierDebt:addLegacyImport error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("supplierDebt:saveBankDetails", async (event, data = {}) => {
  try {
    requireRole("admin", "manager");
    const supplierId =
      data.supplierId === "legacy" ? "legacy" : Number(data.supplierId);
    if (!supplierId) throw new Error("Nhà cung cấp không hợp lệ.");
    const bankName = String(data.bankName || "").trim();
    const accountNumber = String(data.accountNumber || "").replace(/\s/g, "");
    const accountName = String(data.accountName || "").trim();
    if (!bankName || !accountNumber || !accountName)
      throw new Error("Cần nhập đủ ngân hàng, số tài khoản và chủ tài khoản.");
    const banks = await readSupplierDebtConfig(SUPPLIER_DEBT_BANKS_KEY, {});
    banks[String(supplierId)] = {
      ...banks[String(supplierId)],
      bankName,
      accountNumber,
      accountName,
      updatedAt: new Date().toISOString(),
    };
    await prisma.appConfig.upsert({
      where: { key: SUPPLIER_DEBT_BANKS_KEY },
      update: { value: JSON.stringify(banks) },
      create: { key: SUPPLIER_DEBT_BANKS_KEY, value: JSON.stringify(banks) },
    });
    return { success: true, data: banks[String(supplierId)] };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("supplierDebt:confirmPayment", async (event, data = {}) => {
  try {
    requireRole("admin", "manager");
    const supplierId = Number(data.supplierId);
    const amount = Number(data.amount);
    const type = ["VAT", "TIEN_HANG", "UNG_TRUOC"].includes(data.type)
      ? data.type
      : "TIEN_HANG";
    if (
      (!supplierId && supplierId !== "legacy") ||
      !Number.isFinite(amount) ||
      amount <= 0
    )
      throw new Error("Hãy nhập nhà cung cấp và số tiền thanh toán hợp lệ.");
    const result = await getPrismaDirectTx().$transaction(
      async (tx) => {
        if (supplierId !== "legacy")
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${supplierId})`;
        const now = new Date();
        const paymentNumber = `PTNCC-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${String(now.getTime()).slice(-6)}`;
        const config = await tx.appConfig.findUnique({
          where: { key: SUPPLIER_DEBT_PAYMENTS_KEY },
        });
        const payments = parseSupplierDebtConfig(config?.value, []);
        const payment = {
          id: paymentNumber,
          paymentNumber,
          supplierId,
          amount,
          type,
          method: data.method === "cash" ? "cash" : "bank_transfer",
          bankReference: String(data.bankReference || "").trim(),
          note: String(data.note || "").trim(),
          paymentDate: data.paymentDate
            ? new Date(data.paymentDate).toISOString()
            : now.toISOString(),
          createdAt: now.toISOString(),
          confirmedBy: currentSession.username,
        };
        payments.push(payment);
        await tx.appConfig.upsert({
          where: { key: SUPPLIER_DEBT_PAYMENTS_KEY },
          update: { value: JSON.stringify(payments.slice(-1000)) },
          create: {
            key: SUPPLIER_DEBT_PAYMENTS_KEY,
            value: JSON.stringify([payment]),
          },
        });
        await tx.activityLog.create({
          data: {
            module: "supplier_debt",
            action: "PAYMENT_CREATE",
            description: `Ghi nhận thanh toán ${type}: ${amount.toLocaleString("vi-VN")}đ`,
            recordName: paymentNumber,
            changes: JSON.stringify(payment),
            userName: currentSession.username,
            userId: currentSession.id,
            severity: "INFO",
          },
        });
        return payment;
      },
      { timeout: 30000, maxWait: 10000 },
    );
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Change password (user changes their own password)
ipcMain.handle(
  "users:changePassword",
  async (event, { userId, oldPassword, newPassword }) => {
    try {
      requireRole();
      if (!prisma) throw new Error("Prisma not available");
      if (!currentSession?.id || Number(userId) !== currentSession.id) {
        return {
          success: false,
          error: "Chỉ được đổi mật khẩu của chính bạn.",
        };
      }

      const passwordText = assertStrongPassword(newPassword);

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return { success: false, error: "Người dùng không tồn tại" };
      }

      // Verify old password (bcrypt compare — hỗ trợ cả plaintext legacy)
      let passwordValid = false;
      if (user.password && user.password.startsWith("$2")) {
        passwordValid = await bcrypt.compare(oldPassword, user.password);
      } else {
        passwordValid = user.password === oldPassword;
      }
      if (!passwordValid) {
        return { success: false, error: "Mật khẩu hiện tại không đúng" };
      }
      const isSamePassword = user.password?.startsWith("$2")
        ? await bcrypt.compare(passwordText, user.password)
        : user.password === passwordText;
      if (isSamePassword) {
        return {
          success: false,
          error: "Mật khẩu mới phải khác mật khẩu hiện tại.",
        };
      }

      // Hash new password before storing
      const hashedNew = await bcrypt.hash(passwordText, 10);
      await prisma.user.update({
        where: { id: userId },
        data: {
          password: hashedNew,
          passwordChangedAt: new Date(),
          forcePasswordChange: false,
        },
      });
      await revokeRememberTokensForUser(user.id);
      currentSession.mustChangePassword = false;

      console.log(`✅ Changed password for user: ${user.username}`);
      void logActivity({
        module: "users",
        action: "UPDATE",
        description: `Đổi mật khẩu: ${user.username}`,
        recordName: user.username,
        userName: user.username,
      });
      return { success: true };
    } catch (error) {
      console.error("❌ Change password error:", error);
      return { success: false, error: error.message };
    }
  },
);

// Reset password (admin resets another user's password)
ipcMain.handle(
  "users:resetPassword",
  async (event, { userId, newPassword }) => {
    try {
      requireRole("admin");
      if (!prisma) throw new Error("Prisma not available");

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return { success: false, error: "Người dùng không tồn tại" };
      }

      const passwordText = assertStrongPassword(newPassword);
      // Mật khẩu do admin cấp là tạm thời: bắt buộc đổi ngay ở lần đăng nhập tiếp theo.
      const hashedPassword = await bcrypt.hash(passwordText, 10);
      await prisma.user.update({
        where: { id: userId },
        data: {
          password: hashedPassword,
          passwordChangedAt: new Date(0),
          forcePasswordChange: true,
        },
      });
      await revokeRememberTokensForUser(user.id);

      console.log(`✅ Reset password for user: ${user.username}`);
      void logActivity({
        module: "users",
        action: "UPDATE",
        description: `Đặt lại mật khẩu tạm: ${user.username}`,
        recordName: user.username,
        userName: currentSession?.username || "admin",
      });
      return { success: true };
    } catch (error) {
      console.error("❌ Reset password error:", error);
      return { success: false, error: error.message };
    }
  },
);

// ========================================
// BACKUP & RESTORE SYSTEM
// ========================================

const AdmZip = require("adm-zip");

// Backup toàn bộ folder desktop thành ZIP
ipcMain.handle("system:backup", async () => {
  try {
    requireRole("admin");
    console.log("🔄 Starting FULL system backup (including node_modules)...");

    // Sử dụng thư mục backup mặc định
    const backupDir = "G:\\QUAN LY BAN HANG\\apps\\BACKUP";

    // Tạo thư mục backup nếu chưa tồn tại
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
      console.log("📁 Created backup directory:", backupDir);
    }

    console.log("📂 Backup directory:", backupDir);

    // Đường dẫn folder cần backup (toàn bộ desktop)
    const sourceFolder = path.join(__dirname, "..");
    console.log("📁 Source folder:", sourceFolder);

    // Tên file backup với format: BACKUP-MMDDYY-HHMMSS.zip
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const year = String(now.getFullYear()).slice(-2); // 2 chữ số cuối
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    const backupFileName = `BACKUP-${month}${day}${year}-${hours}${minutes}${seconds}.zip`;
    const backupFilePath = path.join(backupDir, backupFileName);

    console.log("📦 Creating ZIP file:", backupFilePath);
    console.log("⚠️  This will take several minutes due to large size...");

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
          zip.addLocalFile(
            itemPath,
            path.dirname(itemZipPath),
            path.basename(itemPath),
          );
          addedCount++;

          if (addedCount % 1000 === 0) {
            console.log(`   ⏳ Added ${addedCount} files...`);
          }
        }
      }
    }

    console.log("🔄 Adding all files (this may take 2-5 minutes)...");

    // Thêm TOÀN BỘ folder desktop
    addFolderToZip(sourceFolder, "");

    console.log(`✅ Total files added: ${addedCount}`);
    console.log("💾 Writing ZIP file (this may take another 1-2 minutes)...");

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
        filename: backupFileName,
      },
    };
  } catch (error) {
    console.error("❌ Backup error:", error);
    console.error("   Stack:", error.stack);
    return { success: false, error: error.message };
  }
});

// Lấy danh sách backups
ipcMain.handle("system:listBackups", async () => {
  try {
    requireRole("admin");
    const backupDir = path.join(__dirname, "..", "..", "Backups");

    if (!fs.existsSync(backupDir)) {
      return { success: true, data: [] };
    }

    const files = fs
      .readdirSync(backupDir)
      .filter((file) => file.endsWith(".zip"))
      .map((file) => {
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);
        return {
          filename: file,
          path: filePath,
          size: stats.size,
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt); // Mới nhất ở đầu

    console.log(`📂 Found ${files.length} backup files`);
    return { success: true, data: files };
  } catch (error) {
    console.error("❌ List backups error:", error);
    return { success: false, error: error.message };
  }
});

// Restore từ backup (giải nén ZIP)
ipcMain.handle("system:restore", async (event, backupPath) => {
  try {
    requireRole("admin");
    console.log("🔄 Starting restore from:", backupPath);

    if (!fs.existsSync(backupPath)) {
      return { success: false, error: "File backup không tồn tại!" };
    }

    // Thư mục restore
    const restoreDir = path.join(__dirname, "..");

    // Sử dụng adm-zip để giải nén
    const zip = new AdmZip(backupPath);

    // Tạo backup tạm của database trước khi restore
    const dbPath = path.join(restoreDir, "prisma", "dev.db");
    const dbBackupPath = path.join(
      restoreDir,
      "prisma",
      `dev.backup.${Date.now()}.db`,
    );
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
        message: "Khôi phục thành công! Vui lòng khởi động lại ứng dụng.",
      },
    };
  } catch (error) {
    console.error("❌ Restore error:", error);
    return { success: false, error: error.message };
  }
});

// Inspect/Preview backup - Xem thông tin chi tiết
ipcMain.handle("system:inspectBackup", async (event, backupPath) => {
  try {
    requireRole("admin");
    console.log("🔍 Inspecting backup:", backupPath);

    if (!fs.existsSync(backupPath)) {
      return { success: false, error: "File backup không tồn tại!" };
    }

    // Lấy thông tin file
    const stats = fs.statSync(backupPath);
    const zip = new AdmZip(backupPath);
    const entries = zip.getEntries();

    // Phân loại entries
    const folders = new Set();
    const files = [];
    let totalSize = 0;

    entries.forEach((entry) => {
      if (entry.isDirectory) {
        folders.add(entry.entryName);
      } else {
        files.push({
          name: entry.entryName,
          size: entry.header.size,
          compressedSize: entry.header.compressedSize,
          date: entry.header.time,
        });
        totalSize += entry.header.size;
      }
    });

    // Kiểm tra các folder quan trọng
    const hasSrc = entries.some((e) => e.entryName.startsWith("src/"));
    const hasElectron = entries.some((e) =>
      e.entryName.startsWith("electron/"),
    );
    const hasPrisma = entries.some((e) => e.entryName.startsWith("prisma/"));
    const hasNodeModules = entries.some((e) =>
      e.entryName.startsWith("node_modules/"),
    );
    const hasPackageJson = entries.some((e) => e.entryName === "package.json");

    // Top 10 files lớn nhất
    const largestFiles = files
      .sort((a, b) => b.size - a.size)
      .slice(0, 10)
      .map((f) => ({
        name: f.name,
        sizeMB: (f.size / 1024 / 1024).toFixed(2),
      }));

    const info = {
      filename: backupPath.split("\\").pop() || backupPath.split("/").pop(),
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
        hasNodeModules,
      },

      // Top files
      largestFiles,

      // Folder structure
      mainFolders: Array.from(folders)
        .filter((f) => !f.includes("/"))
        .sort(),
    };

    console.log("✅ Backup inspection complete");
    console.log(`   Files: ${info.totalFiles}, Folders: ${info.totalFolders}`);
    console.log(
      `   Size: ${info.fileSizeMB} MB (${info.compressionRatio}% compression)`,
    );
    console.log(`   Valid: ${info.isValid}`);

    return { success: true, data: info };
  } catch (error) {
    console.error("❌ Inspect backup error:", error);
    return { success: false, error: error.message };
  }
});

// Browse và chọn file backup để restore
ipcMain.handle("system:browseAndRestore", async () => {
  try {
    requireRole("admin");
    console.log("📂 Opening file browser for backup selection...");

    // Cho user chọn file ZIP
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      title: "Chọn file backup để khôi phục",
      filters: [
        { name: "Backup Files", extensions: ["zip"] },
        { name: "All Files", extensions: ["*"] },
      ],
      defaultPath: path.join(__dirname, "..", ".."),
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: "User cancelled" };
    }

    const selectedFile = result.filePaths[0];
    console.log("✅ Selected file:", selectedFile);

    // Trả về file path để UI xử lý tiếp
    return {
      success: true,
      data: {
        filePath: selectedFile,
        message: "File đã được chọn. Nhấn OK để tiếp tục khôi phục.",
      },
    };
  } catch (error) {
    console.error("❌ Browse error:", error);
    return { success: false, error: error.message };
  }
});

// Xóa backup
ipcMain.handle("system:deleteBackup", async (event, backupPath) => {
  try {
    requireRole("admin");
    if (!fs.existsSync(backupPath)) {
      return { success: false, error: "File backup không tồn tại!" };
    }

    fs.unlinkSync(backupPath);
    console.log(`✅ Deleted backup: ${backupPath}`);

    return { success: true };
  } catch (error) {
    console.error("❌ Delete backup error:", error);
    return { success: false, error: error.message };
  }
});

// ========================================
// DAILY TASKS HANDLERS
// ========================================

const MAX_EVIDENCE_IMAGES = 5;
const TASK_PENALTY_KEY_PREFIX = "dailyTaskEvidencePenalty:";
const ASSIGNMENT_EVIDENCE_PENALTY_KEY_PREFIX = "assignmentEvidencePenalty:";
const DAILY_TASK_REST_DAY_HOLIDAYS = new Set([
  "01-01",
  "04-30",
  "05-01",
  "09-02",
]);

function isDailyTaskPenaltyRestDay(date) {
  const localDate = new Date(date);
  const monthDay = `${String(localDate.getMonth() + 1).padStart(2, "0")}-${String(localDate.getDate()).padStart(2, "0")}`;
  return localDate.getDay() === 0 || DAILY_TASK_REST_DAY_HOLIDAYS.has(monthDay);
}

// Daily work is due at the end of its working date. Keep this rule in the
// Electron process so an older client cannot submit an earlier deadline and
// cause an employee to be fined before the day has actually ended.
function getDailyTaskEndOfDay(value) {
  const dueAt = new Date(value);
  if (Number.isNaN(dueAt.getTime()))
    throw new Error("Invalid daily task deadline.");
  dueAt.setHours(23, 59, 59, 999);
  return dueAt;
}

function getDailyTaskEvidencePenaltyAt(dueAt) {
  const penaltyAt = getDailyTaskEndOfDay(dueAt);
  penaltyAt.setDate(penaltyAt.getDate() + 1);
  penaltyAt.setHours(0, 0, 0, 0);
  return penaltyAt;
}

async function normalizeOpenDailyTaskDeadlines() {
  const tasks = await prisma.dailyTask.findMany({
    where: { type: "daily", status: { in: ["pending", "in_progress"] } },
    select: { id: true, dueDate: true },
  });
  const updates = tasks.flatMap((task) => {
    const normalized = getDailyTaskEndOfDay(task.dueDate);
    return task.dueDate.getTime() === normalized.getTime()
      ? []
      : [
          prisma.dailyTask.update({
            where: { id: task.id },
            data: { dueDate: normalized },
          }),
        ];
  });
  if (updates.length > 0) await prisma.$transaction(updates);
  return updates.length;
}

// Handover recurrence keeps its configured calendar interval. If the computed
// date is Sunday/a fixed holiday, move it forward to the next working day.
// For example, Friday + two days is normally Sunday, so it becomes Monday.
// Keep the original time of day so the configured deadline remains intact.
function getNextAssignmentWorkingDueDate(dueAt, recurrenceDays) {
  const nextDueAt = new Date(dueAt.getTime());
  nextDueAt.setDate(
    nextDueAt.getDate() + Math.max(0, Math.floor(Number(recurrenceDays) || 0)),
  );
  while (isDailyTaskPenaltyRestDay(nextDueAt)) {
    nextDueAt.setDate(nextDueAt.getDate() + 1);
  }
  return nextDueAt;
}

function parseTaskAttachments(attachments) {
  if (!attachments) return {};
  try {
    const parsed =
      typeof attachments === "string" ? JSON.parse(attachments) : attachments;
    return Array.isArray(parsed) ? { files: parsed } : parsed || {};
  } catch {
    return {};
  }
}

async function appendDailyTaskHistory(entry) {
  try {
    const historyConfig = await prisma.appConfig.findUnique({
      where: { key: "dailyTasksHistory" },
    });
    const history = historyConfig ? JSON.parse(historyConfig.value) : [];
    const updatedHistory = [entry, ...history].slice(0, 500);

    await prisma.appConfig.upsert({
      where: { key: "dailyTasksHistory" },
      update: { value: JSON.stringify(updatedHistory) },
      create: {
        key: "dailyTasksHistory",
        value: JSON.stringify(updatedHistory),
      },
    });
  } catch (error) {
    // Evidence remains valid even if its audit entry cannot be written.
    console.error("Unable to write daily task history:", error.message);
  }
}

function normalizeActorName(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("vi-VN");
}

async function getCurrentActor() {
  requireRole();
  const user = await prisma.user.findUnique({
    where: { id: currentSession.id },
  });
  if (!user || user.status !== "active")
    throw new Error("Phiên đăng nhập không hợp lệ.");
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName || user.username,
    role: user.role,
  };
}

function isFixedAssignee(attachments) {
  return Boolean(
    attachments?.assignment?.fixedAssignee ||
    getDailyRotation(attachments).length,
  );
}

function getDailyRotation(attachments) {
  // weeklyRotation is retained as a read-only fallback for tasks created
  // before the rotation cadence changed from weekly to daily.
  const assignees =
    attachments?.assignment?.dailyRotation?.assignees ||
    attachments?.assignment?.weeklyRotation?.assignees;
  return Array.isArray(assignees)
    ? [
        ...new Set(
          assignees.map((name) => String(name || "").trim()).filter(Boolean),
        ),
      ]
    : [];
}

function getTaskRecipients(
  task,
  attachments = parseTaskAttachments(task?.attachments),
) {
  const assignees = attachments?.assignment?.assignees;
  if (Array.isArray(assignees) && assignees.length > 0) {
    return [
      ...new Set(
        assignees.map((name) => String(name || "").trim()).filter(Boolean),
      ),
    ];
  }
  return task?.assignee ? [String(task.assignee).trim()] : [];
}

async function getActiveTaskRecipients(recipients) {
  const values = [
    ...new Set(
      (recipients || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ];
  if (values.length === 0) return [];
  const activeUsers = await prisma.user.findMany({
    where: {
      status: "active",
      OR: [{ username: { in: values } }, { fullName: { in: values } }],
    },
    select: { username: true, fullName: true },
  });
  return values.filter((value) =>
    activeUsers.some((user) => matchesUserIdentity(value, user)),
  );
}

function getLocalDateKey(date = new Date()) {
  const localDate = new Date(date);
  localDate.setHours(0, 0, 0, 0);
  return `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}-${String(localDate.getDate()).padStart(2, "0")}`;
}

function getDailyRotationAssignee(attachments, date = new Date()) {
  const assignees = getDailyRotation(attachments);
  if (assignees.length === 0) return "";

  const configuredAnchor =
    attachments?.assignment?.dailyRotation?.anchorDate ||
    attachments?.assignment?.weeklyRotation?.anchorDate;
  const anchorDate = /^\d{4}-\d{2}-\d{2}$/.test(String(configuredAnchor || ""))
    ? new Date(`${configuredAnchor}T00:00:00`)
    : new Date(`${getLocalDateKey(date)}T00:00:00`);
  const currentDate = new Date(`${getLocalDateKey(date)}T00:00:00`);
  const daysSinceAnchor = Math.floor(
    (currentDate.getTime() - anchorDate.getTime()) / (24 * 60 * 60 * 1000),
  );
  const index =
    ((daysSinceAnchor % assignees.length) + assignees.length) %
    assignees.length;
  return assignees[index];
}

function clearEvidenceSubmission(attachments) {
  const evidence = attachments?.evidence;
  if (!evidence?.required) return attachments;

  const {
    submittedAt,
    submittedBy,
    submittedUrl,
    submittedImage,
    submittedImages,
    reviewedAt,
    reviewedBy,
    ...evidenceConfig
  } = evidence;
  return {
    ...attachments,
    evidence: { ...evidenceConfig, status: "pending" },
  };
}

function getSubmittedEvidenceImages(evidence) {
  if (
    Array.isArray(evidence?.submittedImages) &&
    evidence.submittedImages.length > 0
  ) {
    return evidence.submittedImages.filter(
      (image) => image?.storagePath || image?.driveUrl,
    );
  }
  return evidence?.submittedImage?.storagePath ||
    evidence?.submittedImage?.driveUrl
    ? [evidence.submittedImage]
    : [];
}

// Keep a self-contained proof snapshot in the audit trail before daily reset
// clears the active task for the next assignee.
function getEvidenceHistoryPayload(evidence) {
  if (!evidence?.required) return null;
  return {
    submittedAt: evidence.submittedAt || null,
    submittedBy: evidence.submittedBy || "",
    submittedImages: getSubmittedEvidenceImages(evidence),
    status: evidence.status || "pending",
    reviewedAt: evidence.reviewedAt || null,
    reviewedBy: evidence.reviewedBy || "",
  };
}

function actorOwnsTask(actor, task) {
  const attachments = parseTaskAttachments(task.attachments);
  const recipients = Array.isArray(attachments?.assignment?.assignees)
    ? attachments.assignment.assignees
        .map((name) => normalizeActorName(name))
        .filter(Boolean)
    : [];
  const actorNames = [actor.username, actor.fullName]
    .map(normalizeActorName)
    .filter(Boolean);
  if (recipients.some((recipient) => actorNames.includes(recipient)))
    return true;
  const assignee = normalizeActorName(task.assignee);
  return assignee && actorNames.includes(assignee);
}

async function assertOperationalTaskAssignee(username) {
  const normalizedUsername = String(username || "").trim();
  if (!normalizedUsername) return;

  const user = await prisma.user.findUnique({
    where: { username: normalizedUsername },
  });
  if (!user || user.status !== "active") {
    throw new Error("Người được giao phải là tài khoản đang hoạt động.");
  }
  if (!isOperationalAssignee(user)) {
    throw new Error("Tài khoản này đã bị loại khỏi phân công vận hành.");
  }
}

async function assertDailyRotationAssignees(attachments) {
  const assignees = getDailyRotation(attachments);
  if (assignees.length < 2) {
    throw new Error(
      "Luân phiên theo ngày cần chọn ít nhất 2 nhân viên chính thức.",
    );
  }

  const attendanceConfig = await prisma.appConfig.findUnique({
    where: { key: "attendanceData" },
  });
  const attendanceData = attendanceConfig
    ? JSON.parse(attendanceConfig.value)
    : {};
  const officialUsernames = new Set(
    (Array.isArray(attendanceData.employees) ? attendanceData.employees : [])
      .filter((employee) => employee?.type === "Official")
      .map((employee) => String(employee.username || "").trim())
      .filter(Boolean),
  );

  for (const username of assignees) {
    if (!officialUsernames.has(username)) {
      throw new Error(
        `"${username}" không phải nhân viên chính thức, không thể đưa vào lịch luân phiên.`,
      );
    }
    await assertOperationalTaskAssignee(username);
  }
}

async function validateEvidenceAssignment(attachments, assignee) {
  if (!attachments?.evidence?.required) return;
  const rotationAssignees = getDailyRotation(attachments);
  if (rotationAssignees.length > 0) {
    await assertDailyRotationAssignees(attachments);
    return;
  }
  if (!assignee || !isFixedAssignee(attachments)) {
    throw new Error(
      "Công việc yêu cầu bằng chứng phải có người thực hiện cố định hoặc lịch luân phiên.",
    );
  }
  await assertOperationalTaskAssignee(assignee);
}

function isValidEvidenceImage(buffer, mimeType) {
  if (mimeType === "image/jpeg")
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  if (mimeType === "image/png")
    return (
      buffer.length >= 8 &&
      buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    );
  if (mimeType === "image/webp")
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString() === "RIFF" &&
      buffer.subarray(8, 12).toString() === "WEBP"
    );
  return false;
}

// SHA-256 only catches byte-for-byte duplicates. Browser compression can make
// the exact same photo produce different bytes, so use a small difference hash
// decoded by Electron as a second, server-side anti-reuse signal.
function getEvidenceVisualHash(buffer) {
  try {
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) return null;
    const bitmap = image
      .resize({ width: 9, height: 8, quality: "good" })
      .toBitmap();
    if (bitmap.length < 9 * 8 * 4) return null;
    const gray = (x, y) => {
      const offset = (y * 9 + x) * 4;
      // Electron bitmap pixels are BGRA on Windows. The weighted sum is
      // insensitive to this ordering for duplicate-photo comparison.
      return (
        bitmap[offset] * 0.114 +
        bitmap[offset + 1] * 0.587 +
        bitmap[offset + 2] * 0.299
      );
    };
    let hash = "";
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1)
        hash += gray(x, y) > gray(x + 1, y) ? "1" : "0";
    }
    return hash;
  } catch (error) {
    console.warn("Cannot calculate evidence visual hash:", error.message);
    return null;
  }
}

function evidenceVisualHashDistance(first, second) {
  if (!first || !second || first.length !== second.length) return Infinity;
  let distance = 0;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) distance += 1;
  }
  return distance;
}

const evidenceVisualHashCache = new Map();

async function getRecentEvidenceVisualHashes() {
  if (!evidenceStorage) return [];
  const candidates = [];
  try {
    const [historyConfig, tasks] = await Promise.all([
      prisma.appConfig.findUnique({ where: { key: "dailyTasksHistory" } }),
      prisma.dailyTask.findMany({
        where: { attachments: { not: null } },
        select: { attachments: true },
        orderBy: { completedAt: "desc" },
        take: 40,
      }),
    ]);
    const history = historyConfig?.value ? JSON.parse(historyConfig.value) : [];
    [...(Array.isArray(history) ? history : []), ...tasks].forEach((entry) => {
      const attachments = entry?.evidence
        ? { evidence: entry.evidence }
        : parseTaskAttachments(entry?.attachments);
      getSubmittedEvidenceImages(attachments?.evidence).forEach((image) => {
        if (image?.storagePath) candidates.push(image.storagePath);
      });
    });
  } catch (error) {
    console.warn("Cannot load recent evidence hashes:", error.message);
    return [];
  }

  const paths = [...new Set(candidates)].slice(0, 60);
  const hashes = await Promise.all(
    paths.map(async (storagePath) => {
      if (evidenceVisualHashCache.has(storagePath))
        return evidenceVisualHashCache.get(storagePath);
      try {
        const { data, error } = await evidenceStorage.storage
          .from(EVIDENCE_BUCKET)
          .download(storagePath);
        if (error || !data) return null;
        const hash = getEvidenceVisualHash(
          Buffer.from(await data.arrayBuffer()),
        );
        if (hash) evidenceVisualHashCache.set(storagePath, hash);
        return hash;
      } catch {
        return null;
      }
    }),
  );
  return hashes.filter(Boolean);
}

async function createEvidencePenaltyIfDue(task, now = new Date()) {
  const attachments = parseTaskAttachments(task.attachments);
  const evidence = attachments.evidence || {};
  if (!evidence.required) return null;
  if (task.type === "assignment")
    return createAssignmentEvidencePenaltyIfDue(task, now);
  if (!task.assignee || !isFixedAssignee(attachments)) return null;

  const dueAt = new Date(task.dueDate);
  if (Number.isNaN(dueAt.getTime()) || isDailyTaskPenaltyRestDay(dueAt))
    return null;
  // Daily work is only overdue once its calendar day has ended. This is
  // independent of legacy stored times such as 19:00 or 20:00.
  const penaltyAt = getDailyTaskEvidencePenaltyAt(dueAt);
  if (now < penaltyAt) return null;
  const submittedAt = evidence.submittedAt
    ? new Date(evidence.submittedAt)
    : null;
  const hasSubmittedImage =
    getSubmittedEvidenceImages(evidence).length > 0 ||
    Boolean(evidence.imageExpiredAt && evidence.submittedAt);
  // Compatibility with tasks submitted by older clients that left the task
  // pending: a real image submitted within the grace period must not be fined.
  // A completed flag alone is not proof and must never bypass the penalty.
  if (
    hasSubmittedImage &&
    submittedAt &&
    !Number.isNaN(submittedAt.getTime()) &&
    submittedAt <= penaltyAt &&
    evidence.status !== "rejected"
  )
    return null;

  const dueKey = dueAt.toISOString();
  const recipients = await getActiveTaskRecipients(
    getTaskRecipients(task, attachments),
  );
  if (recipients.length === 0) return [];
  const totalFine = Number(evidence.penaltyAmount) || 30000;
  const baseFine = Math.floor(totalFine / recipients.length);
  const remainder = totalFine % recipients.length;
  const created = [];
  // Migrate the old single-recipient record before writing split penalties.
  const legacyKey = `${TASK_PENALTY_KEY_PREFIX}${task.id}:${dueKey}`;
  await prisma.appConfig.deleteMany({ where: { key: legacyKey } });

  for (const [index, assignee] of recipients.entries()) {
    const key = `${TASK_PENALTY_KEY_PREFIX}${task.id}:${dueKey}:${assignee}`;
    const penalty = {
      id: key,
      taskId: task.id,
      assignee,
      amount: baseFine + (index < remainder ? 1 : 0),
      dueAt: dueAt.toISOString(),
      penaltyAt: penaltyAt.toISOString(),
      type: "Không nộp bằng chứng đúng hạn",
      detail: `${task.title} - hết ngày chưa nộp bằng chứng`,
      source: "daily_task_evidence_overdue",
    };
    try {
      // Several desktop clients may reconcile at the same minute. Let the
      // database accept the first writer and silently ignore the rest.
      const write = await prisma.appConfig.createMany({
        data: { key, value: JSON.stringify(penalty) },
        skipDuplicates: true,
      });
      if (write.count === 0) continue;
      created.push(penalty);
      void logActivity({
        module: "daily_tasks",
        action: "PENALTY",
        recordId: task.id,
        recordName: task.title,
        description: `Tự động phạt ${assignee}: ${penalty.amount}đ vì hết ngày chưa nộp bằng chứng`,
        severity: "WARNING",
      });
    } catch (error) {
      throw error;
    }
  }
  return created;
}

// Remove only automatic daily-task fines written by the former "deadline +
// 20 minutes" rule. Manual payroll deductions and handover penalties use
// different sources and are intentionally untouched.
async function cleanupPrematureDailyEvidencePenalties() {
  const rows = await prisma.appConfig.findMany({
    where: { key: { startsWith: TASK_PENALTY_KEY_PREFIX } },
    select: { key: true, value: true },
  });
  const invalidKeys = rows.flatMap((row) => {
    try {
      const penalty = JSON.parse(row.value);
      if (penalty?.source !== "daily_task_evidence_overdue") return [];
      const dueAt = new Date(penalty?.dueAt);
      const penaltyAt = new Date(penalty?.penaltyAt);
      if (Number.isNaN(dueAt.getTime()) || Number.isNaN(penaltyAt.getTime()))
        return [];
      return penaltyAt < getDailyTaskEvidencePenaltyAt(dueAt) ? [row.key] : [];
    } catch {
      return [];
    }
  });
  if (invalidKeys.length > 0) {
    await prisma.appConfig.deleteMany({ where: { key: { in: invalidKeys } } });
  }
  return invalidKeys.length;
}

function getAssignmentEvidencePenaltyAmount(attachments, evidence) {
  const assignmentAmount = Number(
    attachments?.assignment?.evidencePenaltyAmount ??
      attachments?.assignment?.deadlinePenaltyAmount,
  );
  if (Number.isFinite(assignmentAmount) && assignmentAmount >= 0)
    return assignmentAmount;

  const evidenceAmount = Number(evidence?.penaltyAmount);
  return Number.isFinite(evidenceAmount) && evidenceAmount >= 0
    ? evidenceAmount
    : 30000;
}

function getAssignmentEvidencePenaltyCheckpoints(dueAt, now) {
  // Bàn giao phạt ngay tại deadline; the daily-task grace period does not
  // apply to this escalating assignment policy.
  const firstPenaltyAt = new Date(dueAt);
  if (now < firstPenaltyAt) return [];

  const checkpoints = [{ cycle: 1, multiplier: 1, penaltyAt: firstPenaltyAt }];
  const nextPenaltyAt = new Date(dueAt);
  nextPenaltyAt.setDate(nextPenaltyAt.getDate() + 1);

  for (let cycle = 2; nextPenaltyAt <= now; cycle += 1) {
    checkpoints.push({
      cycle,
      multiplier: cycle,
      penaltyAt: new Date(nextPenaltyAt),
    });
    nextPenaltyAt.setDate(nextPenaltyAt.getDate() + 1);
  }
  return checkpoints;
}

function getAssignmentEvidencePenaltyAt(dueAt, cycle) {
  if (cycle === 1) {
    return new Date(dueAt);
  }
  const penaltyAt = new Date(dueAt);
  penaltyAt.setDate(penaltyAt.getDate() + cycle - 1);
  return penaltyAt;
}

function getAssignmentPenaltyScheduleAnchor(task, dueAt) {
  const createdAt = task?.createdAt ? new Date(task.createdAt) : null;
  // A task may be created after its selected deadline. Do not backfill fines
  // for days before it existed: begin its escalation on the creation date at
  // the configured deadline time instead.
  if (!createdAt || Number.isNaN(createdAt.getTime()) || createdAt <= dueAt)
    return dueAt;
  const anchor = new Date(createdAt);
  anchor.setHours(
    dueAt.getHours(),
    dueAt.getMinutes(),
    dueAt.getSeconds(),
    dueAt.getMilliseconds(),
  );
  return anchor;
}

// v1.0.336 and earlier escalated assignments at 07:00, ahead of a 19:00
// deadline. Repair the records on reconciliation so premature cycles never
// reach payroll and historical records retain the correct scheduled time.
async function repairLegacyAssignmentPenaltySchedule(
  task,
  dueAt,
  scheduleAnchor,
  now,
) {
  const dueKey = dueAt.toISOString();
  const prefix = `${ASSIGNMENT_EVIDENCE_PENALTY_KEY_PREFIX}${task.id}:${dueKey}:`;
  const legacyPrefix = `${TASK_PENALTY_KEY_PREFIX}${task.id}:${dueKey}:`;
  const records = await prisma.appConfig.findMany({
    where: {
      OR: [
        { key: { startsWith: prefix } },
        { key: { startsWith: legacyPrefix } },
      ],
    },
    select: { key: true, value: true },
  });

  for (const record of records) {
    let penalty;
    try {
      penalty = JSON.parse(record.value);
    } catch {
      continue;
    }
    const cycle = Number(penalty?.cycle) || 1;

    const expectedAt = getAssignmentEvidencePenaltyAt(scheduleAnchor, cycle);
    if (expectedAt > now) {
      // Another caller may be reconciling the same task. deleteMany is
      // intentionally idempotent when the first caller already removed it.
      await prisma.appConfig.deleteMany({ where: { key: record.key } });
      continue;
    }

    if (penalty.penaltyAt !== expectedAt.toISOString()) {
      await prisma.appConfig.updateMany({
        where: { key: record.key },
        data: {
          value: JSON.stringify({
            ...penalty,
            cycle,
            multiplier: Number(penalty?.multiplier) || cycle,
            penaltyAt: expectedAt.toISOString(),
          }),
        },
      });
    }
  }
}

async function createAssignmentEvidencePenaltyIfDue(task, now = new Date()) {
  const attachments = parseTaskAttachments(task.attachments);
  const evidence = attachments.evidence || {};
  if (task.type !== "assignment" || !evidence.required) return null;

  // Once proof has been submitted, it stops the escalation. An admin can
  // still review or reject it, but no additional missed-submission fines run.
  const hasSubmittedImage =
    getSubmittedEvidenceImages(evidence).length > 0 ||
    Boolean(evidence.imageExpiredAt && evidence.submittedAt);
  if (
    hasSubmittedImage &&
    evidence.submittedAt &&
    evidence.status !== "rejected"
  )
    return [];

  const dueAt = new Date(task.dueDate);
  if (Number.isNaN(dueAt.getTime())) return null;
  const recipients = await getActiveTaskRecipients(
    getTaskRecipients(task, attachments),
  );
  if (recipients.length === 0) return [];
  const scheduleAnchor = getAssignmentPenaltyScheduleAnchor(task, dueAt);

  await repairLegacyAssignmentPenaltySchedule(task, dueAt, scheduleAnchor, now);

  const checkpoints = getAssignmentEvidencePenaltyCheckpoints(
    scheduleAnchor,
    now,
  );
  if (checkpoints.length === 0) return [];

  const dueKey = dueAt.toISOString();
  const totalFine = getAssignmentEvidencePenaltyAmount(attachments, evidence);
  const created = [];

  for (const checkpoint of checkpoints) {
    // Assignment penalty is configured per recipient. A handover to two
    // people at 100,000đ therefore creates two 100,000đ penalties.
    const finePerRecipient = totalFine * checkpoint.multiplier;

    for (const assignee of recipients) {
      // The old single-penalty policy used this key. Treat it as cycle 1
      // so existing fines are retained without creating a duplicate.
      const legacyKey = `${TASK_PENALTY_KEY_PREFIX}${task.id}:${dueKey}:${assignee}`;
      if (checkpoint.cycle === 1) {
        const legacyPenalty = await prisma.appConfig.findUnique({
          where: { key: legacyKey },
        });
        if (legacyPenalty) continue;
      }

      const key = `${ASSIGNMENT_EVIDENCE_PENALTY_KEY_PREFIX}${task.id}:${dueKey}:${checkpoint.cycle}:${assignee}`;
      const penalty = {
        id: key,
        taskId: task.id,
        assignee,
        amount: finePerRecipient,
        dueAt: dueKey,
        penaltyAt: checkpoint.penaltyAt.toISOString(),
        cycle: checkpoint.cycle,
        multiplier: checkpoint.multiplier,
        type: "Không nộp bằng chứng bàn giao",
        detail: `${task.title} - lần ${checkpoint.cycle}: chưa nộp bằng chứng, phạt x${checkpoint.multiplier}`,
        source: "assignment_evidence_overdue",
      };
      try {
        const write = await prisma.appConfig.createMany({
          data: { key, value: JSON.stringify(penalty) },
          skipDuplicates: true,
        });
        if (write.count === 0) continue;
        created.push(penalty);
        void logActivity({
          module: "daily_tasks",
          action: "PENALTY",
          recordId: task.id,
          recordName: task.title,
          description: `Phạt bàn giao lần ${checkpoint.cycle} ${assignee}: ${penalty.amount}đ vì chưa nộp bằng chứng`,
          severity: "WARNING",
        });
      } catch (error) {
        throw error;
      }
    }
  }
  return created;
}

let evidencePenaltyReconcilePromise = null;
function reconcileEvidencePenalties() {
  // The page loads tasks and penalties in parallel, while a timer also runs
  // every minute. Share one reconciliation to avoid duplicate repair writes.
  if (evidencePenaltyReconcilePromise) return evidencePenaltyReconcilePromise;
  evidencePenaltyReconcilePromise = (async () => {
    await cleanupPrematureDailyEvidencePenalties();
    const tasks = await prisma.dailyTask.findMany({
      // Completed rows are included deliberately: old clients could mark a
      // proof-required task complete without uploading an image.
      where: { attachments: { not: null } },
      // Penalty reconciliation only needs these fields. Avoid sending full
      // task descriptions and metadata across the database connection.
      select: {
        id: true,
        title: true,
        assignee: true,
        dueDate: true,
        status: true,
        type: true,
        attachments: true,
      },
    });
    const created = [];
    for (const task of tasks) {
      const penalties = await createEvidencePenaltyIfDue(task);
      if (Array.isArray(penalties)) created.push(...penalties);
    }
    return created;
  })();
  return evidencePenaltyReconcilePromise.finally(() => {
    evidencePenaltyReconcilePromise = null;
  });
}

async function reconcileSnapshotEvidencePenalties(now = new Date()) {
  const today = getLocalDateKey(now);
  await cleanupPrematureDailyEvidencePenalties();
  const [snapshotRows, existingPenaltyRows] = await Promise.all([
    prisma.appConfig.findMany({
      where: { key: { startsWith: "dailyTasksSnapshot:" } },
      select: { key: true, value: true },
    }),
    prisma.appConfig.findMany({
      where: { key: { startsWith: TASK_PENALTY_KEY_PREFIX } },
      select: { key: true },
    }),
  ]);
  const existingPenaltyKeys = new Set(
    existingPenaltyRows.map((row) => row.key),
  );
  const created = [];
  for (const row of snapshotRows) {
    const snapshotDate = String(row.key || "").slice(
      "dailyTasksSnapshot:".length,
    );
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) || snapshotDate >= today)
      continue;
    let snapshot;
    try {
      snapshot = JSON.parse(row.value);
    } catch {
      continue;
    }
    for (const task of Array.isArray(snapshot?.tasks) ? snapshot.tasks : []) {
      if ((task?.type || "daily") !== "daily") continue;
      const dueAt = new Date(task?.dueDate);
      const attachments = parseTaskAttachments(task?.attachments);
      const recipients = getTaskRecipients(task, attachments);
      if (!Number.isNaN(dueAt.getTime()) && recipients.length > 0) {
        const dueKey = dueAt.toISOString();
        const expectedKeys = recipients.map(
          (assignee) =>
            `${TASK_PENALTY_KEY_PREFIX}${task.id}:${dueKey}:${assignee}`,
        );
        if (expectedKeys.every((key) => existingPenaltyKeys.has(key))) continue;
      }
      const penalties = await createEvidencePenaltyIfDue(task, now);
      if (Array.isArray(penalties)) {
        created.push(...penalties);
        penalties.forEach((penalty) => existingPenaltyKeys.add(penalty.id));
      }
    }
  }
  return created;
}

async function cleanupExpiredEvidenceImages() {
  if (!evidenceStorage) return;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const tasks = await prisma.dailyTask.findMany({
    where: { attachments: { not: null } },
  });
  for (const task of tasks) {
    const attachments = parseTaskAttachments(task.attachments);
    const evidence = attachments?.evidence;
    const submittedAt = evidence?.submittedAt
      ? new Date(evidence.submittedAt).getTime()
      : NaN;
    const submittedImages = getSubmittedEvidenceImages(evidence);
    const storageImages = submittedImages.filter((image) => image?.storagePath);
    if (
      storageImages.length === 0 ||
      !Number.isFinite(submittedAt) ||
      submittedAt > cutoff
    )
      continue;

    await evidenceStorage.storage
      .from(EVIDENCE_BUCKET)
      .remove(storageImages.map((image) => image.storagePath))
      .catch(() => {});
    // Keep the SHA-256 registry after removing the file. The image itself
    // expires after seven days, but its fingerprint must remain to prevent
    // the same proof from being uploaded again later.
    const remainingImages = submittedImages.filter(
      (image) => !image?.storagePath,
    );
    evidence.submittedImage = undefined;
    evidence.submittedImages =
      remainingImages.length > 0 ? remainingImages : undefined;
    evidence.imageExpiredAt = new Date().toISOString();
    await prisma.dailyTask.update({
      where: { id: task.id },
      data: { attachments: JSON.stringify(attachments) },
    });
  }
}

// Do not scan every open desktop process once a minute. Reconciliation runs
// when Daily Tasks is opened or an evidence action occurs, preventing repeated
// database egress from every staff machine while keeping penalties consistent.
setTimeout(
  () =>
    void cleanupExpiredEvidenceImages().catch((error) =>
      console.error("Evidence cleanup startup error:", error),
    ),
  45 * 1000,
);
setInterval(
  () =>
    void cleanupExpiredEvidenceImages().catch((error) =>
      console.error("Evidence cleanup error:", error),
    ),
  24 * 60 * 60 * 1000,
);

// Get all tasks with filters
ipcMain.handle("dailyTasks:uploadEvidenceImage", async (_event, payload) => {
  try {
    requireRole();
    if (!evidenceStorage)
      throw new Error(getEvidenceStorageUnavailableMessage());
    const { taskId, mimeType, data, hash } = payload || {};
    if (!taskId || !mimeType || !data || !hash)
      throw new Error("Dữ liệu ảnh bằng chứng không hợp lệ.");
    const base64 = String(data).replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length > MAX_EVIDENCE_STORAGE_BYTES)
      throw new Error("Ảnh sau nén không được vượt quá 1 MB.");
    const extension =
      mimeType === "image/png"
        ? "png"
        : mimeType === "image/webp"
          ? "webp"
          : "jpg";
    const storagePath = `daily-tasks/${taskId}/${new Date().toISOString().slice(0, 10)}/${hash}.${extension}`;
    const { error } = await evidenceStorage.storage
      .from(EVIDENCE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: false,
      });
    if (error) throw error;
    return { success: true, data: { storagePath } };
  } catch (error) {
    console.error("Evidence image upload error:", error);
    return { success: false, error: error.message };
  }
});

// Force a non-admin user to change their current password on the next login.
// Unlike resetPassword, this does not overwrite the existing password.
ipcMain.handle("users:forcePasswordChange", async (event, userId) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");

    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0)
      throw new Error("Mã người dùng không hợp lệ.");
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new Error("Người dùng không tồn tại.");
    if (user.role === "admin")
      throw new Error("Không áp dụng bắt đổi mật khẩu cho tài khoản quản trị.");

    await prisma.user.update({
      where: { id },
      data: { forcePasswordChange: true },
    });
    await revokeRememberTokensForUser(id);
    void logActivity({
      module: "users",
      action: "FORCE_PASSWORD_CHANGE",
      description: `Bắt đổi mật khẩu ở lần đăng nhập tiếp theo: ${user.username}`,
      recordName: user.username,
      userName: currentSession?.username || "admin",
    });
    return { success: true };
  } catch (error) {
    console.error("Force password change error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("dailyTasks:submitEvidence", async (_event, payload) => {
  const uploadedDriveFileIds = [];
  const imageRegistryKeys = [];
  try {
    const driveStatus = await ensureDriveReady();
    if (!driveStatus.success) throw new Error(driveStatus.error);
    const evidenceFolderId = await getOrCreateEvidenceDriveFolder();
    const drive = driveStatus.drive;
    const actor = await getCurrentActor();
    const task = await prisma.dailyTask.findUnique({
      where: { id: Number(payload?.taskId) },
    });
    if (!task || task.status === "completed")
      throw new Error("Công việc không còn ở trạng thái chờ nộp bằng chứng.");
    const attachments = task.attachments ? JSON.parse(task.attachments) : {};
    const required = attachments?.evidence?.required;
    if (!required) throw new Error("Công việc này không yêu cầu bằng chứng.");
    if (!task.assignee || !isFixedAssignee(attachments))
      throw new Error(
        "Công việc cần bằng chứng phải được giao cố định cho một nhân viên trước khi nộp.",
      );
    if (
      actor.role !== "admin" &&
      !isTestOperatorActor(actor) &&
      !actorOwnsTask(actor, task)
    )
      throw new Error(
        "Bạn chỉ có thể nộp bằng chứng cho công việc được giao cho mình.",
      );

    const images = Array.isArray(payload?.images)
      ? payload.images
      : payload?.image
        ? [payload.image]
        : [];
    if (images.length === 0)
      throw new Error("Vui lòng chọn ít nhất một ảnh bằng chứng.");
    if (images.length > MAX_EVIDENCE_IMAGES) {
      throw new Error(
        `Chỉ được nộp tối đa ${MAX_EVIDENCE_IMAGES} ảnh bằng chứng.`,
      );
    }

    const existingEvidenceHashes = await prisma.appConfig.findMany({
      where: { key: { startsWith: "dailyEvidenceHash:" } },
      select: { value: true },
    });
    const knownVisualHashes = existingEvidenceHashes
      .map((entry) => {
        try {
          return JSON.parse(entry.value)?.visualHash || null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    // Older evidence records only stored a byte hash. Rebuild visual hashes
    // from recent files too, so a photo submitted before this upgrade cannot
    // be reused simply by recompressing it in the browser.
    knownVisualHashes.push(...(await getRecentEvidenceVisualHashes()));
    const submittedImages = [];
    for (const image of images) {
      if (
        !image?.data ||
        !["image/jpeg", "image/png", "image/webp"].includes(image.mimeType)
      )
        throw new Error("Ảnh bằng chứng không hợp lệ.");
      const buffer = Buffer.from(
        String(image.data).replace(/^data:[^;]+;base64,/, ""),
        "base64",
      );
      if (!buffer.length || buffer.length > MAX_EVIDENCE_STORAGE_BYTES)
        throw new Error("Ảnh sau nén phải không vượt quá 1 MB.");
      if (!isValidEvidenceImage(buffer, image.mimeType))
        throw new Error("Dữ liệu tải lên không phải ảnh hợp lệ.");
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      const visualHash = getEvidenceVisualHash(buffer);
      if (
        visualHash &&
        knownVisualHashes.some(
          (existingHash) =>
            evidenceVisualHashDistance(visualHash, existingHash) <= 4,
        )
      ) {
        throw new Error(
          "Ảnh này trùng hoặc quá giống bằng chứng đã nộp trước đó. Hãy chụp ảnh mới tại thời điểm thực hiện công việc.",
        );
      }
      const registryKey = `dailyEvidenceHash:${hash}`;
      try {
        await prisma.appConfig.create({
          data: {
            key: registryKey,
            value: JSON.stringify({
              taskId: task.id,
              createdAt: new Date().toISOString(),
              visualHash,
            }),
          },
        });
        imageRegistryKeys.push(registryKey);
        if (visualHash) knownVisualHashes.push(visualHash);
      } catch (error) {
        if (error.code === "P2002")
          throw new Error(
            "Ảnh này đã được dùng làm bằng chứng cho công việc khác.",
          );
        throw error;
      }
      const ext =
        image.mimeType === "image/png"
          ? "png"
          : image.mimeType === "image/webp"
            ? "webp"
            : "jpg";
      const driveFileName = `BANGCHUNG_TASK-${task.id}_${new Date().toISOString().replace(/[:.]/g, "-")}_${hash.slice(0, 12)}.${ext}`;
      const uploaded = await uploadToDrive(
        drive,
        evidenceFolderId,
        driveFileName,
        buffer,
        image.mimeType,
      );
      if (!uploaded?.fileId || !uploaded.webViewLink)
        throw new Error("Không thể tải ảnh bằng chứng lên Google Drive.");
      uploadedDriveFileIds.push(uploaded.fileId);
      submittedImages.push({
        name: image.name || `evidence.${ext}`,
        mimeType: image.mimeType,
        driveUrl: uploaded.webViewLink,
        hash,
      });
    }

    // Reconcile once more immediately before completion. This closes the
    // gap where the desktop app was offline when the 20-minute grace ended.
    await createEvidencePenaltyIfDue(task);
    // Evidence is the completion proof. Once the assigned user submits a
    // valid file, approve and complete the task immediately for every task
    // type; no manager review queue is required.
    const autoCompleteEvidenceTask = true;
    const submittedAt = new Date().toISOString();
    const evidence = {
      ...attachments.evidence,
      method: "image",
      status: "approved",
      submittedUrl: undefined,
      submittedImage: undefined,
      submittedImages,
      submittedAt,
      submittedBy: actor.fullName,
      reviewedAt: submittedAt,
      reviewedBy: "Hệ thống",
    };
    await prisma.dailyTask.update({
      where: { id: task.id },
      data: {
        attachments: JSON.stringify({ ...attachments, evidence }),
        status: "completed",
        completedAt: new Date(),
        verifier: "Hệ thống",
      },
    });
    await appendDailyTaskHistory({
      taskId: task.id,
      taskTitle: task.title,
      category: task.category,
      assignee: actor.fullName,
      verifier: "",
      action: "evidence_approved",
      timestamp: evidence.submittedAt,
      evidence: getEvidenceHistoryPayload(evidence),
      description: `Đã nộp bằng chứng và tự động hoàn thành: "${task.title}"`,
    });
    return {
      success: true,
      data: { evidence, autoCompleted: autoCompleteEvidenceTask },
    };
  } catch (error) {
    await Promise.all(
      uploadedDriveFileIds.map(async (fileId) => {
        const drive = getDriveClient();
        if (drive) await drive.files.delete({ fileId }).catch(() => {});
      }),
    );
    await Promise.all(
      imageRegistryKeys.map((key) =>
        prisma.appConfig.delete({ where: { key } }).catch(() => {}),
      ),
    );
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  "dailyTasks:reviewEvidence",
  async (_event, taskId, approved) => {
    try {
      const actor = await getCurrentActor();
      if (!["admin", "manager"].includes(actor.role))
        throw new Error("Chỉ quản lý hoặc admin được duyệt bằng chứng.");

      const task = await prisma.dailyTask.findUnique({
        where: { id: Number(taskId) },
      });
      if (!task) throw new Error("Không tìm thấy công việc.");
      const attachments = parseTaskAttachments(task.attachments);
      const evidence = attachments.evidence || {};
      if (!evidence.required || evidence.status !== "submitted")
        throw new Error("Công việc không có bằng chứng chờ duyệt.");

      const reviewedAt = new Date().toISOString();
      const reviewedEvidence = {
        ...evidence,
        status: approved ? "approved" : "rejected",
        reviewedAt,
        reviewedBy: actor.fullName,
      };
      const updatedTask = await prisma.dailyTask.update({
        where: { id: task.id },
        data: {
          attachments: JSON.stringify({
            ...attachments,
            evidence: reviewedEvidence,
          }),
          status: approved ? "completed" : "pending",
          completedAt: approved ? new Date() : null,
          verifier: approved ? actor.fullName : "",
        },
      });

      let penalty = null;
      if (!approved) penalty = await createEvidencePenaltyIfDue(updatedTask);
      await appendDailyTaskHistory({
        taskId: task.id,
        taskTitle: task.title,
        category: task.category,
        assignee: task.assignee,
        verifier: actor.fullName,
        action: approved ? "evidence_approved" : "evidence_rejected",
        timestamp: reviewedAt,
        evidence: getEvidenceHistoryPayload(reviewedEvidence),
        description: approved
          ? `Đã duyệt bằng chứng: "${task.title}"`
          : `Đã từ chối bằng chứng: "${task.title}"`,
      });
      return { success: true, data: { task: updatedTask, penalty } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "dailyTasks:completeRegularTask",
  async (_event, taskId, payload = {}) => {
    try {
      const actor = await getCurrentActor();
      const task = await prisma.dailyTask.findUnique({
        where: { id: Number(taskId) },
      });
      if (!task || task.status === "completed")
        throw new Error("Công việc không còn ở trạng thái chờ hoàn thành.");
      const attachments = parseTaskAttachments(task.attachments);
      if (attachments?.evidence?.required)
        throw new Error(
          "Công việc này phải nộp bằng chứng, không thể tick hoàn thành trực tiếp.",
        );
      if (
        isFixedAssignee(attachments) &&
        !actorOwnsTask(actor, task) &&
        actor.role !== "admin" &&
        !isTestOperatorActor(actor)
      ) {
        throw new Error(
          "Bạn chỉ có thể hoàn thành công việc được giao cố định cho mình.",
        );
      }
      if (
        task.assignee &&
        !actorOwnsTask(actor, task) &&
        actor.role !== "admin" &&
        !isTestOperatorActor(actor)
      ) {
        throw new Error("Công việc này đã được người khác nhận.");
      }

      const verifierName = String(payload.verifier || "").trim();
      const activeUsers = await prisma.user.findMany({
        where: { status: "active" },
      });
      const verifier = activeUsers.find((user) => {
        const key = normalizeActorName(verifierName);
        return (
          key &&
          (normalizeActorName(user.username) === key ||
            normalizeActorName(user.fullName) === key)
        );
      });
      if (!verifier || !["admin", "manager"].includes(verifier.role))
        throw new Error(
          "Người xác nhận phải là tài khoản quản lý hoặc admin đang hoạt động.",
        );
      if (!isOperationalAssignee(verifier))
        throw new Error(
          "Tài khoản người xác nhận đã bị loại khỏi phân công vận hành.",
        );
      if (verifier.id === actor.id)
        throw new Error(
          "Người thực hiện không thể tự xác nhận công việc của mình.",
        );

      const assignee =
        actor.role === "admin" && payload.assignee
          ? String(payload.assignee)
          : task.assignee || actor.fullName;
      const updated = await prisma.dailyTask.update({
        where: { id: task.id },
        data: {
          status: "completed",
          completedAt: new Date(),
          assignee,
          verifier: verifier.fullName || verifier.username,
        },
      });
      await appendDailyTaskHistory({
        taskId: task.id,
        taskTitle: task.title,
        category: task.category,
        assignee: updated.assignee,
        verifier: updated.verifier || "",
        action: "completed",
        timestamp:
          updated.completedAt?.toISOString() || new Date().toISOString(),
        description: `Completed task: "${task.title}"`,
      });
      return { success: true, data: updated };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "dailyTasks:getEvidenceImageUrl",
  async (_event, taskId, requestedPath = "") => {
    try {
      const actor = await getCurrentActor();
      // This endpoint signs a Supabase Storage object. Initializing Drive and
      // looking up/creating its folder here added a network round-trip to
      // every image preview even though Drive is not used at all.
      if (!evidenceStorage)
        throw new Error(getEvidenceStorageUnavailableMessage());
      const task = await prisma.dailyTask.findUnique({
        where: { id: Number(taskId) },
      });
      if (!task) throw new Error("Không tìm thấy công việc.");
      if (
        actor.role !== "admin" &&
        !isTestOperatorActor(actor) &&
        !actorOwnsTask(actor, task)
      )
        throw new Error("Bạn không có quyền xem bằng chứng này.");
      const attachments = task?.attachments ? JSON.parse(task.attachments) : {};
      const activePaths = getSubmittedEvidenceImages(attachments?.evidence)
        .map((image) => image.storagePath)
        .filter(Boolean);
      let storagePath = requestedPath || activePaths[0] || "";
      if (requestedPath && !activePaths.includes(requestedPath)) {
        const historyConfig = await prisma.appConfig.findUnique({
          where: { key: "dailyTasksHistory" },
        });
        const history = historyConfig ? JSON.parse(historyConfig.value) : [];
        const archivedEvidence = history.find(
          (entry) =>
            Number(entry?.taskId) === task.id &&
            getSubmittedEvidenceImages(entry?.evidence).some(
              (image) => image.storagePath === requestedPath,
            ),
        );
        if (!archivedEvidence)
          throw new Error("Archived evidence was not found.");
        storagePath = requestedPath;
      }
      if (!storagePath) throw new Error("Không tìm thấy ảnh bằng chứng.");
      const { data, error } = await evidenceStorage.storage
        .from(EVIDENCE_BUCKET)
        .createSignedUrl(storagePath, 300);
      if (error) throw error;
      return { success: true, data: { url: data.signedUrl } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

// Google Drive webView/webContent links are not image URLs and private files
// cannot be rendered by <img> without the OAuth session. Fetch the file through
// the authenticated Drive client and return a short-lived data URL instead.
ipcMain.handle(
  "dailyTasks:getDriveEvidenceImageUrl",
  async (_event, taskId, driveUrl, mimeType = "image/jpeg") => {
    try {
      const actor = await getCurrentActor();
      const driveStatus = await ensureDriveReady();
      if (!driveStatus.success) throw new Error(driveStatus.error);
      const drive = driveStatus.drive;
      const task = await prisma.dailyTask.findUnique({
        where: { id: Number(taskId) },
      });
      if (!task) throw new Error("Không tìm thấy công việc.");
      if (
        actor.role !== "admin" &&
        !isTestOperatorActor(actor) &&
        !actorOwnsTask(actor, task)
      ) {
        throw new Error("Bạn không có quyền xem bằng chứng này.");
      }
      const fileId = String(driveUrl || "").match(/[-\w]{25,}/)?.[0];
      if (!fileId) throw new Error("Liên kết Google Drive không hợp lệ.");
      const allowedMimeTypes = new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
      ]);
      const contentType = allowedMimeTypes.has(mimeType)
        ? mimeType
        : "image/jpeg";
      const response = await drive.files.get(
        { fileId, alt: "media" },
        { responseType: "arraybuffer" },
      );
      const buffer = Buffer.from(response.data);
      if (!buffer.length || buffer.length > 8 * 1024 * 1024)
        throw new Error("Ảnh bằng chứng không hợp lệ hoặc quá lớn.");
      return {
        success: true,
        data: {
          url: `data:${contentType};base64,${buffer.toString("base64")}`,
        },
      };
    } catch (error) {
      console.error("Drive evidence image error:", error);
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle("dailyTasks:listEvidencePenalties", async () => {
  try {
    requireRole();
    await reconcileEvidencePenalties();
    await reconcileSnapshotEvidencePenalties();
    const rows = await prisma.appConfig.findMany({
      where: {
        OR: [
          { key: { startsWith: TASK_PENALTY_KEY_PREFIX } },
          { key: { startsWith: ASSIGNMENT_EVIDENCE_PENALTY_KEY_PREFIX } },
        ],
      },
    });
    const penalties = rows
      .map((row) => {
        try {
          return JSON.parse(row.value);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return {
      success: true,
      // Never expose a system fine whose deadline falls on Sunday or a
      // fixed holiday, including a row generated by an older version.
      data: penalties.filter(
        (penalty) =>
          !penalty?.dueAt ||
          !isDailyTaskPenaltyRestDay(new Date(penalty.dueAt)),
      ),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("dailyTasks:list", async (event, filters = {}) => {
  try {
    requireRole();
    const {
      status,
      assignee,
      startDate,
      endDate,
      priority,
      type,
      excludeCompleted,
      summary,
      maintenance,
    } = filters;
    // Expensive maintenance belongs to the full Daily Tasks screen. Global
    // alerts poll a compact read model and must not start a full DB scan.
    if (maintenance) {
      await repairRecurringAssignmentRestDays();
      await dedupeOpenRecurringAssignments();
      await reconcileRecurringAssignments();
      await dedupeOpenRecurringAssignments();
      void reconcileEvidencePenalties().catch((error) =>
        console.error("Evidence penalty scan error:", error),
      );
      void reconcileSnapshotEvidencePenalties().catch((error) =>
        console.error("Historical evidence penalty scan error:", error),
      );
      void cleanupExpiredEvidenceImages().catch((error) =>
        console.error("Evidence cleanup error:", error),
      );
    }

    const where = {};

    if (excludeCompleted) {
      where.status = { not: "completed" };
    } else if (status && status !== "all") {
      where.status = status;
    }

    if (type && type !== "all") {
      where.type = type;
    }

    if (assignee && assignee !== "all") {
      where.assignee = assignee;
    }

    if (priority && priority !== "all") {
      where.priority = priority;
    }

    if (startDate || endDate) {
      where.dueDate = {};
      if (startDate) where.dueDate.gte = new Date(startDate);
      if (endDate) where.dueDate.lte = new Date(endDate);
    }

    const tasks = await prisma.dailyTask.findMany({
      where,
      ...(summary
        ? {
            select: {
              id: true,
              title: true,
              assignee: true,
              dueDate: true,
              status: true,
              type: true,
              attachments: true,
            },
          }
        : {}),
      orderBy: [{ status: "asc" }, { dueDate: "asc" }],
    });

    return { success: true, data: tasks };
  } catch (error) {
    console.error("Error listing tasks:", error);
    return { success: false, error: error.message };
  }
});

// Create new task
ipcMain.handle("dailyTasks:create", async (event, taskData) => {
  try {
    requireRole("admin");
    const attachments = parseTaskAttachments(taskData.attachments);
    const rotationAssignee = getDailyRotationAssignee(attachments);
    if (rotationAssignee)
      taskData = { ...taskData, assignee: rotationAssignee };
    await assertOperationalTaskAssignee(taskData.assignee);
    await validateEvidenceAssignment(attachments, taskData.assignee);
    if (rotationAssignee) await assertDailyRotationAssignees(attachments);
    const task = await prisma.dailyTask.create({
      data: {
        ...taskData,
        // This endpoint creates recurring daily work only. Assignment
        // deadlines use createAssignments and retain their own time.
        type: "daily",
        dueDate: getDailyTaskEndOfDay(taskData.dueDate),
        tags: taskData.tags ? JSON.stringify(taskData.tags) : null,
        attachments: taskData.attachments
          ? JSON.stringify(taskData.attachments)
          : null,
      },
    });

    void logActivity({
      module: "system",
      action: "CREATE",
      description: `Tạo công việc "${task.title}"`,
      recordName: task.title,
      userName: taskData.assignee || "Chưa phân công",
    });
    return { success: true, data: task };
  } catch (error) {
    console.error("Error creating task:", error);
    return { success: false, error: error.message };
  }
});

// Create a handover for multiple recipients atomically. A failed recipient
// validation must never leave a partially-created handover behind.
ipcMain.handle(
  "dailyTasks:createAssignments",
  async (event, taskData, assignees) => {
    try {
      requireRole("admin");
      const recipients = [
        ...new Set(
          (Array.isArray(assignees) ? assignees : [])
            .map((name) => String(name || "").trim())
            .filter(Boolean),
        ),
      ];
      if (recipients.length === 0)
        throw new Error("Chọn ít nhất một người nhận.");

      const attachments = parseTaskAttachments(taskData.attachments);
      // Handover tasks always require an image proof. Older clients could
      // send evidenceRequired=false; normalize that input at the trust boundary.
      const assignmentPenaltyAmount =
        Number(attachments?.assignment?.deadlinePenaltyAmount) || 50000;
      attachments.evidence = {
        ...(attachments.evidence || {}),
        required: true,
        method: "image",
        status: attachments.evidence?.status || "pending",
        penaltyAmount:
          Number(attachments.evidence?.penaltyAmount) ||
          assignmentPenaltyAmount,
      };
      for (const recipient of recipients) {
        await assertOperationalTaskAssignee(recipient);
        await validateEvidenceAssignment(attachments, recipient);
      }

      const groupId = `assignment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const groupAttachments = {
        ...attachments,
        assignment: {
          ...(attachments.assignment || {}),
          groupId,
          assignees: recipients,
        },
      };
      const dueDate = new Date(taskData.dueDate);
      const task = await prisma.dailyTask.create({
        data: {
          ...taskData,
          assignee: recipients[0],
          dueDate,
          tags: taskData.tags ? JSON.stringify(taskData.tags) : null,
          attachments: JSON.stringify(groupAttachments),
        },
      });

      void logActivity({
        module: "system",
        action: "CREATE",
        description: `Tạo bàn giao "${taskData.title}" cho ${recipients.length} người`,
        recordName: taskData.title,
        userName: recipients.join(", "),
      });
      return { success: true, data: task };
    } catch (error) {
      console.error("Error creating assignment group:", error);
      return { success: false, error: error.message };
    }
  },
);

const ASSIGNMENT_RECURRENCE_KEY_PREFIX = "dailyAssignmentRecurrence:";

// Older versions generated recurring handovers with calendar days. Repair
// currently open recurring rows that landed on Sunday/a fixed holiday so they
// do not remain visible, overdue, or fined on a rest day.
async function repairRecurringAssignmentRestDays() {
  const assignments = await prisma.dailyTask.findMany({
    where: {
      type: "assignment",
      status: { in: ["pending", "in_progress"] },
      attachments: { not: null },
    },
    select: { id: true, dueDate: true, attachments: true },
  });
  let repaired = 0;
  for (const task of assignments) {
    const assignment = parseTaskAttachments(task.attachments).assignment || {};
    const recurrenceDays = Math.floor(Number(assignment.recurrenceDays) || 0);
    const dueAt = new Date(task.dueDate);
    if (
      recurrenceDays < 1 ||
      Number.isNaN(dueAt.getTime()) ||
      !isDailyTaskPenaltyRestDay(dueAt)
    )
      continue;

    const repairedDueAt = getNextAssignmentWorkingDueDate(dueAt, 0);
    await prisma.$transaction([
      prisma.dailyTask.update({
        where: { id: task.id },
        data: { dueDate: repairedDueAt },
      }),
      // These are automatic evidence fines only. A Sunday/holiday must
      // never create one, and deleting by task id cannot affect manual fines.
      prisma.appConfig.deleteMany({
        where: {
          key: {
            startsWith: `${ASSIGNMENT_EVIDENCE_PENALTY_KEY_PREFIX}${task.id}:`,
          },
        },
      }),
      prisma.appConfig.deleteMany({
        where: { key: { startsWith: `${TASK_PENALTY_KEY_PREFIX}${task.id}:` } },
      }),
    ]);
    repaired += 1;
  }
  return repaired;
}

// Remove duplicate open rows produced by older recurrence workers. A row is
// considered the same recurrence only when its root, sequence and due time
// all match; intentionally different handovers are left untouched.
async function dedupeOpenRecurringAssignments() {
  const assignments = await prisma.dailyTask.findMany({
    where: {
      type: "assignment",
      status: { in: ["pending", "in_progress"] },
      attachments: { not: null },
    },
    select: { id: true, dueDate: true, attachments: true },
    orderBy: { id: "asc" },
  });
  const groups = new Map();
  for (const task of assignments) {
    const assignment = parseTaskAttachments(task.attachments).assignment || {};
    const root = String(assignment.recurrenceRootId || "").trim();
    const sequence = Number(assignment.recurrenceSequence || 0);
    const dueAt = new Date(task.dueDate);
    if (
      !root ||
      !Number.isInteger(sequence) ||
      sequence < 1 ||
      Number.isNaN(dueAt.getTime())
    )
      continue;
    const key = `${root}|${sequence}|${dueAt.toISOString()}`;
    const rows = groups.get(key) || [];
    rows.push(task.id);
    groups.set(key, rows);
  }
  let removed = 0;
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const duplicateIds = ids.slice(1);
    const result = await prisma.dailyTask.deleteMany({
      where: { id: { in: duplicateIds } },
    });
    removed += result.count;
  }
  return removed;
}

// Generate the next independent handover when any handover reaches its
// configured calendar interval. Completion of an older handover must not
// control this schedule: an overdue handover keeps its daily fines while the
// next scheduled handover is created as a separate task.
// The AppConfig marker makes this idempotent across multiple desktop clients.
async function reconcileRecurringAssignments(now = new Date()) {
  const assignments = await prisma.dailyTask.findMany({
    where: { type: "assignment" },
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      category: true,
      note: true,
      assignee: true,
      verifier: true,
      dueDate: true,
      tags: true,
      attachments: true,
    },
  });
  let created = 0;
  for (const task of assignments) {
    const attachments = parseTaskAttachments(task.attachments);
    const assignment = attachments.assignment || {};
    const recurrenceDays = Math.floor(Number(assignment.recurrenceDays) || 0);
    if (recurrenceDays < 1 || recurrenceDays > 365) continue;
    const dueAt = new Date(task.dueDate);
    if (Number.isNaN(dueAt.getTime())) continue;
    const nextDueAt = getNextAssignmentWorkingDueDate(dueAt, recurrenceDays);
    if (getLocalDateKey(now) < getLocalDateKey(nextDueAt)) continue;

    const recurrenceRootId = String(assignment.recurrenceRootId || task.id);
    const recurrenceSequence = (Number(assignment.recurrenceSequence) || 1) + 1;
    const openCandidates = await prisma.dailyTask.findMany({
      where: {
        type: "assignment",
        status: { in: ["pending", "in_progress"] },
        dueDate: nextDueAt,
      },
      select: { id: true, title: true, attachments: true },
    });
    const alreadyGenerated = openCandidates.some((candidate) => {
      const candidateAssignment =
        parseTaskAttachments(candidate.attachments).assignment || {};
      return (
        candidate.title === task.title &&
        String(candidateAssignment.recurrenceRootId || "") ===
          recurrenceRootId &&
        Number(candidateAssignment.recurrenceSequence || 0) ===
          recurrenceSequence
      );
    });
    if (alreadyGenerated) continue;
    const recurrenceKey = `${ASSIGNMENT_RECURRENCE_KEY_PREFIX}${recurrenceRootId}:${nextDueAt.toISOString()}`;
    const marker = await prisma.appConfig.createMany({
      data: {
        key: recurrenceKey,
        value: JSON.stringify({
          sourceTaskId: task.id,
          nextDueAt: nextDueAt.toISOString(),
          createdAt: now.toISOString(),
        }),
      },
      skipDuplicates: true,
    });
    if (marker.count === 0) continue;

    const recipients = getTaskRecipients(task, attachments);
    const activeRecipientRows =
      recipients.length > 0
        ? await prisma.user.findMany({
            where: {
              status: "active",
              OR: [
                { username: { in: recipients } },
                { fullName: { in: recipients } },
              ],
            },
            select: { username: true, fullName: true },
          })
        : [];
    const activeRecipients = recipients.filter((recipient) =>
      activeRecipientRows.some((user) => matchesUserIdentity(recipient, user)),
    );
    if (activeRecipients.length === 0) {
      await prisma.appConfig.deleteMany({ where: { key: recurrenceKey } });
      continue;
    }
    const nextGroupId = `assignment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const nextAssignment = {
      ...assignment,
      groupId: nextGroupId,
      assignees: activeRecipients,
      recurrenceRootId,
      recurrenceSequence,
      completionRequestedAt: undefined,
      completionRequestedBy: undefined,
    };
    const evidence = attachments.evidence;
    const nextEvidence = evidence?.required
      ? (({
          submittedAt,
          submittedBy,
          submittedUrl,
          submittedImage,
          submittedImages,
          reviewedAt,
          reviewedBy,
          penaltyCycle,
          penaltyCount,
          penaltyEscalation,
          ...config
        }) => ({ ...config, status: "pending" }))(evidence)
      : evidence;
    try {
      await prisma.dailyTask.create({
        data: {
          title: task.title,
          description: task.description || "",
          priority: task.priority || "normal",
          category: task.category || "Bàn giao",
          note: task.note || "",
          type: "assignment",
          status: "pending",
          assignee: activeRecipients[0],
          verifier: "",
          dueDate: nextDueAt,
          tags: task.tags || null,
          attachments: JSON.stringify({
            ...attachments,
            assignment: nextAssignment,
            evidence: nextEvidence,
          }),
        },
      });
      created += 1;
    } catch (error) {
      await prisma.appConfig.deleteMany({ where: { key: recurrenceKey } });
      throw error;
    }
  }
  return created;
}

// An assignment recipient can request completion, but only an admin can close it.
ipcMain.handle("dailyTasks:requestAssignmentCompletion", async (_event, id) => {
  try {
    const actor = await getCurrentActor();
    const task = await prisma.dailyTask.findUnique({
      where: { id: Number(id) },
    });
    if (!task) throw new Error("Assignment task was not found.");
    if (task.type !== "assignment")
      throw new Error("This action only applies to assignment tasks.");
    if (task.status === "completed")
      throw new Error("This assignment is already completed.");
    if (
      actor.role !== "admin" &&
      !isTestOperatorActor(actor) &&
      !actorOwnsTask(actor, task)
    ) {
      throw new Error(
        "You can only request completion for an assignment assigned to you.",
      );
    }

    const attachments = parseTaskAttachments(task.attachments);
    if (
      attachments?.evidence?.required &&
      attachments.evidence.status !== "approved"
    ) {
      throw new Error(
        "Evidence must be approved before requesting completion.",
      );
    }
    attachments.assignment = {
      ...(attachments.assignment || {}),
      completionRequestedAt: new Date().toISOString(),
      completionRequestedBy: actor.username,
    };
    const updated = await prisma.dailyTask.update({
      where: { id: task.id },
      data: { attachments: JSON.stringify(attachments) },
    });
    await appendDailyTaskHistory({
      taskId: task.id,
      taskTitle: task.title,
      category: task.category,
      assignee: task.assignee,
      verifier: task.verifier || "",
      action: "completion_requested",
      timestamp: new Date().toISOString(),
      description: `${actor.username} requested completion for assignment: "${task.title}"`,
    });
    void logActivity({
      module: "daily_tasks",
      action: "REQUEST_COMPLETE",
      recordId: task.id,
      recordName: task.title,
      description: `${actor.username} requested completion approval`,
    });
    return { success: true, data: updated };
  } catch (error) {
    console.error("Error requesting assignment completion:", error);
    return { success: false, error: error.message };
  }
});

// Update task
ipcMain.handle("dailyTasks:update", async (event, id, updates) => {
  try {
    const actor = await getCurrentActor();
    const updateData = { ...updates };
    const existingTask = await prisma.dailyTask.findUnique({
      where: { id: Number(id) },
    });
    if (!existingTask) throw new Error("KhÃ´ng tÃ¬m tháº¥y cÃ´ng viá»‡c.");
    const existingAttachments = parseTaskAttachments(existingTask.attachments);
    if (
      actor.role !== "admin" &&
      !isTestOperatorActor(actor) &&
      existingTask.type === "assignment" &&
      updates.status === "completed"
    ) {
      throw new Error("Only an admin can complete an assignment.");
    }
    const canCompleteSharedAssignment =
      existingTask.type === "assignment" &&
      updates.status === "completed" &&
      actorOwnsTask(actor, existingTask);
    if (
      actor.role !== "admin" &&
      !isTestOperatorActor(actor) &&
      !canCompleteSharedAssignment
    ) {
      throw new Error("Chỉ admin được cập nhật công việc này.");
    }
    const attachments =
      updates.attachments !== undefined
        ? parseTaskAttachments(updates.attachments)
        : existingAttachments;
    const rotationAssignee = getDailyRotationAssignee(attachments);
    if (rotationAssignee) {
      updates = { ...updates, assignee: rotationAssignee };
      updateData.assignee = rotationAssignee;
    }
    const assignee =
      updates.assignee !== undefined ? updates.assignee : existingTask.assignee;
    if (updates.assignee !== undefined)
      await assertOperationalTaskAssignee(assignee);
    if (existingTask.type === "assignment") {
      const recipients = [
        ...new Set(
          (Array.isArray(attachments?.assignment?.assignees)
            ? attachments.assignment.assignees
            : [assignee]
          )
            .map((name) => String(name || "").trim())
            .filter(Boolean),
        ),
      ];
      if (recipients.length === 0)
        throw new Error("Bàn giao phải còn ít nhất một người nhận.");
      for (const recipient of recipients) {
        await assertOperationalTaskAssignee(recipient);
      }
      updateData.assignee = recipients[0];
    }
    await validateEvidenceAssignment(attachments, assignee);

    if (rotationAssignee) await assertDailyRotationAssignees(attachments);

    if (updates.dueDate) {
      updateData.dueDate =
        existingTask.type === "daily"
          ? getDailyTaskEndOfDay(updates.dueDate)
          : new Date(updates.dueDate);
    }

    if (updates.tags) {
      updateData.tags = JSON.stringify(updates.tags);
    }

    if (updates.attachments) {
      updateData.attachments = JSON.stringify(updates.attachments);
    }

    if (
      updates.status === "pending" &&
      existingTask.status === "completed" &&
      attachments?.evidence?.required
    ) {
      updateData.attachments = JSON.stringify(
        clearEvidenceSubmission(attachments),
      );
    }

    // Auto set completedAt khi status thay đổi
    if (
      updates.status === "pending" &&
      existingTask.status === "completed" &&
      existingTask.type === "assignment"
    ) {
      const reopenedAttachments = parseTaskAttachments(
        updateData.attachments || existingTask.attachments,
      );
      if (reopenedAttachments.assignment) {
        delete reopenedAttachments.assignment.completionRequestedAt;
        delete reopenedAttachments.assignment.completionRequestedBy;
      }
      updateData.attachments = JSON.stringify(reopenedAttachments);
    }

    if (updates.status === "completed" && !updates.completedAt) {
      updateData.completedAt = new Date();
    } else if (updates.status === "pending") {
      updateData.completedAt = null;
    }

    if (
      updates.status === "completed" &&
      attachments?.evidence?.required &&
      attachments.evidence.status !== "approved"
    ) {
      throw new Error(
        "Công việc yêu cầu bằng chứng chỉ được hoàn thành sau khi bằng chứng được duyệt.",
      );
    }

    const task = await prisma.dailyTask.update({
      where: { id },
      data: updateData,
    });

    if (
      (existingTask.type === "daily" || existingTask.type === "assignment") &&
      updates.status &&
      updates.status !== existingTask.status
    ) {
      await appendDailyTaskHistory({
        taskId: task.id,
        taskTitle: task.title,
        category: task.category,
        assignee: task.assignee,
        verifier: task.verifier || "",
        action: updates.status === "completed" ? "completed" : "pending",
        timestamp: new Date().toISOString(),
        description:
          updates.status === "completed"
            ? `Đã hoàn thành ${existingTask.type === "assignment" ? "bàn giao" : "công việc"}: "${task.title}"`
            : `Đã mở lại ${existingTask.type === "assignment" ? "bàn giao" : "công việc"}: "${task.title}"`,
      });
    }

    void logActivity({
      module: "system",
      action: "UPDATE",
      description: `Cập nhật công việc #${id}`,
      recordId: id,
    });
    return { success: true, data: task };
  } catch (error) {
    console.error("Error updating task:", error);
    return { success: false, error: error.message };
  }
});

// Update task status
ipcMain.handle("dailyTasks:updateStatus", async (event, id, status) => {
  try {
    requireRole("admin");
    const existingTask = await prisma.dailyTask.findUnique({
      where: { id: Number(id) },
    });
    if (!existingTask) throw new Error("Không tìm thấy công việc.");
    const attachments = parseTaskAttachments(existingTask.attachments);
    if (
      status === "completed" &&
      attachments?.evidence?.required &&
      attachments.evidence.status !== "approved"
    ) {
      throw new Error(
        "Công việc yêu cầu bằng chứng chỉ được hoàn thành sau khi bằng chứng được duyệt.",
      );
    }
    const updateData = { status };
    if (
      status === "pending" &&
      existingTask.status === "completed" &&
      attachments?.evidence?.required
    ) {
      updateData.attachments = JSON.stringify(
        clearEvidenceSubmission(attachments),
      );
    }

    // Auto set completedAt when status is completed
    if (status === "completed") {
      updateData.completedAt = new Date();
    } else if (status !== "completed") {
      updateData.completedAt = null;
    }

    const task = await prisma.dailyTask.update({
      where: { id },
      data: updateData,
    });

    if (task.type === "daily" && status !== existingTask.status) {
      await appendDailyTaskHistory({
        taskId: task.id,
        taskTitle: task.title,
        category: task.category,
        assignee: task.assignee,
        verifier: task.verifier || "",
        action: status === "completed" ? "completed" : "pending",
        timestamp: new Date().toISOString(),
        description:
          status === "completed"
            ? `Đã hoàn thành công việc: "${task.title}"`
            : `Đã mở lại công việc: "${task.title}"`,
      });
    }

    return { success: true, data: task };
  } catch (error) {
    console.error("Error updating task status:", error);
    return { success: false, error: error.message };
  }
});

// Delete task
ipcMain.handle("dailyTasks:delete", async (event, id) => {
  try {
    requireRole("admin");
    const taskId = Number(id);
    await prisma.$transaction([
      // System fines are derived from this task; manual fines are not affected.
      prisma.appConfig.deleteMany({
        where: { key: { startsWith: `${TASK_PENALTY_KEY_PREFIX}${taskId}:` } },
      }),
      prisma.dailyTask.delete({ where: { id: taskId } }),
    ]);

    void logActivity({
      module: "system",
      action: "DELETE",
      description: `Xóa công việc #${id}`,
    });
    return { success: true };
  } catch (error) {
    console.error("Error deleting task:", error);
    return { success: false, error: error.message };
  }
});

// Get statistics
ipcMain.handle("dailyTasks:stats", async (event, filters = {}) => {
  try {
    requireRole();
    const { assignee, startDate, endDate } = filters;

    const where = {};

    if (assignee && assignee !== "all") {
      where.assignee = assignee;
    }

    if (startDate || endDate) {
      where.dueDate = {};
      if (startDate) where.dueDate.gte = new Date(startDate);
      if (endDate) where.dueDate.lte = new Date(endDate);
    }

    const [total, completed, inProgress, pending, overdue] = await Promise.all([
      prisma.dailyTask.count({ where }),
      prisma.dailyTask.count({ where: { ...where, status: "completed" } }),
      prisma.dailyTask.count({ where: { ...where, status: "in_progress" } }),
      prisma.dailyTask.count({ where: { ...where, status: "pending" } }),
      prisma.dailyTask.count({
        where: {
          ...where,
          status: { in: ["pending", "in_progress"] },
          dueDate: { lt: new Date() },
        },
      }),
    ]);

    const completionRate =
      total > 0 ? ((completed / total) * 100).toFixed(1) : 0;

    return {
      success: true,
      data: {
        total,
        completed,
        inProgress,
        pending,
        overdue,
        completionRate: parseFloat(completionRate),
      },
    };
  } catch (error) {
    console.error("Error getting task stats:", error);
    return { success: false, error: error.message };
  }
});

const DAILY_TASK_SNAPSHOT_PREFIX = "dailyTasksSnapshot:";

async function migrateLegacyDailyTaskSnapshots() {
  const legacy = await prisma.appConfig.findUnique({
    where: { key: "dailyTasksSnapshots" },
  });
  if (!legacy) return;

  let snapshots = {};
  try {
    snapshots = JSON.parse(legacy.value) || {};
  } catch {
    snapshots = {};
  }
  const entries = Object.entries(snapshots).filter(
    ([date, snapshot]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && snapshot,
  );
  if (entries.length > 0) {
    // Multiple desktop clients can start together. This migration must be
    // idempotent instead of racing on an individual upsert per date.
    await prisma.appConfig.createMany({
      data: entries.map(([date, snapshot]) => ({
        key: `${DAILY_TASK_SNAPSHOT_PREFIX}${date}`,
        value: JSON.stringify(snapshot),
      })),
      skipDuplicates: true,
    });
  }
  await prisma.appConfig.deleteMany({ where: { key: "dailyTasksSnapshots" } });
}
// Reset daily tasks - tự động reset khi sang ngày mới
ipcMain.handle("dailyTasks:resetDaily", async () => {
  try {
    if (!prisma) throw new Error("Database chưa được khởi tạo.");

    // Fix null assignee/verifier (tương thích Prisma client cũ)
    await prisma.$executeRawUnsafe(
      `UPDATE "DailyTask" SET assignee = '' WHERE assignee IS NULL`,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "DailyTask" SET verifier = '' WHERE verifier IS NULL`,
    );

    // Lấy ngày hôm nay (theo timezone local)
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    await migrateLegacyDailyTaskSnapshots();
    // Apply the end-of-day rule before a penalty reconciliation. This also
    // repairs active rows created by older clients at 19:00 or 20:00.
    const deadlineNormalized = await normalizeOpenDailyTaskDeadlines();
    // Reconcile yesterday's immutable snapshot before any recurring task is
    // reset or moved to today's deadline. Otherwise the old missed deadline
    // disappears from the active row and can never be fined.
    await reconcileSnapshotEvidencePenalties(now);
    await reconcileEvidencePenalties();
    await reconcileRecurringAssignments(now);

    // Daily work is not generated or reset on Sunday. Assignment tasks
    // retain their own deadlines and are intentionally unaffected.
    if (now.getDay() === 0) {
      return {
        success: true,
        data: {
          reset: false,
          message: "Chủ nhật không sinh công việc hàng ngày",
        },
      };
    }

    // Kiểm tra ngày reset cuối cùng
    const lastResetConfig = await prisma.appConfig.findUnique({
      where: { key: "dailyTasksLastResetDate" },
    });

    const lastResetDate = lastResetConfig
      ? JSON.parse(lastResetConfig.value)
      : null;

    if (lastResetDate === today) {
      // Đã reset hôm nay rồi
      return {
        success: true,
        data: {
          reset: false,
          deadlineNormalized,
          message: "Đã reset hôm nay rồi",
        },
      };
    }

    // Fix dữ liệu cũ: Các task category='Bàn giao' nhưng type='daily' → sửa thành 'assignment'
    await prisma.dailyTask.updateMany({
      where: { category: "Bàn giao", type: "daily" },
      data: { type: "assignment" },
    });

    // Lấy danh sách task HÀNG NGÀY đã completed để lưu history trước khi reset
    // Bàn giao (type: 'assignment') KHÔNG reset - chỉ reset daily tasks
    // The activity feed only records interacted tasks. Capture all daily
    // tasks before reset so historical totals include unfinished work.
    const dailyTasksBeforeReset = await prisma.dailyTask.findMany({
      where: { type: "daily" },
    });
    const snapshotDate = lastResetDate || today;
    const snapshotKey = `${DAILY_TASK_SNAPSHOT_PREFIX}${snapshotDate}`;
    await prisma.appConfig.upsert({
      where: { key: snapshotKey },
      update: {},
      create: {
        key: snapshotKey,
        value: JSON.stringify({
          capturedAt: now.toISOString(),
          tasks: dailyTasksBeforeReset,
        }),
      },
    });
    const snapshotRows = await prisma.appConfig.findMany({
      where: { key: { startsWith: DAILY_TASK_SNAPSHOT_PREFIX } },
      select: { key: true },
    });
    const expiredSnapshotKeys = snapshotRows
      .map((row) => row.key)
      .sort((left, right) => right.localeCompare(left))
      .slice(90);
    if (expiredSnapshotKeys.length > 0) {
      await prisma.appConfig.deleteMany({
        where: { key: { in: expiredSnapshotKeys } },
      });
    }

    const completedTasks = dailyTasksBeforeReset.filter(
      (task) => task.status === "completed",
    );

    // Lưu vào history trước khi reset
    if (completedTasks.length > 0) {
      // Đọc history cũ
      const historyConfig = await prisma.appConfig.findUnique({
        where: { key: "dailyTasksHistory" },
      });
      const existingHistory = historyConfig
        ? JSON.parse(historyConfig.value)
        : [];

      const getHistoryDateKey = (value) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      };
      const completionKeys = new Set(
        existingHistory
          .filter(
            (entry) =>
              entry.action === "completed" || entry.action === "daily_reset",
          )
          .map(
            (entry) =>
              `${entry.taskId || entry.taskTitle}:${getHistoryDateKey(entry.timestamp)}`,
          ),
      );

      // Only add a reset entry when the original confirmation was not saved.
      const newEntries = completedTasks.flatMap((task) => {
        const timestamp = task.completedAt
          ? task.completedAt.toISOString()
          : lastResetDate || now.toISOString();
        const completionKey = `${task.id}:${getHistoryDateKey(timestamp)}`;
        if (completionKeys.has(completionKey)) return [];

        return [
          {
            taskId: task.id,
            taskTitle: task.title,
            category: task.category,
            assignee: task.assignee,
            verifier: task.verifier || "",
            action: "daily_reset",
            timestamp,
            description: `✅ Đã hoàn thành: "${task.title}" (tự động reset sang ngày ${today})`,
          },
        ];
      });

      const updatedHistory = [...newEntries, ...existingHistory].slice(0, 500); // Giữ tối đa 500 entries

      await prisma.appConfig.upsert({
        where: { key: "dailyTasksHistory" },
        update: { value: JSON.stringify(updatedHistory) },
        create: {
          key: "dailyTasksHistory",
          value: JSON.stringify(updatedHistory),
        },
      });

      // Reset chỉ daily tasks completed về pending (không reset bàn giao)
      await prisma.dailyTask.updateMany({
        where: { status: "completed", type: "daily" },
        data: {
          status: "pending",
          completedAt: null,
          verifier: "",
        },
      });

      console.log(
        `✅ [DAILY RESET] Ngày ${today}: Reset ${completedTasks.length} tasks completed → pending`,
      );
    }

    // Cập nhật dueDate của chỉ DAILY tasks sang ngày hôm nay (giữ nguyên giờ)
    // Fix bug: task vẫn mang dueDate cũ → calendar hiển thị sai ngày hoàn thành
    // Bàn giao (assignment) giữ nguyên deadline riêng, không cập nhật
    const allTasks = await prisma.dailyTask.findMany({
      where: { type: "daily" },
    });
    for (const task of allTasks) {
      const newDueDate = new Date(now);
      newDueDate.setHours(23, 59, 59, 999);
      const attachments = parseTaskAttachments(task.attachments);
      const rotationAssignee = getDailyRotationAssignee(attachments, now);
      await prisma.dailyTask.update({
        where: { id: task.id },
        data: {
          dueDate: newDueDate,
          verifier: "",
          // Người cố định phải còn nguyên để phạt/nộp bằng chứng đúng người.
          assignee:
            rotationAssignee ||
            (isFixedAssignee(attachments) ? task.assignee : ""),
          attachments: attachments?.evidence?.required
            ? JSON.stringify(clearEvidenceSubmission(attachments))
            : task.attachments,
        },
      });
    }
    console.log(
      `✅ [DAILY RESET] Đã cập nhật dueDate của ${allTasks.length} tasks sang ngày ${today}`,
    );

    // Lưu ngày reset
    await prisma.appConfig.upsert({
      where: { key: "dailyTasksLastResetDate" },
      update: { value: JSON.stringify(today) },
      create: { key: "dailyTasksLastResetDate", value: JSON.stringify(today) },
    });

    return {
      success: true,
      data: {
        reset: completedTasks.length > 0,
        resetCount: completedTasks.length,
        deadlineNormalized,
        message:
          completedTasks.length > 0
            ? `Đã reset ${completedTasks.length} công việc sang ngày mới`
            : "Sang ngày mới, không có công việc cần reset",
      },
    };
  } catch (error) {
    console.error("Error resetting daily tasks:", error);
    return { success: false, error: error.message };
  }
});

// ========================================
// COMBO PRODUCTS
// ========================================

// Remove any existing handlers to prevent duplicate registration error
try {
  ipcMain.removeHandler("combos:getAll");
} catch (e) {}
try {
  ipcMain.removeHandler("combos:create");
} catch (e) {}
try {
  ipcMain.removeHandler("combos:update");
} catch (e) {}
try {
  ipcMain.removeHandler("combos:delete");
} catch (e) {}

// Keep the server-side policy aligned with the configured Combo capabilities.
// Renderer guards are useful for UX only; these checks are authoritative.
const COMBO_ACCESS = Object.freeze({
  create: ["admin", "manager"],
  update: ["admin", "manager"],
  delete: ["admin", "manager"],
});

function requireComboAccess(action) {
  const roles = COMBO_ACCESS[action];
  if (!roles) throw new Error("Unsupported combo action.");
  requireRole(...roles);
}

function parseComboItems(value) {
  const items = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(items) || items.length === 0)
    throw new Error("A combo must contain at least one component.");
  if (items.length > 100)
    throw new Error("A combo cannot contain more than 100 components.");
  return items;
}

async function validateComboItems(rawItems) {
  const items = parseComboItems(rawItems);
  const productIds = [
    ...new Set(
      items.map((item) => Number(item?.productId)).filter(Number.isInteger),
    ),
  ];
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          sku: true,
          name: true,
          cost: true,
          variants: true,
          status: true,
        },
      })
    : [];
  const productById = new Map(products.map((product) => [product.id, product]));
  const seenSkus = new Set();
  let calculatedCost = 0;

  const canonicalItems = items.map((item) => {
    const product = productById.get(Number(item?.productId));
    const quantity = Number(item?.quantity);
    if (!product || product.status !== "active")
      throw new Error("A combo component is missing or inactive.");
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 100000)
      throw new Error("Component quantity must be a positive integer.");

    const variantIndex = item?.variantIndex;
    let sku = product.sku;
    let unitCost = Number(product.cost || 0);
    if (
      variantIndex !== undefined &&
      variantIndex !== null &&
      variantIndex !== ""
    ) {
      const index = Number(variantIndex);
      let variants;
      try {
        variants = JSON.parse(product.variants || "[]");
      } catch {
        throw new Error(`Invalid variants for product ${product.id}.`);
      }
      const variant = Number.isInteger(index) ? variants[index] : null;
      if (!variant?.sku)
        throw new Error(`Invalid variant for product ${product.id}.`);
      sku = String(variant.sku);
      unitCost = Number(variant.cost ?? product.cost ?? 0);
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      throw new Error(
        `Missing or invalid cost for combo component ${sku || product.id}.`,
      );
    }
    if (!sku || seenSkus.has(sku))
      throw new Error("A combo cannot contain a duplicate component SKU.");
    seenSkus.add(sku);
    calculatedCost += unitCost * quantity;
    return {
      productId: product.id,
      variantIndex:
        variantIndex === undefined ||
        variantIndex === null ||
        variantIndex === ""
          ? null
          : Number(variantIndex),
      sku,
      quantity,
    };
  });
  if (!Number.isFinite(calculatedCost)) throw new Error("Invalid combo cost.");
  return { items: canonicalItems, cost: calculatedCost };
}

ipcMain.handle("combos:getAll", async () => {
  try {
    if (!prisma) return { success: true, data: [] };
    const combos = await prisma.comboProduct.findMany({
      orderBy: { createdAt: "desc" },
    });
    const products = await prisma.product.findMany({
      select: { id: true, stock: true, cost: true, variants: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));
    const combosWithStock = combos.map((combo) => {
      const items = JSON.parse(combo.items || "[]");
      let availableStock = Infinity;
      let calculatedCost = 0;
      items.forEach((item) => {
        const product = productById.get(item.productId);
        if (product && product.variants) {
          let variants;
          try {
            variants = JSON.parse(product.variants);
          } catch {
            variants = [];
          }
          const variant = variants[item.variantIndex];
          if (variant) {
            const possibleCombos = Math.floor(
              (variant.stock || 0) / item.quantity,
            );
            availableStock = Math.min(availableStock, possibleCombos);
            calculatedCost += (variant.cost || 0) * item.quantity;
          }
        } else if (product) {
          const possibleCombos = Math.floor(product.stock / item.quantity);
          availableStock = Math.min(availableStock, possibleCombos);
          calculatedCost += (product.cost || 0) * item.quantity;
        }
      });
      return {
        ...combo,
        stock: availableStock === Infinity ? 0 : availableStock,
        cost: calculatedCost,
      };
    });
    const data = isAdminSession()
      ? combosWithStock
      : combosWithStock.map(({ stock, cost, ...combo }) => ({
          ...combo,
          available: Number(stock || 0) > 0,
        }));
    return { success: true, data };
  } catch (error) {
    console.error("Error getting combos:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("combos:create", async (event, data) => {
  try {
    requireComboAccess("create");
    if (!prisma) throw new Error("Database not initialized");
    const sku = String(data?.sku || "").trim();
    const name = String(data?.name || "").trim();
    const price = Number(data?.price);
    if (!sku || !name || !Number.isFinite(price) || price < 0)
      throw new Error("Invalid combo details.");
    const validated = await validateComboItems(data?.items);
    const comboData = {
      name,
      items: JSON.stringify(validated.items),
      price,
      cost: validated.cost,
      status: "active",
    };
    const combo = await prisma.comboProduct.create({
      data: { sku, ...comboData },
    });
    void logActivity({
      module: "products",
      action: "CREATE",
      description: `Tạo combo "${combo.name}" (SKU: ${combo.sku})`,
      recordName: combo.name,
    });
    void logActivity({
      module: "combos",
      action: "CREATE",
      recordId: combo.id,
      recordName: combo.name,
      description: `Created combo ${combo.sku}. Reason: ${String(data?.reason || "not provided").trim() || "not provided"}`,
      changes: { before: null, after: combo, actor: currentSession.username },
      severity: "WARNING",
    });
    return { success: true, data: combo };
  } catch (error) {
    console.error("Error creating combo:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("combos:update", async (event, id, data) => {
  try {
    requireComboAccess("update");
    if (!prisma) throw new Error("Database not initialized");
    const comboId = Number(id);
    if (!Number.isInteger(comboId)) throw new Error("Invalid combo id.");
    const before = await prisma.comboProduct.findUnique({
      where: { id: comboId },
    });
    if (!before) throw new Error("Combo not found.");
    const sku = String(data?.sku ?? before.sku).trim();
    const name = String(data?.name ?? before.name).trim();
    const price = data?.price === undefined ? before.price : Number(data.price);
    if (!sku || !name || !Number.isFinite(price) || price < 0)
      throw new Error("Invalid combo details.");
    const validated =
      data?.items === undefined ? null : await validateComboItems(data.items);
    const updateData = {
      sku,
      name,
      price,
      ...(validated
        ? { items: JSON.stringify(validated.items), cost: validated.cost }
        : {}),
    };
    const combo = await prisma.comboProduct.update({
      where: { id: comboId },
      data: updateData,
    });
    void logActivity({
      module: "combos",
      action: "UPDATE",
      recordId: combo.id,
      recordName: combo.name,
      description: `Updated combo ${combo.sku}. Reason: ${String(data?.reason || "not provided").trim() || "not provided"}`,
      changes: { before, after: combo, actor: currentSession.username },
      severity: "WARNING",
    });
    void logActivity({
      module: "products",
      action: "UPDATE",
      description: `Cập nhật combo "${combo.name}"`,
      recordName: combo.name,
    });
    return { success: true, data: combo };
  } catch (error) {
    console.error("Error updating combo:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("combos:delete", async (event, id) => {
  try {
    requireComboAccess("delete");
    if (!prisma) throw new Error("Database not initialized");
    const comboId = Number(id);
    if (!Number.isInteger(comboId)) throw new Error("Invalid combo id.");
    const before = await prisma.comboProduct.findUnique({
      where: { id: comboId },
    });
    if (!before) throw new Error("Combo not found.");
    await prisma.comboProduct.delete({ where: { id: comboId } });
    void logActivity({
      module: "combos",
      action: "DELETE",
      recordId: comboId,
      recordName: before.name,
      description: `Deleted combo ${before.sku}. Reason: not provided`,
      changes: { before, after: null, actor: currentSession.username },
      severity: "WARNING",
    });
    void logActivity({
      module: "products",
      action: "DELETE",
      description: `Xóa combo #${id}`,
    });
    return { success: true };
  } catch (error) {
    console.error("Error deleting combo:", error);
    return { success: false, error: error.message };
  }
});

// ========================================
// ECOMMERCE EXPORT - FOLDER IMPORT & WATCHER
// ========================================

let ecommerceExportWatcher = null;
let ecommerceExportKnownFiles = new Set();
let ecommerceExportWatchFolder = "";

// Kích hoạt dialog chọn thư mục và tự động start watcher
ipcMain.handle("ecommerceExport:selectAndWatch", async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Chọn thư mục theo dõi file Excel TMĐT (Realtime)",
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: "Không có thư mục được chọn" };
    }

    const folderPath = result.filePaths[0];

    // Lấy danh sách file hiện có
    const existingFiles = fs.readdirSync(folderPath).filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return [".xlsx", ".xls", ".csv"].includes(ext) && !f.startsWith("~$");
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
      if (![".xlsx", ".xls", ".csv"].includes(ext)) return;
      if (filename.startsWith("~$")) return; // File tạm Excel

      // Debounce 2 giây (file có thể đang copy)
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const filePath = path.join(folderPath, filename);

        // Chỉ xử lý file MỚI (chưa có trong danh sách)
        if (
          !ecommerceExportKnownFiles.has(filename) &&
          fs.existsSync(filePath)
        ) {
          console.log(`📁 [TMDT Watcher] File mới: ${filename}`);
          ecommerceExportKnownFiles.add(filename);

          // Đọc file và gửi về frontend
          try {
            const fileBuffer = fs.readFileSync(filePath);
            const base64 = fileBuffer.toString("base64");

            // Gửi event về tất cả cửa sổ
            const { BrowserWindow } = require("electron");
            const windows = BrowserWindow.getAllWindows();
            for (const win of windows) {
              win.webContents.send("ecommerceExport:newFile", {
                name: filename,
                base64: base64,
                path: filePath,
              });
            }
            console.log(`✅ [TMDT Watcher] Đã gửi ${filename} về frontend`);
          } catch (readErr) {
            console.error(
              `❌ [TMDT Watcher] Lỗi đọc file ${filename}:`,
              readErr.message,
            );
          }
        }
      }, 2000);
    });

    console.log(
      `👁️ [TMDT Watcher] Đang theo dõi: ${folderPath} (${existingFiles.length} file có sẵn — chỉ watch file MỚI)`,
    );

    // ⚡ KHÔNG đọc nội dung file cũ — chúng đã tồn tại trong DB hoặc user sẽ import thủ công
    // Chỉ track tên file để watcher biết đâu là file MỚI
    return {
      success: true,
      data: {
        folderPath,
        existingFiles: existingFiles.length,
        existingFileList: [], // ⚡ Trả rỗng — không load file cũ
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Bắt đầu theo dõi trực tiếp (không dialog — dùng khi auto-restore)
ipcMain.handle("ecommerceExport:startWatch", async (event, folderPath) => {
  try {
    if (!folderPath || !fs.existsSync(folderPath)) {
      return { success: false, error: "Thư mục không tồn tại" };
    }

    // Lấy danh sách file hiện có (CHỈ ĐỂ TRACK — không đọc nội dung)
    const existingFiles = fs.readdirSync(folderPath).filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return [".xlsx", ".xls", ".csv"].includes(ext) && !f.startsWith("~$");
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
      if (![".xlsx", ".xls", ".csv"].includes(ext)) return;
      if (filename.startsWith("~$")) return;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const filePath = path.join(folderPath, filename);

        if (
          !ecommerceExportKnownFiles.has(filename) &&
          fs.existsSync(filePath)
        ) {
          console.log(`📁 [TMDT Watcher] File mới: ${filename}`);
          ecommerceExportKnownFiles.add(filename);

          try {
            const fileBuffer = fs.readFileSync(filePath);
            const base64 = fileBuffer.toString("base64");

            const { BrowserWindow } = require("electron");
            const windows = BrowserWindow.getAllWindows();
            for (const win of windows) {
              win.webContents.send("ecommerceExport:newFile", {
                name: filename,
                base64: base64,
                path: filePath,
              });
            }
          } catch (readErr) {
            console.error(
              `❌ [TMDT Watcher] Lỗi đọc file ${filename}:`,
              readErr.message,
            );
          }
        }
      }, 2000);
    });

    // ⚡ KHÔNG ĐỌC NỘI DUNG FILE CŨ — chúng đã được import trước đó
    // Chỉ trả về số lượng file đã biết (để UI hiển thị)
    console.log(
      `👁️ [TMDT Watcher] Đã khôi phục session theo dõi: ${folderPath} (${existingFiles.length} file đã có)`,
    );

    return {
      success: true,
      data: {
        folderPath,
        existingFiles: existingFiles.length,
        existingFileList: [],
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Dừng theo dõi
ipcMain.handle("ecommerceExport:stopWatch", async () => {
  if (ecommerceExportWatcher) {
    ecommerceExportWatcher.close();
    ecommerceExportWatcher = null;
    ecommerceExportWatchFolder = "";
    ecommerceExportKnownFiles.clear();
    console.log("🛑 [TMDT Watcher] Đã dừng theo dõi");
    return { success: true };
  }
  return { success: false, error: "Không có watcher nào đang chạy" };
});

// Chon thu muc chua file Excel xuat hang TMDT
ipcMain.handle("ecommerceExport:selectFolder", async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Chon thu muc chua file Excel xuat hang TMDT",
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: "Khong co thu muc duoc chon" };
    }

    return { success: true, data: result.filePaths[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Đọc tất cả file Excel từ thư mục
ipcMain.handle("ecommerceExport:loadExcelFiles", async (event, folderPath) => {
  try {
    if (!folderPath || !fs.existsSync(folderPath)) {
      return { success: false, error: "Thư mục không tồn tại" };
    }

    // Đọc tất cả file trong thư mục
    const files = fs.readdirSync(folderPath);

    // Lọc chỉ lấy file Excel (.xlsx, .xls)
    const excelFiles = files.filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return ext === ".xlsx" || ext === ".xls";
    });

    if (excelFiles.length === 0) {
      return {
        success: false,
        error: "Không tìm thấy file Excel nào trong thư mục",
      };
    }

    // Đọc nội dung từng file
    const filesData = [];
    for (const fileName of excelFiles) {
      const filePath = path.join(folderPath, fileName);
      try {
        const fileBuffer = fs.readFileSync(filePath);
        // Convert buffer to base64 để gửi qua IPC
        const base64Data = fileBuffer.toString("base64");
        filesData.push({
          name: fileName,
          data: base64Data,
        });
      } catch (err) {
        console.error(`Error reading file ${fileName}:`, err);
      }
    }

    console.log(`✅ Loaded ${filesData.length} Excel files from ${folderPath}`);
    return { success: true, data: filesData };
  } catch (error) {
    console.error("Error loading Excel files:", error);
    return { success: false, error: error.message };
  }
});

// ========================================
// SHELL - Open External Links
// ========================================
ipcMain.handle("shell:openExternal", async (event, url) => {
  try {
    if (!url || typeof url !== "string") {
      return { success: false, error: "Invalid URL" };
    }

    // Validate URL format
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return {
        success: false,
        error: "URL must start with http:// or https://",
      };
    }

    await shell.openExternal(url);
    console.log(`✅ Opened external URL: ${url}`);
    return { success: true };
  } catch (error) {
    console.error("❌ Error opening external URL:", error);
    return { success: false, error: error.message };
  }
});

// ==================== AUTO UPDATE ====================

const GITHUB_REPO = "yendao444-del/airclean-wms";
const UPDATE_HISTORY_FILE = path.join(
  app.getPath("userData"),
  "update-history.json",
);

function getUpdateHistory() {
  try {
    if (fs.existsSync(UPDATE_HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(UPDATE_HISTORY_FILE, "utf8"));
    }
  } catch {}
  return [];
}

// ========================================
// AUTO UPDATE HANDLERS
// ========================================
require("./update-handlers")(prisma, { requireRole });

// ========================================
// ECOMMERCE EXPORTS HANDLERS (XUẤT HÀNG TMDT)
// ========================================

ipcMain.handle(
  "ecommerceExports:getAll",
  async (
    event,
    {
      since,
      sinceField,
      until,
      limit,
      search,
      statusIn,
      statusNotIn,
      skip,
    } = {},
  ) => {
    try {
      requireRole("admin", "manager");
      if (!prisma) throw new Error("Prisma not available");
      const startedAt = Date.now();
      const field = sinceField || "ecommerceExportDate";
      const dateFilter = {};
      if (since && !search) dateFilter.gte = new Date(since);
      if (until && !search) dateFilter.lte = new Date(until);
      const trimmedSearch = search ? String(search).trim() : "";
      const syntheticIdMatch = trimmedSearch.match(
        /^#?(?:TMDT|TMDT-EX)-(\d+)$/i,
      );
      const numericId = syntheticIdMatch ? Number(syntheticIdMatch[1]) : null;

      const statusFilter = {};
      if (Array.isArray(statusIn) && statusIn.length > 0) {
        statusFilter.in = statusIn.map((s) => String(s));
      }
      if (Array.isArray(statusNotIn) && statusNotIn.length > 0) {
        statusFilter.notIn = statusNotIn.map((s) => String(s));
      }

      const where = search
        ? {
            OR: [
              { orderNumber: { contains: trimmedSearch, mode: "insensitive" } },
              {
                ecommerceExportCode: {
                  contains: trimmedSearch,
                  mode: "insensitive",
                },
              },
              {
                customerName: { contains: trimmedSearch, mode: "insensitive" },
              },
              { notes: { contains: trimmedSearch, mode: "insensitive" } },
              ...(numericId ? [{ id: numericId }] : []),
            ],
            ...(Object.keys(statusFilter).length > 0
              ? { status: statusFilter }
              : {}),
          }
        : {
            ...(Object.keys(dateFilter).length > 0
              ? { [field]: dateFilter }
              : {}),
            ...(Object.keys(statusFilter).length > 0
              ? { status: statusFilter }
              : {}),
          };

      const take = search ? 50 : limit || 2000;

      const exports = await prisma.ecommerceExport.findMany({
        where: Object.keys(where).length > 0 ? where : undefined,
        orderBy: { ecommerceExportDate: "desc" },
        skip: skip || 0,
        take: take + 1,
      });
      const hasMore = exports.length > take;
      const rows = hasMore ? exports.slice(0, take) : exports;
      // Format dates for frontend
      const formatted = rows.map((e) => ({
        ...e,
        ecommerceExportDate: e.ecommerceExportDate.toISOString(),
        updatedAt: e.updatedAt ? e.updatedAt.toISOString() : null,
        items: e.items, // Already JSON string
      }));
      console.log(
        `[Perf] ecommerceExports:getAll rows=${formatted.length} hasMore=${hasMore} search=${!!search} ms=${Date.now() - startedAt}`,
      );
      return { success: true, data: formatted, hasMore };
    } catch (error) {
      console.error("❌ Get ecommerce exports error:", error);
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "ecommerceExports:getPackersByOrderNumbers",
  async (event, orderNumbers) => {
    try {
      if (!prisma) throw new Error("Prisma not available");
      const records = await prisma.ecommerceExport.findMany({
        where: { orderNumber: { in: orderNumbers } },
        select: { orderNumber: true, pickedBy: true },
      });
      const map = {};
      records.forEach((r) => {
        if (r.pickedBy) map[r.orderNumber] = r.pickedBy;
      });
      return { success: true, data: map };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "ecommerceExports:checkExistingKeys",
  async (event, { orderNumbers = [], ecommerceExportCodes = [] } = {}) => {
    try {
      if (!prisma) throw new Error("Prisma not available");
      const normalizeKeys = (keys) => [
        ...new Set(
          (keys || []).map((k) => String(k || "").trim()).filter(Boolean),
        ),
      ];
      const normalizedOrderNumbers = normalizeKeys(orderNumbers);
      const normalizedExportCodes = normalizeKeys(ecommerceExportCodes);
      const totalKeys =
        normalizedOrderNumbers.length + normalizedExportCodes.length;
      if (totalKeys === 0)
        return {
          success: true,
          data: { orderNumbers: [], ecommerceExportCodes: [] },
        };
      if (totalKeys > 1000)
        throw new Error("Too many keys. Maximum 1000 keys per request.");

      const clauses = [];
      if (normalizedOrderNumbers.length > 0)
        clauses.push({ orderNumber: { in: normalizedOrderNumbers } });
      if (normalizedExportCodes.length > 0)
        clauses.push({ ecommerceExportCode: { in: normalizedExportCodes } });

      const [exports, marketplaceOrders] = await Promise.all([
        prisma.ecommerceExport.findMany({
          where: { OR: clauses },
          select: { orderNumber: true, ecommerceExportCode: true },
        }),
        normalizedOrderNumbers.length > 0
          ? prisma.order.findMany({
              where: {
                source: { in: ["tiktok", "shopee", "lazada", "tmdt"] },
                orderNumber: { in: normalizedOrderNumbers },
              },
              select: { orderNumber: true },
            })
          : Promise.resolve([]),
      ]);

      const existingOrderNumbers = new Set();
      const existingExportCodes = new Set();
      for (const record of exports) {
        if (record.orderNumber)
          existingOrderNumbers.add(record.orderNumber.trim());
        if (record.ecommerceExportCode)
          existingExportCodes.add(record.ecommerceExportCode.trim());
      }
      for (const order of marketplaceOrders) {
        if (order.orderNumber)
          existingOrderNumbers.add(order.orderNumber.trim());
      }

      return {
        success: true,
        data: {
          orderNumbers: Array.from(existingOrderNumbers),
          ecommerceExportCodes: Array.from(existingExportCodes),
        },
      };
    } catch (error) {
      console.error("Check existing ecommerce keys error:", error);
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle("ecommerceExports:create", async (event, data) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    const isCompleted = data.status === "completed";
    const orderKey = (
      data.orderNumber ||
      data.ecommerceExportCode ||
      ""
    ).trim();

    // 🔒 StockMutex: serialize stock operations — tránh race condition Thẻ Kho
    const result = await withStockLock(() =>
      prisma.$transaction(
        async (tx) => {
          if (orderKey) {
            const existing = await tx.ecommerceExport.findFirst({
              where: {
                OR: [
                  { orderNumber: orderKey },
                  { ecommerceExportCode: orderKey },
                ],
              },
              select: {
                id: true,
                orderNumber: true,
                ecommerceExportCode: true,
                status: true,
              },
            });
            if (existing) {
              return { skipped: true, reason: "duplicate", data: existing };
            }
            if (isCompleted) {
              const existingOrder = await tx.order.findUnique({
                where: { orderNumber: orderKey },
                select: { id: true, orderNumber: true, status: true },
              });
              if (existingOrder) {
                return {
                  skipped: true,
                  reason: "existing_order",
                  data: { ...existingOrder, status: "completed" },
                };
              }
            }
          }

          const resolvedItems = await resolveTmdtItemsSkus(tx, data.items);
          if (isCompleted) {
            assertTmdtItemsHaveSku(
              resolvedItems,
              data.orderNumber || data.ecommerceExportCode,
            );
            await assertTmdtItemsSkusExist(
              tx,
              resolvedItems,
              data.orderNumber || data.ecommerceExportCode,
            );
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
              status: data.status || "processing",
              createdBy: data.createdBy || null,
              pickedBy: data.pickedBy || null,
            },
          });

          if (isCompleted) {
            for (const item of resolvedItems) {
              if (item.variantSku) {
                await assertSaleStockAvailable(
                  tx,
                  item.variantSku,
                  item.quantity,
                );
                await deductItemOrCombo(tx, item.variantSku, -item.quantity, {
                  type: "ecom_sale",
                  referenceType: "TMDT",
                  reference:
                    data.orderNumber ||
                    data.ecommerceExportCode ||
                    "Lưu thủ công",
                  note: `Xuất hàng TMDT: ${data.customerName}`,
                  createdBy: data.createdBy || "System",
                });
              }
            }
            await ensureMarketplaceOrderInTx(
              tx,
              newRecord,
              data.pickedBy || data.createdBy || null,
            );
          }
          return { skipped: false, data: newRecord };
        },
        { timeout: 30000, maxWait: 10000 },
      ),
    );

    if (result?.skipped) {
      return {
        success: true,
        skipped: true,
        reason: result.reason,
        data: result.data,
      };
    }
    const record = result.data;
    const createdItems =
      typeof record.items === "string"
        ? JSON.parse(record.items || "[]")
        : record.items || [];
    emitStockChangedForSkus(
      createdItems.map((item) => item.variantSku || item.sku),
      {
        referenceType: "TMDT",
        reference:
          data.orderNumber || data.ecommerceExportCode || `TMDT-${record.id}`,
      },
    );
    console.log(`✅ Created ecommerce export #${record.id}`);
    void logActivity({
      module: "export",
      action: "CREATE",
      description: `Tạo bàn giao TMDT #${record.id} - ${data.customerName}`,
      recordName: data.customerName,
      userName: data.createdBy,
    });
    return { success: true, data: record };
  } catch (error) {
    console.error("❌ Create ecommerce export error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("ecommerceExports:getCompletedKeys", async () => {
  try {
    if (!prisma) throw new Error("Prisma not available");

    const [completedExports, marketplaceOrders] = await Promise.all([
      prisma.ecommerceExport.findMany({
        where: { status: "completed" },
        select: { orderNumber: true, ecommerceExportCode: true },
      }),
      prisma.order.findMany({
        where: {
          source: { in: ["tiktok", "shopee", "lazada", "tmdt"] },
        },
        select: { orderNumber: true },
      }),
    ]);

    const keys = new Set();
    for (const record of completedExports) {
      if (record.orderNumber) keys.add(record.orderNumber.trim());
      if (record.ecommerceExportCode)
        keys.add(record.ecommerceExportCode.trim());
    }
    for (const order of marketplaceOrders) {
      if (order.orderNumber) keys.add(order.orderNumber.trim());
    }

    return { success: true, data: Array.from(keys) };
  } catch (error) {
    console.error("Get completed ecommerce keys error:", error);
    return { success: false, error: error.message };
  }
});

// ─── Helper: phân biệt lỗi mạng với lỗi logic ────────────────────────────────
function isNetworkError(err) {
  const msg = (err.message || "").toLowerCase();
  const code = err.code || "";
  return (
    msg.includes("enotfound") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("network") ||
    msg.includes("connect") ||
    msg.includes("fetch failed") ||
    code === "P5010" ||
    code === "P5011" // Prisma connection errors
  );
}

function extractTrackingFromNotes(notes) {
  const match = notes?.match(/Tracking: ([^|]+)/);
  return match ? match[1].trim() : null;
}

function normalizeMarketplaceSource(name) {
  const value = String(name || "").toLowerCase();
  if (value.includes("tiktok")) return "tiktok";
  if (value.includes("shopee")) return "shopee";
  if (value.includes("lazada")) return "lazada";
  return "tmdt";
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

async function resolveTmdtItemSku(tx, item) {
  const incomingSku = item?.variantSku || item?.sku || "";
  return incomingSku ? String(incomingSku).trim() : "";
}

async function resolveTmdtItemsSkus(tx, rawItems) {
  const items =
    typeof rawItems === "string"
      ? JSON.parse(rawItems || "[]")
      : rawItems || [];
  const resolved = [];
  for (const item of items) {
    const variantSku = await resolveTmdtItemSku(tx, item);
    if (!variantSku) {
      console.warn(
        `[TMDT] Không resolve được SKU cho item: ${item?.productName || ""} / ${item?.color || ""}`,
      );
    }
    resolved.push({ ...item, variantSku: variantSku || "" });
  }
  return resolved;
}

function assertTmdtItemsHaveSku(items, refCode) {
  const missing = (items || []).filter((item) => !item?.variantSku);
  if (missing.length > 0) {
    const first = missing[0] || {};
    throw new Error(
      `Không resolve được SKU TMDT cho ${refCode || "đơn"}: ${first.productName || ""} / ${first.color || ""}`,
    );
  }
}

async function assertTmdtItemsSkusExist(tx, items, refCode) {
  for (const item of items || []) {
    const sku = item?.variantSku || "";
    if (!sku) continue;
    const combo = await tx.comboProduct.findUnique({
      where: { sku },
      select: { sku: true },
    });
    if (combo) continue;
    const directProduct = await tx.product
      .findUnique({ where: { sku }, select: { sku: true } })
      .catch(() => null);
    if (directProduct) continue;
    const variantProduct = await tx.product.findFirst({
      where: { variants: { contains: sku } },
      select: { variants: true },
    });
    if (variantProduct) {
      try {
        const variants = JSON.parse(variantProduct.variants || "[]");
        if (variants.some((v) => v?.sku === sku)) continue;
      } catch {}
    }
    throw new Error(
      `SKU TMDT không tồn tại trong kho cho ${refCode || "đơn"}: ${sku}`,
    );
  }
}

async function ensureMarketplaceOrderInTx(tx, record, actorName) {
  const orderNumber = (
    record.orderNumber ||
    record.ecommerceExportCode ||
    ""
  ).trim();
  if (!orderNumber) return;

  const existing = await tx.order.findUnique({
    where: { orderNumber },
    select: { id: true },
  });
  if (existing) return;

  let createdByUserId = null;
  if (actorName) {
    const user = await tx.user.findFirst({
      where: {
        OR: [{ username: actorName }, { fullName: actorName }],
      },
      select: { id: true },
    });
    if (user) createdByUserId = user.id;
  }

  const items =
    typeof record.items === "string"
      ? JSON.parse(record.items || "[]")
      : record.items || [];
  const subtotal = items.reduce(
    (sum, item) =>
      sum +
      Number(item.total || (item.unitPrice || 0) * (item.quantity || 0) || 0),
    0,
  );
  const total = Number(record.totalAmount || subtotal || 0);
  const trackingNumber = extractTrackingFromNotes(record.notes || null);

  const order = await tx.order.create({
    data: {
      orderNumber,
      source: normalizeMarketplaceSource(record.customerName),
      status: "completed",
      paymentStatus: "paid",
      paymentMethod: "platform",
      subtotal,
      shippingFee: 0,
      total,
      profit: 0,
      trackingNumber,
      note: record.notes || null,
      createdBy: createdByUserId,
      createdAt: record.updatedAt || new Date(),
    },
  });

  for (const item of items) {
    await tx.orderItem.create({
      data: {
        orderId: order.id,
        productId: item.productId || null,
        sku: item.variantSku || `TMDT-${orderNumber}`,
        productName: item.productName || "Đơn TMDT",
        variant: item.color || null,
        quantity: Number(item.quantity || 0),
        price: Number(item.unitPrice || 0),
        cost: 0,
        discount: 0,
        subtotal: Number(
          item.total || (item.unitPrice || 0) * (item.quantity || 0) || 0,
        ),
      },
    });
  }
}

// --- Core logic tach rieng de dung lai khi sync queue ---
async function execEcommerceExportUpdate(id, data) {
  if (!prisma) throw new Error("Prisma not available");
  const result = await withStockLock(() =>
    prisma.$transaction(
      async (tx) => {
        const oldRecord = await tx.ecommerceExport.findUnique({
          where: { id },
        });
        if (!oldRecord) throw new Error("Khong tim thay phieu xuat.");
        const nextOrderKey = String(
          data.orderNumber ||
            data.ecommerceExportCode ||
            oldRecord.orderNumber ||
            oldRecord.ecommerceExportCode ||
            "",
        ).trim();

        if (
          data.status === "completed" &&
          oldRecord.status !== "completed" &&
          nextOrderKey
        ) {
          const existingOrder = await tx.order.findUnique({
            where: { orderNumber: nextOrderKey },
            select: { id: true, orderNumber: true, status: true },
          });
          if (existingOrder) {
            return {
              skipped: true,
              reason: "existing_order",
              data: { ...existingOrder, status: "completed" },
            };
          }
        }

        if (oldRecord.status === "completed") {
          const oldItemsStr = oldRecord.items || "[]";
          const newItemsStr = data.items
            ? typeof data.items === "string"
              ? data.items
              : JSON.stringify(data.items)
            : oldItemsStr;
          const itemsUnchanged =
            data.status === "completed" && oldItemsStr === newItemsStr;
          if (!itemsUnchanged) {
            const oldItems = JSON.parse(oldItemsStr);
            for (const old of oldItems) {
              if (old.variantSku) {
                await deductItemOrCombo(tx, old.variantSku, old.quantity, {
                  type: "adjustment",
                  referenceType: "TMDT_EDIT",
                  reference:
                    oldRecord.orderNumber ||
                    oldRecord.ecommerceExportCode ||
                    "Sua thu cong",
                  note: "Hoan ton (sua don TMDT #" + oldRecord.id + ")",
                  createdBy: data.createdBy || "System",
                });
              }
            }
          }
        }

        const resolvedItems = data.items
          ? await resolveTmdtItemsSkus(tx, data.items)
          : null;
        if (data.status === "completed" && resolvedItems) {
          assertTmdtItemsHaveSku(
            resolvedItems,
            data.orderNumber ||
              data.ecommerceExportCode ||
              oldRecord.orderNumber ||
              oldRecord.ecommerceExportCode,
          );
          await assertTmdtItemsSkusExist(
            tx,
            resolvedItems,
            data.orderNumber ||
              data.ecommerceExportCode ||
              oldRecord.orderNumber ||
              oldRecord.ecommerceExportCode,
          );
        }

        const newRecord = await tx.ecommerceExport.update({
          where: { id },
          data: {
            customerName: data.customerName,
            ecommerceExportCode: data.ecommerceExportCode || null,
            orderNumber: data.orderNumber || null,
            ecommerceExportReason: data.ecommerceExportReason || null,
            ecommerceExportDate: data.ecommerceExportDate
              ? new Date(data.ecommerceExportDate)
              : undefined,
            items: resolvedItems ? JSON.stringify(resolvedItems) : undefined,
            totalAmount: data.totalAmount,
            notes: data.notes || null,
            status: data.status,
            createdBy:
              data.createdBy !== undefined ? data.createdBy : undefined,
            pickedBy: data.pickedBy !== undefined ? data.pickedBy : undefined,
          },
        });

        const oldItemsStrFinal = oldRecord.items || "[]";
        const newItemsStrFinal = resolvedItems
          ? JSON.stringify(resolvedItems)
          : oldItemsStrFinal;
        const skipDeduct =
          oldRecord.status === "completed" &&
          data.status === "completed" &&
          oldItemsStrFinal === newItemsStrFinal;
        if (data.status === "completed" && !skipDeduct) {
          const newItems = JSON.parse(newItemsStrFinal);
          for (const item of newItems) {
            if (item.variantSku) {
              await assertSaleStockAvailable(
                tx,
                item.variantSku,
                item.quantity,
              );
              await deductItemOrCombo(tx, item.variantSku, -item.quantity, {
                type: "ecom_sale",
                referenceType: "TMDT_EDIT",
                reference:
                  data.orderNumber ||
                  data.ecommerceExportCode ||
                  "Sua thu cong",
                note:
                  "Tao/Sua don TMDT: " +
                  (data.customerName || oldRecord.customerName || "TMDT"),
                createdBy: data.createdBy || "System",
              });
            }
          }
        }

        if (data.status === "completed" && oldRecord.status !== "completed") {
          await ensureMarketplaceOrderInTx(
            tx,
            newRecord,
            data.pickedBy ||
              data.createdBy ||
              oldRecord.pickedBy ||
              oldRecord.createdBy ||
              null,
          );
        }
        return { skipped: false, data: newRecord };
      },
      { timeout: 30000, maxWait: 10000 },
    ),
  );
  return result;
}

ipcMain.handle("ecommerceExports:update", async (event, id, data) => {
  try {
    requireRole("admin", "manager");
    const result = await execEcommerceExportUpdate(id, data);
    if (result?.skipped) {
      return {
        success: true,
        skipped: true,
        reason: result.reason,
        data: result.data,
      };
    }
    const record = result.data;
    const updatedItems =
      typeof record.items === "string"
        ? JSON.parse(record.items || "[]")
        : record.items || [];
    emitStockChangedForSkus(
      updatedItems.map((item) => item.variantSku || item.sku),
      {
        referenceType: "TMDT",
        reference:
          data.orderNumber || data.ecommerceExportCode || `TMDT-${record.id}`,
      },
    );
    console.log("Updated ecommerce export #" + record.id);
    void logActivity({
      module: "export",
      action: "UPDATE",
      description: "Cap nhat ban giao TMDT #" + record.id,
      recordId: record.id,
    });
    return { success: true, data: record };
  } catch (error) {
    if (isNetworkError(error)) {
      console.warn(
        "[OfflineQueue] Network error, queuing update id=" + id + ":",
        error.message,
      );
      try {
        offlineQueue.enqueue("ecommerceExports:update", { id, data });
        return {
          success: true,
          queued: true,
          pendingCount: offlineQueue.count(),
        };
      } catch (qErr) {
        console.error("[OfflineQueue] Failed to enqueue:", qErr.message);
      }
    }
    console.error("Update ecommerce export error:", error);
    return { success: false, error: error.message };
  }
});
ipcMain.handle("ecommerceExports:delete", async (event, id) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");
    const deletedSkus = [];

    // 🔒 StockMutex: serialize stock operations — tránh race condition Thẻ Kho
    await withStockLock(() =>
      prisma.$transaction(
        async (tx) => {
          const doc = await tx.ecommerceExport.findUnique({ where: { id } });
          if (!doc) return;

          if (doc.status === "completed") {
            const items = JSON.parse(doc.items || "[]");
            for (const item of items) {
              if (item.variantSku) {
                deletedSkus.push(item.variantSku);
                await deductItemOrCombo(tx, item.variantSku, item.quantity, {
                  type: "adjustment",
                  referenceType: "TMDT_CANCEL",
                  reference:
                    doc.orderNumber ||
                    doc.ecommerceExportCode ||
                    "Xóa thủ công",
                  note: `Hoàn tồn do xóa đơn TMDT #${id}`,
                  createdBy: "System",
                });
              }
            }
          }
          await tx.ecommerceExport.delete({ where: { id } });
        },
        { timeout: 30000, maxWait: 10000 },
      ),
    );

    console.log(`✅ Deleted ecommerce export #${id}`);
    emitStockChangedForSkus(deletedSkus, {
      referenceType: "TMDT_CANCEL",
      reference: `TMDT-${id}`,
    });
    void logActivity({
      module: "export",
      action: "DELETE",
      description: `Xóa bàn giao TMDT #${id}`,
    });
    return { success: true };
  } catch (error) {
    console.error("❌ Delete ecommerce export error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("ecommerceExports:bulkDelete", async (event, ids) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");
    const startTime = Date.now();
    const bulkDeletedSkus = [];

    // 🔒 StockMutex: serialize stock operations — tránh race condition Thẻ Kho
    const count = await withStockLock(() =>
      prisma.$transaction(
        async (tx) => {
          // 🚀 Bước 1: Lấy TẤT CẢ đơn cần xóa trong 1 query
          const docs = await tx.ecommerceExport.findMany({
            where: { id: { in: ids } },
          });
          if (docs.length === 0) return 0;

          // 🚀 Bước 2: Gom SKU cần hoàn kho từ đơn completed
          const completedDocs = docs.filter((d) => d.status === "completed");
          if (completedDocs.length > 0) {
            const skuCache = await buildSkuCache(tx);
            const skuChanges = [];
            for (const doc of completedDocs) {
              const items = JSON.parse(doc.items || "[]");
              for (const item of items) {
                if (item.variantSku) {
                  bulkDeletedSkus.push(item.variantSku);
                  skuChanges.push({
                    sku: item.variantSku,
                    quantity: item.quantity,
                  }); // + quantity = hoàn kho
                }
              }
            }
            if (skuChanges.length > 0) {
              await batchStockUpdate(
                tx,
                skuChanges,
                {
                  type: "adjustment",
                  referenceType: "TMDT_CANCEL",
                  reference: `Xóa hàng loạt ${docs.length} đơn`,
                  note: `Hoàn tồn do xóa ${completedDocs.length} đơn TMDT completed`,
                  createdBy: "System",
                },
                skuCache,
              );
            }
          }

          // 🚀 Bước 3: Xóa tất cả trong 1 DELETE statement
          const deleted = await tx.ecommerceExport.deleteMany({
            where: { id: { in: ids } },
          });
          return deleted.count;
        },
        { timeout: 60000, maxWait: 10000 },
      ),
    );

    const elapsed = Date.now() - startTime;
    emitStockChangedForSkus(bulkDeletedSkus, {
      referenceType: "TMDT_CANCEL",
      reference: `TMDT-BULK-${count}`,
    });
    console.log(`✅ Bulk deleted ${count} ecommerce exports in ${elapsed}ms`);
    void logActivity({
      module: "export",
      action: "DELETE",
      description: `Xóa hàng loạt ${count} bàn giao TMDT (${elapsed}ms)`,
    });
    return { success: true, data: count };
  } catch (error) {
    console.error("❌ Bulk delete ecommerce exports error:", error);
    return { success: false, error: error.message };
  }
});

// ⚡ Xóa TẤT CẢ đơn TMDT (dùng khi cần reset/cleanup)
ipcMain.handle("ecommerceExports:deleteAll", async () => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");

    const count = await prisma.$transaction(async (tx) => {
      const completedDocs = await tx.ecommerceExport.findMany({
        where: { status: "completed" },
      });
      for (const doc of completedDocs) {
        await ensureMarketplaceOrderInTx(
          tx,
          doc,
          doc.pickedBy || doc.createdBy || null,
        );
      }

      const deleted = await tx.ecommerceExport.deleteMany({});
      return deleted.count;
    });

    console.log(`🗑️ Deleted ALL ${count} ecommerce exports`);
    void logActivity({
      module: "export",
      action: "DELETE",
      description: `Xóa toàn bộ ${count} bàn giao TMDT`,
    });
    return { success: true, data: count };
  } catch (error) {
    console.error("❌ Delete all ecommerce exports error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("ecommerceExports:deleteCancelled", async () => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");

    const result = await prisma.ecommerceExport.deleteMany({
      where: { status: "cancelled" },
    });

    console.log(`🗑️ Deleted ${result.count} cancelled ecommerce exports`);
    void logActivity({
      module: "export",
      action: "DELETE",
      description: `Xóa ${result.count} đơn TMDT đã hủy`,
    });
    return { success: true, data: result.count };
  } catch (error) {
    console.error("❌ Delete cancelled ecommerce exports error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("ecommerceExports:bulkCreate", async (event, records) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    const startTime = Date.now();
    const orderKeys = [
      ...new Set(
        (records || [])
          .map((r) => (r?.orderNumber || r?.ecommerceExportCode || "").trim())
          .filter(Boolean),
      ),
    ];

    // Re-import file TMDT nên thay thế các đơn chưa giao/cancelled cùng Order ID,
    // chỉ giữ lại đơn completed để tránh ghi đè lịch sử đã pickup.
    if (orderKeys.length > 0) {
      await prisma.ecommerceExport.deleteMany({
        where: {
          status: { not: "completed" },
          OR: [
            { orderNumber: { in: orderKeys } },
            { ecommerceExportCode: { in: orderKeys } },
          ],
        },
      });
    }

    const [existingRecords, existingOrders] =
      orderKeys.length > 0
        ? await Promise.all([
            prisma.ecommerceExport.findMany({
              where: {
                status: "completed",
                OR: [
                  { orderNumber: { in: orderKeys } },
                  { ecommerceExportCode: { in: orderKeys } },
                ],
              },
              select: { orderNumber: true, ecommerceExportCode: true },
            }),
            prisma.order.findMany({
              where: { orderNumber: { in: orderKeys } },
              select: { orderNumber: true },
            }),
          ])
        : [[], []];

    const existingOrderKeys = new Set();
    for (const record of existingRecords) {
      if (record.orderNumber) existingOrderKeys.add(record.orderNumber.trim());
      if (record.ecommerceExportCode)
        existingOrderKeys.add(record.ecommerceExportCode.trim());
    }
    for (const order of existingOrders) {
      if (order.orderNumber) existingOrderKeys.add(order.orderNumber.trim());
    }

    const seenIncomingOrderKeys = new Set();
    const dedupedRecords = [];
    for (const record of records || []) {
      const orderKey = (
        record?.orderNumber ||
        record?.ecommerceExportCode ||
        ""
      ).trim();
      if (orderKey) {
        if (
          existingOrderKeys.has(orderKey) ||
          seenIncomingOrderKeys.has(orderKey)
        ) {
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
    const result = await withStockLock(() =>
      prisma.$transaction(
        async (tx) => {
          // 🚀 Bước 1: Batch INSERT tất cả đơn cùng lúc (1 SQL statement)
          const normalizedRecords = [];
          for (const data of dedupedRecords) {
            const resolvedItems = await resolveTmdtItemsSkus(tx, data.items);
            if (data.status === "completed") {
              assertTmdtItemsHaveSku(
                resolvedItems,
                data.orderNumber || data.ecommerceExportCode,
              );
              await assertTmdtItemsSkusExist(
                tx,
                resolvedItems,
                data.orderNumber || data.ecommerceExportCode,
              );
            }
            normalizedRecords.push({
              ...data,
              items: JSON.stringify(resolvedItems),
            });
          }

          const createData = normalizedRecords.map((data) => ({
            customerName: data.customerName,
            ecommerceExportCode: data.ecommerceExportCode || null,
            orderNumber: data.orderNumber || null,
            ecommerceExportReason: data.ecommerceExportReason || null,
            ecommerceExportDate:
              data.ecommerceExportDate &&
              !isNaN(new Date(data.ecommerceExportDate).getTime())
                ? new Date(data.ecommerceExportDate)
                : new Date(),
            items: data.items,
            totalAmount: data.totalAmount || 0,
            notes: data.notes || null,
            status: data.status || "processing",
            createdBy: data.createdBy || null,
          }));

          await tx.ecommerceExport.createMany({ data: createData });

          // 🚀 Bước 2: Gom tất cả SKU cần trừ kho → batch update
          const completedRecords = normalizedRecords.filter(
            (d) => d.status === "completed",
          );
          if (completedRecords.length > 0) {
            const skuCache = await buildSkuCache(tx);
            const skuChanges = [];
            for (const data of completedRecords) {
              const itemsList = JSON.parse(data.items || "[]");
              for (const item of itemsList) {
                if (item.variantSku) {
                  skuChanges.push({
                    sku: item.variantSku,
                    quantity: -item.quantity,
                  });
                }
              }
            }
            if (skuChanges.length > 0) {
              await batchStockUpdate(
                tx,
                skuChanges,
                {
                  type: "ecom_sale",
                  referenceType: "TMDT",
                  reference: `Nhập hàng loạt ${records.length} đơn`,
                  note: `Tạo hàng loạt ${completedRecords.length} đơn TMDT completed`,
                  createdBy: dedupedRecords[0]?.createdBy || "System",
                },
                skuCache,
              );
            }
          }

          return dedupedRecords.length;
        },
        {
          maxWait: 15000,
          timeout: 120000,
        },
      ),
    );

    const elapsed = Date.now() - startTime;
    console.log(`✅ Bulk created ${result} ecommerce exports in ${elapsed}ms`);
    void logActivity({
      module: "export",
      action: "CREATE",
      description: `Tạo hàng loạt ${result} bàn giao TMDT (${elapsed}ms)`,
    });
    return {
      success: true,
      data: { count: result, skipped: records.length - result },
    };
  } catch (error) {
    console.error("❌ Bulk create ecommerce exports error:", error);
    return { success: false, error: error.message };
  }
});

// 🚫 Đánh dấu hàng loạt đơn TMDT đã bị hủy trên sàn (đối soát khi import file mới)
// Chỉ cancel đơn pending — không đụng vào đơn completed (đã giao rồi)
ipcMain.handle("ecommerceExports:bulkCancel", async (event, ids) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    if (!ids || ids.length === 0) return { success: true, data: 0 };

    const result = await prisma.ecommerceExport.updateMany({
      where: {
        id: { in: ids },
        status: { notIn: ["completed"] }, // Chỉ cancel đơn chưa giao
      },
      data: { status: "cancelled" },
    });

    console.log(
      `🚫 Bulk cancelled ${result.count} ecommerce exports (đối soát sàn)`,
    );
    void logActivity({
      module: "export",
      action: "UPDATE",
      description: `Tự động hủy ${result.count} đơn TMDT (đối soát sàn)`,
    });
    return { success: true, data: result.count };
  } catch (error) {
    console.error("❌ Bulk cancel ecommerce exports error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  "marketplaceOrders:getAll",
  async (event, { since, search, limit } = {}) => {
    try {
      if (!prisma) throw new Error("Prisma not available");
      const trimmedSearch = search ? String(search).trim() : "";
      const syntheticIdMatch = trimmedSearch.match(/^#?TMDT-(\d+)$/i);
      const numericId = syntheticIdMatch ? Number(syntheticIdMatch[1]) : null;
      const where = {
        source: { in: ["tiktok", "shopee", "lazada", "tmdt"] },
        status: "completed",
        ...(since && !search ? { createdAt: { gte: new Date(since) } } : {}),
      };
      if (search)
        where.OR = [
          { orderNumber: { contains: search, mode: "insensitive" } },
          { customerName: { contains: search, mode: "insensitive" } },
          { trackingNumber: { contains: search, mode: "insensitive" } },
          ...(numericId ? [{ id: numericId }] : []),
        ];
      const orders = await prisma.order.findMany({
        where,
        select: {
          id: true,
          orderNumber: true,
          source: true,
          status: true,
          total: true,
          note: true,
          trackingNumber: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { username: true, fullName: true } },
          items: {
            select: {
              productName: true,
              quantity: true,
              price: true,
              sku: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: search ? 50 : limit || 1000,
      });

      const formatted = orders.map((o) => ({
        ...o,
        userName: o.user?.username || o.user?.fullName || null,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
      }));
      return { success: true, data: formatted };
    } catch (error) {
      console.error("❌ Get marketplace orders error:", error);
      return { success: false, error: error.message };
    }
  },
);

// ========================================
// EXPORT ORDERS HANDLERS (XUẤT HÀNG POS)
// ========================================

ipcMain.handle("marketplaceOrders:delete", async (event, { id, userName }) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");

    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new Error("Không tìm thấy đơn hàng.");
    if (
      !["shopee", "tiktok", "lazada", "tmdt"].includes(
        String(order.source || "").toLowerCase(),
      )
    ) {
      throw new Error("Đây không phải đơn TMDT.");
    }

    await withStockLock(() =>
      getPrismaDirectTx().$transaction(
        async (tx) => {
          const linkedExport = await tx.ecommerceExport.findFirst({
            where: {
              OR: [
                { orderNumber: order.orderNumber },
                { ecommerceExportCode: order.orderNumber },
              ],
            },
          });

          if (linkedExport && linkedExport.status === "completed") {
            const exportItems = JSON.parse(linkedExport.items || "[]");
            for (const item of exportItems) {
              if (item.variantSku) {
                await deductItemOrCombo(tx, item.variantSku, item.quantity, {
                  type: "adjustment",
                  referenceType: "TMDT_CANCEL",
                  reference:
                    linkedExport.orderNumber ||
                    linkedExport.ecommerceExportCode ||
                    order.orderNumber,
                  note: `Hoàn tồn do xóa đơn TMDT ${order.orderNumber} từ màn Đơn hàng`,
                  createdBy: userName || "System",
                });
              }
            }
          } else if (order.status === "completed") {
            for (const item of order.items) {
              if (item.sku) {
                await deductItemOrCombo(tx, item.sku, item.quantity, {
                  type: "adjustment",
                  referenceType: "TMDT_CANCEL",
                  reference: order.orderNumber,
                  note: `Hoàn tồn do xóa đơn TMDT ${order.orderNumber} từ màn Đơn hàng`,
                  createdBy: userName || "System",
                });
              }
            }
          }

          if (linkedExport) {
            await tx.ecommerceExport.delete({ where: { id: linkedExport.id } });
          }

          await tx.payment.deleteMany({ where: { orderId: order.id } });
          await tx.orderItem.deleteMany({ where: { orderId: order.id } });
          await tx.order.delete({ where: { id: order.id } });
        },
        { timeout: 30000, maxWait: 10000 },
      ),
    );

    void logActivity({
      module: "sales",
      action: "DELETE",
      description: `Xóa đơn TMDT #${order.orderNumber} từ màn Đơn hàng`,
      userName: userName || "System",
    });
    return { success: true };
  } catch (error) {
    console.error("marketplaceOrders:delete error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  "exportOrders:getAll",
  async (event, { since, search, limit } = {}) => {
    try {
      requireRole("admin", "manager");
      if (!prisma) throw new Error("Prisma not available");
      const trimmedSearch = search ? String(search).trim() : "";
      const syntheticIdMatch = trimmedSearch.match(/^#?(?:XH|EX)-(\d+)$/i);
      const numericId = syntheticIdMatch ? Number(syntheticIdMatch[1]) : null;
      const where = search
        ? {
            OR: [
              { customer: { contains: search, mode: "insensitive" } },
              { notes: { contains: search, mode: "insensitive" } },
              ...(numericId ? [{ id: numericId }] : []),
            ],
          }
        : since
          ? { exportDate: { gte: new Date(since) } }
          : undefined;
      const orders = await prisma.exportOrder.findMany({
        where,
        orderBy: { exportDate: "desc" },
        take: search ? 50 : limit || 1000,
      });
      const formatted = orders.map((o) => ({
        ...o,
        exportDate: o.exportDate.toISOString(),
        items: typeof o.items === "string" ? JSON.parse(o.items) : o.items,
      }));
      return { success: true, data: formatted };
    } catch (error) {
      console.error("❌ Get export orders error:", error);
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle("exportOrders:create", async (event, data) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    const record = await prisma.exportOrder.create({
      data: {
        exportDate: new Date(data.exportDate),
        customer: data.customer,
        status: data.status || "processing",
        totalAmount: data.totalAmount || 0,
        notes: data.notes || null,
        items:
          typeof data.items === "string"
            ? data.items
            : JSON.stringify(data.items),
        createdBy: data.createdBy || null,
      },
    });
    console.log(`✅ Created export order #${record.id}`);
    void logActivity({
      module: "export",
      action: "CREATE",
      description: `Tạo xuất hàng #${record.id} - ${data.customer}`,
      recordName: data.customer,
      userName: data.createdBy,
    });
    return { success: true, data: record };
  } catch (error) {
    console.error("❌ Create export order error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("exportOrders:update", async (event, id, data) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    const record = await prisma.exportOrder.update({
      where: { id },
      data: {
        exportDate: data.exportDate ? new Date(data.exportDate) : undefined,
        customer: data.customer,
        status: data.status,
        totalAmount: data.totalAmount,
        notes: data.notes || null,
        items: data.items
          ? typeof data.items === "string"
            ? data.items
            : JSON.stringify(data.items)
          : undefined,
      },
    });
    console.log(`✅ Updated export order #${record.id}`);
    void logActivity({
      module: "export",
      action: "UPDATE",
      description: `Cập nhật xuất hàng #${record.id}`,
    });
    return { success: true, data: record };
  } catch (error) {
    console.error("❌ Update export order error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("exportOrders:delete", async (event, id) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    await prisma.exportOrder.delete({ where: { id } });
    console.log(`✅ Deleted export order #${id}`);
    void logActivity({
      module: "export",
      action: "DELETE",
      description: `Xóa xuất hàng #${id}`,
    });
    return { success: true };
  } catch (error) {
    console.error("❌ Delete export order error:", error);
    return { success: false, error: error.message };
  }
});

// ========================================
// RETURNS HANDLERS (TRẢ HÀNG)
// ========================================

ipcMain.handle("returns:getAll", async (event, { since } = {}) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    const returns = await prisma.return.findMany({
      where: since ? { createdAt: { gte: new Date(since) } } : undefined,
      orderBy: { createdAt: "desc" },
      take: 500, // ⚡ Giới hạn 500 phiếu trả gần nhất
    });
    const formatted = returns.map((r) => ({
      ...r,
      // Map DB fields → frontend fields
      complaintCode: r.returnCode || "", // returnCode → complaintCode
      productName: r.customerName || "", // customerName → productName (frontend uses productName)
      complaintDate: r.returnDate.toISOString().split("T")[0], // returnDate → complaintDate
      reason: r.returnReason || "", // returnReason → reason
      returnDate: r.returnDate.toISOString().split("T")[0],
      processNotes: r.notes || null, // notes → processNotes
      faultParty: r.faultParty || "warehouse", // ✅ Map faultParty (mặc định warehouse)
    }));
    return { success: true, data: formatted };
  } catch (error) {
    console.error("❌ Get returns error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("returns:create", async (event, data) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    const record = await prisma.return.create({
      data: {
        customerName: data.customerName,
        returnCode: data.returnCode || null,
        orderNumber: data.orderNumber || null,
        returnReason: data.returnReason || null,
        returnDate: new Date(data.returnDate),
        items:
          typeof data.items === "string"
            ? data.items
            : JSON.stringify(data.items),
        totalAmount: data.totalAmount || 0,
        notes: data.notes || null,
        status: data.status || "pending",
        packer: data.packer || null,
        faultParty: data.faultParty === "customer" ? "customer" : "warehouse", // ✅ Lưu lý do lỗi
        createdBy: data.createdBy || null,
      },
    });
    console.log(`✅ Created return #${record.id}`);
    void logActivity({
      module: "returns",
      action: "CREATE",
      description: `Tạo trả hàng #${record.id} - ${data.customerName}`,
      recordName: data.customerName,
      userName: data.createdBy,
    });
    return { success: true, data: record };
  } catch (error) {
    console.error("❌ Create return error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("returns:update", async (event, id, data) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    // 🔧 FIX: Chỉ update field được gửi, không ghi đè null các field khác
    const updateData = {};
    if (data.customerName !== undefined)
      updateData.customerName = data.customerName;
    if (data.returnCode !== undefined)
      updateData.returnCode = data.returnCode || null;
    if (data.orderNumber !== undefined)
      updateData.orderNumber = data.orderNumber || null;
    if (data.returnReason !== undefined)
      updateData.returnReason = data.returnReason || null;
    if (data.returnDate !== undefined)
      updateData.returnDate = new Date(data.returnDate);
    if (data.items !== undefined)
      updateData.items =
        typeof data.items === "string"
          ? data.items
          : JSON.stringify(data.items);
    if (data.totalAmount !== undefined)
      updateData.totalAmount = data.totalAmount;
    if (data.notes !== undefined) updateData.notes = data.notes || null;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.packer !== undefined) updateData.packer = data.packer || null;
    if (data.faultParty !== undefined)
      updateData.faultParty =
        data.faultParty === "customer" ? "customer" : "warehouse"; // ✅ Cập nhật lý do lỗi

    const record = await prisma.return.update({
      where: { id },
      data: updateData,
    });
    console.log(`✅ Updated return #${record.id}`);
    void logActivity({
      module: "returns",
      action: "UPDATE",
      description: `Cập nhật trả hàng #${record.id}`,
      changes: data,
    });
    return { success: true, data: record };
  } catch (error) {
    console.error("❌ Update return error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("returns:delete", async (event, id) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    await prisma.return.delete({ where: { id } });
    console.log(`✅ Deleted return #${id}`);
    void logActivity({
      module: "returns",
      action: "DELETE",
      description: `Xóa trả hàng #${id}`,
    });
    return { success: true };
  } catch (error) {
    console.error("❌ Delete return error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("returns:bulkCreate", async (event, records) => {
  try {
    if (!prisma) throw new Error("Prisma not available");
    console.log(`📦 returns:bulkCreate called with ${records.length} records`);
    const created = [];
    for (let i = 0; i < records.length; i++) {
      const data = records[i];
      try {
        // 🔧 Safe date parsing
        let returnDate = new Date(data.returnDate);
        if (isNaN(returnDate.getTime())) {
          console.warn(
            `⚠️ Record ${i}: Invalid returnDate: "${data.returnDate}", using current date`,
          );
          returnDate = new Date();
        }
        const record = await prisma.return.create({
          data: {
            customerName: data.customerName || "N/A",
            returnCode: data.returnCode || null,
            orderNumber: data.orderNumber || null,
            returnReason: data.returnReason || null,
            returnDate: returnDate,
            items:
              typeof data.items === "string"
                ? data.items
                : JSON.stringify(data.items || []),
            totalAmount: data.totalAmount || 0,
            notes: data.notes || null,
            status: data.status || "pending",
            packer: data.packer || null,
            faultParty:
              data.faultParty === "customer" ? "customer" : "warehouse", // ✅ Lưu lý do lỗi (bulkCreate)
            createdBy: data.createdBy || null,
          },
        });
        created.push(record);
      } catch (recordError) {
        console.error(
          `❌ Record ${i} failed:`,
          recordError.message,
          "Data:",
          JSON.stringify(data),
        );
      }
    }
    console.log(`✅ Bulk created ${created.length}/${records.length} returns`);
    void logActivity({
      module: "returns",
      action: "CREATE",
      description: `Tạo hàng loạt ${created.length} trả hàng`,
    });
    return { success: true, data: created };
  } catch (error) {
    console.error("❌ Bulk create returns error:", error);
    return { success: false, error: error.message };
  }
});

// ========================================
// REFUNDS HANDLERS (HÀNG HOÀN)
// ========================================

ipcMain.handle("refunds:getAll", async (event, { since, limit } = {}) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    const refunds = await prisma.refund.findMany({
      where: since ? { createdAt: { gte: new Date(since) } } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit || 1000,
    });
    const formatted = refunds.map((r) => ({
      ...r,
      refundDate: r.refundDate.toISOString().split("T")[0],
    }));
    return { success: true, data: formatted };
  } catch (error) {
    console.error("❌ Get refunds error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("refunds:create", async (event, data) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    // 🔧 Safe date parsing
    let refundDate = new Date(data.refundDate);
    if (isNaN(refundDate.getTime())) {
      console.warn(
        `⚠️ Invalid refundDate: "${data.refundDate}", using current date`,
      );
      refundDate = new Date();
    }
    const record = await prisma.refund.create({
      data: {
        customerName: data.customerName || "N/A",
        refundCode: data.refundCode || null,
        orderNumber: data.orderNumber || null,
        refundReason: data.refundReason || null,
        refundDate: refundDate,
        items:
          typeof data.items === "string"
            ? data.items
            : JSON.stringify(data.items || []),
        totalAmount: data.totalAmount || 0,
        notes: data.notes || null,
        status: data.status || "processing",
        createdBy: data.createdBy || null,
      },
    });
    console.log(`✅ Created refund #${record.id}`);
    void logActivity({
      module: "refunds",
      action: "CREATE",
      description: `Tạo hàng hoàn #${record.id} - ${data.customerName}`,
      recordName: data.customerName,
      userName: data.createdBy,
    });
    return { success: true, data: record };
  } catch (error) {
    console.error("❌ Create refund error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("refunds:update", async (event, id, data) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    // 🔧 FIX: Chỉ update các field được gửi lên, KHÔNG overwrite field không có
    const updateData = {};
    if (data.customerName !== undefined)
      updateData.customerName = data.customerName;
    if (data.refundCode !== undefined)
      updateData.refundCode = data.refundCode || null;
    if (data.orderNumber !== undefined)
      updateData.orderNumber = data.orderNumber || null;
    if (data.refundReason !== undefined)
      updateData.refundReason = data.refundReason || null;
    if (data.refundDate !== undefined)
      updateData.refundDate = new Date(data.refundDate);
    if (data.items !== undefined)
      updateData.items =
        typeof data.items === "string"
          ? data.items
          : JSON.stringify(data.items);
    if (data.totalAmount !== undefined)
      updateData.totalAmount = data.totalAmount;
    if (data.notes !== undefined) updateData.notes = data.notes || null;
    if (data.status !== undefined) updateData.status = data.status;

    console.log(
      `📝 Updating refund #${id} with fields:`,
      Object.keys(updateData),
    );
    const record = await prisma.refund.update({
      where: { id },
      data: updateData,
    });
    console.log(`✅ Updated refund #${record.id}`);
    void logActivity({
      module: "refunds",
      action: "UPDATE",
      description: `Cập nhật hàng hoàn #${record.id}`,
      changes: data,
    });
    return { success: true, data: record };
  } catch (error) {
    console.error("❌ Update refund error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("refunds:delete", async (event, id) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
    await prisma.refund.delete({ where: { id } });
    console.log(`✅ Deleted refund #${id}`);
    void logActivity({
      module: "refunds",
      action: "DELETE",
      description: `Xóa hàng hoàn #${id}`,
    });
    return { success: true };
  } catch (error) {
    console.error("❌ Delete refund error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("refunds:bulkDelete", async (event, ids) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");
    const result = await prisma.refund.deleteMany({
      where: { id: { in: ids } },
    });
    console.log(`✅ Bulk deleted ${result.count} refunds`);
    void logActivity({
      module: "refunds",
      action: "DELETE",
      description: `Xóa hàng loạt ${result.count} hàng hoàn`,
    });
    return { success: true, data: result.count };
  } catch (error) {
    console.error("❌ Bulk delete refunds error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("refunds:bulkCreate", async (event, records) => {
  try {
    requireRole("admin", "manager");
    if (!prisma) throw new Error("Prisma not available");
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
            console.warn(
              `⚠️ Invalid refundDate for record ${i}: "${data.refundDate}", using current date`,
            );
            refundDate = new Date();
          }
        } catch {
          refundDate = new Date();
        }

        const record = await prisma.refund.create({
          data: {
            customerName: data.customerName || "N/A",
            refundCode: data.refundCode || null,
            orderNumber: data.orderNumber || null,
            refundReason: data.refundReason || null,
            refundDate: refundDate,
            items:
              typeof data.items === "string"
                ? data.items
                : JSON.stringify(data.items || []),
            totalAmount: data.totalAmount || 0,
            notes: data.notes || null,
            status: data.status || "processing",
            createdBy: data.createdBy || null,
          },
        });
        created.push(record);
      } catch (itemError) {
        console.error(
          `❌ Error creating refund record ${i}:`,
          itemError.message,
        );
        console.error(`   Data:`, JSON.stringify(data).substring(0, 200));
        // Continue with other records
      }
    }
    console.log(`✅ Bulk created ${created.length}/${records.length} refunds`);
    void logActivity({
      module: "refunds",
      action: "CREATE",
      description: `Tạo hàng loạt ${created.length} hàng hoàn`,
    });
    return { success: true, data: created };
  } catch (error) {
    console.error("❌ Bulk create refunds error:", error);
    return { success: false, error: error.message };
  }
});

// ========================================
// STOCK BALANCE HANDLERS (CÂN BẰNG KHO)
// ========================================

ipcMain.handle("stockBalance:getAll", async (event, { limit } = {}) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");
    const records = await prisma.stockBalance.findMany({
      orderBy: { createdAt: "desc" },
      take: limit || 500,
    });
    const formatted = records.map((r) => ({
      ...r,
      date: r.createdAt.toISOString(),
      items: typeof r.items === "string" ? JSON.parse(r.items) : r.items,
    }));
    return { success: true, data: formatted };
  } catch (error) {
    console.error("❌ Get stock balance records error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("stockBalance:create", async (event, data) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");
    const record = await prisma.stockBalance.create({
      data: {
        date: new Date(data.date),
        // This endpoint is admin-only. The renderer must never choose
        // the actor recorded in an inventory audit trail.
        adjustedBy: currentSession.username,
        items:
          typeof data.items === "string"
            ? data.items
            : JSON.stringify(data.items),
        notes: data.notes || null,
      },
    });
    console.log(`✅ Created stock balance record #${record.id}`);
    const effectiveUser = currentSession.username;
    void logActivity({
      module: "products",
      action: "UPDATE",
      description: `Cân bằng kho - ${effectiveUser}`,
      recordName: effectiveUser,
      userName: effectiveUser,
    });
    return { success: true, data: record };
  } catch (error) {
    console.error("❌ Create stock balance error:", error);
    return { success: false, error: error.message };
  }
});

// ========================================
// INVENTORY LOGS / THẺ KHO
// ========================================

// Helper: Ghi log thẻ kho — được gọi từ tất cả module (POS, Purchase, Export, Returns, Refunds, StockBalance)
async function createInventoryLog({
  sku,
  productId,
  productName,
  variantColor,
  type,
  referenceType,
  reference,
  quantity,
  oldStock,
  newStock,
  note,
  createdBy,
}) {
  try {
    if (!prisma) return null;

    let reporterId = null;

    // Đích danh user đang thao tác (chống ghi đè 'System' hay 'Admin' mù mờ)
    let actualUsername = currentSession?.username;
    if (!actualUsername && typeof createdBy === "string")
      actualUsername = createdBy;

    if (actualUsername) {
      const user = await prisma.user.findUnique({
        where: { username: actualUsername },
      });
      if (user) reporterId = user.id;
    } else if (typeof createdBy === "number") {
      reporterId = createdBy;
    }

    const log = await prisma.inventoryLog.create({
      data: {
        productId: productId || 0,
        sku: sku || "",
        productName: productName || null,
        variantColor: variantColor || null,
        type: type || "adjustment",
        referenceType: referenceType || null,
        reference: reference || null,
        quantity: quantity || 0,
        oldStock: oldStock || 0,
        newStock: newStock || 0,
        note: note || null,
        createdBy: reporterId,
      },
    });
    console.log(
      `📋 [ThẻKho] ${referenceType || type}: ${sku} ${quantity > 0 ? "+" : ""}${quantity} → Tồn cuối: ${newStock}`,
    );
    return log;
  } catch (err) {
    console.error("❌ [ThẻKho] Error:", err.message);
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
      where: { variants: { contains: sku } },
    });
    for (const p of products) {
      if (!p.variants) continue;
      try {
        const variants = JSON.parse(p.variants);
        const v = variants.find((v) => v.sku === sku);
        if (v) return v.stock || 0;
      } catch {}
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
      return {
        productId: product.id,
        productName: product.name,
        variantColor: null,
      };
    }

    // Tìm trong variants
    const products = await prisma.product.findMany({
      where: { variants: { contains: sku } },
    });
    for (const p of products) {
      if (!p.variants) continue;
      try {
        const variants = JSON.parse(p.variants);
        const v = variants.find((v) => v.sku === sku);
        if (v) {
          return {
            productId: p.id,
            productName: p.name,
            variantColor: v.color || v.name || null,
          };
        }
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
}

// Lấy tất cả inventory logs (có filter + phân trang)
ipcMain.handle("inventoryLogs:getAll", async (event, filters = {}) => {
  try {
    requireInventoryLedgerReadAccess();
    if (!prisma) throw new Error("Prisma not available");

    const where = {};
    if (filters.sku) where.sku = filters.sku;
    if (filters.type) where.type = filters.type;
    if (filters.referenceType) where.referenceType = filters.referenceType;
    if (filters.search) {
      where.OR = [
        { sku: { contains: filters.search, mode: "insensitive" } },
        { productName: { contains: filters.search, mode: "insensitive" } },
        { reference: { contains: filters.search, mode: "insensitive" } },
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
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { username: true, fullName: true } },
      },
    };
    // Chỉ giới hạn khi caller truyền limit rõ ràng (vd: getBySku dùng limit: 100)
    // Không giới hạn khi load thẻ kho để tổng xuất/nhập luôn chính xác
    if (filters.limit) queryOptions.take = filters.limit;

    const logs = await prisma.inventoryLog.findMany(queryOptions);

    const formatted = logs.map((l) => ({
      ...l,
      createdAt: l.createdAt.toISOString(),
      userName: l.user?.username || null,
    }));

    console.log(`📋 [ThẻKho] Loaded ${formatted.length} logs`);
    return { success: true, data: formatted };
  } catch (error) {
    console.error("❌ Get inventory logs error:", error);
    return { success: false, error: error.message };
  }
});

// Lấy log theo SKU (thẻ kho 1 sản phẩm)
ipcMain.handle(
  "inventoryLogs:getBySku",
  async (event, { sku, limit = 100 }) => {
    try {
      requireInventoryLedgerReadAccess();
      if (!prisma) throw new Error("Prisma not available");

      const logs = await prisma.inventoryLog.findMany({
        where: { sku },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          user: { select: { username: true, fullName: true } },
        },
      });

      const formatted = logs.map((l) => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
        userName: l.user?.username || null,
      }));

      return { success: true, data: formatted };
    } catch (error) {
      console.error("❌ Get inventory logs by SKU error:", error);
      return { success: false, error: error.message };
    }
  },
);

// Lấy chi tiết chứng từ gốc từ inventory log (click Mã CT)
ipcMain.handle(
  "inventoryLogs:getRefDetail",
  async (event, { referenceType, reference }) => {
    try {
      requireInventoryLedgerReadAccess();
      if (!prisma) throw new Error("Prisma not available");
      if (!reference) return { success: false, error: "Không có mã chứng từ" };

      const refType = (referenceType || "").toUpperCase();

      // TMDT / TMDT_EDIT / TMDT_CANCEL
      if (refType.startsWith("TMDT")) {
        const doc = await prisma.ecommerceExport.findFirst({
          where: {
            OR: [
              { orderNumber: reference },
              { ecommerceExportCode: reference },
            ],
          },
        });
        if (!doc)
          return {
            success: false,
            error: `Chi tiết chứng từ gốc không còn trên hệ thống: ${reference}`,
          };
        let items = [];
        try {
          items =
            typeof doc.items === "string"
              ? JSON.parse(doc.items)
              : doc.items || [];
        } catch {}
        // Với mỗi item là combo, load combo definition để biết components
        const itemsWithCombo = await Promise.all(
          items.map(async (item) => {
            const sku = item.variantSku || item.sku || "";
            console.log(`[getRefDetail] item sku: "${sku}"`);
            if (!sku) return item;
            const combo = await prisma.comboProduct.findUnique({
              where: { sku },
            });
            console.log(
              `[getRefDetail] combo found for "${sku}":`,
              combo ? `YES - items: ${combo.items}` : "NO",
            );
            if (!combo) return item;
            let comboComponents = [];
            try {
              comboComponents =
                typeof combo.items === "string"
                  ? JSON.parse(combo.items)
                  : combo.items || [];
            } catch {}
            console.log(
              `[getRefDetail] comboComponents for "${sku}":`,
              JSON.stringify(comboComponents),
            );
            return { ...item, comboComponents };
          }),
        );
        return {
          success: true,
          type: "TMDT",
          data: { ...doc, items: itemsWithCombo },
        };
      }

      // POS / POS_EDIT / POS_CANCEL
      if (refType.startsWith("POS")) {
        const order = await prisma.order.findFirst({
          where: { orderNumber: reference },
          include: { items: true, payments: true, customer: true },
        });
        if (!order)
          return {
            success: false,
            error: `Chi tiết chứng từ gốc không còn trên hệ thống: ${reference}`,
          };
        return { success: true, type: "POS", data: order };
      }

      // NHAP (Purchase)
      if (refType === "NHAP") {
        const po = await prisma.purchaseOrder.findFirst({
          where: { poNumber: reference },
          include: {
            supplier: true,
            items: {
              include: {
                product: { select: { name: true, sku: true, unit: true } },
              },
            },
          },
        });
        if (!po)
          return {
            success: false,
            error: `Chi tiết chứng từ gốc không còn trên hệ thống: ${reference}`,
          };
        return { success: true, type: "PURCHASE", data: po };
      }

      // Adjustment / other — không có chứng từ gốc
      return {
        success: false,
        error: "Loại chứng từ này không có chi tiết để xem.",
      };
    } catch (error) {
      console.error("❌ getRefDetail error:", error);
      return { success: false, error: error.message };
    }
  },
);

// Tạo inventory log thủ công (điều chỉnh / cân bằng kho)
ipcMain.handle("inventoryLogs:create", async (event, data) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");
    const log = await createInventoryLog(data);
    return { success: true, data: log };
  } catch (error) {
    console.error("❌ Create inventory log error:", error);
    return { success: false, error: error.message };
  }
});

// ========================================
// APP CONFIG HANDLERS (CẤU HÌNH ỨNG DỤNG)
// ========================================

// This is a security boundary. New configuration keys are private until they
// are deliberately added here; never make an unknown key renderer-readable.
const CONFIG_ACCESS = Object.freeze({
  stockCheckSessionsV2: { read: ["admin"], write: ["admin"], sensitive: true },
  variantMinStocks: { read: ["admin"], write: ["admin"], sensitive: true },
  pausedVariants: { read: ["admin"], write: ["admin"], sensitive: true },
  stockConversionRates: {
    read: ["admin", "manager"],
    write: ["admin", "manager"],
    sensitive: true,
  },
  // Sổ kiện chỉ lưu trạng thái vật lý (mã kiện, vị trí, trạng thái mở/khui).
  // Tồn và quy cách luôn được đọc lại từ Phiếu nhập + SKU, không lấy từ đây.
  handlingUnitsRegisterV1: {
    read: ["admin", "manager"],
    write: ["admin", "manager"],
    sensitive: true,
  },
  attendanceData: { read: ["admin"], write: ["admin"], sensitive: true },
  attendanceDataEmployeeBackup: {
    read: ["admin"],
    write: ["admin"],
    sensitive: true,
  },
  dailyTasksHistory: { read: ["admin"], write: ["admin"], sensitive: true },
  dailyTasksSnapshots: { read: ["admin"], write: ["admin"], sensitive: true },
  telegramApiToken: { read: ["admin"], write: ["admin"], sensitive: true },
  telegramChatId: { read: ["admin"], write: ["admin"], sensitive: true },
  // Nhặt hàng là công cụ vận hành chung: mọi tài khoản được chọn và khôi phục thư mục theo dõi.
  pickupWatchFolder: {
    read: ["admin", "manager", "staff"],
    write: ["admin", "manager", "staff"],
  },
  statusList: { read: ["admin", "manager"], write: ["admin", "manager"] },
  activePacker: { read: ["admin", "manager"], write: ["admin", "manager"] },
  telegramOrderCounter: {
    read: ["admin", "manager"],
    write: ["admin", "manager"],
  },
  telegramOrderCounterDate: {
    read: ["admin", "manager"],
    write: ["admin", "manager"],
  },
  dailyTasksCategories: {
    read: ["admin", "manager"],
    write: ["admin", "manager"],
  },
  calculator_inputs_v2: {
    read: ["admin", "manager"],
    write: ["admin", "manager"],
  },
  shopee_fees_v3: { read: ["admin", "manager"], write: ["admin", "manager"] },
  tiktok_fees_v3: { read: ["admin", "manager"], write: ["admin", "manager"] },
  pnlConfig: { read: ["admin", "manager"], write: ["admin", "manager"] },
});

function requireConfigAccess(key, operation) {
  if (typeof key !== "string" || !key.trim())
    throw new Error("Invalid configuration key.");
  requireRole();
  const policy =
    CONFIG_ACCESS[key] ||
    (key.startsWith("dailyTasksSnapshot:")
      ? CONFIG_ACCESS.dailyTasksSnapshots
      : null);
  if (!policy || !policy[operation]?.includes(currentSession.role)) {
    throw new Error(
      `Not authorized to ${operation} configuration key "${key}".`,
    );
  }
  return policy;
}

ipcMain.handle("appConfig:get", async (event, key) => {
  try {
    requireConfigAccess(key, "read");
    if (key === "stockCheckSessionsV2" && currentSession?.role !== "admin") {
      throw new Error(
        "Dữ liệu phiên kiểm chỉ được truy cập qua API kiểm hàng.",
      );
    }
    if (!prisma) throw new Error("Prisma not available");
    const config = await prisma.appConfig.findUnique({
      where: { key },
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

let attendanceDataWriteTail = Promise.resolve();

function enqueueAttendanceDataWrite(write) {
  const task = attendanceDataWriteTail.then(write, write);
  // Keep the queue alive even when a caller receives a rejected write.
  attendanceDataWriteTail = task.catch(() => undefined);
  return task;
}

function isTransactionWriteConflict(error) {
  return (
    error?.code === "P2034" ||
    /write conflict|deadlock|could not serialize/i.test(String(error?.message || ""))
  );
}

const waitForRetry = (attempt) =>
  new Promise((resolve) => setTimeout(resolve, 75 * (attempt + 1)));

ipcMain.handle("appConfig:set", async (event, key, value) => {
  try {
    const policy = requireConfigAccess(key, "write");
    if (key === "stockCheckSessionsV2" && currentSession?.role !== "admin") {
      throw new Error(
        "Dữ liệu phiên kiểm chỉ được cập nhật qua API kiểm hàng.",
      );
    }
    if (!prisma) throw new Error("Prisma not available");
    const adminOnlyKeys = new Set([
      "variantMinStocks",
      "pausedVariants",
      "dailyTasksHistory",
    ]);
    if (adminOnlyKeys.has(key)) {
      requireRole("admin");
    }
    let config;
    if (key === "attendanceData") {
      config = await enqueueAttendanceDataWrite(async () => {
        let lastConflict = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            return await prisma.$transaction(
              async (tx) => {
                const current = await tx.appConfig.findUnique({ where: { key } });
                let valueToSave = { ...(value || {}), employees: [] };
                if (current?.value) {
                  try {
                    const currentValue = JSON.parse(current.value);
                    if (Array.isArray(currentValue?.employees)) {
                      valueToSave = {
                        ...(value || {}),
                        employees: currentValue.employees,
                      };
                    }
                  } catch {}
                }
                return tx.appConfig.upsert({
                  where: { key },
                  update: { value: JSON.stringify(valueToSave) },
                  create: { key, value: JSON.stringify(valueToSave) },
                });
              },
              { isolationLevel: "Serializable", timeout: 10000, maxWait: 10000 },
            );
          } catch (error) {
            if (!isTransactionWriteConflict(error)) throw error;
            lastConflict = error;
            await waitForRetry(attempt);
          }
        }
        throw (
          lastConflict ||
          new Error("Dữ liệu chấm công đang được cập nhật ở máy khác. Hãy thử lại.")
        );
      });
    } else {
      config = await prisma.appConfig.upsert({
        where: { key },
        update: { value: JSON.stringify(value) },
        create: { key, value: JSON.stringify(value) },
      });
    }
    if (policy.sensitive) {
      await logActivity({
        module: "app_config",
        action: "UPDATE_SENSITIVE_CONFIG",
        description: `Updated sensitive configuration: ${key}`,
        recordName: key,
        severity: "WARNING",
      });
    }
    console.log(`✅ Set config "${key}"`);
    return { success: true, data: config };
  } catch (error) {
    console.error(`❌ Set config "${key}" error:`, error);
    return { success: false, error: error.message };
  }
});

function sanitizeStockCheckSessions(sessions, isAdmin) {
  if (isAdmin) return sessions;
  return sessions.map((session) => ({
    ...session,
    items: (session.items || []).map((item) =>
      sanitizeStockCheckItem(item, false),
    ),
  }));
}

async function readStockCheckSessions() {
  const record = await prisma.appConfig.findUnique({
    where: { key: "stockCheckSessionsV2" },
  });
  return parseStockCheckSessionsFromConfig(record);
}

function getStockCheckTodayKey() {
  return getLocalDateKey(new Date());
}

function normalizeStockCheckUsername(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("vi-VN");
}

function isStockCheckAssignee(session) {
  if (isTestOperatorSession()) return true;
  return (
    normalizeStockCheckUsername(session?.assignedTo) ===
    normalizeStockCheckUsername(currentSession?.username)
  );
}

function isPrivilegedStockCheckSession() {
  return currentSession?.role === "admin" || isTestOperatorSession();
}

function sanitizeStockCheckItem(item, isAdmin) {
  if (isAdmin) return item;
  const { systemStock, difference, ...safeItem } = item;
  // Keep the count blind until the checker explicitly asks to balance it.
  // Once a mismatch has been confirmed (or the row has been balanced), the
  // immutable comparison snapshot is safe and necessary for reconciliation.
  if (item?.requiresNote) {
    safeItem.balanceSystemStock = Number(
      item.balanceSystemStock ?? systemStock ?? 0,
    );
    safeItem.balanceActualStock = Number(
      item.balanceActualStock ?? item.actualStock ?? 0,
    );
    safeItem.balanceDifference = Number(
      item.balanceDifference ?? difference ?? 0,
    );
  } else if (!item?.balanced) {
    delete safeItem.balanceSystemStock;
    delete safeItem.balanceActualStock;
    delete safeItem.balanceDifference;
  }
  return safeItem;
}

function sanitizeStockCheckSession(session, isAdmin) {
  return {
    ...session,
    items: (session.items || []).map((item) =>
      sanitizeStockCheckItem(item, isAdmin),
    ),
  };
}

function getStockCheckSessionOrThrow(
  sessions,
  sessionId,
  allowCompleted = false,
) {
  const session = sessions.find(
    (entry) => String(entry.id) === String(sessionId),
  );
  if (!session) throw new Error("Phiên kiểm hàng không tồn tại.");
  if (session.date !== getStockCheckTodayKey())
    throw new Error("Chỉ được thao tác phiên kiểm hàng hôm nay.");
  if (!allowCompleted && session.status === "completed")
    throw new Error("Phiên kiểm hàng đã nộp, không thể sửa số đếm.");
  if (currentSession.role !== "admin" && !isStockCheckAssignee(session))
    throw new Error("Bạn không được phân công cho phiên kiểm hàng này.");
  return session;
}

function isStockCheckSessionCompleted(session) {
  return session?.status === "completed" && Boolean(session?.completedAt);
}

// A carry-over session transfers the obligation to count, not yesterday's
// physical count. Keeping any count state here makes an empty row look entered.
function resetCarriedOverStockCheckItem(item) {
  const {
    actualStock,
    difference,
    balanced,
    verificationStatus,
    requiresNote,
    countLocked,
    retryCount,
    note,
    balancedAt,
    balancedBy,
    balanceSystemStock,
    balanceActualStock,
    balanceDifference,
    stockSnapshotAt,
    ...stockItem
  } = item;
  return {
    ...stockItem,
    actualStock: null,
    difference: 0,
    balanced: false,
    note: "",
    requiresNote: false,
    countLocked: false,
    retryCount: 0,
  };
}

// One-time repair for carry-over sessions created before count-state reset was
// added. Only today's carry-over is touched, so historical audit data remains.
function repairTodayCarryOverCounts(sessions) {
  const today = getStockCheckTodayKey();
  let changed = false;
  const repairedSessions = sessions.map((session) => {
    const isTodayCarryOver =
      session?.date === today &&
      session?.type === "daily" &&
      String(session?.runId || "").startsWith("carry-over-");
    if (!isTodayCarryOver || session.carryOverCountResetVersion === 1)
      return session;
    changed = true;
    return {
      ...session,
      items: (session.items || []).map(resetCarriedOverStockCheckItem),
      carryOverCountResetVersion: 1,
    };
  });
  return { sessions: repairedSessions, changed };
}

// Make an unfinished daily check durable across days. This runs in the main
// process so the obligation does not depend on an admin opening the React page.
function createDailyCarryOverSession(sessions) {
  const today = getStockCheckTodayKey();
  const nowIso = new Date().toISOString();
  // A session with every SKU balanced is complete in substance.  Do not
  // require a person to return to a locked past date merely to press a
  // button; close it before deciding whether there is work to carry over.
  let changed = false;
  const normalizedSessions = sessions.map((session) => {
    const items = Array.isArray(session?.items) ? session.items : [];
    const fullyBalanced =
      session?.type === "daily" &&
      session?.date < today &&
      session?.status !== "completed" &&
      items.length > 0 &&
      items.every(
        (item) =>
          Number.isInteger(item?.actualStock) &&
          Number(item.actualStock) >= 0 &&
          item?.balanced === true,
      );
    if (!fullyBalanced) return session;
    changed = true;
    return {
      ...session,
      status: "completed",
      completedAt: session.completedAt || nowIso,
      completedBy: session.completedBy || "Hệ thống",
      completionSummary: session.completionSummary || {
        totalSku: items.length,
        balancedSku: items.length,
        matchedSku: items.filter((item) => item.verificationStatus === "match")
          .length,
        adjustedSku: items.filter(
          (item) => item.verificationStatus === "balanced_mismatch",
        ).length,
        completedAt: nowIso,
        completedBy: "Hệ thống",
      },
    };
  });

  // Repair an old buggy carry-over: its source has just been auto-completed
  // and the new-day copy has never received a count. Remove only that empty
  // duplicate; the normal daily assignment will then be generated normally.
  const repairedSessions = normalizedSessions.filter((session) => {
    if (
      session?.type !== "daily" ||
      session?.date !== today ||
      session?.status === "completed"
    )
      return true;
    const isUntouchedCarryOver =
      String(session?.notes || "").startsWith("Tiếp tục ") &&
      Array.isArray(session.items) &&
      session.items.length > 0 &&
      session.items.every(
        (item) => item?.actualStock === null || item?.actualStock === undefined,
      );
    if (!isUntouchedCarryOver) return true;
    const hasCompletedSource = normalizedSessions.some(
      (source) =>
        source?.type === "daily" &&
        source?.date < today &&
        source?.status === "completed" &&
        String(session.notes || "").includes(
          String(source.date || "")
            .split("-")
            .reverse()
            .slice(0, 2)
            .join("/"),
        ),
    );
    if (hasCompletedSource) changed = true;
    return !hasCompletedSource;
  });

  if (
    repairedSessions.some(
      (session) => session.date === today && session.type === "daily",
    )
  ) {
    return { sessions: repairedSessions, changed };
  }

  const source = repairedSessions
    .filter(
      (session) =>
        session.type === "daily" &&
        session.date < today &&
        session.status !== "completed" &&
        !session.rolledOverTo &&
        Array.isArray(session.items) &&
        session.items.length > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!source) return { sessions: repairedSessions, changed };

  const remainingItems = source.items.filter((item) => !item.balanced);
  // Never copy a fully balanced session into the next day.
  if (remainingItems.length === 0)
    return { sessions: repairedSessions, changed };
  const items = remainingItems;
  const carryOverSession = {
    id: today,
    runId: `carry-over-${today}-${Date.now()}`,
    date: today,
    type: "daily",
    assignedTo: source.assignedTo,
    assignedName: source.assignedName,
    status: "in_progress",
    items: items.map(resetCarriedOverStockCheckItem),
    carryOverCountResetVersion: 1,
    notes: `Tiếp tục ${items.length} SKU tồn đọng từ ${source.date}.`,
    createdAt: new Date().toISOString(),
  };
  return {
    sessions: repairedSessions
      .map((session) =>
        session.id === source.id
          ? { ...session, rolledOverTo: today }
          : session,
      )
      .concat(carryOverSession),
    changed: true,
  };
}

function hasValidStockCheckConversion(conversionRates, productName) {
  if (conversionRates?.[productName]?.noConversion === true) return true;
  const units = conversionRates?.[productName]?.units;
  return (
    Array.isArray(units) &&
    units.some((unit) => {
      const rate = Number(unit?.rate);
      return (
        String(unit?.label || "").trim().length > 0 &&
        Number.isInteger(rate) &&
        rate > 0
      );
    })
  );
}

// A SKU balanced in a full check on the same date has already been physically
// verified. Remove it from an open daily assignment so staff do not repeat the
// same work, while retaining an explicit audit trail for the daily screen.
function applySameDayFullCheckExemptions(sessions) {
  let changed = false;
  const balancedFullSkusByDate = new Map();

  for (const session of sessions) {
    if (session?.type !== "full") continue;
    const date = String(session.date || "");
    if (!date) continue;
    const balancedItems = (session.items || []).filter(
      (item) => item?.balanced === true && item?.sku,
    );
    if (!balancedItems.length) continue;
    const bySku = balancedFullSkusByDate.get(date) || new Map();
    balancedItems.forEach((item) => bySku.set(String(item.sku), item));
    balancedFullSkusByDate.set(date, bySku);
  }

  const updatedSessions = sessions.map((session) => {
    if (
      session?.type !== "daily" ||
      session?.date !== getStockCheckTodayKey() ||
      session?.status === "completed"
    )
      return session;
    const balancedBySku = balancedFullSkusByDate.get(
      String(session.date || ""),
    );
    if (!balancedBySku?.size) return session;

    const exemptedItems = (session.items || []).filter((item) =>
      balancedBySku.has(String(item.sku)),
    );
    if (!exemptedItems.length) return session;

    const existing = Array.isArray(session.fullCheckExemptions)
      ? session.fullCheckExemptions
      : [];
    const exemptionBySku = new Map(
      existing.map((item) => [String(item?.sku || ""), item]),
    );
    exemptedItems.forEach((item) =>
      exemptionBySku.set(String(item.sku), {
        sku: String(item.sku),
        productName: item.productName || "",
      }),
    );
    changed = true;
    return {
      ...session,
      items: (session.items || []).filter(
        (item) => !balancedBySku.has(String(item.sku)),
      ),
      fullCheckExemptions: Array.from(exemptionBySku.values()),
    };
  });
  return { sessions: updatedSessions, changed };
}

const DAILY_STOCK_CHECK_PRODUCT_COUNT = 3;
const STOCK_CHECK_RISK_WINDOW_DAYS = 14;
const STOCK_CHECK_LARGE_DIFFERENCE = 10;
const DAILY_STOCK_CHECK_MIN_SKUS = 12;
const DAILY_STOCK_CHECK_MAX_SKUS = 15;
const DAILY_STOCK_CHECK_VARIANT_DIVISOR = 3;

function stockCheckScopeHash(value) {
  return Array.from(String(value || "")).reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
}

function isMandatoryFullDailyStockCheckProduct(productName, items = []) {
  const name = String(productName || "").toLocaleUpperCase("vi-VN");
  const sku = String(items[0]?.sku || "").toLocaleUpperCase("vi-VN");
  return (
    (name.includes("UNICARE") && name.includes("5D")) || sku.includes("5DUNI")
  );
}

function selectDailyStockCheckScopeItems(items, date) {
  const groups = new Map();
  for (const item of items) {
    const productName = String(item?.productName || "").trim();
    if (!productName) continue;
    if (!groups.has(productName)) groups.set(productName, []);
    groups.get(productName).push(item);
  }

  const selected = [];
  for (const [productName, groupItems] of groups) {
    const remaining = DAILY_STOCK_CHECK_MAX_SKUS - selected.length;
    if (remaining <= 0) break;
    const ordered = [...groupItems].sort((left, right) =>
      String(left?.sku || "").localeCompare(String(right?.sku || "")),
    );
    const quota = isMandatoryFullDailyStockCheckProduct(productName, ordered)
      ? ordered.length
      : Math.max(
          1,
          Math.ceil(ordered.length / DAILY_STOCK_CHECK_VARIANT_DIVISOR),
        );
    const negativeItems = ordered
      .filter((item) => Number(item?.systemStock) < 0)
      .slice(0, quota);
    const selectedSkus = new Set(
      negativeItems.map((item) => String(item?.sku || "")),
    );
    const startAt =
      (stockCheckScopeHash(`${date}:${productName}`) +
        Number(String(date).replace(/\D/g, ""))) %
      ordered.length;
    for (
      let offset = 0;
      negativeItems.length < quota && offset < ordered.length;
      offset += 1
    ) {
      const item = ordered[(startAt + offset) % ordered.length];
      if (!selectedSkus.has(String(item?.sku || ""))) {
        negativeItems.push(item);
        selectedSkus.add(String(item?.sku || ""));
      }
    }
    selected.push(...negativeItems.slice(0, remaining));
  }
  return selected;
}

// One-time migration for untouched daily sessions made before the 15-SKU
// policy. A started session is never changed, because that would discard work.
function normalizeUntouchedDailyStockCheckScope(sessions) {
  const today = getStockCheckTodayKey();
  let changed = false;
  const normalizedSessions = sessions.map((session) => {
    const items = Array.isArray(session?.items) ? session.items : [];
    if (
      session?.type !== "daily" ||
      session?.date !== today ||
      session?.status === "completed" ||
      items.length <= DAILY_STOCK_CHECK_MAX_SKUS ||
      items.some(
        (item) =>
          (item?.actualStock !== null && item?.actualStock !== undefined) ||
          item?.balanced,
      )
    ) {
      return session;
    }
    const scopedItems = selectDailyStockCheckScopeItems(items, today);
    if (scopedItems.length >= items.length) return session;
    changed = true;
    return { ...session, items: scopedItems, dailyScopePolicyVersion: 1 };
  });
  return { sessions: normalizedSessions, changed };
}

function getLatestStockCheckVerificationBySku(sessions, today) {
  const cutoff = new Date(`${today}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - STOCK_CHECK_RISK_WINDOW_DAYS);
  const latestBySku = new Map();
  const candidates = sessions
    .filter(
      (session) =>
        String(session?.date || "") <= today && Array.isArray(session?.items),
    )
    .slice()
    .sort((left, right) => {
      const leftKey = `${left.date || ""}|${left.completedAt || left.createdAt || ""}`;
      const rightKey = `${right.date || ""}|${right.completedAt || right.createdAt || ""}`;
      return rightKey.localeCompare(leftKey);
    });

  for (const session of candidates) {
    const sessionDate = new Date(`${session.date}T00:00:00`);
    if (Number.isNaN(sessionDate.getTime()) || sessionDate < cutoff) continue;
    for (const item of session.items) {
      const sku = String(item?.sku || "").trim();
      if (!sku || latestBySku.has(sku) || item?.balanced !== true) continue;
      const difference = Number(item.balanceDifference ?? item.difference ?? 0);
      latestBySku.set(sku, Number.isFinite(difference) ? difference : 0);
    }
  }
  return latestBySku;
}

// A risk item is deliberately selected before sales-rank/random candidates.
// It is cleared by a later clean verification for the same SKU, while a
// current negative balance remains critical until physically reconciled.
function getStockCheckRiskProducts(products, sessions, today) {
  const latestVerificationBySku = getLatestStockCheckVerificationBySku(
    sessions,
    today,
  );
  return products
    .map((product, index) => {
      const items = expandProductForStockCheck(product);
      const negativeSkus = items
        .filter((item) => Number(item.systemStock) < 0)
        .map((item) => String(item.sku));
      const mismatchSkus = items
        .filter(
          (item) =>
            Math.abs(
              Number(latestVerificationBySku.get(String(item.sku)) || 0),
            ) >= STOCK_CHECK_LARGE_DIFFERENCE,
        )
        .map((item) => String(item.sku));
      if (!negativeSkus.length && !mismatchSkus.length) return null;
      const priority = negativeSkus.length ? 0 : 1;
      const affectedSkus = Array.from(
        new Set([...negativeSkus, ...mismatchSkus]),
      );
      const reason = negativeSkus.length
        ? "Tồn âm cần kiểm khẩn"
        : `Chênh lệch lớn (>= ${STOCK_CHECK_LARGE_DIFFERENCE}) cần kiểm lại`;
      return { product, index, priority, affectedSkus, reason };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        left.priority - right.priority || left.index - right.index,
    );
}

function applyStockCheckRiskMetadata(items, risk) {
  if (!risk) return items;
  const affected = new Set(risk.affectedSkus || []);
  return items.map((item) =>
    affected.has(String(item.sku))
      ? {
          ...item,
          priorityReason: risk.reason,
          priorityLevel: risk.priority === 0 ? "critical" : "high",
        }
      : item,
  );
}

function expandProductForStockCheck(product) {
  const unit = product?.unit || "Cái";
  const category = product?.category?.name || "-";
  let variants = [];
  try {
    variants =
      typeof product?.variants === "string"
        ? JSON.parse(product.variants || "[]")
        : Array.isArray(product?.variants)
          ? product.variants
          : [];
  } catch {
    /* An invalid legacy variants value falls back to the base SKU. */
  }

  const variantItems = variants
    .filter((variant) => String(variant?.sku || "").trim())
    .map((variant) => ({
      sku: String(variant.sku).trim(),
      productName: product.name,
      color: variant.color || "",
      unit,
      category,
      systemStock: Number(variant.stock || 0),
      actualStock: null,
      note: "",
      difference: 0,
      balanced: false,
    }));
  if (variantItems.length) return variantItems;
  if (!String(product?.sku || "").trim()) return [];
  return [
    {
      sku: String(product.sku).trim(),
      productName: product.name,
      unit,
      category,
      systemStock: Number(product.stock || 0),
      actualStock: null,
      note: "",
      difference: 0,
      balanced: false,
    },
  ];
}

// Read the authoritative stock for a SKU at the moment a physical count is
// first entered. Daily sessions may be created hours before the count, so the
// stock snapshot stored when the session is generated can already be stale.
async function readCurrentStockForStockCheck(tx, sku) {
  const direct = await tx.product.findUnique({
    where: { sku },
    select: { stock: true, variants: true },
  });
  if (direct) {
    if (direct.variants) {
      try {
        const variant = JSON.parse(direct.variants).find(
          (item) => item?.sku === sku,
        );
        if (variant) return Number(variant.stock || 0);
      } catch {}
    }
    return Number(direct.stock || 0);
  }
  const parents = await tx.product.findMany({
    where: { variants: { contains: sku } },
    select: { variants: true },
  });
  for (const parent of parents) {
    try {
      const variant = JSON.parse(parent.variants || "[]").find(
        (item) => item?.sku === sku,
      );
      if (variant) return Number(variant.stock || 0);
    } catch {}
  }
  return null;
}

// A daily session is one best-selling product plus two random products. The
// renderer starts a session, but enforcing the minimum here makes the rule
// durable for old sessions and for the assigned manager's first page load.
async function topUpTodayDailyStockCheckProducts(sessions, tx) {
  const today = getStockCheckTodayKey();
  const fullyCheckedSkus = new Set(
    sessions
      .filter((session) => session?.type === "full" && session?.date === today)
      .flatMap((session) => session.items || [])
      .filter((item) => item?.balanced && item?.sku)
      .map((item) => String(item.sku)),
  );
  const candidates = await tx.product.findMany({
    select: productSelectForCatalog(),
    orderBy: { createdAt: "asc" },
  });
  const alwaysCheckUnicare = candidates.find((product) =>
    isMandatoryFullDailyStockCheckProduct(
      product?.name,
      expandProductForStockCheck(product),
    ),
  );
  const riskProducts = getStockCheckRiskProducts(candidates, sessions, today);
  const riskByProductName = new Map(
    riskProducts.map((risk) => [String(risk.product?.name || "").trim(), risk]),
  );
  let changed = false;
  const updatedSessions = sessions.map((session) => {
    if (
      session?.type !== "daily" ||
      session?.date !== today ||
      session?.status === "completed"
    )
      return session;
    const items = Array.isArray(session.items) ? session.items : [];
    // A generated daily scope is immutable once a physical count has been
    // entered. Only repair an untouched scope that violates the 12-15 SKU
    // policy or that omitted the mandatory 5D UNICARE product.
    if (
      !items.length ||
      items.some(
        (item) =>
          (item?.actualStock !== null && item?.actualStock !== undefined) ||
          item?.balanced,
      )
    )
      return session;
    const exemptedSkus = new Set([
      ...fullyCheckedSkus,
      ...(session.fullCheckExemptions || []).map((item) =>
        String(item?.sku || ""),
      ),
    ]);
    const priorityProducts = riskProducts.filter((risk) => {
      const productName = String(risk.product?.name || "").trim();
      const availableItems = expandProductForStockCheck(risk.product).filter(
        (item) => !exemptedSkus.has(String(item.sku)),
      );
      return productName && availableItems.length > 0;
    });
    const mandatoryItems = alwaysCheckUnicare
      ? expandProductForStockCheck(alwaysCheckUnicare).filter(
          (item) => !exemptedSkus.has(String(item.sku)),
        )
      : [];
    const currentSkus = new Set(items.map((item) => String(item?.sku || "")));
    const hasMandatoryFullScope =
      !mandatoryItems.length ||
      mandatoryItems.every((item) => currentSkus.has(String(item.sku)));
    const isValidScope =
      items.length >= DAILY_STOCK_CHECK_MIN_SKUS &&
      items.length <= DAILY_STOCK_CHECK_MAX_SKUS &&
      hasMandatoryFullScope;
    if (isValidScope) return session;

    const productScore = (product) =>
      stockCheckScopeHash(`${today}:${product?.name || product?.sku || ""}`);
    const orderedProducts = [
      ...(alwaysCheckUnicare ? [alwaysCheckUnicare] : []),
      ...priorityProducts.map((risk) => risk.product),
      ...candidates
        .slice()
        .sort((left, right) => productScore(left) - productScore(right)),
    ].filter((product, index, list) => {
      const key = String(product?.id || product?.sku || product?.name || "");
      return (
        key &&
        list.findIndex(
          (entry) =>
            String(entry?.id || entry?.sku || entry?.name || "") === key,
        ) === index
      );
    });
    const availableItems = orderedProducts.flatMap((product) =>
      applyStockCheckRiskMetadata(
        expandProductForStockCheck(product).filter(
          (item) => !exemptedSkus.has(String(item.sku)),
        ),
        riskByProductName.get(String(product?.name || "").trim()),
      ),
    );
    // Carry-over items are obligations from yesterday and must never be
    // replaced. Keep them first, then add today's mandatory/risk/rotation
    // scope until the daily minimum is reached.
    const generatedItems = selectDailyStockCheckScopeItems(
      availableItems,
      today,
    );
    const scopedItems = items.slice();
    const selectedSkus = new Set(
      scopedItems.map((item) => String(item?.sku || "")),
    );
    for (const item of generatedItems) {
      if (scopedItems.length >= DAILY_STOCK_CHECK_MAX_SKUS) break;
      if (!selectedSkus.has(String(item.sku))) {
        scopedItems.push(item);
        selectedSkus.add(String(item.sku));
      }
    }
    if (scopedItems.length < DAILY_STOCK_CHECK_MIN_SKUS) {
      for (const item of availableItems) {
        if (
          scopedItems.length >= DAILY_STOCK_CHECK_MIN_SKUS ||
          scopedItems.length >= DAILY_STOCK_CHECK_MAX_SKUS
        )
          break;
        if (!selectedSkus.has(String(item.sku))) {
          scopedItems.push(item);
          selectedSkus.add(String(item.sku));
        }
      }
    }
    if (!scopedItems.length) return session;
    changed = true;
    return { ...session, items: scopedItems, dailyScopePolicyVersion: 3 };
  });
  return { sessions: updatedSessions, changed };
}

async function requireStockCheckConversion(tx, productName) {
  const record = await tx.appConfig.findUnique({
    where: { key: "stockConversionRates" },
  });
  let conversionRates = {};
  try {
    conversionRates = record ? JSON.parse(record.value || "{}") : {};
  } catch {}
  if (!hasValidStockCheckConversion(conversionRates, productName)) {
    const error = new Error(
      `Chưa thiết lập quy đổi đơn vị cho sản phẩm "${productName || "không xác định"}".`,
    );
    error.code = "conversion_required";
    throw error;
  }
}

function getStockCheckItemOrThrow(session, sku) {
  const item = (session.items || []).find(
    (entry) => String(entry.sku) === String(sku),
  );
  if (!item) throw new Error("SKU không thuộc phiên kiểm hàng này.");
  return item;
}

function serializeStockCheckSessions(sessions) {
  const json = JSON.stringify(sessions);
  return `gz:${zlib.deflateRawSync(Buffer.from(json, "utf8")).toString("base64")}`;
}

async function writeStockCheckSessions(sessions, tx = prisma) {
  const value = serializeStockCheckSessions(sessions);
  await tx.appConfig.upsert({
    where: { key: "stockCheckSessionsV2" },
    update: { value },
    create: { key: "stockCheckSessionsV2", value },
  });
}

// All check sessions are kept in one AppConfig record. Use a PostgreSQL
// transaction-scoped advisory lock so different desktop clients cannot overwrite
// each other's session changes with a stale JSON snapshot.
async function lockStockCheckSessions(tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('stockCheckSessionsV2'))`;
}

function parseStockCheckSessionsFromConfig(record) {
  try {
    const value = String(record?.value || "[]");
    const json = value.startsWith("gz:")
      ? zlib
          .inflateRawSync(Buffer.from(value.slice(3), "base64"))
          .toString("utf8")
      : value;
    return JSON.parse(json || "[]");
  } catch {
    return [];
  }
}

function buildStockCheckBalanceHistoryItem(item, reference) {
  const systemStock = Number(item.systemStock || 0);
  const actualStock = Number(item.actualStock ?? systemStock);
  return {
    ...item,
    systemStock,
    actualStock,
    difference: actualStock - systemStock,
    reference,
    balancedAt: new Date().toISOString(),
  };
}

ipcMain.handle("stockCheck:balanceItems", async (event, payload = {}) => {
  try {
    // Atomic batch balance: reads system/count values from the backend session,
    // so the renderer cannot forge stock deltas.
    requireRole("admin", "manager", "staff");
    if (!prisma) throw new Error("Prisma not available");

    const username = currentSession.username;
    const sessionId = String(payload.sessionId || "").trim();
    const reference = String(payload.reference || "").trim();
    const rawItems = Array.isArray(payload.items) ? payload.items : [];

    if (!sessionId) throw new Error("Thiếu sessionId cân bằng kho.");
    if (!reference) throw new Error("Thiếu reference cân bằng kho.");
    if (!rawItems.length) throw new Error("Không có SKU nào để cân bằng.");

    const response = await withStockLock(() =>
      getPrismaDirectTx().$transaction(
        async (tx) => {
          await lockStockCheckSessions(tx);
          const existingBalance = await tx.stockBalance.findFirst({
            where: { items: { contains: reference } },
            orderBy: { createdAt: "desc" },
          });
          if (existingBalance) {
            const config = await tx.appConfig.findUnique({
              where: { key: "stockCheckSessionsV2" },
            });
            const sessions = parseStockCheckSessionsFromConfig(config);
            console.log(
              `[StockCheckAtomic] duplicate reference=${reference} username=${username} sessionId=${sessionId} -> skip`,
            );
            return {
              duplicate: true,
              adjustedCount: 0,
              matchedCount: 0,
              stockBalance: existingBalance,
              sessions,
            };
          }

          const config = await tx.appConfig.findUnique({
            where: { key: "stockCheckSessionsV2" },
          });
          const sessions = parseStockCheckSessionsFromConfig(config);
          const sessionIndex = sessions.findIndex(
            (s) => String(s?.id) === sessionId,
          );
          if (sessionIndex < 0)
            throw new Error(`Không tìm thấy phiên kiểm ${sessionId}.`);

          const session = sessions[sessionIndex];
          if (session.date !== getStockCheckTodayKey()) {
            throw new Error("Chỉ được cân bằng phiên kiểm hàng hôm nay.");
          }
          if (session.status === "completed") {
            throw new Error("Stock check session has already been submitted.");
          }
          if (
            currentSession?.role !== "admin" &&
            !isStockCheckAssignee(session)
          ) {
            throw new Error(
              "Bạn không được phân công cho phiên kiểm hàng này.",
            );
          }

          const storedItemsBySku = new Map(
            (session.items || []).map((item) => [String(item.sku), item]),
          );
          const completedItems = [];
          const adjustedItems = [];
          const matchedItems = [];
          const nowIso = new Date().toISOString();

          for (const raw of rawItems) {
            const sku = String(raw?.sku || "").trim();
            if (!sku) throw new Error("Thiếu SKU trong request cân bằng.");
            const stored = storedItemsBySku.get(sku);
            if (!stored)
              throw new Error(
                `SKU ${sku} không thuộc phiên kiểm ${sessionId}.`,
              );
            if (stored.balanced) continue;
            if (!stored.stockSnapshotAt) {
              throw new Error(
                `SKU ${sku} thuộc phiên kiểm cũ chưa có mốc tồn thực tế. Hãy dùng "Kiểm lại" và nhập lại số trước khi cân bằng.`,
              );
            }

            await requireStockCheckConversion(tx, stored.productName);

            const actualStock = stored.actualStock;
            if (actualStock === null || actualStock === undefined)
              throw new Error(`SKU ${sku} chưa nhập tồn thực tế.`);
            const systemStock = Number(stored.systemStock || 0);
            const actual = Number(actualStock);
            const difference = actual - systemStock;
            const note = String(stored.note ?? "").trim();
            if (difference !== 0 && !note)
              throw new Error(`SKU ${sku} chênh lệch nhưng thiếu lý do.`);

            const historyItem = buildStockCheckBalanceHistoryItem(
              {
                ...stored,
                sku,
                systemStock,
                actualStock: actual,
                difference,
                note,
              },
              reference,
            );
            historyItem.stockCheckRunId =
              session.runId || session.createdAt || session.id;

            if (difference !== 0) {
              const stockResult = await updateProductStockInTx(
                tx,
                sku,
                difference,
                {
                  type: "adjustment",
                  referenceType: "CAN_BANG",
                  reference,
                  note: `${payload.logPrefix || "Kiểm hàng"}. HT ${systemStock} -> TT ${actual}. ${note ? `Lý do: ${note}` : ""}`,
                  createdBy: username,
                },
              );
              historyItem.oldStock = stockResult.oldStock;
              historyItem.newStock = stockResult.newStock;
              adjustedItems.push(historyItem);
            } else {
              matchedItems.push(historyItem);
            }
            completedItems.push(historyItem);
          }

          if (!completedItems.length)
            throw new Error("Không có dòng mới nào để cân bằng.");

          const stockBalance = await tx.stockBalance.create({
            data: {
              date: payload.date ? new Date(payload.date) : new Date(),
              adjustedBy: username,
              items: JSON.stringify(completedItems),
              notes: `${payload.historyNotes || "Kiểm hàng"} | Ref: ${reference}`,
            },
          });

          const completedBySku = new Map(
            completedItems.map((item) => [String(item.sku), item]),
          );
          const updatedItems = (session.items || []).map((item) => {
            const balancedItem = completedBySku.get(String(item.sku));
            if (!balancedItem) return item;
            return {
              ...item,
              actualStock: balancedItem.actualStock,
              balanceSystemStock: balancedItem.systemStock,
              balanceActualStock: balancedItem.actualStock,
              balanceDifference: balancedItem.difference,
              systemStock: balancedItem.actualStock,
              difference: 0,
              note: balancedItem.note || "",
              balanced: true,
              verificationStatus:
                balancedItem.difference === 0 ? "match" : "balanced_mismatch",
              requiresNote: false,
              countLocked: false,
              balancedAt: nowIso,
            };
          });
          // Balancing every SKU only makes the session ready. The assignee
          // must explicitly submit the completed session afterwards.
          sessions[sessionIndex] = {
            ...session,
            items: updatedItems,
            status: "in_progress",
            completedAt: undefined,
          };

          await writeStockCheckSessions(sessions, tx);
          await tx.activityLog.create({
            data: {
              module: "products",
              action: "UPDATE",
              description: `Cân bằng kho atomic ${completedItems.length} SKU - ${reference}`,
              recordId: stockBalance.id,
              recordName: reference,
              changes: JSON.stringify({
                reference,
                sessionId,
                username,
                adjusted: adjustedItems.map((i) => ({
                  sku: i.sku,
                  before: i.systemStock,
                  after: i.actualStock,
                  difference: i.difference,
                })),
                matched: matchedItems.map((i) => ({
                  sku: i.sku,
                  stock: i.actualStock,
                })),
              }),
              userName: username,
              severity: "INFO",
            },
          });

          console.log(
            `[StockCheckAtomic] OK reference=${reference} username=${username} sessionId=${sessionId} adjusted=${adjustedItems.length} matched=${matchedItems.length}`,
          );
          return {
            duplicate: false,
            adjustedCount: adjustedItems.length,
            matchedCount: matchedItems.length,
            stockBalance,
            sessions,
          };
        },
        { timeout: 30000, maxWait: 10000 },
      ),
    );

    emitStockChanged({
      referenceType: "CAN_BANG",
      reference,
      sessionId,
      username,
      skus: response.stockBalance
        ? rawItems.map((item) => String(item?.sku || "").trim()).filter(Boolean)
        : [],
      count: rawItems.length,
    });
    return {
      success: true,
      ...response,
      data: {
        stockBalance: response.stockBalance,
        sessions: (response.sessions || []).map((session) =>
          sanitizeStockCheckSession(session, currentSession?.role === "admin"),
        ),
      },
    };
  } catch (error) {
    console.error("❌ StockCheck atomic balance error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("stockCheck:getSessions", async () => {
  try {
    requireRole("admin", "manager");
    const sessions = await getPrismaDirectTx().$transaction(
      async (tx) => {
        await lockStockCheckSessions(tx);
        const record = await tx.appConfig.findUnique({
          where: { key: "stockCheckSessionsV2" },
        });
        const storedSessions = parseStockCheckSessionsFromConfig(record);
        const carried = createDailyCarryOverSession(storedSessions);
        const repaired = repairTodayCarryOverCounts(carried.sessions);
        const exempted = applySameDayFullCheckExemptions(repaired.sessions);
        const normalizedScope = normalizeUntouchedDailyStockCheckScope(
          exempted.sessions,
        );
        const toppedUp = await topUpTodayDailyStockCheckProducts(
          normalizedScope.sessions,
          tx,
        );
        if (
          carried.changed ||
          repaired.changed ||
          exempted.changed ||
          normalizedScope.changed ||
          toppedUp.changed
        ) {
          await writeStockCheckSessions(toppedUp.sessions, tx);
        }
        return toppedUp.sessions;
      },
      { timeout: 30000, maxWait: 10000 },
    );
    const isAdmin = isPrivilegedStockCheckSession();
    const visibleSessions =
      isAdmin || isTestOperatorSession()
        ? sessions
        : sessions.filter(
            (session) =>
              session.date === getStockCheckTodayKey() &&
              isStockCheckAssignee(session),
          );
    return {
      success: true,
      data: visibleSessions.map((session) =>
        sanitizeStockCheckSession(session, isAdmin),
      ),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Managers may ask the system to create today's daily session, but may never
// replace the complete session ledger. The server owns both the assignee and
// the transaction lock so concurrent clients cannot make duplicate sessions.
ipcMain.handle("stockCheck:ensureDailySession", async (event, payload = {}) => {
  try {
    requireRole("admin", "manager");
    const requestedItems = Array.isArray(payload.items) ? payload.items : [];
    if (!requestedItems.length)
      throw new Error("Chưa có SKU để tạo phiên kiểm.");

    const result = await getPrismaDirectTx().$transaction(
      async (tx) => {
        await lockStockCheckSessions(tx);
        const today = getStockCheckTodayKey();
        const record = await tx.appConfig.findUnique({
          where: { key: "stockCheckSessionsV2" },
        });
        const storedSessions = parseStockCheckSessionsFromConfig(record);
        const carried = createDailyCarryOverSession(storedSessions);
        const repaired = repairTodayCarryOverCounts(carried.sessions);
        let sessions = repaired.sessions;
        const existing = sessions.find(
          (session) => session?.date === today && session?.type === "daily",
        );
        if (existing) {
          if (carried.changed || repaired.changed)
            await writeStockCheckSessions(sessions, tx);
          return {
            session: existing,
            changed: carried.changed || repaired.changed,
          };
        }

        const managers = (
          await tx.user.findMany({
            where: { role: "manager", status: "active" },
            select: {
              username: true,
              fullName: true,
              role: true,
              status: true,
              permissions: true,
            },
          })
        )
          .filter(isOperationalAssignee)
          .sort((a, b) =>
            String(a.username).localeCompare(String(b.username), "vi"),
          );
        if (!managers.length)
          throw new Error(
            "Chưa có quản lý đang hoạt động để phân công phiên kiểm.",
          );

        const previous = [...sessions]
          .filter(
            (session) =>
              session?.type === "daily" &&
              session?.date < today &&
              managers.some(
                (manager) =>
                  normalizeStockCheckUsername(manager.username) ===
                  normalizeStockCheckUsername(session.assignedTo),
              ),
          )
          .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
        const previousIndex = previous
          ? managers.findIndex(
              (manager) =>
                normalizeStockCheckUsername(manager.username) ===
                normalizeStockCheckUsername(previous.assignedTo),
            )
          : -1;
        const assignee =
          managers[(previousIndex + 1 + managers.length) % managers.length];

        const uniqueSkus = new Set();
        const items = requestedItems
          .slice(0, 1000)
          .map((item) => {
            const sku = String(item?.sku || "").trim();
            if (!sku || uniqueSkus.has(sku)) return null;
            uniqueSkus.add(sku);
            return {
              sku,
              productName: String(item?.productName || sku),
              color: item?.color ? String(item.color) : undefined,
              unit: String(item?.unit || "Cái"),
              category: String(item?.category || "-"),
              systemStock: Number.isFinite(Number(item?.systemStock))
                ? Number(item.systemStock)
                : 0,
              actualStock: null,
              note: "",
              difference: 0,
              balanced: false,
              requiresNote: false,
              countLocked: false,
              retryCount: 0,
              priorityReason: item?.priorityReason
                ? String(item.priorityReason)
                : undefined,
              priorityLevel:
                item?.priorityLevel === "critical"
                  ? "critical"
                  : item?.priorityLevel === "high"
                    ? "high"
                    : undefined,
            };
          })
          .filter(Boolean);
        if (!items.length) throw new Error("Danh sách SKU kiểm không hợp lệ.");

        const now = new Date();
        const session = {
          id: today,
          runId: `daily-${crypto.randomUUID?.() || now.getTime()}`,
          date: today,
          type: "daily",
          assignedTo: assignee.username,
          assignedName: assignee.fullName || assignee.username,
          status: "in_progress",
          items,
          notes: "",
          createdAt: now.toISOString(),
          createdBy: currentSession.username,
          autoAssigned: true,
        };
        sessions = [...sessions, session].slice(-90);
        await writeStockCheckSessions(sessions, tx);
        await tx.activityLog.create({
          data: {
            module: "stock_check",
            action: "AUTO_CREATE_DAILY_SESSION",
            description: `Tự tạo phiên kiểm ${today}: ${items.length} SKU, giao ${assignee.username}.`,
            recordName: today,
            changes: JSON.stringify({
              assignedTo: assignee.username,
              totalSku: items.length,
            }),
            userName: currentSession.username,
            severity: "INFO",
          },
        });
        return { session, changed: true };
      },
      { timeout: 30000, maxWait: 10000 },
    );

    return {
      success: true,
      session: sanitizeStockCheckSession(
        result.session,
        isPrivilegedStockCheckSession(),
      ),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  "stockCheck:createRecheckSession",
  async (event, payload = {}) => {
    try {
      requireRole("admin", "manager");
      const sourceSessionId = String(payload.sourceSessionId || "").trim();
      const assignedTo = String(payload.assignedTo || "").trim();
      const reason = String(payload.reason || "").trim();
      const selectedSkus = [
        ...new Set(
          (Array.isArray(payload.skus) ? payload.skus : [])
            .map((sku) => String(sku || "").trim())
            .filter(Boolean),
        ),
      ];
      if (!sourceSessionId) throw new Error("Thiếu phiên gốc cần kiểm lại.");
      if (!assignedTo) throw new Error("Cần chọn người phụ trách kiểm lại.");
      if (!reason) throw new Error("Cần nhập lý do kiểm lại.");
      if (!selectedSkus.length)
        throw new Error("Cần chọn ít nhất một SKU để kiểm lại.");

      const result = await getPrismaDirectTx().$transaction(
        async (tx) => {
          await lockStockCheckSessions(tx);
          const record = await tx.appConfig.findUnique({
            where: { key: "stockCheckSessionsV2" },
          });
          const sessions = parseStockCheckSessionsFromConfig(record);
          const source = sessions.find(
            (session) => String(session?.id) === sourceSessionId,
          );
          if (!source) throw new Error("Không tìm thấy phiên kiểm gốc.");
          if (!isStockCheckSessionCompleted(source))
            throw new Error("Chỉ có thể tạo kiểm lại từ phiên đã hoàn thành.");
          if (String(source.date || "") >= getStockCheckTodayKey())
            throw new Error("Chỉ tạo kiểm lại từ phiên trước ngày hôm nay.");

          const existingOpenRecheck = sessions.find(
            (session) =>
              session?.type === "recheck" &&
              session?.sourceSessionId === sourceSessionId &&
              session?.status !== "completed",
          );
          if (existingOpenRecheck)
            throw new Error(
              "Phiên gốc này đã có một phiên kiểm lại đang thực hiện.",
            );

          const assignee = await tx.user.findUnique({
            where: { username: assignedTo },
            select: {
              username: true,
              fullName: true,
              role: true,
              status: true,
              permissions: true,
            },
          });
          if (
            !assignee ||
            assignee.status !== "active" ||
            !isOperationalAssignee(assignee) ||
            assignee.role !== "manager"
          ) {
            throw new Error(
              "Người phụ trách không hợp lệ hoặc không còn hoạt động.",
            );
          }

          const sourceBySku = new Map(
            (source.items || []).map((item) => [String(item.sku), item]),
          );
          const invalidSkus = selectedSkus.filter(
            (sku) => !sourceBySku.has(sku),
          );
          if (invalidSkus.length)
            throw new Error(
              `SKU không thuộc phiên gốc: ${invalidSkus.join(", ")}.`,
            );

          const products = await tx.product.findMany({
            select: productSelectForCatalog(),
          });
          const currentItemBySku = new Map(
            products
              .flatMap(expandProductForStockCheck)
              .map((item) => [String(item.sku), item]),
          );
          const items = selectedSkus.map((sku) => {
            const current = currentItemBySku.get(sku);
            const original = sourceBySku.get(sku);
            if (!current)
              throw new Error(
                `SKU ${sku} không còn tồn tại trong danh mục sản phẩm.`,
              );
            return {
              ...current,
              recheckOriginalSystemStock: Number(original.systemStock || 0),
              recheckOriginalActualStock:
                original.actualStock == null
                  ? null
                  : Number(original.actualStock),
              recheckOriginalDifference: Number(original.difference || 0),
              recheckOriginalVerificationStatus:
                original.verificationStatus || null,
            };
          });
          const now = new Date();
          const today = getStockCheckTodayKey();
          const session = {
            id: `recheck-${today}-${now.getTime()}`,
            runId: `recheck-${crypto.randomUUID?.() || now.getTime()}`,
            date: today,
            type: "recheck",
            assignedTo: assignee.username,
            assignedName: assignee.fullName || assignee.username,
            status: "in_progress",
            items,
            notes: reason,
            createdAt: now.toISOString(),
            sourceSessionId: source.id,
            sourceSessionDate: source.date,
            sourceSessionRunId: source.runId || null,
            recheckScope: payload.scope === "all" ? "all" : "mismatch",
            createdBy: currentSession.username,
          };
          const updatedSessions = [...sessions, session].slice(-90);
          await writeStockCheckSessions(updatedSessions, tx);
          await tx.activityLog.create({
            data: {
              module: "stock_check",
              action: "CREATE_RECHECK",
              description: `Tạo phiên kiểm lại ${session.id} từ phiên ${source.id}: ${items.length} SKU`,
              recordName: session.id,
              changes: JSON.stringify({
                sourceSessionId: source.id,
                sourceDate: source.date,
                assignedTo,
                reason,
                skus: selectedSkus,
              }),
              userName: currentSession.username,
              severity: "WARNING",
            },
          });
          return { session, sessions: updatedSessions };
        },
        { timeout: 30000, maxWait: 10000 },
      );

      return {
        success: true,
        session: sanitizeStockCheckSession(
          result.session,
          isPrivilegedStockCheckSession(),
        ),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle(
  "stockCheck:adminSaveSessions",
  async (event, incomingSessions) => {
    try {
      // Bulk session replacement is an admin operation. Managers update a
      // single assigned count through stockCheck:updateCount/submitSession.
      requireRole("admin");
      const isAdmin = isPrivilegedStockCheckSession();
      const submittedSessions = Array.isArray(incomingSessions)
        ? incomingSessions
        : [];
      const merged = await getPrismaDirectTx().$transaction(
        async (tx) => {
          await lockStockCheckSessions(tx);
          const record = await tx.appConfig.findUnique({
            where: { key: "stockCheckSessionsV2" },
          });
          const storedSessions = parseStockCheckSessionsFromConfig(record);
          const storedById = new Map(
            storedSessions.map((session) => [String(session.id), session]),
          );
          const incomingIds = new Set();
          const protectedSessions = [];

          for (const session of submittedSessions) {
            const sessionId = String(session?.id || "").trim();
            if (!sessionId || incomingIds.has(sessionId)) {
              throw new Error(
                "Dữ liệu phiên kiểm không hợp lệ hoặc bị trùng ID.",
              );
            }
            incomingIds.add(sessionId);
            const storedSession = storedById.get(sessionId);

            // Completed sessions are immutable. They can only be reopened by
            // a dedicated audited operation, never by a bulk JSON replacement.
            if (storedSession && isStockCheckSessionCompleted(storedSession)) {
              if (JSON.stringify(session) !== JSON.stringify(storedSession)) {
                throw new Error(
                  "Phiên kiểm đã chốt là bất biến. Muốn sửa phải dùng luồng mở lại phiên có ghi nhận lý do.",
                );
              }
              protectedSessions.push(storedSession);
              continue;
            }
            if (session?.status === "completed" || session?.completedAt) {
              throw new Error(
                "Không thể chốt phiên qua lưu hàng loạt. Hãy dùng thao tác Chốt phiên kiểm hàng.",
              );
            }
            protectedSessions.push(session);
          }

          // A stale admin screen must not be able to delete an already-closed
          // session by omitting it from its local snapshot.
          storedSessions.forEach((session) => {
            if (
              isStockCheckSessionCompleted(session) &&
              !incomingIds.has(String(session.id))
            ) {
              protectedSessions.push(session);
            }
          });

          const exempted = applySameDayFullCheckExemptions(protectedSessions);
          const normalizedScope = normalizeUntouchedDailyStockCheckScope(
            exempted.sessions,
          );
          const toppedUp = await topUpTodayDailyStockCheckProducts(
            normalizedScope.sessions,
            tx,
          );
          await writeStockCheckSessions(toppedUp.sessions, tx);
          return toppedUp.sessions;
        },
        { timeout: 30000, maxWait: 10000 },
      );
      return { success: true, data: merged };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

// ========================================
// USERS HANDLERS (NGƯỜI DÙNG / PHÂN QUYỀN)
// ========================================

ipcMain.handle("stockCheck:updateCount", async (event, payload = {}) => {
  try {
    requireRole("admin", "manager");
    const clearCount = payload.actualStock === null;
    const actualStock = Number(payload.actualStock);
    if (!clearCount && (!Number.isInteger(actualStock) || actualStock < 0))
      throw new Error("Số đếm thực tế phải là số nguyên không âm.");
    const item = await getPrismaDirectTx().$transaction(
      async (tx) => {
        await lockStockCheckSessions(tx);
        const record = await tx.appConfig.findUnique({
          where: { key: "stockCheckSessionsV2" },
        });
        const sessions = parseStockCheckSessionsFromConfig(record);
        const session = getStockCheckSessionOrThrow(
          sessions,
          payload.sessionId,
        );
        const storedItem = getStockCheckItemOrThrow(session, payload.sku);
        if (storedItem.countLocked)
          throw new Error(
            "Số đếm đang được khóa. Hãy nhập lý do hoặc dùng lượt nhập lại.",
          );
        // Capture the live stock only when this SKU receives its first
        // physical count. Later edits must keep the same comparison point.
        if (
          !clearCount &&
          storedItem.actualStock === null &&
          !storedItem.balanced
        ) {
          const liveStock = await readCurrentStockForStockCheck(
            tx,
            payload.sku,
          );
          if (liveStock === null)
            throw new Error(
              `Không thể lấy tồn kho hiện tại cho SKU ${payload.sku}.`,
            );
          storedItem.systemStock = liveStock;
          // This marker distinguishes a safe, live baseline from a
          // legacy session snapshot created hours before the count.
          storedItem.stockSnapshotAt = new Date().toISOString();
        }
        storedItem.actualStock = clearCount ? null : actualStock;
        storedItem.difference = clearCount
          ? 0
          : actualStock - Number(storedItem.systemStock || 0);
        storedItem.balanced = false;
        storedItem.requiresNote = false;
        delete storedItem.balanceSystemStock;
        delete storedItem.balanceActualStock;
        delete storedItem.balanceDifference;
        if (clearCount) delete storedItem.stockSnapshotAt;
        await writeStockCheckSessions(sessions, tx);
        return storedItem;
      },
      { timeout: 30000, maxWait: 10000 },
    );
    return {
      success: true,
      status: "entered",
      item: sanitizeStockCheckItem(item, isPrivilegedStockCheckSession()),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("stockCheck:retryCount", async (event, payload = {}) => {
  try {
    requireRole("admin", "manager");
    const item = await getPrismaDirectTx().$transaction(
      async (tx) => {
        await lockStockCheckSessions(tx);
        const record = await tx.appConfig.findUnique({
          where: { key: "stockCheckSessionsV2" },
        });
        const sessions = parseStockCheckSessionsFromConfig(record);
        const session = getStockCheckSessionOrThrow(
          sessions,
          payload.sessionId,
          isPrivilegedStockCheckSession(),
        );
        const storedItem = getStockCheckItemOrThrow(session, payload.sku);
        const retryCount = Number(storedItem.retryCount || 0);
        if (!isPrivilegedStockCheckSession() && retryCount >= 2) {
          const error = new Error(
            "Đã dùng hết 2 lượt nhập lại. Hãy nhập lý do để cân bằng.",
          );
          error.code = "retry_limit";
          throw error;
        }
        storedItem.actualStock = null;
        storedItem.note = "";
        storedItem.difference = 0;
        storedItem.balanced = false;
        storedItem.requiresNote = false;
        storedItem.countLocked = false;
        storedItem.retryCount = retryCount + 1;
        delete storedItem.balanceSystemStock;
        delete storedItem.balanceActualStock;
        delete storedItem.balanceDifference;
        delete storedItem.stockSnapshotAt;
        await writeStockCheckSessions(sessions, tx);
        return storedItem;
      },
      { timeout: 30000, maxWait: 10000 },
    );
    if (isPrivilegedStockCheckSession()) {
      void logActivity({
        module: "stock_check",
        action: "REOPEN_COUNT",
        description: `Mở lại lượt đếm SKU ${item.sku} trong phiên ${payload.sessionId}`,
        recordName: item.sku,
      });
    }
    return {
      success: true,
      status: "retry_opened",
      item: sanitizeStockCheckItem(item, isPrivilegedStockCheckSession()),
    };
  } catch (error) {
    return { success: false, code: error.code, error: error.message };
  }
});

ipcMain.handle("stockCheck:updateNote", async (event, payload = {}) => {
  try {
    requireRole("admin", "manager");
    const note = String(payload.note || "").trim();
    if (!note) throw new Error("Ghi chú không được để trống.");
    const item = await getPrismaDirectTx().$transaction(
      async (tx) => {
        await lockStockCheckSessions(tx);
        const record = await tx.appConfig.findUnique({
          where: { key: "stockCheckSessionsV2" },
        });
        const sessions = parseStockCheckSessionsFromConfig(record);
        const session = getStockCheckSessionOrThrow(
          sessions,
          payload.sessionId,
          isPrivilegedStockCheckSession(),
        );
        const storedItem = getStockCheckItemOrThrow(session, payload.sku);
        if (storedItem.balanced) return storedItem;
        if (
          storedItem.actualStock === null ||
          storedItem.actualStock === undefined
        ) {
          throw new Error("SKU này chưa nhập tồn thực tế.");
        }
        storedItem.note = note;
        await writeStockCheckSessions(sessions, tx);
        return storedItem;
      },
      { timeout: 30000, maxWait: 10000 },
    );
    return {
      success: true,
      item: sanitizeStockCheckItem(item, isPrivilegedStockCheckSession()),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// A narrowly scoped audit view for the assigned checker. It is limited to the
// session date plus the immediately preceding calendar day and SKU, while
// exposing the same stock movement columns needed to explain a mismatch.
ipcMain.handle(
  "stockCheck:getReconciliationLogs",
  async (event, payload = {}) => {
    try {
      requireRole("manager", "staff");
      const sessionId = String(payload.sessionId || "").trim();
      const sku = String(payload.sku || "").trim();
      const page = Math.max(1, Number.parseInt(payload.page, 10) || 1);
      const pageSize = 50;
      if (!sessionId || !sku)
        throw new Error("Thiếu phiên kiểm hoặc SKU cần đối soát.");

      const result = await getPrismaDirectTx().$transaction(
        async (tx) => {
          await lockStockCheckSessions(tx);
          const config = await tx.appConfig.findUnique({
            where: { key: "stockCheckSessionsV2" },
          });
          const sessions = parseStockCheckSessionsFromConfig(config);
          const session = getStockCheckSessionOrThrow(
            sessions,
            sessionId,
            false,
          );
          const item = getStockCheckItemOrThrow(session, sku);
          if (!item.countLocked || !item.requiresNote || item.balanced) {
            throw new Error(
              "Chỉ mở đối soát cho SKU đang chờ giải trình chênh lệch.",
            );
          }

          // “Đối soát 2 ngày gần nhất”: the previous calendar day and the
          // session day. This is a calendar window, not a rolling 48 hours,
          // and never includes future transactions.
          const sessionDay = new Date(`${session.date}T00:00:00`);
          const since = new Date(sessionDay);
          since.setDate(since.getDate() - 1);
          const until = new Date(`${session.date}T23:59:59.999`);
          const where = {
            sku,
            createdAt: { gte: since, lte: until },
          };
          const [logs, total] = await Promise.all([
            tx.inventoryLog.findMany({
              where,
              select: {
                id: true,
                sku: true,
                type: true,
                referenceType: true,
                reference: true,
                quantity: true,
                oldStock: true,
                newStock: true,
                note: true,
                createdAt: true,
              },
              orderBy: { createdAt: "desc" },
              skip: (page - 1) * pageSize,
              take: pageSize,
            }),
            tx.inventoryLog.count({ where }),
          ]);
          return {
            logs: logs.map((log) => ({
              ...log,
              createdAt: log.createdAt.toISOString(),
            })),
            total,
            page,
            pageSize,
          };
        },
        { timeout: 30000, maxWait: 10000 },
      );

      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle("stockCheck:balanceItem", async (event, payload = {}) => {
  try {
    // Keep single-item balancing aligned with the batch endpoint. The
    // assigned checker may be a staff user; session assignment is still
    // enforced by getStockCheckSessionOrThrow below.
    requireRole("admin", "manager", "staff");
    const note = String(payload.note || "").trim();
    const reference = String(
      payload.reference || `STOCK-CHECK-${payload.sessionId}-${payload.sku}`,
    ).trim();
    const result = await withStockLock(() =>
      getPrismaDirectTx().$transaction(
        async (tx) => {
          await lockStockCheckSessions(tx);
          const record = await tx.appConfig.findUnique({
            where: { key: "stockCheckSessionsV2" },
          });
          const sessions = parseStockCheckSessionsFromConfig(record);
          const session = getStockCheckSessionOrThrow(
            sessions,
            payload.sessionId,
            currentSession.role === "admin",
          );
          const item = getStockCheckItemOrThrow(session, payload.sku);
          if (!item.stockSnapshotAt) {
            throw new Error(
              'Phiên kiểm cũ chưa có mốc tồn thực tế. Hãy dùng "Kiểm lại" và nhập lại số trước khi cân bằng.',
            );
          }
          await requireStockCheckConversion(tx, item.productName);
          const existingBalance = await tx.stockBalance.findFirst({
            // Match the complete JSON reference value. A plain substring
            // makes SKU "...-XANH" collide with "...-XANHTHAN"/"...-XANHZIP".
            where: { items: { contains: `"reference":"${reference}"` } },
            orderBy: { createdAt: "desc" },
          });
          if (existingBalance) {
            // A retry can arrive after the first request committed but before
            // its renderer received the response. Reconcile the session from
            // the immutable balance record so it never stays "Đã nhập" while
            // the backend correctly rejects a second stock adjustment.
            const historyItems = parseJsonArray(existingBalance.items);
            const historyItem = historyItems.find(
              (entry) =>
                String(entry?.reference || "") === reference &&
                String(entry?.sku || "") === String(payload.sku || ""),
            );
            const session = sessions.find(
              (entry) => String(entry?.id) === String(payload.sessionId),
            );
            if (historyItem && session) {
              const item = (session.items || []).find(
                (entry) => String(entry?.sku) === String(payload.sku || ""),
              );
              if (item && !item.balanced) {
                item.actualStock = Number(historyItem.actualStock);
                item.balanceSystemStock = Number(historyItem.systemStock);
                item.balanceActualStock = Number(historyItem.actualStock);
                item.balanceDifference = Number(historyItem.difference || 0);
                item.systemStock = Number(historyItem.actualStock);
                item.difference = 0;
                item.note = String(historyItem.note || "");
                item.balanced = true;
                item.verificationStatus =
                  Number(historyItem.difference || 0) === 0
                    ? "match"
                    : "balanced_mismatch";
                item.requiresNote = false;
                item.countLocked = false;
                item.balancedAt =
                  historyItem.balancedAt ||
                  existingBalance.createdAt?.toISOString?.() ||
                  new Date().toISOString();
                await writeStockCheckSessions(sessions, tx);
              }
              return {
                status: "duplicate_repaired",
                stockBalance: existingBalance,
                item,
                session,
              };
            }
            return { status: "duplicate", stockBalance: existingBalance };
          }
          if (item.actualStock === null || item.actualStock === undefined)
            return { status: "missing_count" };
          const difference =
            Number(item.actualStock) - Number(item.systemStock || 0);
          item.difference = difference;
          const historyItem = buildStockCheckBalanceHistoryItem(
            { ...item, difference, note, sessionId: session.id },
            reference,
          );
          historyItem.stockCheckRunId =
            session.runId || session.createdAt || session.id;
          item.balanceSystemStock = historyItem.systemStock;
          item.balanceActualStock = historyItem.actualStock;
          item.balanceDifference = historyItem.difference;
          if (difference === 0) {
            const stockBalance = await tx.stockBalance.create({
              data: {
                date: new Date(),
                adjustedBy: currentSession.username,
                items: JSON.stringify([historyItem]),
                notes: `Kiểm hàng khớp | Ref: ${reference}`,
              },
            });
            item.balanced = true;
            item.verificationStatus = "match";
            item.countLocked = false;
            item.requiresNote = false;
            item.systemStock = Number(item.actualStock);
            item.difference = 0;
            await writeStockCheckSessions(sessions, tx);
            await tx.activityLog.create({
              data: {
                module: "stock_check",
                action: "BALANCE",
                description: `Cân bằng SKU ${payload.sku} trong phiên ${payload.sessionId}: khớp tồn - ${reference}`,
                recordId: stockBalance.id,
                recordName: payload.sku,
                changes: JSON.stringify({
                  reference,
                  sessionId: payload.sessionId,
                  sku: payload.sku,
                  before: historyItem.systemStock,
                  after: historyItem.actualStock,
                  difference: 0,
                }),
                userName: currentSession.username,
                severity: "INFO",
              },
            });
            return { status: "match", item, session };
          }
          if (!note) {
            item.countLocked = true;
            item.requiresNote = true;
            await writeStockCheckSessions(sessions, tx);
            return { status: "mismatch_requires_note", item };
          }
          const logContext = {
            type: "adjustment",
            referenceType: "CAN_BANG",
            reference,
            note: `Kiểm hàng phiên ${session.id}; SKU ${item.sku}; người thực hiện ${currentSession.username}; lý do: ${note}`,
            createdBy: currentSession.id,
          };
          const adjustment = await updateProductStockInTx(
            tx,
            item.sku,
            difference,
            logContext,
          );
          historyItem.oldStock = adjustment.oldStock;
          historyItem.newStock = adjustment.newStock;
          const stockBalance = await tx.stockBalance.create({
            data: {
              date: new Date(),
              adjustedBy: currentSession.username,
              items: JSON.stringify([historyItem]),
              notes: `${note} | Ref: ${reference}`,
            },
          });
          item.note = note;
          item.balanced = true;
          item.verificationStatus = "balanced_mismatch";
          item.countLocked = false;
          item.requiresNote = false;
          item.systemStock = Number(item.actualStock);
          item.difference = 0;
          await writeStockCheckSessions(sessions, tx);
          await tx.activityLog.create({
            data: {
              module: "stock_check",
              action: "BALANCE",
              description: `Cân bằng SKU ${payload.sku} trong phiên ${payload.sessionId}: ${currentSession.username} - ${reference}`,
              recordId: stockBalance.id,
              recordName: payload.sku,
              changes: JSON.stringify({
                reference,
                sessionId: payload.sessionId,
                sku: payload.sku,
                before: historyItem.systemStock,
                after: historyItem.actualStock,
                difference,
              }),
              userName: currentSession.username,
              severity: "WARNING",
            },
          });
          return { status: "balanced_mismatch", item, session };
        },
        { timeout: 30000, maxWait: 10000 },
      ),
    );
    if (result.status === "balanced_mismatch") {
      emitStockChanged({
        sku: payload.sku,
        referenceType: "CAN_BANG",
        reference,
      });
    }
    return {
      success: true,
      status: result.status,
      item: result.item
        ? sanitizeStockCheckItem(result.item, currentSession.role === "admin")
        : undefined,
      session: result.session
        ? sanitizeStockCheckSession(
            result.session,
            currentSession.role === "admin",
          )
        : undefined,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("stockCheck:submitSession", async (event, payload = {}) => {
  try {
    requireRole("admin", "manager");
    const session = await getPrismaDirectTx().$transaction(
      async (tx) => {
        await lockStockCheckSessions(tx);
        const record = await tx.appConfig.findUnique({
          where: { key: "stockCheckSessionsV2" },
        });
        const sessions = parseStockCheckSessionsFromConfig(record);
        const storedSession = getStockCheckSessionOrThrow(
          sessions,
          payload.sessionId,
          true,
        );
        if (isStockCheckSessionCompleted(storedSession)) {
          return { session: storedSession, alreadyCompleted: true };
        }
        const items = storedSession.items || [];
        if (items.length === 0) {
          const error = new Error(
            "Phiên kiểm chưa có SKU nào, không thể chốt.",
          );
          error.code = "empty_session";
          throw error;
        }
        if (
          items.some(
            (item) =>
              !Number.isInteger(item.actualStock) ||
              Number(item.actualStock) < 0,
          )
        ) {
          const error = new Error(
            "Cần nhập đủ số đếm cho tất cả SKU trước khi nộp.",
          );
          error.code = "missing_count";
          throw error;
        }
        if (items.some((item) => item.balanced !== true)) {
          const error = new Error(
            "Cần cân bằng hoặc xác nhận kết quả cho tất cả SKU trước khi nộp.",
          );
          error.code = "unbalanced_items";
          throw error;
        }
        const completedAt = new Date().toISOString();
        const matchedSkuCount = items.filter(
          (item) => item.verificationStatus === "match",
        ).length;
        const adjustedSkuCount = items.filter(
          (item) => item.verificationStatus === "balanced_mismatch",
        ).length;
        storedSession.status = "completed";
        storedSession.completedAt = completedAt;
        storedSession.completedBy = currentSession.username;
        storedSession.completionSummary = {
          totalSku: items.length,
          balancedSku: items.length,
          matchedSku: matchedSkuCount,
          adjustedSku: adjustedSkuCount,
          completedAt,
          completedBy: currentSession.username,
        };
        await writeStockCheckSessions(sessions, tx);
        await tx.activityLog.create({
          data: {
            module: "stock_check",
            action: "SESSION_COMPLETED",
            description: `Chốt phiên kiểm ${storedSession.id}: ${items.length}/${items.length} SKU đã cân bằng`,
            recordName: String(storedSession.id),
            changes: JSON.stringify({
              sessionId: storedSession.id,
              runId: storedSession.runId || null,
              completedAt,
              completedBy: currentSession.username,
              totalSku: items.length,
              matchedSku: matchedSkuCount,
              adjustedSku: adjustedSkuCount,
            }),
            userName: currentSession.username,
            userId: currentSession.id || null,
            severity: "INFO",
          },
        });
        return { session: storedSession, alreadyCompleted: false };
      },
      { timeout: 30000, maxWait: 10000 },
    );
    return {
      success: true,
      status: session.alreadyCompleted ? "already_completed" : "completed",
      session: sanitizeStockCheckSession(
        session.session,
        currentSession.role === "admin",
      ),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

const OPERATIONAL_ASSIGNMENT_EXCLUSION = "exclude_operational_assignment";
const USER_EMPLOYMENT_CONFIG_KEY = "userEmploymentStatusV1";
const USER_STATUS_RESIGNED = "resigned";

function parseUserPermissions(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function isOperationalAssignee(user) {
  return !parseUserPermissions(user?.permissions).includes(
    OPERATIONAL_ASSIGNMENT_EXCLUSION,
  );
}

function updateOperationalAssignmentPermission(value, operationalAssignee) {
  const permissions = new Set(parseUserPermissions(value));
  if (operationalAssignee === false) {
    permissions.add(OPERATIONAL_ASSIGNMENT_EXCLUSION);
  } else {
    permissions.delete(OPERATIONAL_ASSIGNMENT_EXCLUSION);
  }
  return JSON.stringify([...permissions]);
}

function parseEmploymentStatusConfig(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

async function getEmploymentStatusConfig() {
  const record = await prisma.appConfig.findUnique({
    where: { key: USER_EMPLOYMENT_CONFIG_KEY },
  });
  return parseEmploymentStatusConfig(record?.value);
}

async function saveEmploymentStatusConfig(config) {
  await prisma.appConfig.upsert({
    where: { key: USER_EMPLOYMENT_CONFIG_KEY },
    update: { value: JSON.stringify(config) },
    create: { key: USER_EMPLOYMENT_CONFIG_KEY, value: JSON.stringify(config) },
  });
}

function normalizeEmploymentEndDate(value) {
  const date = String(value || "").trim();
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(new Date(`${date}T00:00:00`).getTime())
  ) {
    throw new Error("Ngày nghỉ việc không hợp lệ.");
  }
  return date;
}

function matchesUserIdentity(value, user) {
  const candidate = normalizeActorName(value);
  if (!candidate) return false;
  const identities = [user?.username, user?.fullName]
    .map(normalizeActorName)
    .filter(Boolean);
  return identities.includes(candidate);
}

// A resigned employee must never keep an open future assignment. For shared
// assignments we only remove that recipient; a task with no recipient left is
// cancelled and kept as an auditable record rather than deleted.
async function removeFutureTasksForResignedUser(user, effectiveDate) {
  const cutoff = new Date(`${effectiveDate}T00:00:00`);
  const tasks = await prisma.dailyTask.findMany({
    where: {
      status: { in: ["pending", "in_progress"] },
      dueDate: { gte: cutoff },
    },
    select: { id: true, assignee: true, note: true, attachments: true },
  });
  let updated = 0;
  for (const task of tasks) {
    const attachments = parseTaskAttachments(task.attachments);
    const recipients = getTaskRecipients(task, attachments);
    const hasRecipient = recipients.some((recipient) =>
      matchesUserIdentity(recipient, user),
    );
    const isPrimaryAssignee = matchesUserIdentity(task.assignee, user);
    if (!hasRecipient && !isPrimaryAssignee) continue;

    const remainingRecipients = recipients.filter(
      (recipient) => !matchesUserIdentity(recipient, user),
    );
    if (remainingRecipients.length > 0) {
      if (attachments.assignment)
        attachments.assignment.assignees = remainingRecipients;
      await prisma.dailyTask.update({
        where: { id: task.id },
        data: {
          assignee: isPrimaryAssignee ? remainingRecipients[0] : task.assignee,
          attachments: JSON.stringify(attachments),
        },
      });
    } else {
      const note = [
        task.note,
        `Tự hủy từ ${effectiveDate}: người được giao ${user.fullName || user.username} đã nghỉ việc.`,
      ]
        .filter(Boolean)
        .join("\n");
      await prisma.dailyTask.update({
        where: { id: task.id },
        data: { status: "cancelled", note },
      });
    }
    updated++;
  }
  return updated;
}

ipcMain.handle("users:getAll", async () => {
  try {
    requireRole();
    if (!prisma) throw new Error("Prisma not available");
    const isAdmin = currentSession?.role === "admin";
    // Dùng raw SQL để luôn lấy được lastActiveAt kể cả khi Prisma client cũ chưa generate lại
    const [users, employmentStatus] = await Promise.all([
      prisma.$queryRaw`SELECT id, username, "fullName", email, role, status, permissions, "createdAt", "lastActiveAt" FROM "User" ORDER BY id ASC`,
      getEmploymentStatusConfig(),
    ]);
    const formatted = users.map((u) => ({
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      role: u.role,
      isActive: u.status === "active",
      employmentStatus:
        u.status === USER_STATUS_RESIGNED ? USER_STATUS_RESIGNED : "active",
      resignationDate:
        u.status === USER_STATUS_RESIGNED
          ? employmentStatus[String(u.id)]?.effectiveDate || null
          : null,
      resignationReason:
        isAdmin && u.status === USER_STATUS_RESIGNED
          ? employmentStatus[String(u.id)]?.reason || ""
          : "",
      operationalAssignee: isOperationalAssignee(u),
      ...(isAdmin
        ? {
            email: u.email,
            createdAt: new Date(u.createdAt).toISOString(),
            lastActiveAt: u.lastActiveAt
              ? new Date(u.lastActiveAt).toISOString()
              : null,
          }
        : {}),
    }));
    return { success: true, data: formatted };
  } catch (error) {
    console.error("❌ Get users error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("users:create", async (event, data) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");
    // 🔒 SECURITY: Mật khẩu mới do admin cấp là mật khẩu tạm.
    const hashedPassword = await bcrypt.hash(
      assertStrongPassword(data.password),
      10,
    );
    const user = await prisma.user.create({
      data: {
        username: data.username,
        password: hashedPassword,
        fullName: data.fullName,
        email: data.email || null,
        role: data.role || "staff",
        status: data.isActive !== false ? "active" : "inactive",
        permissions:
          data.operationalAssignee === false
            ? updateOperationalAssignmentPermission(null, false)
            : null,
        passwordChangedAt: new Date(0),
        forcePasswordChange: true,
      },
    });
    console.log(`✅ Created user: ${user.username}`);
    void logActivity({
      module: "users",
      action: "CREATE",
      description: `Tạo người dùng "${user.username}" (${data.role || "staff"})`,
      recordName: user.username,
    });
    return {
      success: true,
      data: { ...user, isActive: user.status === "active" },
    };
  } catch (error) {
    console.error("❌ Create user error:", error);
    if (error.code === "P2002") {
      return { success: false, error: "Tên đăng nhập đã tồn tại!" };
    }
    return { success: false, error: error.message };
  }
});

ipcMain.handle("users:update", async (event, id, data) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");
    const existingUser = await prisma.user.findUnique({
      where: { id: Number(id) },
    });
    if (!existingUser) throw new Error("User not found");
    if (
      data.username !== undefined &&
      String(data.username).trim().toLowerCase() !==
        existingUser.username.trim().toLowerCase()
    ) {
      const attendanceRecord = await prisma.appConfig.findUnique({
        where: { key: "attendanceData" },
      });
      let attendanceData = {};
      try {
        attendanceData = attendanceRecord?.value
          ? JSON.parse(attendanceRecord.value)
          : {};
      } catch {}
      const linkedToPayroll = (
        Array.isArray(attendanceData.employees) ? attendanceData.employees : []
      ).some(
        (employee) =>
          String(employee?.username || "")
            .trim()
            .toLowerCase() === existingUser.username.trim().toLowerCase(),
      );
      if (linkedToPayroll) {
        throw new Error(
          "Không thể đổi username đang liên kết với bảng công/lương.",
        );
      }
    }
    const updateData = {};
    if (data.username !== undefined) updateData.username = data.username;
    if (data.fullName !== undefined) updateData.fullName = data.fullName;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.role !== undefined) updateData.role = data.role;
    // 🔒 SECURITY: Hash password mới nếu đổi mật khẩu
    if (data.password !== undefined) {
      updateData.password = await bcrypt.hash(
        assertStrongPassword(data.password),
        10,
      );
      updateData.passwordChangedAt = new Date(0);
      updateData.forcePasswordChange = true;
    }
    const employmentStatus = [
      USER_STATUS_RESIGNED,
      "active",
      "inactive",
    ].includes(data.employmentStatus)
      ? data.employmentStatus
      : null;
    const resignationDate =
      employmentStatus === USER_STATUS_RESIGNED
        ? normalizeEmploymentEndDate(data.resignationDate)
        : null;
    if (employmentStatus === USER_STATUS_RESIGNED) {
      if (existingUser.role === "admin")
        throw new Error(
          "Không thể đánh dấu tài khoản quản trị viên là đã nghỉ việc.",
        );
      updateData.status = USER_STATUS_RESIGNED;
    } else if (employmentStatus === "active") {
      updateData.status = "active";
    } else if (employmentStatus === "inactive") {
      updateData.status = "inactive";
    } else if (data.isActive !== undefined) {
      updateData.status = data.isActive ? "active" : "inactive";
    }
    if (data.operationalAssignee !== undefined) {
      updateData.permissions = updateOperationalAssignmentPermission(
        existingUser.permissions,
        data.operationalAssignee,
      );
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
    });
    if (employmentStatus === USER_STATUS_RESIGNED) {
      const employmentConfig = await getEmploymentStatusConfig();
      employmentConfig[String(user.id)] = {
        effectiveDate: resignationDate,
        reason: String(data.resignationReason || "").trim(),
        updatedAt: new Date().toISOString(),
        updatedBy: currentSession?.username || "admin",
      };
      await saveEmploymentStatusConfig(employmentConfig);
      await Promise.all([
        revokeRememberTokensForUser(user.id),
        prisma.faceProfile.updateMany({
          where: { userId: user.id },
          data: { isActive: false },
        }),
        removeFutureTasksForResignedUser(user, resignationDate),
      ]);
      if (currentSession?.id === user.id) currentSession = null;
    } else if (
      employmentStatus === "active" &&
      existingUser.status === USER_STATUS_RESIGNED
    ) {
      const employmentConfig = await getEmploymentStatusConfig();
      delete employmentConfig[String(user.id)];
      await Promise.all([
        saveEmploymentStatusConfig(employmentConfig),
        prisma.faceProfile.updateMany({
          where: { userId: user.id },
          data: { isActive: true },
        }),
      ]);
    }
    if (data.password !== undefined) await revokeRememberTokensForUser(user.id);
    console.log(`✅ Updated user: ${user.username}`);
    void logActivity({
      module: "users",
      action: "UPDATE",
      description: `Cập nhật người dùng "${user.username}"`,
      recordName: user.username,
    });
    return {
      success: true,
      data: { ...user, isActive: user.status === "active" },
    };
  } catch (error) {
    console.error("❌ Update user error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("users:delete", async (event, id) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");
    const user = await prisma.user.findUnique({ where: { id: Number(id) } });
    if (!user) throw new Error("Người dùng không tồn tại.");
    const attendanceRecord = await prisma.appConfig.findUnique({
      where: { key: "attendanceData" },
    });
    let attendanceData = {};
    try {
      attendanceData = attendanceRecord?.value
        ? JSON.parse(attendanceRecord.value)
        : {};
    } catch {}
    const linkedToPayroll = (
      Array.isArray(attendanceData.employees) ? attendanceData.employees : []
    ).some(
      (employee) =>
        String(employee?.username || "")
          .trim()
          .toLowerCase() === user.username.trim().toLowerCase(),
    );
    if (linkedToPayroll) {
      throw new Error(
        "Tài khoản đang liên kết với bảng công/lương. Hãy đánh dấu nghỉ việc thay vì xóa.",
      );
    }
    await prisma.user.delete({ where: { id } });
    console.log(`✅ Deleted user #${id}`);
    void logActivity({
      module: "users",
      action: "DELETE",
      description: `Xóa người dùng #${id}`,
    });
    return { success: true };
  } catch (error) {
    console.error("❌ Delete user error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle(
  "users:login",
  async (event, username, password, rememberMe = false) => {
    try {
      if (!prisma) throw new Error("Prisma not available");
      const normalizedUsername =
        typeof username === "string" ? username.trim() : "";
      const user = await prisma.user.findUnique({
        where: { username: normalizedUsername },
      });
      if (!user || user.status !== "active") {
        return {
          success: false,
          error: "Tên đăng nhập hoặc mật khẩu không đúng.",
        };
      }
      if (
        user.loginLockedUntil &&
        new Date(user.loginLockedUntil).getTime() > Date.now()
      ) {
        const remainingMinutes = Math.ceil(
          (new Date(user.loginLockedUntil).getTime() - Date.now()) / 60000,
        );
        return {
          success: false,
          error: `Đăng nhập tạm khóa. Thử lại sau ${remainingMinutes} phút.`,
        };
      }
      // 🔒 SECURITY: So sánh bằng bcrypt
      const isHashed =
        typeof user.password === "string" && user.password.startsWith("$2");
      let passwordValid = false;
      if (isHashed) {
        passwordValid = await bcrypt.compare(password, user.password);
      } else {
        // Backward compatible: plaintext password cũ → auto-upgrade sang hash
        passwordValid = user.password === password;
        if (passwordValid) {
          const hashed = await bcrypt.hash(password, 10);
          await prisma.user.update({
            where: { id: user.id },
            data: {
              password: hashed,
              passwordChangedAt: new Date(),
              forcePasswordChange: false,
            },
          });
          console.log(`🔒 Auto-upgraded password for user: ${user.username}`);
        }
      }
      if (!passwordValid) {
        await recordFailedLogin(user);
        return {
          success: false,
          error: "Tên đăng nhập hoặc mật khẩu không đúng.",
        };
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { loginFailedAttempts: 0, loginLockedUntil: null },
      });
      // Lưu session phía backend
      currentSession = {
        id: user.id,
        username: user.username,
        role: user.role,
        mustChangePassword: isPasswordRotationRequired(user),
      };
      prisma.$executeRaw`UPDATE "User" SET "lastActiveAt" = NOW() WHERE id = ${user.id}`.catch(
        () => {},
      );
      void logActivity({
        module: "users",
        action: "LOGIN",
        description: `Đăng nhập: ${user.username}`,
        recordName: user.username,
        userName: user.username,
      });
      const rememberToken =
        rememberMe && user.role === "admin"
          ? await issueRememberToken(user.id)
          : null;
      return {
        success: true,
        data: sanitizeUserForClient(user),
        rememberToken,
      };
    } catch (error) {
      console.error("❌ Login error:", error);
      return { success: false, error: error.message };
    }
  },
);

ipcMain.handle("users:logout", async (event, rememberToken) => {
  await revokeRememberToken(rememberToken).catch(() => {});
  if (currentSession?.id) {
    await prisma.$executeRaw`UPDATE "User" SET "lastActiveAt" = NULL WHERE id = ${currentSession.id}`.catch(
      () => {},
    );
  }
  currentSession = null;
  return { success: true };
});

ipcMain.handle("users:getCurrentSession", async () => {
  try {
    if (!prisma) return { success: false };
    if (!currentSession?.id) return { success: false };
    const user = await prisma.user.findUnique({
      where: { id: currentSession.id },
    });
    if (!user || user.status !== "active") {
      currentSession = null;
      return { success: false };
    }
    currentSession = {
      id: user.id,
      username: user.username,
      role: user.role,
      mustChangePassword: isPasswordRotationRequired(user),
    };
    return { success: true, data: sanitizeUserForClient(user) };
  } catch {
    return { success: false };
  }
});

// Restore session khi auto-login từ remember token đã cấp sau login password thành công
ipcMain.handle("users:restoreSession", async (event, rememberToken) => {
  try {
    if (
      !prisma ||
      typeof rememberToken !== "string" ||
      rememberToken.length < 32
    )
      return { success: false };
    const now = Date.now();
    const tokenHash = hashRememberToken(rememberToken);
    const tokens = await readRememberTokens();
    const validTokens = tokens.filter(
      (t) => t && t.expiresAt && new Date(t.expiresAt).getTime() > now,
    );
    const record = validTokens.find((t) => t.tokenHash === tokenHash);
    if (!record) {
      if (validTokens.length !== tokens.length)
        await writeRememberTokens(validTokens);
      return { success: false };
    }
    if (validTokens.length !== tokens.length)
      await writeRememberTokens(validTokens);
    const user = await prisma.user.findUnique({ where: { id: record.userId } });
    if (!user || user.status !== "active") return { success: false };
    currentSession = {
      id: user.id,
      username: user.username,
      role: user.role,
      mustChangePassword: isPasswordRotationRequired(user),
    };
    prisma.$executeRaw`UPDATE "User" SET "lastActiveAt" = NOW() WHERE id = ${user.id}`.catch(
      () => {},
    );
    return { success: true, data: sanitizeUserForClient(user) };
  } catch {
    return { success: false };
  }
});

ipcMain.handle("users:heartbeat", async () => {
  try {
    if (!currentSession?.id || !prisma) return { success: false };
    await prisma.$executeRaw`UPDATE "User" SET "lastActiveAt" = NOW() WHERE id = ${currentSession.id}`.catch(
      () => {},
    );
    return { success: true };
  } catch {
    return { success: false };
  }
});

ipcMain.handle("users:ensureAdmin", async () => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Prisma not available");
    const adminCount = await prisma.user.count({
      where: { role: "admin", status: "active" },
    });
    return adminCount > 0
      ? { success: true }
      : {
          success: false,
          error: "Không còn tài khoản quản trị viên đang hoạt động.",
        };
  } catch (error) {
    console.error("❌ Ensure admin error:", error);
    return { success: false, error: error.message };
  }
});

// ========================================
// DAILY EXPENSES HANDLERS (CHI PHÍ HÀNG NGÀY - P&L)
// ========================================

ipcMain.handle("dailyExpenses:getAll", async (event, filters) => {
  try {
    if (!prisma) throw new Error("Prisma not available");
    const where = {};
    if (filters?.startDate && filters?.endDate) {
      where.date = {
        gte: new Date(filters.startDate),
        lte: new Date(filters.endDate),
      };
    }
    const records = await prisma.dailyExpense.findMany({
      where,
      orderBy: { date: "desc" },
    });
    const formatted = records.map((r) => ({
      ...r,
      date: r.date.toISOString().split("T")[0],
    }));
    return { success: true, data: formatted };
  } catch (error) {
    console.error("❌ Get daily expenses error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("dailyExpenses:upsert", async (event, data) => {
  try {
    if (!prisma) throw new Error("Prisma not available");
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
    return {
      success: true,
      data: { ...record, date: record.date.toISOString().split("T")[0] },
    };
  } catch (error) {
    console.error("❌ Upsert daily expense error:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("dailyExpenses:delete", async (event, id) => {
  try {
    if (!prisma) throw new Error("Prisma not available");
    await prisma.dailyExpense.delete({ where: { id } });
    console.log(`✅ Deleted daily expense #${id}`);
    return { success: true };
  } catch (error) {
    console.error("❌ Delete daily expense error:", error);
    return { success: false, error: error.message };
  }
});

module.exports = { prisma };

// ===== REFUNDS: Import từ thư mục =====
ipcMain.handle("refunds:importFromFolder", async () => {
  try {
    requireRole("admin", "manager");
    // 1. Mở dialog chọn thư mục
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Chọn thư mục chứa file Excel hàng hoàn",
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: "cancelled" };
    }

    const folderPath = result.filePaths[0];
    console.log(`📂 Selected folder: ${folderPath}`);

    // 2. Tìm tất cả file .xlsx / .xls trong thư mục
    const allFiles = fs.readdirSync(folderPath);
    const excelFiles = allFiles.filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return ext === ".xlsx" || ext === ".xls";
    });

    if (excelFiles.length === 0) {
      return {
        success: false,
        error: "Không tìm thấy file Excel (.xlsx/.xls) trong thư mục!",
      };
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
        fileResults.push({
          name: fileName,
          rows: jsonData.length,
          success: true,
        });
        totalRows += jsonData.length;
      } catch (fileError) {
        console.error(`  ❌ ${fileName}: ${fileError.message}`);
        fileResults.push({
          name: fileName,
          rows: 0,
          success: false,
          error: fileError.message,
        });
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
    console.error("❌ Import from folder error:", error);
    return { success: false, error: error.message };
  }
});

// ========================================
// MISA meINVOICE API INTEGRATION
// ========================================

const { v4: uuidv4 } = (() => {
  try {
    return require("uuid");
  } catch {
    // Fallback UUID generator nếu chưa install uuid
    return {
      v4: () =>
        "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
        }),
    };
  }
})();

// Cache token MISA
let misaTokenCache = { token: null, expiresAt: 0 };

// Mã hóa / giải mã password đơn giản (obfuscation)
function encodeSecret(plain) {
  if (!plain) return "";
  return Buffer.from(plain).toString("base64");
}
function decodeSecret(encoded) {
  if (!encoded) return "";
  try {
    return Buffer.from(encoded, "base64").toString("utf-8");
  } catch {
    return encoded;
  }
}
function maskString(str, showChars = 3) {
  if (!str || str.length <= showChars) return "***";
  return str.substring(0, showChars) + "***";
}

// Lấy cấu hình MISA từ AppConfig
async function getMisaConfig() {
  if (!prisma) throw new Error("Database not initialized");
  const configRecord = await prisma.appConfig.findUnique({
    where: { key: "misaConfig" },
  });
  if (!configRecord?.value)
    throw new Error(
      "Chưa cấu hình MISA meInvoice! Vào ⚙️ Cấu hình để thiết lập.",
    );
  const config = JSON.parse(configRecord.value);
  // Giải mã password nếu đã mã hóa
  if (config.password) {
    config.password = decodeSecret(config.password);
  }
  if (
    !config.appid ||
    !config.taxcode ||
    !config.username ||
    !config.password
  ) {
    throw new Error(
      "Cấu hình MISA thiếu thông tin! Cần: AppID, MST, Username, Password.",
    );
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
  const baseUrl = "https://api.meinvoice.vn";

  // Trim tất cả field để loại bỏ khoảng trắng ẩn
  const appid = (config.appid || "").trim();
  const taxcode = (config.taxcode || "").trim();
  const username = (config.username || "").trim();
  const password = (config.password || "").trim();

  console.log(`🔑 MISA: Requesting token from ${baseUrl}...`);
  console.log(
    `🔑 MISA: AppID=${maskString(appid)}, TaxCode=${maskString(taxcode)}, User=${maskString(username)}, PassLen=${password.length}`,
  );

  // Thử cả 2 URL endpoint (v3 và integration)
  const tokenUrls = [
    `${baseUrl}/api/integration/auth/token`,
    `${baseUrl}/api/v3/auth/token`,
  ];

  let lastError = "";
  let lastResult = null;

  for (const tokenUrl of tokenUrls) {
    console.log(`🔑 MISA: Trying ${tokenUrl}...`);
    let response;
    try {
      response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    console.log(
      `🔑 MISA Response from ${tokenUrl} (${response.status}):`,
      responseText.substring(0, 800),
    );

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
    const errorCode = result.ErrorCode || result.errorCode || "";

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
    console.error(
      `❌ MISA Auth Error from ${tokenUrl}:`,
      JSON.stringify(result, null, 2),
    );
    lastResult = result;
    lastError = errorCode;
  }

  // Cả 2 URL đều thất bại — phân tích lỗi chi tiết
  const errorCode = lastError;
  const errors = lastResult?.Errors || lastResult?.errors || [];
  const errorsStr = Array.isArray(errors) ? errors.join(", ") : String(errors);
  const fullResponse = lastResult
    ? JSON.stringify(lastResult).substring(0, 400)
    : "No response";

  // Check Errors array trước — MISA thường ghi chi tiết lỗi ở đây
  let errorMsg;
  if (errorsStr.includes("TaxCodeNotExist")) {
    errorMsg = `❌ Mã số thuế "${taxcode}" KHÔNG tồn tại trên MISA! Kiểm tra lại MST hoặc đăng ký MST trên meinvoice.vn trước.`;
  } else if (errorCode === "InvalidAppID") {
    errorMsg = `❌ Sai AppID MISA! [${fullResponse}]`;
  } else if (errorCode === "InactiveAppID") {
    errorMsg = `❌ AppID MISA đã bị khóa! [${fullResponse}]`;
  } else if (errorCode === "UnAuthorize") {
    errorMsg = `❌ Lỗi xác thực MISA (UnAuthorize). Chi tiết: ${errorsStr || "Không rõ"}. [User=${username}, TaxCode=${taxcode}]`;
  } else {
    errorMsg = `❌ Lỗi MISA: ${errorsStr || fullResponse}`;
  }
  throw new Error(errorMsg);
}

// Xóa token cache khi bị reject (để lần sau lấy token mới)
function invalidateMisaToken() {
  misaTokenCache = { token: null, expiresAt: 0 };
  console.log("🔄 MISA: Token cache invalidated — sẽ lấy token mới lần tới");
}

// Chuyển số thành chữ tiếng Việt
function numberToVietnameseWords(num) {
  if (num === 0) return "Không đồng.";
  const units = [
    "",
    "một",
    "hai",
    "ba",
    "bốn",
    "năm",
    "sáu",
    "bảy",
    "tám",
    "chín",
  ];
  const groups = ["", "nghìn", "triệu", "tỷ"];

  function readThreeDigits(n, showZeroHundred) {
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const u = n % 10;
    let result = "";
    if (h > 0) result += units[h] + " trăm ";
    else if (showZeroHundred) result += "không trăm ";
    if (t > 1) result += units[t] + " mươi ";
    else if (t === 1) result += "mười ";
    else if (t === 0 && h > 0 && u > 0) result += "lẻ ";
    if (u === 1 && t > 1) result += "mốt";
    else if (u === 5 && t > 0) result += "lăm";
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

  let result = "";
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] > 0 || i < parts.length - 1) {
      const text = readThreeDigits(parts[i], i < parts.length - 1);
      if (text) result += text + " " + groups[i] + " ";
    }
  }

  result = result.trim();
  result = result.charAt(0).toUpperCase() + result.slice(1) + " đồng.";
  return result;
}

// Build InvoiceData cho MISA API từ DB record
function buildMisaInvoiceData(order, config) {
  let items = [];
  try {
    items =
      typeof order.items === "string" ? JSON.parse(order.items) : order.items;
  } catch {
    items = [];
  }

  const totalAmount = order.totalAmount || 0;
  const refId = uuidv4();

  // Build OriginalInvoiceDetail
  const invoiceDetails = items.map((item, idx) => ({
    ItemType: 1,
    LineNumber: idx + 1,
    SortOrder: idx + 1,
    ItemCode: item.sku || "",
    ItemName: item.productName || "Hàng hóa",
    UnitName: "Cái",
    Quantity: item.quantity || 1,
    UnitPrice: item.unitPrice || 0,
    DiscountRate: 0,
    DiscountAmountOC: 0,
    DiscountAmount: 0,
    AmountOC: item.total || item.unitPrice * item.quantity || 0,
    Amount: item.total || item.unitPrice * item.quantity || 0,
    AmountWithoutVATOC: item.total || item.unitPrice * item.quantity || 0,
    AmountWithoutVAT: item.total || item.unitPrice * item.quantity || 0,
    VATRateName: config.vatRate || "KCT",
    VATAmountOC: 0,
    VATAmount: 0,
  }));

  // Build TaxRateInfo
  const taxRateInfo = [
    {
      VATRateName: config.vatRate || "KCT",
      AmountWithoutVATOC: totalAmount,
      VATAmountOC: 0,
    },
  ];

  return {
    RefID: refId,
    InvSeries: config.invSeries || "",
    InvDate: order.deliveryDate
      ? new Date(order.deliveryDate).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0],
    CurrencyCode: "VND",
    ExchangeRate: 1.0,
    PaymentMethodName: config.paymentMethod || "TM/CK",
    // Thông tin người mua
    BuyerLegalName: order.customerName || "Người mua không lấy hóa đơn",
    BuyerTaxCode: "",
    BuyerAddress: "",
    BuyerFullName: order.customerName || "Người mua không lấy hóa đơn",
    BuyerPhoneNumber: order.customerPhone || "",
    BuyerEmail: "",
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
      MainCurrency: "VND",
      AmountDecimalDigits: "0",
      AmountOCDecimalDigits: "0",
      UnitPriceOCDecimalDigits: "0",
      UnitPriceDecimalDigits: "0",
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
  const baseUrl = "https://api.meinvoice.vn/api/integration";

  // Body theo tài liệu Mục 6: { SignType, InvoiceData, PublishInvoiceData }
  const body = {
    SignType: 2, // 2=HSM ký số từ xa, 5=Không ký (MTT)
    InvoiceData: invoiceDataList,
    PublishInvoiceData: null,
  };

  console.log(
    `📤 MISA: Publishing ${invoiceDataList.length} invoice(s) to ${baseUrl}/invoice ...`,
  );
  console.log(
    `📤 MISA: SignType=${body.SignType}, Sample:`,
    JSON.stringify(invoiceDataList[0]).substring(0, 500),
  );

  // Helper: gọi API publish 1 lần
  async function doPublishRequest(authToken) {
    const response = await fetch(`${baseUrl}/invoice`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();
    console.log(
      `📤 MISA Publish Response (${response.status}):`,
      responseText.substring(0, 800),
    );

    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error(
        `MISA trả về response không hợp lệ khi phát hành (status ${response.status}): ${responseText.substring(0, 200)}`,
      );
    }
    return { result, status: response.status };
  }

  let { result, status } = await doPublishRequest(token);

  // Check success (MISA API trả về success hoặc Success)
  let isSuccess = result.Success === true || result.success === true;

  // AUTO-RETRY: Nếu bị UnAuthorize hoặc HTTP 401 → xóa cache, lấy token mới, thử lại 1 lần
  if (!isSuccess) {
    const errCode = result.ErrorCode || result.errorCode || "";
    if (errCode === "UnAuthorize" || status === 401) {
      console.log(
        "🔄 MISA: Token expired — invalidating cache and retrying with fresh token...",
      );
      invalidateMisaToken();
      const newToken = await getMisaToken();
      const retry = await doPublishRequest(newToken);
      result = retry.result;
      isSuccess = result.Success === true || result.success === true;
    }
  }

  if (!isSuccess) {
    const errCode = result.ErrorCode || result.errorCode || "";
    const errDesc = result.descriptionErrorCode || result.Errors || "";
    console.error(
      "❌ MISA Publish FULL Response:",
      JSON.stringify(result, null, 2),
    );
    throw new Error(
      `MISA Publish Error: ${errCode} — ${errDesc || JSON.stringify(result).substring(0, 300)}`,
    );
  }

  // Parse publishInvoiceResult (có thể là string JSON) — theo tài liệu Mục 6
  let publishResults = result.publishInvoiceResult;
  if (typeof publishResults === "string") {
    try {
      publishResults = JSON.parse(publishResults);
    } catch {
      publishResults = [];
    }
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
  const baseUrl = "https://api.meinvoice.vn/api/integration";

  async function doDownloadRequest(authToken) {
    const response = await fetch(
      `${baseUrl}/invoice/download?downloadDataType=2`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify([transactionId]),
      },
    );

    const responseText = await response.text();
    console.log(
      `📥 MISA Download Response (${response.status}):`,
      responseText.substring(0, 300),
    );

    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error(
        `MISA download trả về response không hợp lệ (status ${response.status})`,
      );
    }
    return { result, status: response.status };
  }

  let { result, status } = await doDownloadRequest(token);
  let isSuccess = result.Success === true || result.success === true;

  // AUTO-RETRY: token expired → lấy mới và thử lại
  if (!isSuccess) {
    const errCode = result.ErrorCode || result.errorCode || "";
    if (errCode === "UnAuthorize" || status === 401) {
      console.log(
        "🔄 MISA Download: Token expired — retrying with fresh token...",
      );
      invalidateMisaToken();
      token = await getMisaToken();
      const retry = await doDownloadRequest(token);
      result = retry.result;
      isSuccess = result.Success === true || result.success === true;
    }
  }

  const data = result.Data || result.data;
  if (!isSuccess || !data) {
    throw new Error(
      `Lỗi tải PDF: ${result.ErrorCode || result.errorCode || JSON.stringify(result).substring(0, 200)}`,
    );
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

ipcMain.handle("misa:getConfig", async () => {
  try {
    if (!prisma) throw new Error("Database not initialized");
    const record = await prisma.appConfig.findUnique({
      where: { key: "misaConfig" },
    });
    const config = record?.value ? JSON.parse(record.value) : {};
    // Không trả password ra frontend
    return { success: true, data: { ...config, password: "" } }; // Không trả password, frontend tự hiện placeholder
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("misa:saveConfig", async (event, config) => {
  try {
    if (!prisma) throw new Error("Database not initialized");
    // Nếu password rỗng hoặc là masked → giữ nguyên password cũ (đã mã hóa)
    if (!config.password || config.password === "••••••••") {
      const existing = await prisma.appConfig.findUnique({
        where: { key: "misaConfig" },
      });
      if (existing?.value) {
        const old = JSON.parse(existing.value);
        config.password = old.password; // Giữ nguyên password đã mã hóa
      }
    } else {
      // Mã hóa password mới trước khi lưu
      config.password = encodeSecret(config.password);
    }
    await prisma.appConfig.upsert({
      where: { key: "misaConfig" },
      update: { value: JSON.stringify(config) },
      create: { key: "misaConfig", value: JSON.stringify(config) },
    });
    // Clear token cache khi đổi config
    invalidateMisaToken();
    console.log(
      `✅ MISA config saved (password length: ${config.password?.length || 0})`,
    );
    void logActivity({
      module: "einvoice",
      action: "UPDATE",
      description: "Cập nhật cấu hình MISA meInvoice",
      userName: "Admin",
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("misa:testConnection", async () => {
  try {
    const token = await getMisaToken();
    return { success: true, data: { tokenLength: token.length } };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Lấy danh sách mẫu HĐ — Tài liệu Mục 3
ipcMain.handle("misa:getTemplates", async () => {
  try {
    const config = await getMisaConfig();
    const token = await getMisaToken();
    const baseUrl =
      config.env === "live"
        ? "https://api.meinvoice.vn/api/integration"
        : "https://testapi.meinvoice.vn/api/integration";

    // Thử nhiều combinations để tìm tất cả mẫu HĐ
    const queries = [
      "invoiceWithCode=true&ticket=false",
      "invoiceWithCode=false&ticket=false",
      "ticket=true",
      "", // Không filter
    ];

    let allTemplates = [];
    let lastResponse = "";
    for (const q of queries) {
      const url = q
        ? `${baseUrl}/invoice/templates?${q}`
        : `${baseUrl}/invoice/templates`;
      console.log(`📋 MISA: Trying templates URL: ${url}`);
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      const responseText = await response.text();
      console.log(
        `📋 MISA Templates Response (${q}):`,
        responseText.substring(0, 500),
      );

      let result;
      try {
        result = JSON.parse(responseText);
      } catch {
        continue;
      }

      const isSuccess = result.Success === true || result.success === true;
      let data = result.Data || result.data;

      // Data có thể là string JSON
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {}
      }

      if (isSuccess && data) {
        if (Array.isArray(data) && data.length > 0) {
          allTemplates = [...allTemplates, ...data];
          break;
        } else if (typeof data === "object" && !Array.isArray(data)) {
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
    allTemplates.forEach((t) => uniqueMap.set(t.InvSeries || t.invSeries, t));
    const unique = Array.from(uniqueMap.values());

    if (unique.length === 0) {
      return {
        success: false,
        error: `Không tìm thấy mẫu HĐ. MISA Response: ${lastResponse || "Empty"}`,
      };
    }
    return { success: true, data: unique };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Xem nháp HĐ (unpublishview) — Tài liệu Mục 4 — KHÔNG phát hành, chỉ xem
ipcMain.handle("misa:previewInvoice", async (event, invoiceData) => {
  try {
    const config = await getMisaConfig();
    const token = await getMisaToken();
    const baseUrl =
      config.env === "live"
        ? "https://api.meinvoice.vn/api/integration"
        : "https://testapi.meinvoice.vn/api/integration";
    console.log(
      "👀 MISA Preview: Sending unpublishview...",
      JSON.stringify(invoiceData).substring(0, 500),
    );
    const response = await fetch(`${baseUrl}/invoice/unpublishview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(invoiceData),
    });
    const responseText = await response.text();
    console.log("👀 MISA Preview Response:", responseText.substring(0, 500));
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error(
        `MISA preview trả về response không hợp lệ (status ${response.status})`,
      );
    }
    const isSuccess = result.Success === true || result.success === true;
    const data = result.Data || result.data;
    if (!isSuccess || !data) {
      const errCode = result.ErrorCode || result.errorCode || "";
      const errors = result.Errors || result.errors || [];
      throw new Error(
        `Lỗi xem nháp: ${errCode} — ${Array.isArray(errors) ? errors.join(", ") : errors || JSON.stringify(result).substring(0, 300)}`,
      );
    }
    return { success: true, data: data }; // data = link xem HĐ
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("misa:downloadPDF", async (event, transactionId) => {
  try {
    const base64PDF = await downloadMisaInvoicePDF(transactionId);
    // Cho user chọn nơi lưu
    const result = await dialog.showSaveDialog({
      title: "Lưu hóa đơn PDF",
      defaultPath: `HoaDon_${transactionId}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (result.canceled || !result.filePath)
      return { success: false, error: "Đã hủy" };
    fs.writeFileSync(result.filePath, Buffer.from(base64PDF, "base64"));
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
ipcMain.handle("einvoice:getAll", async (event, { limit } = {}) => {
  try {
    if (!prisma) throw new Error("Database not initialized");
    const records = await prisma.eInvoice.findMany({
      orderBy: { createdAt: "desc" },
      take: limit || 1000,
    });
    const formatted = records.map((r) => ({
      ...r,
      deliveryDate: r.deliveryDate.toISOString(),
      invoiceDate: r.invoiceDate ? r.invoiceDate.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
    console.log(`✅ Loaded ${records.length} einvoice records`);
    return { success: true, data: formatted };
  } catch (error) {
    console.error("❌ einvoice:getAll error:", error.message);
    return { success: false, error: error.message };
  }
});

// Import hàng loạt — chống trùng orderId ở tầng DB
ipcMain.handle("einvoice:bulkImport", async (event, orders) => {
  try {
    if (!prisma) throw new Error("Database not initialized");
    if (!Array.isArray(orders) || orders.length === 0) {
      return { success: false, error: "Không có đơn hàng để import" };
    }

    const isTMDT = (platform) =>
      ["Shopee", "TikTok", "Lazada", "Sendo"].includes(platform);

    // Chuẩn bị data batch
    const dataForInsert = orders.map((order) => ({
      orderId: order.orderId,
      platform: order.platform,
      customerName: order.customerName,
      customerPhone: order.customerPhone || null,
      items:
        typeof order.items === "string"
          ? order.items
          : JSON.stringify(order.items),
      totalQuantity: order.totalQuantity || 1,
      totalAmount: order.totalAmount || 0,
      deliveryDate: new Date(order.deliveryDate),
      sourceFile: order.sourceFile || null,
      isTaxDeductedByPlatform: isTMDT(order.platform),
      platformTaxRate: isTMDT(order.platform) ? 0.015 : null,
      platformTaxAmount: isTMDT(order.platform)
        ? Math.round((order.totalAmount || 0) * 0.015)
        : null,
      invoiceType: isTMDT(order.platform) ? "pos_receipt" : "b2b",
      status: "pending",
    }));

    // 🚀 Batch insert — 1 query duy nhất thay vì N queries
    const result = await prisma.eInvoice.createMany({
      data: dataForInsert,
      skipDuplicates: true, // Tự động bỏ qua orderId trùng
    });

    const imported = result.count;
    const duplicated = orders.length - imported;

    console.log(
      `✅ EInvoice import: ${imported} new, ${duplicated} duplicates skipped (batch insert)`,
    );

    void logActivity({
      module: "einvoice",
      action: "CREATE",
      description: `Import ${imported} đơn HĐĐT${duplicated > 0 ? `, bỏ qua ${duplicated} đơn trùng` : ""} (batch)`,
      userName: "System",
    });

    return {
      success: true,
      data: { imported, duplicated, duplicateIds: [] },
    };
  } catch (error) {
    console.error("❌ einvoice:bulkImport error:", error.message);
    return { success: false, error: error.message };
  }
});

// Xem nháp HĐ từ đơn hàng thật — gọi unpublishview, KHÔNG phát hành
ipcMain.handle("einvoice:previewDraft", async (event, orderId) => {
  try {
    if (!prisma) throw new Error("Database not initialized");
    const misaConfig = await getMisaConfig();
    const token = await getMisaToken();

    // Lấy đơn hàng từ DB
    const order = await prisma.eInvoice.findFirst({ where: { orderId } });
    if (!order) throw new Error(`Không tìm thấy đơn ${orderId}`);

    // Build data HĐ giống khi xuất thật
    let customerName = order.customerName;
    if (!customerName || customerName.trim() === "" || customerName === "***") {
      customerName = "Người mua không lấy hóa đơn";
    }
    const invoiceData = buildMisaInvoiceData(
      { ...order, customerName },
      misaConfig,
    );
    delete invoiceData._refId;

    // Gọi unpublishview
    const baseUrl =
      misaConfig.env === "live"
        ? "https://api.meinvoice.vn/api/integration"
        : "https://testapi.meinvoice.vn/api/integration";

    console.log(
      "👀 Preview Draft:",
      JSON.stringify(invoiceData).substring(0, 500),
    );

    const response = await fetch(`${baseUrl}/invoice/unpublishview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(invoiceData),
    });

    const responseText = await response.text();
    console.log("👀 Preview Response:", responseText.substring(0, 500));

    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error(
        `MISA preview lá»—i (status ${response.status}): ${responseText.substring(0, 200)}`,
      );
    }

    const isSuccess = result.Success === true || result.success === true;
    const data = result.Data || result.data;
    if (!isSuccess || !data) {
      const errCode = result.ErrorCode || result.errorCode || "";
      const errors = result.Errors || result.errors || [];
      throw new Error(
        `Lỗi nháp: ${errCode} — ${Array.isArray(errors) ? errors.join(", ") : JSON.stringify(result).substring(0, 300)}`,
      );
    }

    return { success: true, data: data }; // data = link xem HĐ
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Xuất HĐĐT — gọi MISA meInvoice API thật (SignType=2 — HSM ký tự động)
ipcMain.handle("einvoice:issueInvoices", async (event, orderIds) => {
  try {
    if (!prisma) throw new Error("Database not initialized");
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return { success: false, error: "Không có đơn nào để xuất" };
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
        status: "pending",
      },
    });

    if (pendingOrders.length === 0) {
      return {
        success: false,
        error: "Tất cả đơn đã được xuất HĐĐT trước đó!",
      };
    }

    const batchId = `BATCH-${Date.now()}`;
    const issuedOrders = [];
    const errorLog = [];

    // Xuất từng đơn qua MISA API (1 đơn = 1 API call để dễ track lỗi)
    for (const order of pendingOrders) {
      try {
        // Validate data
        let customerName = order.customerName;
        if (
          !customerName ||
          customerName.trim() === "" ||
          customerName === "***"
        ) {
          customerName = "Người mua không lấy hóa đơn";
          await prisma.eInvoice.update({
            where: { id: order.id },
            data: { customerName },
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
          throw new Error("MISA không trả về kết quả phát hành");
        }

        const misaResult = publishResults[0];

        // Kiểm tra lỗi từ MISA cho từng HĐ
        if (misaResult.ErrorCode && misaResult.ErrorCode !== "") {
          throw new Error(`MISA: ${misaResult.ErrorCode}`);
        }

        // Thành công — cập nhật DB với dữ liệu thật từ MISA
        await prisma.eInvoice.update({
          where: { id: order.id },
          data: {
            status: "issued",
            invoiceNumber: misaResult.InvNo || misaResult.invNo || "",
            invoiceDate: new Date(),
            taxCode: misaResult.TransactionID || misaResult.transactionID || "",
            templateCode:
              misaResult.InvTemplateNo || misaResult.invTemplateNo || "",
            invoiceSeries:
              misaResult.InvSeries ||
              misaResult.invSeries ||
              misaConfig.invSeries ||
              "",
            batchId,
          },
        });

        const invoiceNumber = misaResult.InvNo || misaResult.invNo || "";
        const transactionId =
          misaResult.TransactionID || misaResult.transactionID || "";

        issuedOrders.push({
          orderId: order.orderId,
          invoiceNumber,
          taxCode: transactionId,
          refId,
        });

        console.log(
          `✅ MISA issued: ${order.orderId} → HĐ số ${invoiceNumber} | Mã: ${transactionId}`,
        );

        // Backup PDF lên Google Drive & Telegram (chạy ngầm)
        (async () => {
          try {
            const pdfBase64 = await downloadMisaInvoicePDF(transactionId);
            const pdfBuffer = Buffer.from(pdfBase64, "base64");
            const pdfPath = path.join(
              os.tmpdir(),
              `HD_${invoiceNumber}_${transactionId}.pdf`,
            );
            fs.writeFileSync(pdfPath, pdfBuffer);

            // Lưu path PDF vào DB
            await prisma.eInvoice.update({
              where: { id: order.id },
              data: { pdfFilePath: pdfPath },
            });

            console.log(`📄 PDF saved: ${pdfPath}`);
          } catch (backupErr) {
            console.error(
              `⚠️ Backup PDF for ${invoiceNumber} failed:`,
              backupErr.message,
            );
          }
        })();
      } catch (orderErr) {
        console.error(
          `❌ MISA issue error for ${order.orderId}:`,
          orderErr.message,
        );
        errorLog.push({
          orderId: order.orderId,
          error: orderErr.message,
          timestamp: new Date().toISOString(),
        });

        void logActivity({
          module: "einvoice",
          action: "ERROR",
          description: `Lỗi xuất HĐĐT MISA cho đơn ${order.orderId}: ${orderErr.message}`,
          recordId: order.id,
          severity: "ERROR",
          userName: "System",
        });
      }
    }

    const skippedCount = orderIds.length - pendingOrders.length;

    console.log(
      `✅ MISA Issued ${issuedOrders.length} einvoices (skipped ${skippedCount} already issued, ${errorLog.length} errors)`,
    );

    // Gửi tóm tắt batch lên Telegram
    if (issuedOrders.length > 0) {
      const totalAmount = pendingOrders
        .filter((o) => issuedOrders.some((i) => i.orderId === o.orderId))
        .reduce((s, o) => s + (o.totalAmount || 0), 0);
      const summaryMsg =
        `📊 <b>BATCH XUẤT HĐĐT (MISA)</b>\n` +
        `━━━━━━━━━━━━━━\n` +
        `🧾 Số HĐ: ${issuedOrders.length}\n` +
        `💰 Tổng: ${totalAmount.toLocaleString("vi-VN")}đ\n` +
        `📋 Batch: ${batchId}\n` +
        `🔑 Ký số: HSM (SignType=2)\n` +
        `📅 ${new Date().toLocaleDateString("vi-VN")} ${new Date().toLocaleTimeString("vi-VN")}\n` +
        (skippedCount > 0 ? `⚠️ Bỏ qua: ${skippedCount} đơn đã xuất\n` : "") +
        (errorLog.length > 0 ? `❌ Lỗi: ${errorLog.length} đơn\n` : "") +
        `━━━━━━━━━━━━━━`;
      sendTelegramMessage(summaryMsg).catch((err) =>
        console.error("Telegram summary error:", err),
      );
    }

    void logActivity({
      module: "einvoice",
      action: "UPDATE",
      description: `MISA: Xuất ${issuedOrders.length} HĐĐT thật (batch: ${batchId}, HSM ký số)${skippedCount > 0 ? ` — Bỏ qua ${skippedCount} đơn đã xuất` : ""}${errorLog.length > 0 ? ` — ${errorLog.length} đơn lỗi` : ""}`,
      userName: "System",
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
    console.error("❌ einvoice:issueInvoices error:", error.message);
    return { success: false, error: error.message };
  }
});

// Thống kê
ipcMain.handle("einvoice:getStats", async () => {
  try {
    if (!prisma) throw new Error("Database not initialized");

    // 🚀 Gộp thành 2 queries thay vì 5 + ÁP DỤNG BỘ LỌC 3 NGÀY CHỐNG ĐẾM TRÀN RÁC (842 bills cũ)
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - 3);

    const [statusCounts, totalAmount] = await Promise.all([
      prisma.eInvoice.groupBy({
        by: ["status"],
        where: { createdAt: { gte: dateThreshold } },
        _count: { status: true },
      }),
      prisma.eInvoice.aggregate({
        _sum: { totalAmount: true },
        where: {
          status: "issued",
          createdAt: { gte: dateThreshold },
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
        issued: countMap["issued"] || 0,
        pending: countMap["pending"] || 0,
        adjusted: countMap["adjusted"] || 0,
        cancelled: countMap["cancelled"] || 0,
        totalIssuedAmount: totalAmount._sum.totalAmount || 0,
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Xuất Excel báo cáo
ipcMain.handle("einvoice:exportExcel", async (event, filters) => {
  try {
    if (!prisma) throw new Error("Database not initialized");

    const where = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.platform) where.platform = filters.platform;

    const records = await prisma.eInvoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    if (records.length === 0) {
      return { success: false, error: "Không có dữ liệu để xuất" };
    }

    // Tạo data cho Excel
    const excelData = records.map((r, idx) => {
      let items = [];
      try {
        items = JSON.parse(r.items);
      } catch {}

      return {
        STT: idx + 1,
        Sàn: r.platform,
        "Mã đơn hàng": r.orderId,
        "Khách hàng": r.customerName,
        SĐT: r.customerPhone || "",
        "Sản phẩm": items
          .map((i) => `${i.productName} x${i.quantity}`)
          .join("; "),
        "Tổng SL": r.totalQuantity,
        "Thành tiền": r.totalAmount,
        "Ngày giao": r.deliveryDate
          ? new Date(r.deliveryDate).toLocaleDateString("vi-VN")
          : "",
        "Số HĐĐT": r.invoiceNumber || "",
        "Ngày xuất HĐ": r.invoiceDate
          ? new Date(r.invoiceDate).toLocaleDateString("vi-VN")
          : "",
        "Mã tra cứu": r.taxCode || "",
        "Trạng thái": r.status === "issued" ? "Đã xuất" : "Chưa xuất",
        "File gốc": r.sourceFile || "",
      };
    });

    const ws = XLSX.utils.json_to_sheet(excelData);

    // Set column widths
    ws["!cols"] = [
      { wch: 5 }, // STT
      { wch: 10 }, // Sàn
      { wch: 25 }, // Mã đơn
      { wch: 20 }, // Khách hàng
      { wch: 15 }, // SĐT
      { wch: 50 }, // Sản phẩm
      { wch: 8 }, // Tổng SL
      { wch: 15 }, // Thành tiền
      { wch: 12 }, // Ngày giao
      { wch: 15 }, // Số HĐĐT
      { wch: 12 }, // Ngày xuất
      { wch: 18 }, // Mã tra cứu
      { wch: 12 }, // Trạng thái
      { wch: 30 }, // File gốc
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "HĐĐT");

    // Show save dialog
    const result = await dialog.showSaveDialog({
      title: "Xuất báo cáo HĐĐT",
      defaultPath: `BaoCao_HDDT_${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: "Đã hủy xuất file" };
    }

    XLSX.writeFile(wb, result.filePath);
    console.log(
      `✅ Exported ${records.length} einvoice records to ${result.filePath}`,
    );

    void logActivity({
      module: "einvoice",
      action: "EXPORT",
      description: `Xuất báo cáo HĐĐT: ${records.length} dòng → ${path.basename(result.filePath)}`,
      userName: "System",
    });

    return {
      success: true,
      data: { filePath: result.filePath, count: records.length },
    };
  } catch (error) {
    console.error("❌ einvoice:exportExcel error:", error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("einvoice:delete", async (event, id) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Database not initialized");
    await prisma.eInvoice.delete({ where: { id: parseInt(id) } });
    console.log(`✅ Deleted einvoice #${id}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("einvoice:bulkDelete", async (event, orderIds) => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Database not initialized");
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return { success: false, error: "Không có đơn để xóa" };
    }
    const result = await prisma.eInvoice.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    console.log(`✅ Bulk deleted ${result.count} einvoice records`);
    void logActivity({
      module: "einvoice",
      action: "DELETE",
      description: `Xóa hàng loạt ${result.count} đơn HĐĐT`,
      userName: "Admin",
    });
    return { success: true, data: { deleted: result.count } };
  } catch (error) {
    console.error("❌ einvoice:bulkDelete error:", error.message);
    return { success: false, error: error.message };
  }
});

// ⚠️ TEST ONLY — Xóa toàn bộ HĐĐT (sẽ tắt sau khi test xong)
ipcMain.handle("einvoice:deleteAll", async () => {
  try {
    requireRole("admin");
    if (!prisma) throw new Error("Database not initialized");
    const result = await prisma.eInvoice.deleteMany({});
    console.log(`⚠️ DELETED ALL ${result.count} einvoice records`);
    void logActivity({
      module: "einvoice",
      action: "DELETE",
      description: `⚠️ XÓA TẤT CẢ ${result.count} đơn HĐĐT (TEST MODE)`,
      userName: "Admin",
    });
    return { success: true, data: { deleted: result.count } };
  } catch (error) {
    console.error("❌ einvoice:deleteAll error:", error.message);
    return { success: false, error: error.message };
  }
});

// ============================================================
// TASK 1: Truy xuất HĐ gốc
// ============================================================
ipcMain.handle("einvoice:getOriginalInvoice", async (event, orderId) => {
  try {
    if (!prisma) throw new Error("Database not initialized");
    const invoice = await prisma.eInvoice.findFirst({
      where: { orderId, status: "issued" },
    });
    if (!invoice) {
      return {
        success: false,
        error: `Đơn ${orderId} chưa có HĐĐT — không thể điều chỉnh`,
      };
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
  try {
    items =
      typeof orig.items === "string" ? JSON.parse(orig.items) : orig.items;
  } catch (e) {
    items = [];
  }

  const autoReason =
    reason ||
    `Trả lại hàng hóa cho HĐ Mẫu số ${orig.templateCode || "N/A"}, Ký hiệu ${orig.invoiceSeries || "N/A"}, Số ${orig.invoiceNumber}, ngày ${orig.invoiceDate ? new Date(orig.invoiceDate).toLocaleDateString("vi-VN") : "N/A"}`;

  const payload = {
    OriginalInvoiceData: {
      TemplateCode: orig.templateCode || "",
      InvoiceSeries: orig.invoiceSeries || "",
      InvoiceNumber: orig.invoiceNumber || "",
      InvoiceDate: orig.invoiceDate,
    },
    RefType: adjustmentType === "replacement" ? 4 : 3,
    AdjustmentType: adjustmentType,
    Reason: autoReason,
    BuyerName: orig.customerName,
    BuyerPhone: orig.customerPhone,
    InvoiceDetails: items.map((item, idx) => ({
      LineNumber: idx + 1,
      ItemName: item.productName || "",
      SKU: item.sku || "",
      Unit: "Cái",
      Quantity: -(item.quantity || 1),
      UnitPrice: item.unitPrice || 0,
      Amount: -(item.total || 0),
    })),
    TotalAmount: -(orig.totalAmount || 0),
  };
  return { payload, autoReason };
}

ipcMain.handle(
  "einvoice:adjustInvoice",
  async (event, { orderId, adjustmentType, reason, partialItems }) => {
    try {
      if (!prisma) throw new Error("Database not initialized");

      // Tìm HĐ gốc (issued HOẶC adjusted — đã điều chỉnh 1 phần vẫn cho tiếp)
      const orig = await prisma.eInvoice.findFirst({
        where: {
          orderId,
          status: { in: ["issued", "adjusted"] },
          adjustmentType: null,
        },
        orderBy: { createdAt: "asc" },
      });
      if (!orig)
        return {
          success: false,
          error: `Đơn ${orderId} chưa có HĐĐT hoặc đã bị hủy`,
        };

      // Tìm chain điều chỉnh
      const chain = await prisma.eInvoice.findMany({
        where: { refInvoiceId: orig.id },
        orderBy: { createdAt: "asc" },
      });

      const totalAdjusted = chain.reduce(
        (sum, inv) => sum + Math.abs(inv.totalAmount || 0),
        0,
      );
      const remaining = (orig.totalAmount || 0) - totalAdjusted;

      if (remaining <= 0) {
        return {
          success: false,
          error: `HĐ ${orig.invoiceNumber} đã điều chỉnh hết (${totalAdjusted.toLocaleString()}đ / ${(orig.totalAmount || 0).toLocaleString()}đ)`,
        };
      }

      // NĐ 123: giữ nguyên hình thức lần đầu
      if (
        chain.length > 0 &&
        chain[0].adjustmentType &&
        chain[0].adjustmentType !== adjustmentType
      ) {
        return {
          success: false,
          error: `Theo NĐ 123/2020: Lần đầu đã chọn "${chain[0].adjustmentType}", các lần sau phải giữ nguyên.`,
        };
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
        return {
          success: false,
          error: `Vượt quá: ${adjAmount.toLocaleString()}đ > còn lại ${remaining.toLocaleString()}đ`,
        };
      }

      // Tham chiếu HĐ cuối chain (NĐ 123 yêu cầu)
      const lastInChain = chain.length > 0 ? chain[chain.length - 1] : orig;
      const chainNum = chain.length + 1;
      const autoReason =
        reason ||
        `Điều chỉnh lần ${chainNum} cho HĐ Số ${lastInChain.invoiceNumber}, ngày ${lastInChain.invoiceDate ? new Date(lastInChain.invoiceDate).toLocaleDateString("vi-VN") : "N/A"}`;

      // Simulation
      const last = await prisma.eInvoice.findFirst({
        where: { invoiceNumber: { not: null } },
        orderBy: { invoiceNumber: "desc" },
        select: { invoiceNumber: true },
      });
      let counter = 1;
      if (last?.invoiceNumber) {
        const m = last.invoiceNumber.match(/HD(\d+)/);
        if (m) counter = parseInt(m[1]) + 1;
      }
      const newNum = `HD${String(counter).padStart(7, "0")}`;
      const newTax = `MCQ-ADJ-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

      const isFullyDone =
        totalAdjusted + adjAmount >= (orig.totalAmount || 0) - 0.01;

      const [, adjRecord] = await prisma.$transaction([
        prisma.eInvoice.update({
          where: { id: orig.id },
          data: {
            status: adjustmentType === "replacement" ? "replaced" : "adjusted",
          },
        }),
        prisma.eInvoice.create({
          data: {
            orderId: `${orderId}-${adjustmentType.substring(0, 3).toUpperCase()}-${Date.now()}`,
            platform: orig.platform,
            customerName: orig.customerName,
            customerPhone: orig.customerPhone,
            items: adjItems,
            totalQuantity: adjQuantity,
            totalAmount: -adjAmount,
            deliveryDate: orig.deliveryDate,
            invoiceNumber: newNum,
            invoiceDate: new Date(),
            taxCode: newTax,
            templateCode: orig.templateCode,
            invoiceSeries: orig.invoiceSeries,
            refInvoiceId: orig.id,
            adjustmentType,
            adjustmentReason: autoReason,
            adjustmentDate: new Date(),
            status: "issued",
            batchId: `ADJ-${Date.now()}`,
          },
        }),
      ]);

      console.log(
        `✅ Điều chỉnh lần ${chainNum}: ${orig.invoiceNumber} → ${newNum} | -${adjAmount.toLocaleString()}đ | Còn lại: ${(remaining - adjAmount).toLocaleString()}đ`,
      );
      void logActivity({
        module: "einvoice",
        action: adjustmentType === "replacement" ? "REPLACE" : "ADJUST",
        description: `Lần ${chainNum}: ${orig.invoiceNumber} → ${newNum}. -${adjAmount.toLocaleString()}đ. Còn: ${(remaining - adjAmount).toLocaleString()}đ. ${autoReason}`,
        userName: "System",
      });

      return {
        success: true,
        data: {
          originalInvoice: orig.invoiceNumber,
          newInvoice: newNum,
          adjustmentType,
          reason: autoReason,
          chainNumber: chainNum,
          totalAdjusted: totalAdjusted + adjAmount,
          remaining: remaining - adjAmount,
        },
      };
    } catch (error) {
      console.error("❌ einvoice:adjustInvoice error:", error.message);
      return { success: false, error: error.message };
    }
  },
);

// Lấy chuỗi chain HĐ điều chỉnh
ipcMain.handle("einvoice:getInvoiceChain", async (event, orderId) => {
  try {
    if (!prisma) throw new Error("Database not initialized");
    const orig = await prisma.eInvoice.findFirst({
      where: { orderId, adjustmentType: null },
      orderBy: { createdAt: "asc" },
    });
    if (!orig) return { success: false, error: "Không tìm thấy HĐ gốc" };
    const adjustments = await prisma.eInvoice.findMany({
      where: { refInvoiceId: orig.id },
      orderBy: { createdAt: "asc" },
    });
    const totalAdjusted = adjustments.reduce(
      (sum, inv) => sum + Math.abs(inv.totalAmount || 0),
      0,
    );
    return {
      success: true,
      data: {
        original: orig,
        adjustments,
        totalAdjusted,
        remaining: (orig.totalAmount || 0) - totalAdjusted,
        chainLength: adjustments.length,
      },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ========================================
// ATTENDANCE / CHẤM CÔNG KHUÔN MẶT
// On-demand: Python chỉ chạy khi vào tab Điểm danh
// Tự tắt sau 10 phút ko dùng
// ========================================

const net = require("net");

const FACE_SERVICE_URL = "http://127.0.0.1:5001";
const FACE_SERVICE_PORT = 5001;
const FACE_SERVICE_IDLE_TIMEOUT = 30 * 60 * 1000; // Tăng lên 30 phút thay vì 10 phút
const FACE_SERVICE_NAME = "attendance";

let faceServiceProcess = null; // child_process reference
let faceServiceReady = false;
let faceServiceIdleTimer = null;
let faceExeDisabled = false;

// Reset idle timer mỗi khi có request → tự kill sau 30 phút idle
function resetFaceServiceIdleTimer() {
  if (faceServiceIdleTimer) clearTimeout(faceServiceIdleTimer);
  faceServiceIdleTimer = setTimeout(async () => {
    if (faceServiceProcess) {
      console.log("[Face] ⏹ Tự tắt Python service sau 30 phút không dùng");
      try {
        await faceServiceFetch("/shutdown", { method: "POST" });
      } catch {
        /* Python đã tắt hoặc không phản hồi */
      }
      // Chờ 2s cho Python tự thoát
      await new Promise((r) => setTimeout(r, 2000));
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
let _faceLastSpawnFail = 0; // Timestamp lần spawn thất bại cuối
let _ensurePromise = null; // Promise quản lý việc spawn chống race condition

function isLiveFaceService(data) {
  // Service đã sống (có thể đang initializing hoặc ready)
  return Boolean(
    data &&
    data.ok === true &&
    data.service === FACE_SERVICE_NAME &&
    (data.status === "ready" || data.status === "initializing") &&
    data.version !== undefined,
  );
}

function isValidFaceServiceStatus(data) {
  // Service đã sống VÀ sẵn sàng xử lý request
  return Boolean(
    data &&
    data.ok === true &&
    data.service === FACE_SERVICE_NAME &&
    data.status === "ready" &&
    data.version !== undefined,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFaceServicePortFree() {
  return new Promise((resolve) => {
    const tester = net.createServer();

    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });

    tester.listen(FACE_SERVICE_PORT, "127.0.0.1");
  });
}

function killProcessOnFacePort(execSync) {
  const killCommand = [
    "$targets = @(Get-NetTCPConnection -LocalPort 5001 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)",
    "if ($targets.Count -gt 0) {",
    "  $targets | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }",
    "}",
  ].join("; ");

  execSync(
    `powershell.exe -NoProfile -NonInteractive -Command "${killCommand}"`,
    {
      stdio: "ignore",
      windowsHide: true,
      timeout: 10000,
    },
  );
}

async function waitForFacePortFree(maxAttempts = 10, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await isFaceServicePortFree()) {
      return true;
    }
    console.log(
      `[Face] Chờ port ${FACE_SERVICE_PORT} free... lần ${attempt}/${maxAttempts}`,
    );
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
        const data = await faceServiceFetch("/status");
        if (isValidFaceServiceStatus(data)) {
          console.log(
            "[Face] ✅ Phát hiện service đang chạy sẵn trên port 5001",
          );
          faceServiceReady = true;
          resetFaceServiceIdleTimer();
          return true;
        }
        console.warn(
          "[Face] ⚠️ Port 5001 có phản hồi nhưng không đúng attendance service, sẽ thay thế bằng service nội bộ",
        );
      } catch {
        // Port chưa có service → sẽ spawn bên dưới
      }

      // 3. Cooldown: tránh spawn loop (đợi 10s giữa các lần thất bại)
      const cooldown = Date.now() - _faceLastSpawnFail;
      if (cooldown < 10000) {
        throw new Error(
          `Đợi ${Math.ceil((10000 - cooldown) / 1000)}s trước khi thử lại`,
        );
      }

      // 4. Spawn má»›i
      const { spawn, execSync } = require("child_process");

      // Kill process đang giữ port 5001 rồi chờ Windows nhả port thật sự.
      try {
        killProcessOnFacePort(execSync);
      } catch {
        /* Bỏ qua nếu lệnh kill lỗi hoặc không có ai dùng port */
      }
      if (!(await waitForFacePortFree())) {
        throw new Error(
          `Port ${FACE_SERVICE_PORT} không giải phóng được sau 10s`,
        );
      }

      // ── Xác định cách chạy: EXE (ưu tiên) hoặc Python (fallback) ──────
      const exePath = path.join(
        __dirname,
        "..",
        "python",
        "dist",
        "attendance_service.exe",
      );
      const scriptPath = path.join(
        __dirname,
        "..",
        "python",
        "attendance_service.py",
      );
      let spawnCmd, spawnArgs;

      const preferFaceExe = app.isPackaged && !faceExeDisabled;
      if (preferFaceExe && fs.existsSync(exePath)) {
        console.log("[Face] 🚀 Dùng attendance_service.exe (standalone)");
        spawnCmd = exePath;
        spawnArgs = [];
      } else if (fs.existsSync(scriptPath)) {
        if (!app.isPackaged && fs.existsSync(exePath)) {
          console.log(
            "[Face] 🛠 Dev mode → bỏ qua attendance_service.exe, dùng Python script để debug ổn định hơn",
          );
        } else if (faceExeDisabled) {
          console.log(
            "[Face] ⚠️ attendance_service.exe đã bị vô hiệu hóa cho phiên này → fallback sang Python script",
          );
        }
        console.log("[Face] 🐍 Không có EXE → tìm Python...");
        function findPythonForFace() {
          const { spawnSync } = require("child_process");
          const usernames = [
            ...new Set(
              ["Admin", "NCPC", process.env.USERNAME || ""].filter(Boolean),
            ),
          ];
          const candidates = [];
          for (const uname of usernames) {
            for (const ver of [
              "Python311",
              "Python310",
              "Python39",
              "Python312",
            ]) {
              candidates.push({
                exe: `C:\\Users\\${uname}\\AppData\\Local\\Programs\\Python\\${ver}\\python.exe`,
                args: [],
              });
            }
          }
          for (const ver of [
            "Python311",
            "Python310",
            "Python39",
            "Python312",
          ]) {
            candidates.push({
              exe: `C:\\Program Files\\${ver}\\python.exe`,
              args: [],
            });
          }
          candidates.push(
            { exe: "py", args: ["-3.11"] },
            { exe: "py", args: ["-3.10"] },
            { exe: "py", args: ["-3"] },
            { exe: "python", args: [] },
            { exe: "python3", args: [] },
          );

          console.log(
            `[Face] 🔍 Tìm Python có face_recognition (${candidates.length} candidates, users: ${usernames.join(",")})`,
          );

          for (const c of candidates) {
            try {
              if (c.exe.includes("\\")) {
                if (!fs.existsSync(c.exe)) continue;
              } else {
                const res = spawnSync(c.exe, [...c.args, "--version"], {
                  windowsHide: true,
                  timeout: 5000,
                  stdio: "pipe",
                });
                if (res.error || res.status !== 0) continue;
              }

              const verifyArgs = [
                ...c.args,
                "-c",
                'import face_recognition; print("OK")',
              ];
              const verify = spawnSync(c.exe, verifyArgs, {
                windowsHide: true,
                timeout: 15000,
                stdio: "pipe",
              });
              if (verify.error || verify.status !== 0) continue;

              console.log(
                `[Face]   ✅ CHỌN: ${c.exe} ${c.args.join(" ")} → có face_recognition`,
              );
              return c;
            } catch (err) {}
          }
          return null;
        }
        const pyFound = findPythonForFace();
        if (!pyFound) {
          throw new Error(
            "Không có EXE và không tìm thấy Python. Liên hệ kỹ thuật.",
          );
        }
        spawnCmd = pyFound.exe;
        spawnArgs = [...pyFound.args, scriptPath];
      } else {
        throw new Error("Không tìm thấy attendance_service.exe hoặc .py");
      }
      console.log("[Face] Spawn:", spawnCmd, spawnArgs.join(" "));

      faceServiceProcess = require("child_process").spawn(spawnCmd, spawnArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: {
          ...process.env,
          FACE_DATA_DIR: app.getPath("userData"),
          PYTHONIOENCODING: "utf-8",
        },
      });

      faceServiceProcess.stdout.on("data", (data) => {
        const output = data.toString().trim();
        if (output) console.log("[Face-py]", output);
      });

      faceServiceProcess.stderr.on("data", (data) => {
        const output = data.toString().trim();
        if (output) console.log("[Face-py:err]", output);
      });

      faceServiceProcess.on("error", (err) => {
        console.error("[Face] ❌ Không thể chạy Python:", err.message);
        faceServiceProcess = null;
        faceServiceReady = false;
        _faceLastSpawnFail = Date.now();
      });

      faceServiceProcess.on("exit", (code) => {
        console.log(`[Face] Python service exited (code ${code})`);
        if (spawnCmd === exePath && code !== 0) {
          faceExeDisabled = true;
          console.warn(
            "[Face] ⚠️ attendance_service.exe lỗi, sẽ fallback sang Python script ở lần thử tiếp theo",
          );
        }
        faceServiceProcess = null;
        faceServiceReady = false;
        if (code !== 0) _faceLastSpawnFail = Date.now();
        if (faceServiceIdleTimer) {
          clearTimeout(faceServiceIdleTimer);
          faceServiceIdleTimer = null;
        }
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
            return rej(new Error("Python process thoát bất ngờ"));
          }
          try {
            const statusData = await faceServiceFetch("/status");
            if (isLiveFaceService(statusData)) {
              clearInterval(pollReady);
              // Nếu đã ready thì set luôn, nếu initializing thì chưa set ready
              if (statusData.status === "ready") {
                faceServiceReady = true;
                console.log(
                  `[Face] ✅ Python face service sẵn sàng sau ${attempts * 0.5}s!`,
                );
              } else {
                console.log(
                  `[Face] ✅ Python service đã mở port sau ${attempts * 0.5}s (đang load encodings...)`,
                );
              }
              resetFaceServiceIdleTimer();
              res(true);
            } else {
              throw new Error("Invalid attendance service status payload");
            }
          } catch {
            if (attempts >= maxAttempts) {
              clearInterval(pollReady);
              _faceLastSpawnFail = Date.now();
              console.error("[Face] ❌ Python service không phản hồi sau 90s");
              if (faceServiceProcess) {
                faceServiceProcess.kill();
                faceServiceProcess = null;
              }
              rej(new Error("Python service khởi động thất bại (Timeout 90s)"));
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
app.on("before-quit", () => {
  stopTelegramWmsPolling();
  if (faceServiceProcess) {
    console.log("[Face] 🧹 Tắt Python service khi app thoát");
    faceServiceProcess.kill();
    faceServiceProcess = null;
  }
});

function faceServiceFetch(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body || null;
    const method = options.method || "GET";
    const url = new URL(`${FACE_SERVICE_URL}${urlPath}`);
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 5001,
      path: url.pathname,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    };
    const req = http.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error("Invalid JSON response"));
        }
      });
    });
    // /register: 120s (50 ảnh × HOG + encoding), /recognize: 15s, /profile (delete+rebuild): 60s, còn lại: 5s
    const timeout = urlPath.includes("/register")
      ? 120000
      : urlPath.includes("/recognize")
        ? 15000
        : urlPath.includes("/profile")
          ? 60000
          : 5000;
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// Xác định loại chấm công theo giờ hiện tại
function getLocalDateKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
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
    if (total < 11 * 60 + 50) return "morning_in";
    return "morning_out";
  }

  // Ca chiều
  // Check-in: 13:00 đến trước 17:30
  // Check-out: 17:30 đến 20:30
  if (total >= 13 * 60 && total <= 20 * 60 + 30) {
    if (total < 17 * 60 + 30) return "afternoon_in";
    return "evening_out";
  }

  // DEBUG: Tạm bỏ giới hạn giờ — luôn cho phép chấm công
  // Ngoài khung giờ → tự chọn ca gần nhất thay vì block
  if (total < 7 * 60) return "morning_in"; // Trước 7h → coi như sáng vào sớm
  if (total <= 13 * 60) return "morning_out"; // 12:30-13:00 (nghỉ trưa) → sáng ra
  return "evening_out"; // Sau 20:30 → tối ra
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
    orderBy: { timestamp: "asc" },
  });
  const has = (type) => logs.some((log) => log.checkType === type);

  // Once a session has check-in, the next valid recognition for that session is checkout.
  if (baseCheckType === "morning_in" && has("morning_in")) {
    if (has("morning_out")) return attendanceDecision("morning_out");
    if (total < 11 * 60 + 50) {
      return attendanceDecision(null, {
        reason: "not_checkout_time",
        nextCheckType: "morning_out",
        allowedFrom: "11:50",
      });
    }
    return attendanceDecision("morning_out");
  }

  if (baseCheckType === "afternoon_in" && has("afternoon_in")) {
    if (has("evening_out")) return attendanceDecision("evening_out");
    if (total < 17 * 60 + 30) {
      return attendanceDecision(null, {
        reason: "not_checkout_time",
        nextCheckType: "evening_out",
        allowedFrom: "17:30",
      });
    }
    return attendanceDecision("evening_out");
  }

  return attendanceDecision(baseCheckType);
}

function encodeMailHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value || ""), "utf8").toString("base64")}?=`;
}

function toBase64Url(value) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function isGoogleReauthError(err) {
  const parts = [
    err?.message,
    err?.response?.data?.error,
    err?.response?.data?.error_description,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return parts.some(
    (value) =>
      value.includes("invalid_grant") ||
      value.includes("token has been expired or revoked"),
  );
}

async function sendGmailWithAttachment({
  to,
  subject,
  html,
  fileName,
  pdfBase64,
}) {
  const tokenPath = ensureGoogleTokenPath();
  if (!fs.existsSync(tokenPath)) {
    return {
      success: false,
      reauthRequired: true,
      error: "Chưa có token Google. Cần đăng nhập Google trước khi gửi Gmail.",
    };
  }

  const tokens = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
  const scope = String(tokens.scope || "");
  if (!scope.includes("https://www.googleapis.com/auth/gmail.send")) {
    return {
      success: false,
      reauthRequired: true,
      error:
        "Token Google hiện tại chưa có quyền Gmail. Cần cấp lại quyền với scope gmail.send.",
    };
  }

  const { google } = require("googleapis");
  const oauth2Client = new google.auth.OAuth2(
    OAUTH_CLIENT_ID,
    OAUTH_CLIENT_SECRET,
  );
  oauth2Client.setCredentials(tokens);
  oauth2Client.on("tokens", (newTokens) => {
    try {
      const saved = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));
      fs.writeFileSync(
        tokenPath,
        JSON.stringify({ ...saved, ...newTokens }, null, 2),
      );
    } catch (err) {
      console.error("[Gmail] Failed to save refreshed token:", err.message);
    }
  });

  const boundary = `payslip_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const sender = "yendao444@gmail.com";
  const safeFileName = fileName || "phieu-luong.pdf";
  const message = [
    `From: ${encodeMailHeader("Hệ thống Quản lý")} <${sender}>`,
    `To: ${to}`,
    `Subject: ${encodeMailHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(html || "", "utf8").toString("base64"),
    "",
    `--${boundary}`,
    `Content-Type: application/pdf; name="${safeFileName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${safeFileName}"`,
    "",
    String(pdfBase64 || "").replace(/^data:application\/pdf;base64,/, ""),
    "",
    `--${boundary}--`,
  ].join("\r\n");

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  let sent;
  try {
    sent = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: toBase64Url(message) },
    });
  } catch (err) {
    if (isGoogleReauthError(err)) {
      return {
        success: false,
        reauthRequired: true,
        error:
          "Token Google da het han hoac bi thu hoi. Vui long chay reauth-gdrive.bat de dang nhap Google lai roi gui lai Gmail.",
      };
    }
    throw err;
  }

  return { success: true, data: { id: sent.data.id } };
}

ipcMain.handle(
  "attendance:sendPayslipEmail",
  async (event, { to, employeeName, period, fileName, pdfBase64 } = {}) => {
    try {
      if (!to || !pdfBase64) throw new Error("Thiếu email nhận hoặc file PDF");

      const companyName = "AIRCLEAN CORP.";
      const employeeLabel = String(employeeName || "").trim();
      const rawPeriod = String(period || "").trim();
      const formattedPeriod = rawPeriod
        ? `Tháng ${rawPeriod.replace("-", "/")}`
        : "Tháng";
      const subject =
        `${companyName} - Phiếu Lương ${formattedPeriod} - ${employeeLabel}`
          .replace(/\s+/g, " ")
          .trim();
      const greetingName = employeeLabel ? ` ${employeeLabel}` : "";
      const html = `
            <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#111;">
                <p>Kính gửi anh/chị${greetingName},</p>
                <p>${companyName} gửi anh/chị phiếu lương kỳ ${formattedPeriod.toLowerCase()} trong file đính kèm.</p>
                <p>Anh/chị vui lòng kiểm tra thông tin chi tiết. Nếu có thắc mắc hoặc cần đối soát, vui lòng phản hồi lại email này hoặc liên hệ bộ phận phụ trách.</p>
                <p>Trân trọng,<br/>Bộ phận Nhân sự<br/>DBY Software</p>
            </div>
        `;
      return await sendGmailWithAttachment({
        to,
        subject,
        html,
        fileName,
        pdfBase64,
      });
    } catch (err) {
      console.error("❌ attendance:sendPayslipEmail error:", err.message);
      const message =
        err?.response?.data?.error || err.message || "Gửi Gmail thất bại";
      return {
        success: false,
        error: typeof message === "string" ? message : JSON.stringify(message),
      };
    }
  },
);

// Kiểm tra + tự khởi động Python service khi vào tab Điểm danh
ipcMain.handle(
  "attendance:savePayslipPDF",
  async (event, { fileName, pdfBase64 } = {}) => {
    try {
      if (!fileName || !pdfBase64)
        throw new Error("Thiếu tên file hoặc dữ liệu PDF");
      const safeFileName =
        String(fileName)
          .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
          .replace(/\s+/g, " ")
          .trim() || `phieu-luong-${Date.now()}.pdf`;
      const downloadsDir = app.getPath("downloads");
      const targetPath = path.join(
        downloadsDir,
        safeFileName.toLowerCase().endsWith(".pdf")
          ? safeFileName
          : `${safeFileName}.pdf`,
      );
      fs.writeFileSync(
        targetPath,
        Buffer.from(
          String(pdfBase64).replace(/^data:application\/pdf;base64,/, ""),
          "base64",
        ),
      );
      return { success: true, data: { filePath: targetPath } };
    } catch (err) {
      console.error("❌ attendance:savePayslipPDF error:", err.message);
      return {
        success: false,
        error: err.message || "Không lưu được file PDF",
      };
    }
  },
);

ipcMain.handle("attendance:status", async () => {
  const exePath = path.join(
    __dirname,
    "..",
    "python",
    "dist",
    "attendance_service.exe",
  );
  const scriptPath = path.join(
    __dirname,
    "..",
    "python",
    "attendance_service.py",
  );
  const debug = {
    isPackaged: app.isPackaged,
    exeExists: fs.existsSync(exePath),
    scriptExists: fs.existsSync(scriptPath),
    exePath,
    faceExeDisabled,
    faceServiceReady,
    hasProcess: !!faceServiceProcess,
  };
  console.log("[Face:status] debug:", JSON.stringify(debug));
  try {
    // Tự động spawn Python nếu chưa chạy
    await ensureFaceService();
    const data = await faceServiceFetch("/status");
    if (!isLiveFaceService(data)) {
      throw new Error(
        "Attendance service trả về /status không hợp lệ: " +
          JSON.stringify(data),
      );
    }
    // Nếu đang initializing → vẫn báo success nhưng ghi nhận chưa ready
    if (data.status === "ready" && !faceServiceReady) {
      faceServiceReady = true;
    }
    console.log("[Face:status] OK →", data.status);
    return { success: true, data, debug };
  } catch (err) {
    console.warn("[Face:status] FAILED:", err.message);
    return {
      success: false,
      error: err.message || "Python service chưa sẵn sàng",
      debug,
    };
  }
});

// Phát hiện khuôn mặt (không so khớp) — dùng cho modal đăng ký
ipcMain.handle("attendance:detect", async (event, { image }) => {
  try {
    await ensureFaceService();
    resetFaceServiceIdleTimer();
    const result = await faceServiceFetch("/detect", {
      method: "POST",
      body: JSON.stringify({ image }),
    });
    return {
      success: true,
      face_box: result.face_box,
      img_height: result.img_height,
      found: result.found,
      reason: result.reason,
    };
  } catch (err) {
    console.error("❌ attendance:detect error:", err.message);
    return { success: false, error: err.message };
  }
});

// Nhận diện khuôn mặt + ghi chấm công
ipcMain.handle("attendance:recognize", async (event, { image }) => {
  try {
    await ensureFaceService();
    resetFaceServiceIdleTimer();
    const result = await faceServiceFetch("/recognize", {
      method: "POST",
      body: JSON.stringify({ image }),
    });

    // ── DEBUG LOG ──────────────────────────────────────────────────
    console.log(
      "[Face DEBUG] Python result:",
      JSON.stringify({
        found: result.found,
        face_id: result.face_id,
        reason: result.reason,
        confidence: result.confidence,
        dist: result.dist,
        _debug: result._debug,
      }),
    );

    // Luôn đính kèm face_box để frontend vẽ overlay real-time
    const faceInfo = {
      face_box: result.face_box || null,
      img_width: result.img_width || 640,
      img_height: result.img_height || 480,
    };

    // Không phát hiện mặt
    if (!result.found)
      return { success: false, reason: result.reason, ...faceInfo };

    // Phát hiện mặt nhưng không khớp profile nào
    if (!result.face_id)
      return { success: false, reason: "no_match", ...faceInfo };

    // Lấy thông tin user từ FaceProfile (cần trước cả out_of_hours để có userName)
    const profile = await prisma.faceProfile.findUnique({
      where: { faceId: result.face_id },
    });
    const userName = profile?.userName || result.face_id;
    const userId = profile?.userId || null;

    // Face recognition can run at the shared attendance kiosk without an
    // authenticated desktop session. Check the employee account directly
    // so a resigned/inactive user cannot generate new attendance logs.
    const attendanceUser = userId
      ? await prisma.user.findUnique({
          where: { id: userId },
          select: { status: true },
        })
      : await prisma.user.findFirst({
          where: { OR: [{ username: userName }, { fullName: userName }] },
          select: { status: true },
        });
    if (attendanceUser && attendanceUser.status !== "active") {
      return {
        success: false,
        reason: "inactive_employee",
        message:
          attendanceUser.status === USER_STATUS_RESIGNED
            ? "Nhân viên đã nghỉ việc, không thể chấm công."
            : "Tài khoản nhân viên đang bị vô hiệu hóa.",
        face_id: result.face_id,
        userName,
        ...faceInfo,
      };
    }

    const now = new Date();
    const today = getLocalDateKey(now);
    const checkDecision = await resolveAttendanceCheckType(
      result.face_id,
      today,
      now,
    );
    const checkType = checkDecision.checkType;
    if (!checkType) {
      return {
        success: false,
        reason: checkDecision.reason || "out_of_hours",
        nextCheckType: checkDecision.nextCheckType,
        allowedFrom: checkDecision.allowedFrom,
        face_id: result.face_id,
        userName,
        ...faceInfo,
      };
    }

    // Mỗi loại log chỉ ghi 1 lần/ngày.
    const existing = await prisma.attendanceLog.findFirst({
      where: { faceId: result.face_id, checkType, date: today },
    });
    if (existing)
      return {
        success: false,
        reason: "duplicate",
        face_id: result.face_id,
        userName,
        ...faceInfo,
      };

    // Ghi log
    const log = await prisma.attendanceLog.create({
      data: {
        userId,
        userName,
        faceId: result.face_id,
        checkType,
        confidence: result.confidence,
        date: today,
      },
    });

    const fineResult = await reconcileLateAttendanceFines(prisma, {
      logIds: [log.id],
      actor: "system",
    });
    const lateFine = fineResult.created[0] || null;

    return {
      success: true,
      data: {
        ...log,
        confidence: result.confidence,
        userName,
        lateFine,
        ...faceInfo,
      },
    };
  } catch (err) {
    console.error("❌ attendance:recognize error:", err.message);
    return { success: false, error: err.message };
  }
});

// Đăng ký khuôn mặt nhân viên
ipcMain.handle(
  "attendance:register",
  async (event, { face_id, user_name, user_id, images }) => {
    try {
      await ensureFaceService();
      resetFaceServiceIdleTimer();
      const result = await faceServiceFetch("/register", {
        method: "POST",
        body: JSON.stringify({ face_id, user_name, images }),
      });
      if (!result.ok) throw new Error("Python register failed");

      // Lưu FaceProfile vào DB
      await prisma.faceProfile.upsert({
        where: { faceId: face_id },
        update: {
          userName: user_name,
          userId: user_id || null,
          photoCount: result.saved,
          isActive: true,
        },
        create: {
          faceId: face_id,
          userName: user_name,
          userId: user_id || null,
          photoCount: result.saved,
        },
      });

      return { success: true, saved: result.saved };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

// Lấy lịch sử chấm công
ipcMain.handle(
  "attendance:getLogs",
  async (event, { date, month, userId } = {}) => {
    try {
      const where = {};
      if (date) where.date = date;
      else if (month) where.date = { startsWith: month }; // month: 'YYYY-MM'

      if (userId) where.userId = userId;

      const logs = await prisma.attendanceLog.findMany({
        where,
        orderBy: { timestamp: "desc" },
        ...(date ? { take: 200 } : {}), // Limit if single date, fetch all for month
      });
      return { success: true, data: logs };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  "attendance:saveEmployeeProfile",
  async (event, payload = {}) => {
    try {
      requireRole("admin");
      if (!prisma) throw new Error("Prisma not available");

      const mode = payload.mode === "create" ? "create" : "edit";
      const normalizedUsername = String(payload.employee?.username || "")
        .trim()
        .toLowerCase();
      if (!normalizedUsername)
        throw new Error("Username nhân viên không hợp lệ.");

      let lastConflict = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await prisma.$transaction(
            async (tx) => {
              const [record, account] = await Promise.all([
                tx.appConfig.findUnique({ where: { key: "attendanceData" } }),
                tx.user.findFirst({
                  where: {
                    username: {
                      equals: normalizedUsername,
                      mode: "insensitive",
                    },
                  },
                }),
              ]);
              if (!account)
                throw new Error(
                  "Username không thuộc tài khoản hiện có trong Quản trị.",
                );

              let attendanceData = {};
              try {
                attendanceData = record?.value ? JSON.parse(record.value) : {};
              } catch {}
              const employees = Array.isArray(attendanceData.employees)
                ? attendanceData.employees
                : [];
              let nextEmployees;

              if (mode === "edit") {
                const employeeId = Number(payload.employee?.id);
                const current = employees.find(
                  (employee) => Number(employee.id) === employeeId,
                );
                if (!current)
                  throw new Error(
                    "Hồ sơ đã thay đổi ở nơi khác. Hãy tải lại trước khi sửa.",
                  );
                if (
                  String(current.username || "")
                    .trim()
                    .toLowerCase() !== normalizedUsername
                ) {
                  throw new Error(
                    "Không thể đổi username hoặc mã của hồ sơ lương hiện có.",
                  );
                }
                const updated = {
                  ...current,
                  id: current.id,
                  username: current.username,
                  name: String(payload.employee?.name || "").trim(),
                  type:
                    payload.employee?.type === "Seasonal"
                      ? "Seasonal"
                      : "Official",
                  baseSalary: Math.max(
                    0,
                    Number(payload.employee?.baseSalary || 0),
                  ),
                  isHourly: payload.employee?.type === "Seasonal",
                  bankId: payload.employee?.bankId || undefined,
                  bankAccount:
                    String(payload.employee?.bankAccount || "").replace(
                      /\s+/g,
                      "",
                    ) || undefined,
                  bankAccountName:
                    String(payload.employee?.bankAccountName || "")
                      .trim()
                      .toUpperCase() || undefined,
                };
                if (!updated.name)
                  throw new Error("Họ tên nhân viên không được để trống.");
                nextEmployees = employees.map((employee) =>
                  Number(employee.id) === employeeId ? updated : employee,
                );
              } else {
                if (
                  employees.some(
                    (employee) =>
                      String(employee.username || "")
                        .trim()
                        .toLowerCase() === normalizedUsername,
                  )
                ) {
                  throw new Error("Tài khoản này đã có hồ sơ lương.");
                }
                const usedIds = new Set(
                  employees.map((employee) => Number(employee.id)),
                );
                let employeeId = Date.now();
                while (usedIds.has(employeeId)) employeeId++;
                const created = {
                  id: employeeId,
                  username: normalizedUsername,
                  name: String(
                    payload.employee?.name || account.fullName || "",
                  ).trim(),
                  type:
                    payload.employee?.type === "Seasonal"
                      ? "Seasonal"
                      : "Official",
                  baseSalary: Math.max(
                    0,
                    Number(payload.employee?.baseSalary || 0),
                  ),
                  isHourly: payload.employee?.type === "Seasonal",
                  bankId: payload.employee?.bankId || undefined,
                  bankAccount:
                    String(payload.employee?.bankAccount || "").replace(
                      /\s+/g,
                      "",
                    ) || undefined,
                  bankAccountName:
                    String(payload.employee?.bankAccountName || "")
                      .trim()
                      .toUpperCase() || undefined,
                };
                if (!created.name)
                  throw new Error("Họ tên nhân viên không được để trống.");
                nextEmployees = [...employees, created];
              }

              const backup = {
                createdAt: new Date().toISOString(),
                reason: `${mode}:${normalizedUsername}`,
                attendanceData,
              };
              await tx.appConfig.upsert({
                where: { key: "attendanceDataEmployeeBackup" },
                update: { value: JSON.stringify(backup) },
                create: {
                  key: "attendanceDataEmployeeBackup",
                  value: JSON.stringify(backup),
                },
              });
              await tx.appConfig.upsert({
                where: { key: "attendanceData" },
                update: {
                  value: JSON.stringify({
                    ...attendanceData,
                    employees: nextEmployees,
                  }),
                },
                create: {
                  key: "attendanceData",
                  value: JSON.stringify({
                    ...attendanceData,
                    employees: nextEmployees,
                  }),
                },
              });
              return nextEmployees;
            },
            { isolationLevel: "Serializable", timeout: 10000, maxWait: 10000 },
          );

          await logActivity({
            module: "attendance",
            action:
              mode === "create"
                ? "CREATE_EMPLOYEE_PROFILE"
                : "UPDATE_EMPLOYEE_PROFILE",
            description: `${mode === "create" ? "Tạo" : "Cập nhật"} hồ sơ lương ${normalizedUsername}`,
            recordName: normalizedUsername,
            severity: "WARNING",
          });
          return { success: true, data: result };
        } catch (error) {
          if (error?.code !== "P2034") throw error;
          lastConflict = error;
        }
      }
      throw (
        lastConflict ||
        new Error("Dữ liệu đang được cập nhật ở máy khác. Hãy thử lại.")
      );
    } catch (error) {
      console.error("❌ Save attendance employee profile error:", error);
      return { success: false, error: error.message };
    }
  },
);

// Đối soát toàn bộ lịch sử để bù các khoản phạt đi muộn từng bị sót.
ipcMain.handle("attendance:reconcileLateFines", async () => {
  try {
    requireRole("admin");
    const result = await reconcileLateAttendanceFines(prisma, {
      useHistoricalRates: true,
      repairReconciledAmounts: true,
      actor: currentSession.username,
    });
    return { success: true, data: result };
  } catch (err) {
    console.error("❌ attendance:reconcileLateFines error:", err.message);
    return { success: false, error: err.message };
  }
});

// Kiểm tra toàn bộ profiles — so sánh DB, disk, Python memory
// Trả về danh sách profiles ở từng nơi và highlight mismatch
ipcMain.handle("attendance:verifyAll", async () => {
  const result = {
    db: [],
    disk: [],
    pythonMemory: [],
    mismatches: [],
    serviceOnline: false,
  };
  try {
    // 1. DB
    const dbRows = await prisma.faceProfile.findMany({
      where: { isActive: true },
    });
    result.db = dbRows.map((r) => r.faceId);
  } catch (err) {
    console.error("[attendance] verifyAll DB error:", err.message);
  }
  try {
    // 2. Disk
    const facesRoot = path.join(app.getPath("userData"), "faces");
    if (fs.existsSync(facesRoot)) {
      result.disk = fs
        .readdirSync(facesRoot)
        .filter((name) =>
          fs.statSync(path.join(facesRoot, name)).isDirectory(),
        );
    }
  } catch (err) {
    console.error("[attendance] verifyAll disk error:", err.message);
  }
  try {
    // 3. Python memory
    const status = await faceServiceFetch("/status");
    if (!isValidFaceServiceStatus(status)) {
      throw new Error("Invalid attendance service status payload");
    }
    result.pythonMemory = status.face_ids || [];
    result.serviceOnline = true;
  } catch (_) {
    result.serviceOnline = false;
  }

  // So sánh tìm mismatch
  const allIds = new Set([
    ...result.db,
    ...result.disk,
    ...result.pythonMemory,
  ]);
  for (const id of allIds) {
    const inDb = result.db.includes(id);
    const inDisk = result.disk.includes(id);
    const inPython = result.serviceOnline
      ? result.pythonMemory.includes(id)
      : null;
    const isMismatch =
      inDb !== inDisk || (inPython !== null && inDb !== inPython);
    if (isMismatch) {
      result.mismatches.push({ face_id: id, inDb, inDisk, inPython });
    }
  }

  console.log("[attendance] verifyAll:", JSON.stringify(result, null, 2));
  return { success: true, ...result };
});

// Lấy danh sách profiles khuôn mặt
ipcMain.handle("attendance:getProfiles", async () => {
  try {
    const profiles = await prisma.faceProfile.findMany({
      where: { isActive: true },
    });
    return { success: true, data: profiles };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Xóa profile khuôn mặt
ipcMain.handle("attendance:deleteProfile", async (event, { face_id }) => {
  // Xóa Python encodings qua service
  try {
    await faceServiceFetch(`/profile/${encodeURIComponent(face_id)}`, {
      method: "DELETE",
    });
  } catch (err) {
    console.warn(
      "[attendance] Python delete failed, fallback to direct fs delete:",
      err.message,
    );
    // Fallback: service offline → xóa folder ảnh trực tiếp bằng fs
    // Tránh trường hợp DB xóa thành công nhưng ảnh vẫn còn trên disk
    try {
      const facesDir = path.join(app.getPath("userData"), "faces", face_id);
      if (fs.existsSync(facesDir)) {
        fs.rmSync(facesDir, { recursive: true, force: true });
        console.log("[attendance] Deleted face folder directly:", facesDir);
      }
    } catch (fsErr) {
      console.error("[attendance] fs delete also failed:", fsErr.message);
    }
  }
  // Luôn xóa DB record
  try {
    await prisma.faceProfile.updateMany({
      where: { faceId: face_id },
      data: { isActive: false },
    });
  } catch (err) {
    console.error("[attendance] DB delete failed:", err.message);
    return { success: false, error: err.message };
  }

  // Verify sau khi xóa — kiểm tra cả 3 nơi để chắc chắn sạch
  const verify = { db: false, disk: false, pythonMemory: false };
  try {
    const dbRecord = await prisma.faceProfile.findFirst({
      where: { faceId: face_id, isActive: true },
    });
    verify.db = dbRecord === null; // true = không còn record active
  } catch (_) {}
  try {
    const facesDir = path.join(app.getPath("userData"), "faces", face_id);
    verify.disk = !fs.existsSync(facesDir); // true = folder đã bị xóa
  } catch (_) {}
  try {
    const status = await faceServiceFetch("/status");
    if (!isValidFaceServiceStatus(status)) {
      throw new Error("Invalid attendance service status payload");
    }
    verify.pythonMemory = !status.face_ids?.includes(face_id); // true = không còn trong memory
  } catch (_) {
    verify.pythonMemory = null; // null = service offline, không kiểm tra được
  }

  const allClean =
    verify.db &&
    verify.disk &&
    (verify.pythonMemory === true || verify.pythonMemory === null);
  console.log(`[attendance] Delete verify for '${face_id}':`, verify);
  return { success: true, verify, allClean };
});

//
// OFFLINE QUEUE  Sync & Status handlers
//

// Tr� v� s� �n ang ch� sync
ipcMain.handle("offlineQueue:status", () => {
  return { success: true, pendingCount: offlineQueue.count() };
});

// Flush to�n b� queue l�n Supabase
ipcMain.handle("offlineQueue:sync", async () => {
  const items = offlineQueue.dequeueAll();
  if (items.length === 0) return { success: true, synced: 0, failed: 0 };

  let synced = 0,
    failed = 0;
  const errors = [];

  for (const item of items) {
    try {
      if (item.type === "ecommerceExports:update") {
        await execEcommerceExportUpdate(item.payload.id, item.payload.data);
        offlineQueue.remove(item._filename);
        synced++;
        console.log("[OfflineQueue] Synced:", item._filename);
      } else {
        // Unknown type  b� qua, x�a � kh�ng b� loop
        offlineQueue.remove(item._filename);
      }
    } catch (err) {
      failed++;
      errors.push({ file: item._filename, error: err.message });
      console.error(
        "[OfflineQueue] Sync failed for",
        item._filename,
        ":",
        err.message,
      );
      // Kh�ng x�a file  gi� l�i � retry l�n sau
    }
  }

  console.log(
    "[OfflineQueue] Sync complete  synced:",
    synced,
    "| failed:",
    failed,
    "| remaining:",
    offlineQueue.count(),
  );
  return {
    success: true,
    synced,
    failed,
    remaining: offlineQueue.count(),
    errors,
  };
});
