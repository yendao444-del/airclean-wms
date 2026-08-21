const fs = require("fs");
const path = require("path");

let developmentConfig = {};
try {
  developmentConfig = require("../electron/config");
} catch {
  // Production CI can provide the two values through environment variables.
}

const clientId = String(
  process.env.OAUTH_CLIENT_ID || developmentConfig.OAUTH_CLIENT_ID || "",
).trim();
const clientSecret = String(
  process.env.OAUTH_CLIENT_SECRET ||
    developmentConfig.OAUTH_CLIENT_SECRET ||
    "",
).trim();

if (!clientId || !clientSecret) {
  console.error(
    "[Google OAuth] Missing OAUTH_CLIENT_ID or OAUTH_CLIENT_SECRET.",
  );
  process.exit(1);
}

if (!clientId.endsWith(".apps.googleusercontent.com")) {
  console.error("[Google OAuth] OAUTH_CLIENT_ID has an invalid format.");
  process.exit(1);
}

const outputPath = path.join(
  __dirname,
  "..",
  "electron",
  "google-oauth-config.json",
);
fs.writeFileSync(
  outputPath,
  JSON.stringify({ clientId, clientSecret }, null, 2),
  { encoding: "utf8", mode: 0o600 },
);
console.log("[Google OAuth] Packaged desktop OAuth config is ready.");
