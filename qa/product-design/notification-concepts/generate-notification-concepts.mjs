import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const scriptPath = fileURLToPath(import.meta.url);

if (args[0] === '--parallel') {
  const manifestPath = args[1];
  const entries = JSON.parse(await fs.readFile(path.resolve(manifestPath), 'utf8'));
  const failures = [];
  let remaining = entries.length;

  await new Promise((resolve) => {
    for (const entry of entries) {
      const child = spawn(process.execPath, [scriptPath, entry.outputName, entry.direction], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => failures.push(`${entry.outputName}: ${error.message}`));
      child.on('close', (code) => {
        if (code === 0) process.stdout.write(stdout);
        else failures.push(`${entry.outputName}: ${stderr || stdout || `exit code ${code}`}`);
        remaining -= 1;
        if (remaining === 0) resolve();
      });
    }
  });

  if (failures.length > 0) throw new Error(failures.join('\n'));
  process.exit(0);
}

const [outputName, direction] = args;
if (!outputName || !direction) {
  throw new Error('Usage: node generate-notification-concepts.mjs <output> <direction>');
}

const references = await Promise.all([
  fs.readFile(path.resolve('qa/product-design/reward-redesign-self-list.png')),
  fs.readFile(path.resolve('qa/product-design/attendance-minimal-ledger.png')),
]);
const startedAt = Date.now();

const prompt = `Use case: ui-mockup
Asset type: high-fidelity desktop application concept
Primary request: Design a focused Vietnamese notification experience for the existing DBY Software POS / AIRCLEAN WMS desktop app. The notification system announces new employee policies about rewards, penalties, payroll funds, and salary mechanisms. This direction is: ${direction}
Input images: Image 1 is the primary product-shell and visual-language reference. Image 2 is the typography, payroll information, spacing, and green accent reference. Preserve their restrained white-and-green enterprise character, desktop density, Vietnamese language, thin gray dividers, and existing navigation style.
Target dimensions: 1536 x 1024 desktop app frame.
Current date anchor: 07/09/2026.
Content: Use realistic Vietnamese copy such as "Cập nhật cơ chế thưởng đóng gói tháng 09/2026", "Hiệu lực từ 10/09/2026", "Cần xác nhận", "Quỹ lương", "Thưởng", "Phạt", and "Tôi đã đọc và hiểu". Make the policy version and effective date unmistakable. Show that personal salary amounts remain private.
Style/medium: realistic production-quality UI, not a wireframe; crisp typography; green #00AB56 family, white and warm neutral surfaces; Ant Design-compatible controls and icons.
Composition/framing: one focused primary screen with one clear primary action and at most two supporting content areas. Use spacing, alignment and typography before borders or shadows. Avoid nested cards and avoid filling the screen with feature inventory.
Constraints: Vietnamese text must be legible; no mobile frame; no browser chrome; no dark mode; no gradients; no illustration; no emojis; no purple; no excessive metrics; no fake logo; no watermark; no collage; no multiple concepts in one image.`;

const headers = { 'Content-Type': 'application/json' };
if (process.env.NINEROUTER_KEY) headers.Authorization = `Bearer ${process.env.NINEROUTER_KEY}`;

const response = await fetch(`${process.env.NINEROUTER_URL}/v1/images/generations`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model: 'cx/gpt-5.5-image',
    prompt,
    images: references.map((reference) => `data:image/png;base64,${reference.toString('base64')}`),
    size: '1536x1024',
    quality: 'high',
    image_detail: 'high',
    output_format: 'png',
    response_format: 'b64_json',
  }),
});

if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
const payload = await response.json();
const item = payload.data?.[0];
let bytes;
if (item?.b64_json) bytes = Buffer.from(item.b64_json, 'base64');
else if (item?.url) bytes = Buffer.from(await (await fetch(item.url)).arrayBuffer());
else throw new Error(`No image returned: ${JSON.stringify(payload).slice(0, 1000)}`);

const outputPath = path.resolve('qa/product-design/notification-concepts', outputName);
await fs.writeFile(outputPath, bytes);
console.log(`${outputPath}\t${Math.round((Date.now() - startedAt) / 1000)}s`);
