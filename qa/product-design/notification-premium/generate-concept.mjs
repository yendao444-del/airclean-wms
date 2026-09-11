import fs from 'node:fs/promises';
import path from 'node:path';

const variant = process.argv[2];
const outputName = process.argv[3];
if (!variant || !outputName) throw new Error('Usage: node generate-concept.mjs <variant> <output>');

const referencePath = 'C:/Users/Admin/AppData/Local/Temp/codex-clipboard-35d4a911-10f3-4f87-996f-049e3d108635.png';
const reference = await fs.readFile(referencePath);

const directions = {
  executive: `Executive Clean direction. Preserve the current Electron shell exactly: white top bar, permanent white left sidebar, DBY green active navigation, notification bell as the only entry point. Redesign only the notification content area into a premium executive inbox: warm off-white canvas, generous but efficient spacing, refined deep-navy typography, one slim emerald priority rail, grouped notification rows on a single elevated white surface rather than many floating cards, restrained amber only for required acknowledgement, polished metadata and status chips. Strong hierarchy and calm financial-software quality.`,
  command: `Operational Command Center direction. Preserve the current Electron shell exactly: white top bar, permanent white left sidebar, DBY green active navigation, notification bell as the only entry point. Redesign only the notification content area into a premium operations inbox: compact top summary strip, segmented filters, a highlighted required-action row, dense but highly legible feed with subtle vertical timeline markers, right-aligned deadlines and crisp actions. Use DBY emerald, dark graphite, cool gray, and small amber accents. Feel like premium logistics control software, not a generic SaaS dashboard.`,
  editorial: `Editorial Premium direction. Preserve the current Electron shell exactly: white top bar, permanent white left sidebar, DBY green active navigation, notification bell as the only entry point. Redesign only the notification content area with a sophisticated editorial reading experience: strong oversized page title, quiet whitespace, elegant section labels, a featured required announcement with dark emerald surface and fine amber detail, followed by clean borderless notification rows separated by hairlines. Use premium typography, subtle green-tinted paper background, minimal chips, and precise alignment. Sophisticated, modern, calm, and distinctly DBY.`,
};

const prompt = `Use case: ui-mockup
Asset type: desktop Electron application notification center redesign
Primary request: Create a realistic production-quality premium redesign of the DBY Software POS notification inbox shown in the reference.
Input image: Image 1 is the current real Electron application and controls the product shell, navigation, brand identity, language, and feature scope.
Target dimensions: 1536 x 1024 desktop Electron app frame.
Current date anchor: 08/09/2026.
Intended user: Vietnamese warehouse, sales, and operations employees who need to scan company policies, rewards, penalties, payroll-fund announcements, and mandatory acknowledgements.
Core workflow: enter only from the global bell, scan status and urgency, filter/search, open details, acknowledge required notices.
Visible Vietnamese content: title "Hộp thư thông báo"; tabs "Tất cả", "Cần xác nhận", "Chưa đọc", "Chính sách & Thưởng", "Vận hành kho"; search; newest-first sort; required notice "Quy định kiểm hàng cuối ca"; reward notice "Cập nhật cơ chế thưởng đóng gói tháng 09/2026"; penalty notice "Điều chỉnh mức phạt sai quy trình đóng gói".
Direction: ${directions[variant]}
Typography: premium, highly readable Vietnamese UI typography at realistic 14-16px body scale; confident title hierarchy; no tiny illegible text.
Constraints: preserve the existing Electron window shell and DBY green identity; no notification sidebar module; bell is the only entry; no purple; no neon; no glassmorphism; no excessive gradients; no generic analytics cards; no browser chrome outside the Electron window; no illustrations; no emojis; no fake logo; no watermark; no clipped text; no design labels or annotations. Show one coherent screen only.`;

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
      images: [`data:image/png;base64,${reference.toString('base64')}`],
      size: '1536x1024',
      quality: 'high',
      image_detail: 'high',
      output_format: 'png',
      response_format: 'b64_json',
    }),
  });
  if (response.ok) break;
  lastError = `${response.status} ${await response.text()}`;
  if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 2500));
}

if (!response?.ok) throw new Error(lastError || 'Image generation failed');
const payload = await response.json();
const item = payload.data?.[0];
let bytes;
if (item?.b64_json) bytes = Buffer.from(item.b64_json, 'base64');
else if (item?.url) bytes = Buffer.from(await (await fetch(item.url)).arrayBuffer());
else throw new Error(`No image returned: ${JSON.stringify(payload).slice(0, 1000)}`);

const outputPath = path.resolve('qa/product-design/notification-premium', outputName);
await fs.writeFile(outputPath, bytes);
console.log(outputPath);
