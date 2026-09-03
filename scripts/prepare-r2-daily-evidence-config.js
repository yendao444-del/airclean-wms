const fs = require("fs");
const path = require("path");

function readKeyValueFile(filePath) {
  try {
    const values = {};
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
    return values;
  } catch {
    return {};
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) || {};
  } catch {
    return {};
  }
}

let localConfig = {};
try {
  localConfig = require("../electron/config");
} catch {
  // Production release machines may provide the values through environment variables.
}

const workerVars = readKeyValueFile(
  path.join(__dirname, "..", "cloudflare", "r2-daily-evidence-worker", ".dev.vars"),
);
const legacyBootstrap = readJsonFile(
  path.join(
    process.env.APPDATA || "",
    "quan-ly-ban-hang-desktop",
    "r2-test-bootstrap.json",
  ),
);
const currentBootstrap = readJsonFile(
  path.join(
    process.env.APPDATA || "",
    "quan-ly-ban-hang-desktop",
    "r2-daily-evidence-bootstrap.json",
  ),
);
const endpoint = String(
  process.env.R2_DAILY_EVIDENCE_ENDPOINT ||
    localConfig.R2_DAILY_EVIDENCE_ENDPOINT ||
    currentBootstrap.endpoint ||
    workerVars.R2_DAILY_EVIDENCE_ENDPOINT ||
    "https://dby-pos-daily-evidence.zicky-iluv.workers.dev",
).trim().replace(/\/+$/, "");
const key = String(
  process.env.R2_DAILY_EVIDENCE_KEY ||
    localConfig.R2_DAILY_EVIDENCE_KEY ||
    currentBootstrap.key ||
    legacyBootstrap.testKey ||
    workerVars.DAILY_EVIDENCE_KEY ||
    "",
).trim();

if (!/^https:\/\//i.test(endpoint) || !key || /^development-only$/i.test(key)) {
  console.error("[R2 daily evidence] Missing R2_DAILY_EVIDENCE_KEY or endpoint.");
  process.exit(1);
}

const outputPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, "..", "electron", "r2-daily-evidence-bootstrap.json");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  JSON.stringify({ endpoint, key }, null, 2) + "\n",
  { encoding: "utf8", mode: 0o600 },
);
console.log(`[R2 daily evidence] Bootstrap config prepared at ${outputPath}`);
