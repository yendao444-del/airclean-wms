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

const references = await Promise.all([
  fs.readFile(path.resolve('qa/product-design/notification-global-module/global-notification-master-detail.png')),
  fs.readFile(path.resolve('qa/product-design/notification-global-module/global-notification-priority-feed.png')),
  fs.readFile(path.resolve('qa/product-design/notification-global-module/global-notification-policy-library.png')),
]);
const startedAt = Date.now();

const prompt = `Use case: ui-mockup
Asset type: production-quality full-screen desktop application module
Primary request: Redesign the dedicated DBY Software POS / AIRCLEAN WMS module "Thông báo nội bộ" as a true FULL-SCREEN application page. It is a global company notification module, not part of Bảng công or any other business module. This direction is: ${direction}
Input images: The three attached images are earlier concepts. Preserve the best Vietnamese content, notification statuses, acknowledgement behavior, DBY green-white visual system, and app navigation. Correct their main weakness: the notification experience must fill the entire available application workspace, not look like a drawer, popup, modal, floating panel, or narrow side pane.
Target dimensions: 1536 x 1024 desktop application frame.
Current date anchor: 08/09/2026.
Exact spatial requirement: Keep only the permanent app sidebar and global top bar. Every pixel of the main content area to the right of the sidebar and below the top bar belongs to the Thông báo nội bộ page. Use a broad full-width page header, full-width filters/search, and a spacious content layout. Do not show any underlying Bảng công, dashboard, sales, warehouse, or payroll screen.
Global notification behavior visible: top-bar bell with unread badge; selected sidebar item "Thông báo nội bộ"; states "Tất cả", "Cần xác nhận", "Chưa đọc", "Đã đọc"; realistic company-wide notices from Vận hành, Kho, Bàn giao TMĐT, Chính sách, Thưởng, Phạt, Hệ thống; detailed reading; mandatory checkbox and primary action "Tôi đã đọc và hiểu"; confirmed items remain searchable in history.
Selected announcement: "Cập nhật cơ chế thưởng đóng gói tháng 09/2026", version "PKG-2026.09-v2", effective "10/09/2026", issued by "Phòng vận hành". Include a concise summary, main changes, scope, related modules, and privacy note.
Visual style: realistic Ant Design-compatible enterprise desktop UI; crisp 14-16px Vietnamese typography; white, soft gray and DBY green #00AB56; restrained orange only for required acknowledgement; generous but efficient spacing; thin dividers; minimal elevation.
Hard constraints: no drawer, no popup, no modal, no floating panel, no underlying business screen, no Bảng công content, no payroll totals, no narrow content strip, no card grid, no nested cards, no dark mode, no gradients, no purple, no illustration, no emojis, no browser chrome, no fake logo, no watermark, no collage, no multiple screens in one image, no clipped content.`;

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

const outputPath = path.resolve('qa/product-design/notification-fullscreen', outputName);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, bytes);
console.log(`${outputPath}\t${Math.round((Date.now() - startedAt) / 1000)}s`);
