import { createHash } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsPDF } from 'jspdf';

const endpoint = String(process.env.R2_TEST_ENDPOINT || '').replace(/\/+$/, '');
const testKey = process.env.R2_TEST_KEY || '';
const statePath = join(tmpdir(), 'dby-r2-criteria-state.json');
const mode = process.argv[2] || 'seed';

if (!endpoint || !testKey) {
  console.error('Set R2_TEST_ENDPOINT and R2_TEST_KEY before running the criteria test.');
  process.exit(2);
}

const headers = { 'x-r2-test-key': testKey };

async function request(path, init = {}, expectedStatus = 200) {
  const response = await fetch(`${endpoint}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${init.method || 'GET'} ${path}: expected HTTP ${expectedStatus}, got ${response.status} ${await response.text()}`);
  }
  return response;
}

const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function seed() {
  const stamp = Date.now();
  const imagePath = fileURLToPath(new URL('../../anh san pham/ai-generated-source/electron-webp-archive/01-5d-unicare.webp', import.meta.url));
  const image = await readFile(imagePath);
  const pdf = new jsPDF();
  pdf.setFontSize(18);
  pdf.text('DBY POS R2 preview test', 20, 30);
  pdf.setFontSize(11);
  pdf.text(`Created: ${new Date(stamp).toISOString()}`, 20, 42);
  const pdfBuffer = Buffer.from(pdf.output('arraybuffer'));
  const objects = [
    { key: `test/criteria-${stamp}.webp`, body: image, type: 'image/webp' },
    { key: `test/criteria-${stamp}.pdf`, body: pdfBuffer, type: 'application/pdf' },
  ];

  for (const object of objects) {
    await request(`/objects/${encodeURIComponent(object.key)}`, {
      method: 'POST',
      body: object.body,
      headers: { 'content-type': object.type },
    }, 201);
    const downloaded = Buffer.from(await (await request(`/objects/${encodeURIComponent(object.key)}`)).arrayBuffer());
    if (hash(downloaded) !== hash(object.body)) throw new Error(`Hash mismatch for ${object.key}`);
  }

  await request(`/objects/${encodeURIComponent(`test/criteria-too-large-image-${stamp}.png`)}`, {
    method: 'POST',
    body: Buffer.alloc(1024 * 1024),
    headers: { 'content-type': 'image/png' },
  }, 413);
  await request(`/objects/${encodeURIComponent(`test/criteria-too-large-file-${stamp}.bin`)}`, {
    method: 'POST',
    body: Buffer.alloc(15 * 1024 * 1024 + 1),
    headers: { 'content-type': 'application/octet-stream' },
  }, 413);

  const state = {
    createdAt: new Date(stamp).toISOString(),
    objects: objects.map((object) => ({ key: object.key, hash: hash(object.body), type: object.type })),
  };
  await writeFile(statePath, JSON.stringify(state, null, 2));
  console.log(JSON.stringify({ passed: true, statePath, ...state }, null, 2));
}

async function verify({ cleanup = false } = {}) {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  for (const object of state.objects) {
    const downloaded = Buffer.from(await (await request(`/objects/${encodeURIComponent(object.key)}`)).arrayBuffer());
    if (hash(downloaded) !== object.hash) throw new Error(`Persisted hash mismatch for ${object.key}`);
    if (cleanup) await request(`/objects/${encodeURIComponent(object.key)}`, { method: 'DELETE' });
  }
  if (cleanup) await unlink(statePath).catch(() => {});
  console.log(JSON.stringify({ passed: true, cleanup, objects: state.objects }, null, 2));
}

if (mode === 'seed') await seed();
else if (mode === 'verify') await verify();
else if (mode === 'cleanup') await verify({ cleanup: true });
else throw new Error(`Unknown mode: ${mode}`);
