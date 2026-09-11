import fs from 'node:fs/promises';
import path from 'node:path';

const direction = process.argv[2];
const directions = {
  a: `Friendly premium editorial vector illustration. On the right, a Vietnamese warehouse employee in a neat emerald uniform taps a biometric attendance terminal while a large physical wall clock shows 08:06. Subtle warehouse shelves and parcels behind them. Use crisp geometric planes, soft depth, clean ecommerce illustration quality, and a calm professional expression.`,
  b: `Premium isometric vector illustration. On the right, show a modern attendance kiosk, an employee ID card, a layered clock face, and three ascending time blocks representing light, medium, and serious lateness. Include one Vietnamese warehouse employee approaching the kiosk. Clear visual storytelling, sophisticated and operational rather than playful.`,
  c: `Polished cinematic flat-vector warehouse scene. On the right, a Vietnamese employee hurries toward a green attendance terminal while an oversized clock and a red minute hand create urgency. Use strong diagonal composition, geometric background facets, parcels and warehouse aisle depth, premium enterprise illustration quality.`
};

if (!directions[direction]) throw new Error('Use direction a, b, or c');

const reference = await fs.readFile(path.resolve('qa/product-design/notification-policy-tabs/illustrated-policy-real-data-final.png'));
const prompt = `Use case: illustration-story
Asset type: wide hero illustration for the DBY POS desktop policy detail module "Phạt đi làm muộn"
Primary request: Create a production-quality illustrated banner asset for the lateness policy module. ${directions[direction]}
Input image: use Image 1 only for the established DBY illustration language, emerald/mint palette, warm cream accents, geometric facets, warehouse setting, friendly Vietnamese character design, and premium finish. Do not reproduce the full UI screenshot.
Target dimensions: 1536 x 640 landscape banner.
Composition: reserve the left 42 percent as clean, low-detail mint negative space for live HTML title and policy text. Keep the main subject on the right 58 percent. The crop must work inside a rounded desktop hero panel.
Color palette: DBY emerald green, mint, off-white, deep navy details, with restrained coral red only for lateness urgency. No purple and no orange dominance.
Style: clean original vector illustration, crisp geometric shape layers, refined soft shadows, premium ecommerce-operational visual education, coherent with an Electron business application.
Constraints: image asset only; no app shell; no UI cards; no readable text; no numbers; no letters; no logos; no watermark; no photorealism; no glassmorphism; no blur-heavy background; no cropped face, hands, clock, or attendance terminal.`;

const headers = { 'Content-Type': 'application/json' };
if (process.env.NINEROUTER_KEY) headers.Authorization = `Bearer ${process.env.NINEROUTER_KEY}`;

const response = await fetch(`${process.env.NINEROUTER_URL}/v1/images/generations`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model: 'cx/gpt-5.5-image',
    prompt,
    images: [`data:image/png;base64,${reference.toString('base64')}`],
    size: '1536x640',
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

const outputDir = path.resolve('qa/product-design/notification-policy-tabs/late-policy-concepts');
await fs.mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `late-policy-${direction}.png`);
await fs.writeFile(outputPath, bytes);
console.log(outputPath);
