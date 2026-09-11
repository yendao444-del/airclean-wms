import crypto from "node:crypto";
import fs from "node:fs";

const endpoint = String(process.env.R2_DAILY_EVIDENCE_ENDPOINT || "").replace(/\/+$/, "");
const secret = String(process.env.R2_DAILY_EVIDENCE_KEY || "");
if (!endpoint || !secret) throw new Error("R2 daily evidence configuration is missing.");

const body = process.env.R2_SMOKE_FILE
  ? fs.readFileSync(process.env.R2_SMOKE_FILE)
  : Buffer.from("RIFF\u0004\u0000\u0000\u0000WEBP", "binary");
const hash = crypto.createHash("sha256").update(body).digest("hex");
const key = `daily-tasks/1/2026-08-27/${hash}.webp`;
const objectUrl = `${endpoint}/objects/${encodeURIComponent(key)}`;
const headers = {
  authorization: `Bearer ${secret}`,
  "content-type": "image/webp",
  "content-length": String(body.length),
  "x-content-sha256": hash,
};

const upload = await fetch(objectUrl, { method: "POST", headers, body });
if (!upload.ok) throw new Error(`Upload failed: ${upload.status} ${await upload.text()}`);
const download = await fetch(objectUrl, { headers: { authorization: `Bearer ${secret}` } });
if (!download.ok) throw new Error(`Download failed: ${download.status}`);
const downloaded = Buffer.from(await download.arrayBuffer());
if (!downloaded.equals(body)) throw new Error("Downloaded bytes do not match upload.");
const removed = await fetch(objectUrl, { method: "DELETE", headers: { authorization: `Bearer ${secret}` } });
if (removed.status !== 423) throw new Error(`Expected data-safety delete block, got: ${removed.status}`);

const receiptBody = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const receiptHash = crypto.createHash("sha256").update(receiptBody).digest("hex");
const receiptKey = `purchase-receipts/smoke-test/${receiptHash}.jpg`;
const receiptUrl = `${endpoint}/objects/${encodeURIComponent(receiptKey)}`;
const receiptHeaders = {
  authorization: `Bearer ${secret}`,
  "content-type": "image/jpeg",
  "content-length": String(receiptBody.length),
  "x-content-sha256": receiptHash,
};
const receiptUpload = await fetch(receiptUrl, { method: "POST", headers: receiptHeaders, body: receiptBody });
if (!receiptUpload.ok) throw new Error(`Receipt upload failed: ${receiptUpload.status} ${await receiptUpload.text()}`);
const receiptDownload = await fetch(receiptUrl, { headers: { authorization: `Bearer ${secret}` } });
if (!receiptDownload.ok) throw new Error(`Receipt download failed: ${receiptDownload.status}`);
if (!Buffer.from(await receiptDownload.arrayBuffer()).equals(receiptBody)) {
  throw new Error("Downloaded receipt bytes do not match upload.");
}

const oversizedBody = Buffer.alloc(500 * 1024);
const oversizedHash = crypto.createHash("sha256").update(oversizedBody).digest("hex");
const oversizedKey = `daily-tasks/1/2026-08-27/${oversizedHash}.webp`;
const oversizedResponse = await fetch(`${endpoint}/objects/${encodeURIComponent(oversizedKey)}`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${secret}`,
    "content-type": "image/webp",
    "content-length": String(oversizedBody.length),
    "x-content-sha256": oversizedHash,
  },
  body: oversizedBody,
});
if (oversizedResponse.status !== 413) {
  throw new Error(`Expected a 500 KB image to be rejected, got ${oversizedResponse.status}.`);
}
console.log(`R2 smoke test passed for daily evidence and purchase receipts: ${key}`);
