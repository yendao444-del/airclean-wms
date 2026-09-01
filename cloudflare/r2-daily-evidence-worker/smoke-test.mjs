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
if (!removed.ok) throw new Error(`Cleanup failed: ${removed.status}`);

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
console.log(`R2 daily evidence smoke test passed: ${key}`);
