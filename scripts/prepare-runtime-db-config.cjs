const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(projectRoot, '.env');
const outputDir = path.join(projectRoot, '.runtime-build');
const outputPath = path.join(outputDir, 'runtime.env');

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Missing build environment file: ${sourcePath}`);
}

const sourceConfig = dotenv.parse(fs.readFileSync(sourcePath));
const databaseUrl = String(sourceConfig.DATABASE_URL || '').trim();
const directUrl = String(sourceConfig.DIRECT_URL || databaseUrl).trim();

const isPostgresUrl = (value) => /^postgres(?:ql)?:\/\//i.test(value);
if (!isPostgresUrl(databaseUrl)) {
  throw new Error('DATABASE_URL in .env is missing or is not a PostgreSQL URL.');
}
if (!isPostgresUrl(directUrl)) {
  throw new Error('DIRECT_URL in .env is missing or is not a PostgreSQL URL.');
}

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  outputPath,
  `DATABASE_URL=${JSON.stringify(databaseUrl)}\nDIRECT_URL=${JSON.stringify(directUrl)}\n`,
  { encoding: 'utf8', mode: 0o600 },
);

console.log('[Build] Prepared the minimal runtime database configuration.');
