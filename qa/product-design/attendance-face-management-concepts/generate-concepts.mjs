import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
let args = process.argv.slice(2);

if (args[0] === '--final') {
  args = [
    'compact-command-bar-final.png',
    `Refine the selected compact-command-bar concept using the annotated crop as explicit placement guidance. Preserve the selected concept's overall layout and styling. Move exactly four actions into one compact right-aligned action row at the top of the attendance content: "Cấu hình", "Chốt & khóa", "Chấm công", and "Đăng ký khuôn mặt mới". Keep their priority clear: Chấm công is the main green action, Chốt & khóa remains strongly protected, Cấu hình is quiet, and face registration is secondary; all four must fit cleanly without wrapping. Remove Chấm công and Đăng ký khuôn mặt mới from the lower service/profile row. That lower row contains only "Python service: Sẵn sàng", "Làm mới", and "Quản lý khuôn mặt (3)". Directly beneath it, integrate the earned punctuality badge and streak into a compact attendance achievement card: "Đúng giờ 8 ngày liên tiếp", badge "Đúng giờ +8 ngày", and monthly progress "24/26 ngày để nhận 100.000đ". Make this achievement card visibly belong to attendance rather than looking like a separate generic dashboard widget. The daily shift matrix begins immediately below and remains the dominant content.`,
    'qa/product-design/attendance-face-management-concepts/compact-command-bar.png',
    'C:/Users/Admin/AppData/Local/Temp/codex-clipboard-9cdf3c91-6966-4d6f-94da-7472bc6df28e.png',
  ];
}

const concepts = [
  {
    output: 'compact-command-bar.png',
    direction: `Compact command bar with the face drawer closed. Replace the large registered-profile block with a single restrained button labeled "Quản lý khuôn mặt (3)" beside a compact green-dot service status. Keep check-in and check-out controls in one slim operational strip. Directly below, show a personal progress strip with "Đúng giờ 8 ngày liên tiếp", badge "Đúng giờ +8 ngày", monthly target "24/26 ngày để nhận 100.000đ", and clear progress without making rewards feel punitive. Make the daily shift matrix the dominant above-the-fold content, wide and highly scannable.`,
  },
  {
    output: 'achievement-drawer-open.png',
    direction: `Achievement-led workspace with the right-side face-management drawer visibly open. The main canvas keeps a concise attendance action/status area, then a strong but compact personal achievement band above the daily shift matrix. Show "Chuỗi đúng giờ: 8 ngày", earned badge "Đúng giờ +8 ngày", and "22/26 ngày đúng giờ tháng này — còn 2 ngày để nhận 100.000đ". The drawer title is "Quản lý khuôn mặt (3)", lists three registered profiles with photo thumbnails and status, and includes actions "Đăng ký khuôn mặt mới" and "Cập nhật khuôn mặt". The drawer must feel secondary and must not obscure the matrix's essential columns.`,
  },
  {
    output: 'matrix-first-utility-rail.png',
    direction: `Matrix-first operations workspace. Give nearly all horizontal space to the daily attendance shift matrix and use a narrow right utility rail for today's attendance state, personal reward progress, compact Python service health, and the "Quản lý khuôn mặt (3)" entry. The utility rail shows a small badge summary "Đúng giờ +8 ngày" and monthly progress "22/26 — mục tiêu thưởng 100.000đ". Keep check-in/check-out actions obvious but visually subordinate to the matrix. Registered profiles remain hidden until the face-management entry is opened.`,
  },
];

if (args[0] === '--parallel') {
  const failures = [];
  let remaining = concepts.length;

  await new Promise((resolve) => {
    for (const concept of concepts) {
      const child = spawn(process.execPath, [scriptPath, concept.output, concept.direction], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => failures.push(`${concept.output}: ${error.message}`));
      child.on('close', (code) => {
        if (code === 0) process.stdout.write(stdout);
        else failures.push(`${concept.output}: ${stderr || stdout || `exit code ${code}`}`);
        remaining -= 1;
        if (remaining === 0) resolve();
      });
    }
  });

  if (failures.length > 0) throw new Error(failures.join('\n'));
  process.exit(0);
}

const [outputName, direction, ...additionalReferencePaths] = args;
if (!outputName || !direction) {
  throw new Error('Usage: node generate-concepts.mjs --parallel');
}

const referencePath = 'C:/Users/Admin/AppData/Local/Temp/codex-clipboard-b04bbdcd-9062-44bb-94f2-4d24a5bde757.png';
const reference = await fs.readFile(referencePath);
const references = [reference];
for (const additionalReferencePath of additionalReferencePaths) {
  references.push(await fs.readFile(path.resolve(additionalReferencePath)));
}

const prompt = `Use case: ui-mockup
Asset type: production-quality desktop Electron attendance screen redesign
Primary request: Redesign the attached real DBY Software POS attendance page while preserving its recognizable application shell, left sidebar, top tabs, green-and-white enterprise visual language, compact Vietnamese UI density, and operational character. This is a focused refinement of the existing screen, not a new product or a marketing dashboard.
Input image: The attached screenshot is the authoritative visual reference. Preserve its DBY Software POS shell, sidebar proportions, header structure, tabs, typography character, table behavior, and green accent system.
Target dimensions: 1536 x 1024 desktop application frame.
Current date anchor: 10/09/2026.
Intended user: Vietnamese retail and warehouse employees using daily attendance inside the desktop POS application.
Core goal: Reduce the permanently expanded registered-face profile area so the daily shift matrix becomes the main work surface, while adding understandable positive reinforcement for punctual attendance.
Direction: ${direction}
Content constraints: Use clear Vietnamese labels. The personal reward logic must be explained positively: consecutive on-time days earn a visible punctuality badge; monthly attendance progress shows progress toward a 100.000đ reward for reaching 24/26 on-time workdays. Do not imply that an earned reward replaces normal late penalties. Keep notification concepts out of this screen except for small inline status messaging directly relevant to attendance.
Interaction constraints: Registered profiles are not permanently expanded. They are accessed through "Quản lý khuôn mặt (3)" and, when shown, appear in a right-side drawer. Keep Python/service status compact. Prioritize above the fold in this order: attendance actions and today's status, personal attendance achievement, daily shift matrix.
Visual style: realistic Ant Design-compatible Electron UI, white base surfaces, DBY emerald green, dark navy text, cool gray separators, restrained gold only for earned achievement, 14-16px readable Vietnamese body text, disciplined spacing, thin dividers, minimal shadows.
Layout rules: one coherent desktop screen only; no collage; no browser chrome; no device frame. Use grouping, alignment, typography, and subtle dividers before cards. The matrix must contain realistic rows and columns for daily shifts, status, check-in, check-out, lateness, and work duration, with readable content and no clipping.
Avoid: dark mode, purple, glossy gradients, glassmorphism, gamified cartoon art, emoji badges, trophy illustrations, fake logos, excessive KPI cards, cards inside cards, floating dashboard tiles, oversized empty spaces, unreadable text, malformed Vietnamese, watermarks, or redesigning the sidebar into another brand.`;

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
      images: references.map((image) => `data:image/png;base64,${image.toString('base64')}`),
      size: '1536x1024',
      quality: 'high',
      image_detail: 'high',
      output_format: 'png',
      response_format: 'b64_json',
    }),
  });
  if (response.ok) break;
  lastError = `${response.status} ${await response.text()}`;
  if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
}

if (!response?.ok) throw new Error(lastError || 'Image generation failed');
const payload = await response.json();
const item = payload.data?.[0];
let bytes;
if (item?.b64_json) bytes = Buffer.from(item.b64_json, 'base64');
else if (item?.url) bytes = Buffer.from(await (await fetch(item.url)).arrayBuffer());
else throw new Error(`No image returned: ${JSON.stringify(payload).slice(0, 1000)}`);

const outputPath = path.resolve('qa/product-design/attendance-face-management-concepts', outputName);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, bytes);
process.stdout.write(`${outputPath}\n`);
