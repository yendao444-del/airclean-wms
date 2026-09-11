import fs from 'node:fs/promises';
import path from 'node:path';

const asset = process.argv[2];
const specs = {
  hero: {
    size: '1536x720',
    file: 'late-policy-hero.png',
    description: `A wide premium vector illustration of a Vietnamese DBY warehouse employee in emerald uniform hurrying toward a biometric attendance terminal, with an oversized analog wall clock behind him. The clock may have simple tick marks and hands but absolutely no digits, time label, words, or numbers. Keep the left 42 percent calm and low-detail for dynamic HTML copy. Main character, clock, and terminal sit on the right. Warehouse shelves and parcels create depth.`,
  },
  mild: {
    size: '1024x1024',
    file: 'late-policy-mild.png',
    description: `A compact square editorial vector vignette of the same Vietnamese DBY warehouse employee walking briskly with a small analog clock, calm and still in control. No panic. Clean mint background, subject centered, suitable inside a policy threshold panel.`,
  },
  medium: {
    size: '1024x1024',
    file: 'late-policy-medium.png',
    description: `A compact square editorial vector vignette of the same Vietnamese DBY warehouse employee running toward work and glancing at a small analog clock, visibly concerned but professional. Clean mint background, subject centered, suitable inside a policy threshold panel.`,
  },
  severe: {
    size: '1024x1024',
    file: 'late-policy-severe.png',
    description: `A compact square editorial vector vignette of the same Vietnamese DBY warehouse employee arriving very late, tired and worried beside a small analog clock. Restrained coral urgency accents, clean pale background, subject centered, suitable inside a policy threshold panel.`,
  },
};

if (!specs[asset]) throw new Error('Use hero, mild, medium, or severe');
const spec = specs[asset];
const reference = await fs.readFile(path.resolve('qa/product-design/notification-policy-tabs/late-landing-concepts/late-landing-c.png'));
const prompt = `Use case: illustration-story
Asset type: raster illustration used inside the coded DBY POS policy landing page
Primary request: ${spec.description}
Input image: Image 1 is the selected visual direction. Match its original character design, warehouse art direction, DBY emerald/mint palette, crisp geometric planes, clean line quality, and premium ecommerce-style finish. Generate only the requested illustration asset, not the surrounding application UI.
Style: polished original flat-vector illustration with subtle dimensional shading and crisp edges. DBY emerald and mint dominate; deep navy details; coral red only for urgency.
Constraints: no readable text, no letters, no numbers, no monetary values, no policy parameters, no logos, no signage copy, no UI cards, no application shell, no watermark, no photorealism, no purple, no orange dominance, no cropped face or hands.`;

const headers = { 'Content-Type': 'application/json' };
if (process.env.NINEROUTER_KEY) headers.Authorization = `Bearer ${process.env.NINEROUTER_KEY}`;
const response = await fetch(`${process.env.NINEROUTER_URL}/v1/images/generations`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model: 'cx/gpt-5.5-image',
    prompt,
    images: [`data:image/png;base64,${reference.toString('base64')}`],
    size: spec.size,
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

const outputDir = path.resolve('src/assets/policies');
await fs.mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, spec.file);
await fs.writeFile(outputPath, bytes);
console.log(outputPath);
