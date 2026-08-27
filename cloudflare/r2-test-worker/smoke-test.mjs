const endpoint = String(process.env.R2_TEST_ENDPOINT || '').replace(/\/+$/, '');
const testKey = process.env.R2_TEST_KEY || '';
if (!endpoint || !testKey) {
  console.error('Set R2_TEST_ENDPOINT and R2_TEST_KEY before running the smoke test.');
  process.exit(2);
}

const headers = { 'x-r2-test-key': testKey };
const key = `test/smoke-${Date.now()}.txt`;
const body = 'DBY POS R2 smoke test';

async function request(path, init = {}) {
  const response = await fetch(`${endpoint}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${path}: HTTP ${response.status} ${await response.text()}`);
  return response;
}

await request('/health', { headers: {} });
await request(`/objects/${encodeURIComponent(key)}`, { method: 'POST', body, headers: { 'content-type': 'text/plain; charset=utf-8' } });
const downloaded = await (await request(`/objects/${encodeURIComponent(key)}`)).text();
if (downloaded !== body) throw new Error(`Downloaded body mismatch: ${downloaded}`);
await request(`/objects/${encodeURIComponent(key)}`, { method: 'DELETE' });
console.log(`R2 smoke test passed: ${key}`);
