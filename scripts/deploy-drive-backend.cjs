const path = require("path");
const { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const wrangler = path.join(root, "cloudflare/r2-daily-evidence-worker/node_modules/wrangler/bin/wrangler.js");
const configPath = "cloudflare/drive-upload-worker/wrangler.jsonc";

async function main() {
  const deployed = spawnSync(process.execPath, [wrangler, "deploy", "--config", configPath], { cwd: root, stdio: "inherit", timeout: 120000 });
  if (deployed.status !== 0) throw new Error("Worker deployment failed");
  console.log("Drive Worker deployed. Hyperdrive and Google secrets remain server-side.");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
