const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

async function syncDriveBackend() {
  const root = path.resolve(__dirname, "..");
  const config = require(path.join(root, "electron/config"));
  const tokenPath = process.env.GDRIVE_TOKEN_PATH || path.join(process.env.APPDATA, "quan-ly-ban-hang-desktop/gdrive-token.json");
  const tokens = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  if (!tokens.refresh_token || !String(tokens.scope || "").split(" ").includes("https://www.googleapis.com/auth/drive.file")) throw new Error("Token thieu refresh_token hoac quyen Drive.");
  const { google } = require("googleapis");
  const auth = new google.auth.OAuth2(config.OAUTH_CLIENT_ID, config.OAUTH_CLIENT_SECRET);
  auth.setCredentials(tokens);
  const drive = google.drive({ version: "v3", auth });
  await drive.about.get({ fields: "user(permissionId)" });
  const secret = {
    clientId: config.OAUTH_CLIENT_ID, clientSecret: config.OAUTH_CLIENT_SECRET,
    refreshToken: tokens.refresh_token, rootFolderId: config.GDRIVE_FOLDER_ID || "",
  };
  const wrangler = path.join(root, "cloudflare/r2-daily-evidence-worker/node_modules/wrangler/bin/wrangler.js");
  const child = spawnSync(process.execPath, [wrangler, "secret", "put", "GOOGLE_OAUTH_JSON", "--config", "cloudflare/drive-upload-worker/wrangler.jsonc"], {
    cwd: root, input: JSON.stringify(secret), encoding: "utf8", timeout: 120000,
  });
  if (child.status !== 0) throw new Error("Khong dong bo duoc token len Cloudflare. Kiem tra dang nhap Wrangler tren may dev va chay node scripts/sync-drive-backend.cjs de thu lai.");
  console.log("Google Drive: token da dong bo len Cloudflare; production khong can auth lai.");
}

module.exports = { syncDriveBackend };
if (require.main === module) syncDriveBackend().catch(() => { console.error("Drive sync failed. Verify dev Google consent and Cloudflare access, then retry."); process.exitCode = 1; });
