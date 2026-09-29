const crypto = require("crypto");

function createDriveBackend({ endpoint, getPrisma, getSession, fetchImpl = fetch }) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw new Error("Drive backend requires HTTPS");
  let grant = null;
  let pending = null;
  let generation = 0;
  async function revoke() {
    generation += 1;
    const old = grant;
    grant = null;
    if (old) await getPrisma().appConfig.deleteMany({ where: { key: old.key } });
  }
  async function getGrant() {
    const session = getSession();
    if (!session?.id || session.mustChangePassword) throw new Error("Vui long dang nhap va hoan tat doi mat khau truoc khi upload.");
    if (grant?.userId === session.id && grant.passwordChangedAt === session.passwordChangedAt && grant.expiresAt > Date.now() + 30000) return grant.token;
    if (pending) { await pending; return getGrant(); }
    pending = (async () => {
      await revoke();
      const startedGeneration = generation;
      const token = crypto.randomBytes(32).toString("hex");
      const key = "driveUploadGrant:" + crypto.createHash("sha256").update(token).digest("hex");
      const value = { userId: session.id, passwordChangedAt: session.passwordChangedAt, expiresAt: Date.now() + 5 * 60 * 1000 };
      await getPrisma().appConfig.create({ data: { key, value: JSON.stringify(value) } });
      if (generation !== startedGeneration || getSession()?.id !== session.id || getSession()?.passwordChangedAt !== session.passwordChangedAt || getSession()?.mustChangePassword) {
        await getPrisma().appConfig.deleteMany({ where: { key } });
        throw new Error("Phien dang nhap da thay doi.");
      }
      grant = { ...value, key, token };
    })();
    try { await pending; } finally { pending = null; }
    return grant.token;
  }
  async function call(operation, args = {}) {
    const response = await fetchImpl(new URL("/drive", url), {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await getGrant()}` },
      body: JSON.stringify({ operation, args }), signal: AbortSignal.timeout(60000),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) await revoke();
      throw new Error(result.error || "Khong the ket noi backend Google Drive.");
    }
    return { data: result.data };
  }
  return {
    revoke,
    getSessionGrant: getGrant,
    about: { get: () => call("about") },
    files: {
      list: args => call("list", args),
      async create(args) {
        if (!args.media) return call("create", args);
        const chunks = []; let size = 0;
        for await (const chunk of args.media.body) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > 20 * 1024 * 1024) throw new Error("File vuot qua 20 MB.");
          chunks.push(buffer);
        }
        return call("create", { requestBody: args.requestBody, media: { mimeType: args.media.mimeType, base64: Buffer.concat(chunks).toString("base64") } });
      },
      async get(args) {
        const result = await call("get", args);
        return { data: Buffer.from(result.data.base64, "base64") };
      },
    },
    permissions: { create: args => call("permission", args) },
  };
}

module.exports = { createDriveBackend };
