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
  throw new Error('Usage: node generate-notification-system.mjs <output> <direction>');
}

const referencePaths = [
  'qa/product-design/notification-concepts/notification-bell-drawer.png',
  'qa/product-design/notification-concepts/notification-required-ack.png',
  'qa/product-design/notification-concepts/notification-policy-hub.png',
];
const references = await Promise.all(referencePaths.map((referencePath) => fs.readFile(path.resolve(referencePath))));
const startedAt = Date.now();

const prompt = `Use case: ui-mockup
Asset type: production-quality desktop application notification-system concept
Primary request: Refine the attached DBY Software POS / AIRCLEAN WMS notification concepts into one cohesive Vietnamese employee-notification experience. Every direction must include a notification bell with unread badge, automatic new-notification treatment, mandatory acknowledgement, full readable policy details, and access to notification history. This direction is: ${direction}
Input images: Image 1 is the primary bell-and-drawer reference. Image 2 is the mandatory acknowledgement reference. Image 3 is the full notification detail and history reference. Combine their strongest product ideas while preserving the existing DBY app shell, left navigation, top header, white-and-green visual language, Vietnamese typography, and compact enterprise density.
Target dimensions: 1536 x 1024 desktop app frame.
Current date anchor: 07/09/2026.
Hero content: "Cập nhật cơ chế thưởng đóng gói tháng 09/2026", version "PKG-2026.09-v2", effective date "10/09/2026", category tags "Thưởng", "Phạt", "Quỹ lương", and primary acknowledgement "Tôi đã đọc và hiểu".
Required behavior visible in the UI: New notification is clearly announced near the bell; the user cannot accidentally mark a required policy as confirmed; detailed content can be read directly in the notification experience; after confirmation it remains available in history; salary data is private and the policy does not reveal another employee's amounts.
Layout: Create one focused primary screen, not a collage or storyboard. Use one primary action. Show only supporting UI needed to understand the bell, unread/required state, details, and history entry point. Prefer spacing, hierarchy, thin dividers, and subtle surface tints over cards and shadows.
Style: realistic Ant Design-compatible desktop UI, crisp 14-16px body typography, green #00AB56 family, white, soft gray, restrained orange only for pending acknowledgement.
Avoid: dark mode, gradients, purple, illustration, emojis, fake logos, browser chrome, excessive metrics, card grids, nested cards, clipped content, unreadable Vietnamese, multiple screens in one image, watermarks.`;

const headers = { 'Content-Type': 'application/json' };
if (process.env.NINEROUTER_KEY) headers.Authorization = `Bearer ${process.env.NINEROUTER_KEY}`;

let response;
let lastError = '';
for (let attempt = 1; attempt <= 3; attempt += 1) {
  response = await fetch(`${process.env.NINEROUTER_URL}/v1/images/generations`, {
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
  if (response.ok) break;
  lastError = `${response.status} ${await response.text()}`;
  if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2500 * attempt));
}

if (!response?.ok) throw new Error(lastError || 'Image generation failed');
const payload = await response.json();
const item = payload.data?.[0];
let bytes;
if (item?.b64_json) bytes = Buffer.from(item.b64_json, 'base64');
else if (item?.url) bytes = Buffer.from(await (await fetch(item.url)).arrayBuffer());
else throw new Error(`No image returned: ${JSON.stringify(payload).slice(0, 1000)}`);

const outputPath = path.resolve('qa/product-design/notification-system-v2', outputName);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, bytes);
console.log(`${outputPath}\t${Math.round((Date.now() - startedAt) / 1000)}s`);
