import fs from 'node:fs/promises';
import path from 'node:path';

const direction = process.argv[2];
const directions = {
  a: `Editorial landing page: a large illustrated story hero fills the top half of the right content canvas. Put the policy headline and short explanation on the left of the hero, with an original Vietnamese warehouse worker checking in at a biometric terminal and a large clock on the right. Below, use three large horizontally aligned illustrated penalty milestones, followed by one compact explanation strip. Spacious, premium, highly visual.`,
  b: `Infographic landing page: use one continuous full-height visual narrative across the right content canvas. Start with a bold headline and large clock illustration, then a curved or stepped timeline from the 5-minute grace period through the three lateness thresholds. Integrate a small warehouse employee and attendance terminal into the infographic. Avoid a dashboard-card feeling; it should read like a polished campaign landing page inside the app.`,
  c: `Split-story landing page: create a dramatic top section with a large employee-and-clock illustration occupying about 55 percent of the canvas and a bold policy message beside it. The lower section becomes an illustrated comparison guide for official versus seasonal employees, with three clear threshold columns and a visual rule explanation. Use generous white space and strong ecommerce campaign hierarchy.`
};

if (!directions[direction]) throw new Error('Use direction a, b, or c');

const references = await Promise.all([
  'C:/Users/Admin/AppData/Local/Temp/codex-clipboard-b30de9c8-6364-47a1-bbd5-bc6f06faf2d9.png',
  'qa/product-design/notification-policy-tabs/illustrated-policy-real-data-final.png',
].map((file) => fs.readFile(path.resolve(file))));

const prompt = `Use case: ui-mockup
Asset type: production-quality desktop Electron policy screen concept
Primary request: Redesign the "Phạt đi làm muộn" policy detail as a true visual landing page inside the DBY POS policy center. ${directions[direction]}
Input hierarchy: Image 1 is the current live screen marked by the user. Ignore Snipping Tool chrome, the browser/page behind it, and the hand-drawn red outline. The red outline indicates the entire right-side policy detail canvas that must become the visual landing experience. Preserve the application shell, top tabs, and left policy list. Image 2 controls the established DBY premium illustration style, brand colors, typography, geometric icon surfaces, and overall Electron identity.
Target dimensions: 1536 x 1024 desktop Electron frame.
Current date anchor: 09/09/2026.
Screen structure: preserve the compact top Electron bar, collapsed global application sidebar, top tabs "Thông báo" and "Chính sách" with "Chính sách" selected, and the left policy navigation grouped under "THƯỞNG" and "PHẠT". Select "Đi làm muộn". The entire remaining right canvas is a coherent illustrated landing page, not a plain detail page with one banner and cards.
Real policy data to communicate clearly:
- Title: "Phạt đi làm muộn".
- Morning shift starts at 08:00; afternoon shift starts at 13:30.
- Grace period: 5 minutes.
- Official / Seasonal: 6–15 minutes = 30.000đ / 10.000đ.
- Official / Seasonal: 16–30 minutes = 70.000đ / 30.000đ.
- Official / Seasonal: over 30 minutes = 150.000đ / 60.000đ.
- The system uses the first attendance check-in of each shift and only fines after the 5-minute grace period.
Visual style: DBY emerald and mint remain dominant even though this is a fine policy. Use coral red only as a precise urgency accent. Deep navy typography, warm off-white canvas, crisp geometric facets, high-quality original Vietnamese warehouse character illustration, modern ecommerce landing-page storytelling without copying Shopee. Use large visual storytelling and bold hierarchy instead of many small dashboard cards.
Hard constraints: the right-side landing page must visibly fill the available canvas; no huge empty lower half; no isolated small pink hero card; no plain dashboard; no history column; no assigned-SKU column; no notification creation UI; no orange dominance; no purple; no dark mode; no glassmorphism; no photorealism; no watermark; no Snipping Tool chrome; no red hand-drawn border; no clipped or illegible Vietnamese; one coherent screen only.`;

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

const outputDir = path.resolve('qa/product-design/notification-policy-tabs/late-landing-concepts');
await fs.mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `late-landing-${direction}.png`);
await fs.writeFile(outputPath, bytes);
console.log(outputPath);
