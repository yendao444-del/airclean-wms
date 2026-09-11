import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const scriptPath = fileURLToPath(import.meta.url);

if (args[0] === '--parallel') {
  const manifestPath = args[1];
  if (!manifestPath) {
    throw new Error('Usage: node generate-stock-check-concept.mjs --parallel <manifest.json>');
  }

  const entries = JSON.parse(await fs.readFile(path.resolve(manifestPath), 'utf8'));
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Parallel manifest must contain at least one { outputName, direction } entry.');
  }

  if (args.includes('--dry-run')) {
    for (const entry of entries) {
      if (!entry?.outputName || !entry?.direction) {
        throw new Error('Invalid manifest entry: outputName and direction are required.');
      }
      console.log(`[dry-run] ${entry.outputName}`);
    }
    process.exit(0);
  }

  const failures = [];
  let remaining = entries.length;

  await new Promise((resolve) => {
    for (const entry of entries) {
      if (!entry?.outputName || !entry?.direction) {
        failures.push('Invalid manifest entry: outputName and direction are required.');
        remaining -= 1;
        if (remaining === 0) resolve();
        continue;
      }

      const child = spawn(process.execPath, [scriptPath, entry.outputName, entry.direction], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => {
        failures.push(`${entry.outputName}: ${error.message}`);
      });
      child.on('close', (code) => {
        if (code === 0) process.stdout.write(stdout);
        else failures.push(`${entry.outputName}: ${stderr || stdout || `exit code ${code}`}`);
        remaining -= 1;
        if (remaining === 0) resolve();
      });
    }
  });

  if (failures.length > 0) throw new Error(failures.join('\n'));
  process.exit(0);
}

const [outputName, direction] = args;
if (!outputName || !direction) {
  throw new Error('Usage: node generate-stock-check-concept.mjs <output> <direction>');
}

const referencePath = 'C:/Users/Admin/AppData/Local/Temp/codex-clipboard-8d826e23-4c02-4bf6-9154-7fdcce0fab27.png';
const reference = await fs.readFile(referencePath);
const packageReferencePath = path.resolve('qa/product-design/stock-check-concepts/stock-check-final-layout.png');
const packageReference = await fs.readFile(packageReferencePath).catch(() => null);
const startedAt = Date.now();
const prompt = `Create a realistic, production-quality Vietnamese desktop POS inventory-check UI design, 1440x1024. Use the attached DBY Software POS screenshot as the visual design-system reference: preserve its green-and-white enterprise character, left navigation, compact density and Vietnamese language. Redesign Quản lý kho > Kiểm hàng around this concept direction: ${direction}.

The focused workflow must clearly distinguish "Tải nguyên niêm phong" from "Tải dở". Sealed sacks are counted by number of sacks and automatically converted using the package rate from Quản lý kiện hàng; opened sacks require actual loose SKU counting. Show up to 15 classification SKUs, realistic Unicare SKU examples, expected stock, conversion math, variance status, and one primary confirmation action. Use readable 14-16px typography, strong hierarchy, purposeful spacing, minimal nested cards, no dark mode, no illustration, no collage. Current date anchor: 02/09/2026.`;
const headers = { 'Content-Type': 'application/json' };
if (process.env.NINEROUTER_KEY) headers.Authorization = `Bearer ${process.env.NINEROUTER_KEY}`;
const response = await fetch(`${process.env.NINEROUTER_URL}/v1/images/generations`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    model: 'cx/gpt-5.5-image',
    prompt,
    images: [
      `data:image/png;base64,${reference.toString('base64')}`,
      ...(packageReference ? [`data:image/png;base64,${packageReference.toString('base64')}`] : []),
    ],
    size: '1536x1024',
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
const outputPath = path.resolve('qa/product-design/stock-check-concepts', outputName);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, bytes);
console.log(`${outputPath}\t${Math.round((Date.now() - startedAt) / 1000)}s`);
