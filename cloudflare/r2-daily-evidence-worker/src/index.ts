const MAX_IMAGE_BYTES = 500 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EVIDENCE_KEY_PATTERN = /^daily-tasks\/\d+\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{64}\.(?:jpg|png|webp)$/;
const DATA_SAFETY_MODE = true;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

async function digest(value: string) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function authorized(request: Request, secret: string) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !secret) return false;
  const [actual, expected] = await Promise.all([digest(token), digest(secret)]);
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < Math.max(actual.length, expected.length); index += 1) {
    difference |= (actual[index] || 0) ^ (expected[index] || 0);
  }
  return difference === 0;
}

function getObjectKey(pathname: string) {
  if (!pathname.startsWith("/objects/")) return null;
  try {
    const key = decodeURIComponent(pathname.slice("/objects/".length));
    return EVIDENCE_KEY_PATTERN.test(key) ? key : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "dby-pos-daily-evidence" });
    }
    if (!(await authorized(request, env.DAILY_EVIDENCE_KEY))) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const key = getObjectKey(url.pathname);
    if (!key) return json({ ok: false, error: "Invalid evidence key" }, 400);

    if (request.method === "POST") {
      const contentType = request.headers.get("content-type") || "";
      const contentLength = Number(request.headers.get("content-length") || 0);
      const sha256 = request.headers.get("x-content-sha256") || "";
      if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
        return json({ ok: false, error: "Unsupported image type" }, 415);
      }
      if (!Number.isInteger(contentLength) || contentLength <= 0) {
        return json({ ok: false, error: "Content-Length is required" }, 411);
      }
      if (contentLength >= MAX_IMAGE_BYTES) {
        return json({ ok: false, error: "Evidence image must be below 500 KB" }, 413);
      }
      if (!/^[a-f0-9]{64}$/.test(sha256) || !key.includes(`/${sha256}.`)) {
        return json({ ok: false, error: "Invalid content checksum" }, 400);
      }

      const body = await request.arrayBuffer();
      if (body.byteLength !== contentLength || body.byteLength >= MAX_IMAGE_BYTES) {
        return json({ ok: false, error: "Invalid image size" }, 413);
      }
      if (DATA_SAFETY_MODE) {
        const existing = await env.DAILY_EVIDENCE_BUCKET.head(key);
        if (existing) {
          return json({ ok: true, key, size: existing.size, preserved: true });
        }
      }
      const uploaded = await env.DAILY_EVIDENCE_BUCKET.put(key, body, {
        httpMetadata: { contentType },
        customMetadata: { source: "dby-pos-daily-tasks" },
        sha256,
      });
      return json({ ok: true, key, size: uploaded?.size || body.byteLength }, 201);
    }

    if (request.method === "GET" || request.method === "HEAD") {
      const object = await env.DAILY_EVIDENCE_BUCKET.get(key);
      if (!object) return json({ ok: false, error: "Evidence not found" }, 404);
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("cache-control", "private, no-store");
      return request.method === "HEAD"
        ? new Response(null, { headers })
        : new Response(object.body, { headers });
    }

    if (request.method === "DELETE") {
      if (DATA_SAFETY_MODE) {
        return json({ ok: false, blocked: true, error: "Deletion is disabled by data-safety mode" }, 423);
      }
      await env.DAILY_EVIDENCE_BUCKET.delete(key);
      return json({ ok: true, key, deleted: true });
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  },
} satisfies ExportedHandler<Env>;
