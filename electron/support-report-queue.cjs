const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let queueDir = null;

function init(userDataPath) {
  queueDir = path.join(userDataPath, "support-report-queue");
  fs.mkdirSync(queueDir, { recursive: true });
}

function enqueue(payload) {
  if (!queueDir) throw new Error("[SupportReport] Queue chưa được khởi tạo");
  if (!payload || typeof payload !== "object") throw new Error("[SupportReport] Payload không hợp lệ");
  const filename = `${Date.now()}_${crypto.randomUUID()}.json`;
  const item = {
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
  };
  const finalPath = path.join(queueDir, filename);
  const tempPath = `${finalPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(item), "utf8");
  fs.renameSync(tempPath, finalPath);
  return filename;
}

function dequeueReady() {
  if (!queueDir) return [];
  return fs.readdirSync(queueDir)
    .filter((filename) => filename.endsWith(".json"))
    .sort()
    .map((filename) => {
      try {
        const item = JSON.parse(fs.readFileSync(path.join(queueDir, filename), "utf8"));
        if (item.nextAttemptAt && new Date(item.nextAttemptAt).getTime() > Date.now()) return null;
        return { ...item, _filename: filename };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function remove(filename) {
  if (!queueDir || path.basename(filename) !== filename || !filename.endsWith(".json")) return;
  fs.rmSync(path.join(queueDir, filename), { force: true });
}

function markFailure(filename, errorMessage) {
  if (!queueDir || path.basename(filename) !== filename || !filename.endsWith(".json")) return;
  const finalPath = path.join(queueDir, filename);
  try {
    const item = JSON.parse(fs.readFileSync(finalPath, "utf8"));
    const attempts = Math.min(20, Number(item.attempts || 0) + 1);
    const delayMs = Math.min(30 * 60 * 1000, 1000 * (2 ** Math.min(attempts, 10)));
    const next = {
      ...item,
      attempts,
      lastError: String(errorMessage || "Lỗi không xác định").slice(0, 500),
      nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
    };
    const tempPath = `${finalPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(next), "utf8");
    fs.renameSync(tempPath, finalPath);
  } catch {}
}

function count() {
  if (!queueDir) return 0;
  try { return fs.readdirSync(queueDir).filter((filename) => filename.endsWith(".json")).length; } catch { return 0; }
}

module.exports = { init, enqueue, dequeueReady, remove, markFailure, count };
