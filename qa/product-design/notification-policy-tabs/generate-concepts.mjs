import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const scriptPath = fileURLToPath(import.meta.url);

if (args[0] === '--parallel' || args[0] === '--policy-only' || args[0] === '--policy-only-v2') {
  const concepts = (args[0] === '--policy-only' || args[0] === '--policy-only-v2') ? [
    {
      output: args[0] === '--policy-only-v2' ? 'policy-only-v2-a.png' : 'policy-only-a.png',
      direction: `Show only the newly designed state of the "Chính sách hiện hành" tab. Do not redesign or display a new notification experience. Use a policy library layout: a compact module list on the left for Đóng gói, Kho, Quỹ lương, and Bàn giao TMĐT; a large current-policy reading area in the center; and a slim version-history rail on the right. The selected policy is "Cơ chế thưởng đóng gói tháng 09/2026" with current status, formula, reward and penalty table, worked example, effective date, issuer, and acknowledgement. Keep the existing notification tab visible but inactive and otherwise untouched.`,
    },
    {
      output: args[0] === '--policy-only-v2' ? 'policy-only-v2-b.png' : 'policy-only-b.png',
      direction: `Show only the newly designed state of the "Chính sách hiện hành" tab. Do not redesign or display a new notification experience. Create an operations handbook layout: module navigation as a restrained horizontal category bar, a strong policy title and current-version summary, then a spacious single-column document with anchored section navigation for Tổng quan, Cách tính thưởng, Mức phạt, Ví dụ, and Lịch sử phiên bản. Make scanning long policies easy without turning every section into a card. Keep the existing notification tab visible but inactive and otherwise untouched.`,
    },
    {
      output: args[0] === '--policy-only-v2' ? 'policy-only-v2-c.png' : 'policy-only-c.png',
      direction: `Show only the newly designed state of the "Chính sách hiện hành" tab. Do not redesign or display a new notification experience. Create a module-first policy dashboard with a narrow left module index and a prominent current-policy header. Emphasize the practical answer employees need: today's applicable reward level, calculation formula, penalty conditions, and one worked salary example. Put version history in a collapsible-looking lower section and include a subtle link to the related announcement, but keep attention on the permanent current rule. Keep the existing notification tab visible but inactive and otherwise untouched.`,
    },
  ] : [
    {
      output: 'notification-policy-tabs-a.png',
      direction: `Direct two-tab command center. Make "Thông báo" and "Chính sách hiện hành" the dominant top-level tabs directly beneath the title. Show the "Thông báo" tab selected. Keep the compact KPI strip and timeline feed, but add a slim policy context rail on the right of policy-change notices with current version, effective date, and a strong "Xem chính sách hiện hành" action. The distinction between recent news and permanent rules must be instantly understandable.`,
    },
    {
      output: 'notification-policy-tabs-b.png',
      direction: `Policy library first. Show the "Chính sách hiện hành" tab selected. Create a premium operational policy library organized by module: Đóng gói, Kho, Quỹ lương, Bàn giao TMĐT. The selected Đóng gói policy occupies the main reading area with current version, effective status, reward and penalty table, formula, worked example, issuer, and a clean version-history timeline. Include a compact alert at the top stating that one policy changed recently, linking back to its announcement. Avoid a grid of floating cards; use one coherent page surface with strong editorial hierarchy.`,
    },
    {
      output: 'notification-policy-tabs-c.png',
      direction: `Change-to-policy bridge. Show the "Thông báo" tab selected with a split reading layout: a concise left feed of recent announcements and a generous right detail panel for "Cập nhật cơ chế thưởng đóng gói tháng 09/2026". In the detail panel, visually compare "Trước đây 500đ/đơn" and "Hiện tại 700đ/đơn", show effective date 10/09/2026 and mandatory acknowledgement, then provide the primary action "Xem chính sách hiện hành". Keep the top-level two-tab navigation obvious and make the relationship announcement -> current policy -> version history visually explicit without using a diagram or multiple screens.`,
    },
  ];

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

const [outputName, direction] = args;
if (!outputName || !direction) throw new Error('Usage: node generate-concepts.mjs <output> <direction>');

const referencePaths = [
  'qa/product-design/notification-premium/premium-command-center.png',
  'qa/product-design/notification-implementation-target/notification-bell-fullscreen-target.png',
];
const references = await Promise.all(referencePaths.map((file) => fs.readFile(path.resolve(file))));

const prompt = `Use case: ui-mockup
Asset type: production-quality desktop Electron notification and policy center
Primary request: Design a full-screen Vietnamese DBY Software POS / AIRCLEAN WMS experience that combines notification history and permanent current policies through exactly two primary tabs: "Thông báo" and "Chính sách hiện hành".
Input images: Image 1 is the approved premium visual direction and controls the DBY color system, faceted geometric icon/button surfaces, typography, density, spacing, and overall quality. Image 2 controls the real Electron shell, left navigation, top header, bell entry, and master-detail reading behavior. Preserve their strongest qualities rather than inventing a different brand.
Target dimensions: 1536 x 1024 desktop Electron app frame.
Current date anchor: 09/09/2026.
Intended user: Vietnamese warehouse, packing, sales, payroll, and operations employees.
Core mental model: "Thông báo" answers what just changed. "Chính sách hiện hành" answers what rule currently applies. A policy-change announcement must link to the permanent policy, while the permanent policy retains version history.
Primary content: "Cập nhật cơ chế thưởng đóng gói tháng 09/2026", policy version "PKG-2026.09-v2", effective date "10/09/2026", change from "500đ/đơn" to "700đ/đơn", issuer "Phòng vận hành", mandatory acknowledgement "Tôi đã đọc và hiểu".
Direction: ${direction}
Visual style: premium enterprise operations software; white and subtly green-tinted surfaces; DBY emerald green, dark navy typography, cool gray dividers, restrained orange only for pending acknowledgement; crisp overlapping geometric facets behind important icons and primary buttons; realistic Ant Design-compatible controls; readable Vietnamese at 14-16px body size.
Hard constraints: preserve the Electron app shell and permanent left navigation; preserve the exact existing notification-center header from Image 1 including the title "Hộp thư thông báo", subtitle, KPI summary strip, back button, top search, bell, and user profile; do not rename the screen to "Trung tâm chính sách" or "Trung tâm thông báo & chính sách"; do not redesign any notification content or notification state; add the two primary tabs directly below the unchanged header and show only "Chính sách hiện hành" selected; only the content region below those two tabs may be newly designed; the global bell is the only notification entry and there is no notification module in the sidebar; exactly two primary tabs; no purple; no dark mode; no neon; no glassmorphism; no blurry icon backgrounds; no excessive gradients; no card grid; no cards inside cards; no illustrations; no emojis; no fake logos; no watermark; no browser chrome; no clipped or illegible text; one coherent screen only.`;

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
  if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2500));
}

if (!response?.ok) throw new Error(lastError || 'Image generation failed');
const payload = await response.json();
const item = payload.data?.[0];
let bytes;
if (item?.b64_json) bytes = Buffer.from(item.b64_json, 'base64');
else if (item?.url) bytes = Buffer.from(await (await fetch(item.url)).arrayBuffer());
else throw new Error(`No image returned: ${JSON.stringify(payload).slice(0, 1000)}`);

const outputPath = path.resolve('qa/product-design/notification-policy-tabs', outputName);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, bytes);
console.log(outputPath);
