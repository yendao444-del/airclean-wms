const fs = require("fs");
const path = require("path");
const stage = path.resolve(process.argv[2] || "");
const source = path.resolve(__dirname, "../electron");
if (!process.argv[2] || stage === source || !fs.existsSync(path.join(stage, "ipc-handlers.js"))) {
  throw new Error("Expected staged electron directory, never the source directory");
}
const config = JSON.parse(fs.readFileSync(path.join(stage, "drive-backend-config.json"), "utf8"));
if (new URL(config.endpoint).protocol !== "https:" || !fs.existsSync(path.join(stage, "drive-backend.js"))) throw new Error("Missing Drive backend runtime");
for (const name of ["gdrive-token.json", "gdrive-token.bin", "gdrive-credentials.json", "google-oauth-config.json", "r2-daily-evidence-bootstrap.json"]) {
  fs.rmSync(path.join(stage, name), { force: true });
}
console.log("Shared backends staged: HTTPS endpoint present; Google and R2 credentials excluded.");
