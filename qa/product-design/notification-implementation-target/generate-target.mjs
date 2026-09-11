import fs from 'node:fs/promises';
import path from 'node:path';

const reference = await fs.readFile(path.resolve(
  'qa/product-design/notification-fullscreen/notification-fullscreen-priority-stream.png',
));
const shellReference = await fs.readFile(path.resolve(
  'qa/product-design/reward-redesign-self-list.png',
));

const prompt = `Use case: ui-mockup
Asset type: final implementation target for a desktop application
Primary request: Revise the selected DBY Software POS / AIRCLEAN WMS notification design. Keep the full-screen priority-stream layout and interactions, but REMOVE the "Thông báo nội bộ" module item from the left sidebar entirely. Notifications must be accessed ONLY through the global bell icon in the top application bar.
Input images: Image 1 is the selected full-screen notification design and must control layout, content hierarchy, density, and interaction. Image 2 is the existing app shell reference. Preserve the existing sidebar entries from Image 2; do not add a notification menu entry.
Target dimensions: 1536 x 1024 desktop app frame.
Current date anchor: 08/09/2026.
Exact state: The user clicked the bell. A true full-screen notification center now covers the entire application content area to the right of the permanent sidebar and below the global top bar. The underlying business page is not visible. The bell remains active in the top bar with a badge count. Include an obvious back/close control near the full-screen page title that returns to the prior app screen.
Content: Page title "Trung tâm thông báo"; status tabs "Tất cả", "Cần xác nhận", "Chưa đọc", "Đã đọc"; full-width filters; left notification stream; right selected detail reader. Selected announcement "Cập nhật cơ chế thưởng đóng gói tháng 09/2026", version PKG-2026.09-v2, effective 10/09/2026, issued by Phòng vận hành. Include categories from multiple modules, privacy notice, checkbox, "Để sau", and primary action "Tôi đã đọc và hiểu".
Behavior visible: Required notice is clearly highlighted; confirm button is disabled until the checkbox is selected; confirmed notifications remain in history; no standalone sidebar route exists.
Style: realistic Ant Design-compatible enterprise UI; DBY green #00AB56, white, soft gray, restrained orange; crisp 14-16px Vietnamese typography; thin dividers; no floating drawer or modal.
Hard constraints: no "Thông báo nội bộ" sidebar item, no notification sidebar module, no Bảng công content, no underlying page, no drawer, no popup, no modal, no gradients, no purple, no illustration, no emojis, no browser chrome, no fake logo, no watermark, no clipped text.`;

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
      images: [reference, shellReference].map((image) => `data:image/png;base64,${image.toString('base64')}`),
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

const outputPath = path.resolve(
  'qa/product-design/notification-implementation-target/notification-bell-fullscreen-target.png',
);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, bytes);
console.log(outputPath);
