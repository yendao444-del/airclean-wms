export interface Env {
  R2_TEST_BUCKET: R2Bucket;
  R2_TEST_KEY: string;
  ALLOWED_ORIGIN?: string;
}

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_TEST_STORAGE_BYTES = 500 * 1024 * 1024;
const MAX_TEST_OBJECTS = 500;

const json = (body: unknown, status = 200, origin = "*") =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "content-type,x-r2-test-key",
      "access-control-allow-methods": "GET,HEAD,POST,DELETE,OPTIONS",
    },
  });

function corsHeaders(origin: string) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type,x-r2-test-key",
    "access-control-allow-methods": "GET,HEAD,POST,DELETE,OPTIONS",
  };
}

function authorized(request: Request, env: Env) {
  return Boolean(env.R2_TEST_KEY) && request.headers.get("x-r2-test-key") === env.R2_TEST_KEY;
}

function objectKey(pathname: string) {
  const key = decodeURIComponent(pathname.replace(/^\/objects\//, "")).replace(/^\/+/, "");
  return key && key.length <= 512 && !key.includes("..") ? key : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN || "*";
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") return json({ ok: true, service: "dby-pos-r2-test", timestamp: new Date().toISOString() }, 200, origin);
    if (!authorized(request, env)) return json({ ok: false, error: "Unauthorized test request" }, 401, origin);
    if (url.pathname === "/objects" && request.method === "GET") {
      const listed = await env.R2_TEST_BUCKET.list({ prefix: "test/", limit: 100 });
      return json({ ok: true, objects: listed.objects.map((item) => ({ key: item.key, size: item.size, uploaded: item.uploaded })) }, 200, origin);
    }
    if (!url.pathname.startsWith("/objects/")) return json({ ok: false, error: "Not found" }, 404, origin);
    const key = objectKey(url.pathname);
    if (!key) return json({ ok: false, error: "Invalid object key" }, 400, origin);
    if (request.method === "POST") {
      const contentLength = Number(request.headers.get("content-length") || 0);
      if (contentLength > MAX_UPLOAD_BYTES) return json({ ok: false, error: "File exceeds 15 MB" }, 413, origin);
      const contentType = request.headers.get("content-type") || "application/octet-stream";
      if (contentType.startsWith("image/") && contentLength >= MAX_IMAGE_BYTES) {
        return json({ ok: false, error: "Images must be compressed below 1 MB before upload" }, 413, origin);
      }
      const body = await request.arrayBuffer();
      if (!body.byteLength || body.byteLength > MAX_UPLOAD_BYTES) return json({ ok: false, error: "File is empty or exceeds 15 MB" }, 413, origin);
      if (contentType.startsWith("image/") && body.byteLength >= MAX_IMAGE_BYTES) {
        return json({ ok: false, error: "Images must be compressed below 1 MB before upload" }, 413, origin);
      }
      const usage = await env.R2_TEST_BUCKET.list({ prefix: "test/", limit: 501 });
      const usedBytes = usage.objects.reduce((sum, item) => sum + item.size, 0);
      if (usage.objects.length >= MAX_TEST_OBJECTS || usage.truncated || usedBytes + body.byteLength > MAX_TEST_STORAGE_BYTES) {
        return json({ ok: false, error: "Staging quota reached (500 files or 500 MB)" }, 507, origin);
      }
      const uploaded = await env.R2_TEST_BUCKET.put(key, body, { httpMetadata: { contentType }, customMetadata: { source: "dby-pos-r2-test" } });
      return json({ ok: true, key, size: uploaded?.size || body.byteLength }, 201, origin);
    }
    if (request.method === "GET" || request.method === "HEAD") {
      const object = await env.R2_TEST_BUCKET.get(key);
      if (!object) return json({ ok: false, error: "Object not found" }, 404, origin);
      const headers = new Headers(corsHeaders(origin));
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("cache-control", "private, max-age=60");
      return request.method === "HEAD" ? new Response(null, { headers }) : new Response(object.body, { headers });
    }
    if (request.method === "DELETE") {
      await env.R2_TEST_BUCKET.delete(key);
      return json({ ok: true, key, deleted: true }, 200, origin);
    }
    return json({ ok: false, error: "Method not allowed" }, 405, origin);
  },
};
