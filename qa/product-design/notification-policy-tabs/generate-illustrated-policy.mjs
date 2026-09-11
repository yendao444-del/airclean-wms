import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const scriptPath = fileURLToPath(import.meta.url);

if (args[0] === '--parallel') {
  const concepts = [
    {
      output: 'illustrated-policy-a.png',
      direction: `Illustrated policy hero. Preserve the three-column policy-library structure from Image 1. In the center column, replace the plain opening area with a polished wide DBY-green illustrated banner featuring a friendly warehouse packing employee, parcel, checklist, and reward coins. Below it, use three illustrated explainer blocks for reward calculation, excluded orders, and penalty conditions, followed by the compact policy table. Illustration density should be confident but leave all operational data readable.`,
    },
    {
      output: 'illustrated-policy-b.png',
      direction: `Visual handbook. Preserve the three-column policy-library structure from Image 1. Turn the center policy into an editorial infographic with a strong illustrated header and a horizontal three-step story: pack correctly, hand over successfully, receive the 700d reward. Use small narrative illustrations beside short rules, a large formula ribbon, and one clear worked example. Keep the version-history rail and acknowledgement footer practical and enterprise-ready.`,
    },
    {
      output: 'illustrated-policy-c.png',
      direction: `Campaign-style policy poster inside the app. Preserve the three-column policy-library structure from Image 1, but let the center column feature a vibrant DBY campaign panel inspired by approachable ecommerce policy communication. Show a mascot-like packing worker holding a parcel, a large 500d to 700d change, and three cream information columns for eligible orders, excluded orders, and common penalties. Below the poster, retain structured metadata, version history, and acknowledgement so this remains a real operational policy screen rather than a marketing page.`,
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
  if (failures.length) throw new Error(failures.join('\n'));
  process.exit(0);
}

const [outputName, direction] = args;
if (!outputName || !direction) throw new Error('Usage: node generate-illustrated-policy.mjs <output> <direction>');

const referencePaths = [
  'qa/product-design/notification-policy-tabs/policy-only-v2-a.png',
  'C:/Users/Admin/AppData/Local/Temp/codex-clipboard-20cbe3d6-efe3-46a1-bba7-53c8e07a5b51.png',
  'C:/Users/Admin/AppData/Local/Temp/codex-clipboard-afa1dbdf-0cc0-451c-915b-d9fd095e290d.png',
  'qa/product-design/notification-premium/premium-command-center.png',
];
const references = await Promise.all(referencePaths.map((file) => fs.readFile(path.resolve(file))));

const prompt = `Use case: ui-mockup
Asset type: production-quality illustrated policy screen inside a desktop Electron application
Primary request: Revise the selected DBY policy-library concept in Image 1 to communicate policy rules with substantially more visual illustration, using Images 2 and 3 only as inspiration for friendly, easy-to-scan ecommerce policy communication. Do not copy Shopee branding, orange palette, logos, characters, layout, or wording.
Input hierarchy: Image 1 controls the exact full-screen layout, three-column structure, Vietnamese content, Electron shell, and two-tab architecture. Images 2 and 3 demonstrate the desired amount of illustration, poster-like hierarchy, simple visual storytelling, bold rule summaries, and approachable policy education. Image 4 controls DBY premium styling, faceted geometric icon and button backgrounds, navigation, typography, and emerald identity.
Target dimensions: 1536 x 1024 desktop Electron frame.
Current date anchor: 09/09/2026.
Intended user: Vietnamese packing, warehouse, payroll, and operations employees who need to understand current reward and penalty rules quickly.
Selected structure: keep "Hộp thư thông báo", the KPI header, bell, sidebar, and the two tabs exactly as in Image 1. Show "Chính sách hiện hành" selected. Keep the left policy library and right version-history rail. Redesign only the central policy reading content with more illustration.
Policy content: "Cơ chế thưởng đóng gói tháng 09/2026", version "PKG-2026.09-v2", effective 10/09/2026, reward changes from 500đ/đơn to 700đ/đơn, formula "Số đơn hợp lệ x 700đ x Hệ số hiệu suất", common exclusions are returned/cancelled orders, and acknowledgement is required.
Direction: ${direction}
Illustration art direction: original flat vector editorial illustrations with expressive human warehouse workers, parcels, barcode/checklist motifs, simple geometric scenery, bold silhouettes, and clean cream information surfaces. Use DBY emerald, mint, deep navy, warm cream, and restrained orange only for warnings. Blend illustration into the product surface instead of placing a random stock image. Keep Vietnamese typography large and readable.
Hard constraints: preserve the notification interface and application shell; do not create or redesign the notification feed; bell remains the only entry; no notification sidebar module; no Shopee logo, shopping-bag S mark, 9.9 mark, copied character, or orange-dominant palette; no photo realism; no purple; no dark mode; no glassmorphism; no excessive cards; no nested cards; no browser chrome; no fake DBY logo; no watermark; no clipped text; one coherent desktop screen only.`;

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
await fs.writeFile(outputPath, bytes);
console.log(outputPath);
