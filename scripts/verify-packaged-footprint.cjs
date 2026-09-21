const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(process.argv[2] || 'release4/win-unpacked/resources/app');
const nodeModulesRoot = path.join(appRoot, 'node_modules');

const requiredRuntimeModules = [
  'dotenv',
  '@prisma/client',
  '.prisma',
  '@supabase/supabase-js',
  '@zxing/browser',
  'adm-zip',
  'archiver',
  'bcryptjs',
  'cloudflared',
  'glob',
  'googleapis',
  'nodemailer',
  'uuid',
  'ws',
  'xlsx',
];

const forbiddenRendererModules = [
  '@phosphor-icons/react',
  'html2canvas',
  'jspdf',
  'pdfjs-dist',
  'qrcode.react',
];

const getDirectorySize = (directory) => {
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    total += entry.isDirectory() ? getDirectorySize(entryPath) : fs.statSync(entryPath).size;
  }
  return total;
};

if (!fs.existsSync(nodeModulesRoot)) {
  throw new Error(`Packaged node_modules was not found: ${nodeModulesRoot}`);
}

const missing = requiredRuntimeModules.filter((moduleName) =>
  !fs.existsSync(path.join(nodeModulesRoot, ...moduleName.split('/'))),
);
if (missing.length > 0) {
  throw new Error(`Packaged runtime is missing modules: ${missing.join(', ')}`);
}

const leaked = forbiddenRendererModules.filter((moduleName) =>
  fs.existsSync(path.join(nodeModulesRoot, ...moduleName.split('/'))),
);
if (leaked.length > 0) {
  throw new Error(`Renderer-only modules leaked into packaged runtime: ${leaked.join(', ')}`);
}

const appBytes = getDirectorySize(appRoot);
const moduleBytes = getDirectorySize(nodeModulesRoot);
console.log(
  `PACKAGED_FOOTPRINT_OK appMB=${(appBytes / 1024 / 1024).toFixed(2)}` +
  ` nodeModulesMB=${(moduleBytes / 1024 / 1024).toFixed(2)}` +
  ` requiredModules=${requiredRuntimeModules.length}`,
);
