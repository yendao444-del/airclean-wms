const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const archivePath = path.resolve(process.argv[2] || "");
if (!archivePath || !fs.existsSync(archivePath)) {
  console.error(`[Release archive] Missing archive: ${archivePath || "(none)"}`);
  process.exit(1);
}

const forbiddenNames = [
  /(^|[\\/])\.env(?:\.|$)/i,
  /(^|[\\/])(?:config|supabase-storage|gdrive-token|gdrive-credentials|google-oauth-config|r2-daily-evidence-bootstrap|wms-bot-runtime)\.json?$/i,
  /(^|[\\/])(?:.*credentials.*|.*private.*key.*)\.(?:json|pem|key|p12|pfx)$/i,
  /(^|[\\/])[^/\\]*(?:\.db|\.sqlite|\.backup[^/\\]*\.json)$/i,
];

const secretPatterns = [
  /ya29\.[A-Za-z0-9_-]{20,}/,
  /"refresh_token"\s*:\s*"[^"\r\n]{20,}/,
  /sb_secret_[A-Za-z0-9_-]{10,}/,
  /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/i,
  /\b\d{8,10}:[A-Za-z0-9_-]{20,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

let zip;
try {
  zip = new AdmZip(archivePath);
} catch (error) {
  console.error(`[Release archive] Invalid ZIP: ${error.message}`);
  process.exit(1);
}

const findings = [];
for (const entry of zip.getEntries()) {
  const normalized = entry.entryName.replace(/\\/g, "/");
  if (forbiddenNames.some((pattern) => pattern.test(normalized))) {
    findings.push(`${normalized}: forbidden credential/data filename`);
    continue;
  }
  if (entry.isDirectory || entry.header.size > 2 * 1024 * 1024) continue;
  const content = entry.getData();
  if (content.includes(0)) continue;
  const text = content.toString("utf8");
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) {
      findings.push(`${normalized}: secret pattern`);
      break;
    }
  }
}

if (findings.length > 0) {
  console.error("[Release archive] BLOCKED: sensitive content detected:");
  for (const finding of findings.slice(0, 30)) console.error(`  - ${finding}`);
  if (findings.length > 30) console.error(`  - ... and ${findings.length - 30} more`);
  process.exit(1);
}

console.log(`[Release archive] OK: no credential or database artifacts in ${path.basename(archivePath)}`);
