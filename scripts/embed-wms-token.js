const fs = require("fs");
const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, "..", ".env"),
  quiet: true,
});

const token = String(process.env.TELEGRAM_WMS_BOT_TOKEN || "").trim();
if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
  throw new Error(
    "Thiếu TELEGRAM_WMS_BOT_TOKEN hợp lệ trong .env; dừng đóng gói để tránh phát hành bản production không có bot WMS.",
  );
}

const outputPath = path.join(__dirname, "..", "electron", "wms-bot-runtime.js");
const encodedToken = Buffer.from(token, "utf8").toString("base64");
const source = [
  "// Generated during electron:build. Do not commit this file.",
  `module.exports = Buffer.from(${JSON.stringify(encodedToken)}, "base64").toString("utf8");`,
  "",
].join("\n");

fs.writeFileSync(outputPath, source, { encoding: "utf8", mode: 0o600 });
console.log("[Build] Embedded Telegram WMS token into the desktop package.");
