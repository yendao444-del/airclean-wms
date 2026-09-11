import fs from 'node:fs/promises';
import path from 'node:path';

const reference = await fs.readFile(path.resolve('qa/product-design/notification-policy-tabs/illustrated-policy-real-data-final.png'));
const prompt = `Create one wide production UI illustration asset, 1536 x 512 pixels, for the DBY Software warehouse policy center. Use the attached full-screen mockup only for art direction.

Draw an original friendly Vietnamese warehouse packing employee in a DBY emerald-green uniform and cap, smiling while holding a sealed cardboard parcel at a packing station. Place the employee and parcel on the right half. Show a bright clean warehouse with shelves, boxes, barcode labels, a checklist board, and subtle mint geometric facets. Leave the left 42 percent calm and low-detail so live UI text can be placed there.

Palette: DBY emerald, mint, warm cream, deep navy accents. Flat vector editorial illustration with dimensional shading, crisp outlines, premium ecommerce policy-education quality. No orange-dominant palette, no Shopee branding, no logos, no letters, no words, no numbers, no signs with text, no watermark, no UI chrome, no border, no rounded outer frame, no photorealism.`;

const headers = { 'Content-Type': 'application/json' };
if (process.env.NINEROUTER_KEY) headers.Authorization = `Bearer ${process.env.NINEROUTER_KEY}`;
const response = await fetch(`${process.env.NINEROUTER_URL}/v1/images/generations`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model: 'cx/gpt-5.5-image',
    prompt,
    images: [`data:image/png;base64,${reference.toString('base64')}`],
    size: '1536x512',
    quality: 'high',
    image_detail: 'high',
    output_format: 'png',
    response_format: 'b64_json',
  }),
});
if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
const payload = await response.json();
const item = payload.data?.[0];
const bytes = item?.b64_json
  ? Buffer.from(item.b64_json, 'base64')
  : item?.url
    ? Buffer.from(await (await fetch(item.url)).arrayBuffer())
    : null;
if (!bytes) throw new Error('No image returned');
const output = path.resolve('src/assets/packing/policy-packing-hero.png');
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, bytes);
console.log(output);
