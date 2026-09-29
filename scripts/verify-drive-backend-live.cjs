const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const { endpoint } = require("../electron/drive-backend-config.json");

async function main() {
  if (!process.env.DATABASE_URL) {
    try { process.env.DATABASE_URL = require("../electron/config").DATABASE_URL; } catch {}
  }
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL for live verification");
  const prisma = new PrismaClient();
  let key;
  try {
    const user = await prisma.user.findFirst({
      where: { status: "active", forcePasswordChange: false },
      select: { id: true, passwordChangedAt: true },
    });
    if (!user) throw new Error("No active employee available for verification");
    const token = crypto.randomBytes(32).toString("hex");
    key = "driveUploadGrant:" + crypto.createHash("sha256").update(token).digest("hex");
    await prisma.appConfig.create({
      data: {
        key,
        value: JSON.stringify({ userId: user.id, passwordChangedAt: user.passwordChangedAt.getTime(), expiresAt: Date.now() + 60000 }),
      },
    });
    const response = await fetch(new URL("/drive", endpoint), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ operation: "about", args: {} }),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok || !result?.data?.user) throw new Error(`Worker about failed: HTTP ${response.status}`);
    const missingObject = `daily-tasks/${user.id}/${new Date().toISOString().slice(0, 10)}/${crypto.randomBytes(32).toString("hex")}.webp`;
    const r2Response = await fetch(`https://dby-pos-daily-evidence.zicky-iluv.workers.dev/objects/${encodeURIComponent(missingObject)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    });
    if (r2Response.status !== 404) throw new Error(`R2 grant verification failed: HTTP ${r2Response.status}`);
    await prisma.appConfig.deleteMany({ where: { key } });
    const revoked = await fetch(new URL("/drive", endpoint), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ operation: "about", args: {} }),
      signal: AbortSignal.timeout(30000),
    });
    if (revoked.status !== 401) throw new Error(`Revoked grant was accepted: HTTP ${revoked.status}`);
    console.log("SHARED_BACKENDS_LIVE_OK: employee grant, Hyperdrive, Google refresh, and R2 authorization succeeded");
  } finally {
    if (key) await prisma.appConfig.deleteMany({ where: { key } });
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
