import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const scriptPath = fileURLToPath(import.meta.url);

if (args[0] === '--parallel') {
  const entries = JSON.parse(await fs.readFile(path.resolve(args[1]), 'utf8'));
  const failures = [];
  let remaining = entries.length;
  await new Promise((resolve) => {
    for (const entry of entries) {
      const child = spawn(process.execPath, [scriptPath, entry.outputName, entry.direction], {
        cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
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
  if (failures.length) throw new Error(failures.join('\n'));
  process.exit(0);
}

const [outputName, direction] = args;
if (!outputName || !direction) throw new Error('Missing output name or direction');

const referencePaths = [
  'qa/product-design/reward-redesign-self-list.png',
  'qa/product-design/notification-system-v2/notification-system-overlay-inbox.png',
  'qa/product-design/notification-concepts/notification-policy-hub.png',
];
const references = await Promise.all(referencePaths.map((item) => fs.readFile(path.resolve(item))));
const startedAt = Date.now();

const prompt = `Use case: ui-mockup
Asset type: production-quality desktop application module concept
Primary request: Design the dedicated global module "Thông báo nội bộ" for DBY Software POS / AIRCLEAN WMS. This is an app-wide module for company announcements, operating policies, rewards, penalties, payroll funds and general system notices. It must NOT look like part of Bảng công, payroll, attendance, or any single business module. This direction is: ${direction}
Input images: Image 1 is the app-shell and green-white enterprise visual reference only. Image 2 supplies notification interactions. Image 3 supplies the reading and acknowledgement pattern. Do not preserve their Bảng công context. Replace it with a standalone notification module selected in the main left navigation.
Target dimensions: 1536 x 1024 desktop app frame.
Current date anchor: 07/09/2026.
Global architecture visible in the frame: a bell with unread badge remains in the top application header; the left sidebar has a distinct selected item "Thông báo nội bộ"; the page title is "Thông báo nội bộ" or "Trung tâm thông báo"; the module supports Cần xác nhận, Chưa đọc and Đã đọc; selected announcements can be read in full and confirmed; confirmed items remain in history.
Hero announcement: "Cập nhật cơ chế thưởng đóng gói tháng 09/2026", version "PKG-2026.09-v2", effective from "10/09/2026", issued by "Phòng vận hành". Primary action: "Tôi đã đọc và hiểu". Supporting action: "Để sau" only before the effective date.
Content scope: Include realistic examples from multiple modules, not just payroll: "Quy định kiểm hàng cuối ca", "Cập nhật quy trình bàn giao TMDT", "Cơ chế thưởng đóng gói", "Lịch nghỉ lễ 02/09". Use categories Chính sách, Vận hành, Thưởng, Phạt, Hệ thống. Include a short privacy note without making salary the page focus.
Layout: one focused primary screen, strong hierarchy, readable Vietnamese, 14-16px body text, thin dividers, subtle tints, minimal cards, no card grid, no nested cards. Keep the established white, gray and DBY green #00AB56 visual language; restrained orange for items needing acknowledgement.
Hard constraints: no Bảng công title, no attendance tabs, no payroll totals, no salary table, no dark mode, no gradients, no purple, no illustration, no emojis, no browser chrome, no fake logo, no watermark, no collage, no multiple screens in one image, no clipped content.`;

const headers = { 'Content-Type': 'application/json' };
if (process.env.NINEROUTER_KEY) headers.Authorization = `Bearer ${process.env.NINEROUTER_KEY}`;
let response;
let lastError = '';
for (let attempt = 1; attempt <= 3; attempt += 1) {
  response = await fetch(`${process.env.NINEROUTER_URL}/v1/images/generations`, {
    method: 'POST', headers,
    body: JSON.stringify({
      model: 'cx/gpt-5.5-image', prompt,
      images: references.map((image) => `data:image/png;base64,${image.toString('base64')}`),
      size: '1536x1024', quality: 'high', image_detail: 'high',
      output_format: 'png', response_format: 'b64_json',
    }),
  });
  if (response.ok) break;
  lastError = `${response.status} ${await response.text()}`;
  if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2500));
}
if (!response?.ok) throw new Error(lastError || 'Image generation failed');

const payload = await response.json();
const item = payload.data?.[0];
let bytes;
if (item?.b64_json) bytes = Buffer.from(item.b64_json, 'base64');
else if (item?.url) bytes = Buffer.from(await (await fetch(item.url)).arrayBuffer());
else throw new Error(`No image returned: ${JSON.stringify(payload).slice(0, 1000)}`);

const outputPath = path.resolve('qa/product-design/notification-global-module', outputName);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, bytes);
console.log(`${outputPath}\t${Math.round((Date.now() - startedAt) / 1000)}s`);
