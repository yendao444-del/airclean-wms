import fs from 'node:fs/promises';
import path from 'node:path';

const references = await Promise.all([
  'qa/product-design/notification-policy-tabs/illustrated-policy-a.png',
  'qa/product-design/notification-policy-tabs/policy-only-v2-a.png',
  'qa/product-design/notification-premium/premium-command-center.png',
].map((file) => fs.readFile(path.resolve(file))));

const prompt = `Use case: ui-mockup
Asset type: final production-quality desktop Electron policy screen
Primary request: Revise Image 1, the selected illustrated DBY policy concept, so every visible policy fact matches the application's current real configuration. There is no new policy change today, so remove every fake change, deadline, required acknowledgement, previous-price comparison, and confirmation checkbox. This is a permanent reference page, not an announcement.
Input hierarchy: Image 1 controls the chosen illustrated visual direction. Image 2 controls the policy library, three-column layout, and navigation. Image 3 controls the exact Electron shell, DBY premium identity, typography, spacing, faceted geometric icon and button backgrounds, and unchanged notification header.
Target dimensions: 1536 x 1024 desktop Electron frame.
Current date anchor: 09/09/2026.
Screen shell: preserve the exact "Hộp thư thông báo" header, KPI strip, bell, user profile, left application navigation, and top-level tabs "Thông báo" and "Chính sách hiện hành". Show "Chính sách hiện hành" selected. The notification experience is unchanged.
Current real packing policy data from the software database:
- Policy title: "Cơ chế hoa hồng đóng gói hiện hành".
- Current configuration last updated 03/09/2026 by admin.
- Commission is calculated per actual packing unit on each order line; total packing commission is the sum of each unit multiplied by its configured level rate.
- Level "Dễ": 20đ/gói.
- Level "Trung bình": 50đ/gói.
- Level "Cao": 100đ/gói.
- Custom level "Thùng kiện to": 500đ/kiện.
- Current assigned SKUs: 1-AMIECO = Cao; 1-AMIMEDICAL = Cao; 1-UPF = Cao; 1-UPF-NAMI = Cao; 1-KF94DUYNGOC = Thùng kiện to.
- Weekly packing winner reward: 100.000đ, active from the week beginning 31/08/2026.
- Wrong-order fine: official employee 30.000đ/order; seasonal employee 15.000đ/order.
- For payroll periods before 01/09/2026, preserve the legacy flat commission of 20đ/SKU.
Visual content: keep a friendly original DBY-green vector illustration of a warehouse packing employee and parcels. Below it, show four illustrated rate blocks for Dễ, Trung bình, Cao, and Thùng kiện to. Add a compact "Cách tính" explanation, the weekly reward, current SKU assignment list, wrong-order fine note, and legacy-policy note. Right rail shows current configuration status and concise version history, with "Không có thay đổi mới" near the related-notification area.
Style: DBY emerald and mint as dominant colors, deep navy typography, warm cream secondary panels, restrained red only for fines. Use crisp geometric facets in important icon backgrounds. Friendly ecommerce-style visual education without copying Shopee.
Hard constraints: no 500đ to 700đ change; no 700đ reward rate; no fake effective date 10/09/2026; no pending acknowledgement; no "Tôi đã đọc và hiểu" action; no orange-dominant campaign; no Shopee branding, logo, 9.9 mark, characters, wording, or layout; no notification-feed redesign; no notification sidebar module; no purple; no dark mode; no glassmorphism; no photo realism; no watermark; no clipped or illegible Vietnamese; one coherent screen only.`;

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

const outputPath = path.resolve('qa/product-design/notification-policy-tabs/illustrated-policy-real-data-final.png');
await fs.writeFile(outputPath, bytes);
console.log(outputPath);
