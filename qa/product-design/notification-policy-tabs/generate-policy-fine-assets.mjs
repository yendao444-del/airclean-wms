import fs from 'node:fs/promises';
import path from 'node:path';

const key = process.argv[2];
const specs = {
    wrongOrder: {
        file: 'wrong-order-fine-hero.png',
        description: 'a warehouse packer discovering a mismatched shipping label on a sealed parcel, with a red warning tag and a correctly packed box beside it; the scene clearly communicates wrong-order packing and quality control',
    },
    vatLate: {
        file: 'vat-invoice-late-hero.png',
        description: 'a warehouse coordinator checking a stack of incoming parcels and an overdue invoice document beside a calendar with an emphasized overdue page; the scene clearly communicates late VAT invoice submission',
    },
    returnOverdue: {
        file: 'return-overdue-hero.png',
        description: 'a returns desk with a parcel waiting in a return crate, a circular return arrow and a clock indicating an overdue processing queue; the scene clearly communicates late return processing',
    },
    refundOverdue: {
        file: 'refund-overdue-hero.png',
        description: 'a warehouse receiving employee checking an unclaimed returned parcel at a receiving dock, with a return label, clock and pending tray; the scene clearly communicates an overdue returned shipment receipt',
    },
    taskDeadline: {
        file: 'task-deadline-fine-hero.png',
        description: 'a team lead handing a clipboard task to a warehouse employee while a large analog deadline clock and a small red overdue marker signal a missed handoff; the scene clearly communicates a late task deadline',
    },
    taskEvidence: {
        file: 'task-evidence-fine-hero.png',
        description: 'a warehouse employee taking a proof photo of a completed packing task with a tablet camera, with a checklist showing one missing proof item and a review warning; the scene clearly communicates missing or rejected work evidence',
    },
    stockMissing: {
        file: 'stock-check-missing-hero.png',
        description: 'an inventory checker scanning shelves with a handheld barcode scanner while one aisle is marked as not checked and a daily checklist is pending; the scene clearly communicates a missing daily stock check',
    },
};

if (!specs[key]) throw new Error(`Use one of: ${Object.keys(specs).join(', ')}`);
const spec = specs[key];
const reference = await fs.readFile(path.resolve('qa/product-design/notification-policy-tabs/late-landing-concepts/late-landing-c.png'));
const prompt = `Use case: illustration-story
Asset type: wide raster illustration used as the background of one DBY POS policy tab
Primary request: ${spec.description}.
Input image: Image 1 is the selected visual direction. Match its DBY warehouse art direction, emerald and mint palette, crisp geometric planes, friendly polished character design, and premium ecommerce-style finish. Generate only the requested scene, not surrounding UI.
Style: polished original 3D-cartoon/vector hybrid illustration with clean edges, subtle dimensional shading, and a wide cinematic composition.
Composition: 1792 x 1024 landscape background, leave the left 40 percent calmer and lower-detail for live HTML copy; keep the relevant subject and prop on the right; make the policy meaning immediately understandable from the image alone.
Color palette: DBY emerald, mint, deep navy, warm amber for supporting cues, and coral red only for urgency.
Constraints: no readable text, no letters, no numbers, no monetary values, no policy parameters, no logos, no signage copy, no UI cards, no application shell, no watermark, no purple, no orange dominance, no cropped face or hands.`;

const headers = { 'Content-Type': 'application/json' };
if (process.env.NINEROUTER_KEY) headers.Authorization = `Bearer ${process.env.NINEROUTER_KEY}`;
const response = await fetch(`${process.env.NINEROUTER_URL}/v1/images/generations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
        model: 'cx/gpt-5.5-image',
        prompt,
        images: [`data:image/png;base64,${reference.toString('base64')}`],
        size: '1792x1024',
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
