const fs = require("fs");
const path = require("path");

const tokenPath = path.resolve(process.argv[2] || "electron/gdrive-token.json");

function fail(message) {
  console.error(`[Google Drive token] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(tokenPath)) fail(`Missing token file: ${tokenPath}`);

let tokens;
try {
  tokens = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
} catch (error) {
  fail(`Invalid JSON: ${error.message}`);
}

if (!String(tokens.refresh_token || "").trim()) {
  fail("refresh_token is missing. Run reauth-gdrive.bat before releasing.");
}

if (!String(tokens.scope || "").includes("https://www.googleapis.com/auth/drive.file")) {
  fail("Google Drive scope is missing. Run reauth-gdrive.bat again.");
}

console.log(`[Google Drive token] Ready: ${tokenPath}`);
