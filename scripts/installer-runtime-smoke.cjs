const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const appRoot = path.resolve(process.argv[2] || 'release-installer/win-unpacked/resources/app');
const requireFromApp = createRequire(path.join(appRoot, 'package.json'));
const requiredModules = [
  '@prisma/client',
  'bcryptjs',
  'xlsx',
  'adm-zip',
  'archiver',
  'glob',
  'googleapis',
  'nodemailer',
];

async function main() {
  for (const moduleName of requiredModules) requireFromApp.resolve(moduleName);

  if (fs.existsSync(path.join(appRoot, '.env'))) {
    throw new Error('Packaged runtime contains database credentials in app/.env.');
  }
  // The installer is self-contained, but credentials are supplied at launch.
  // An optional smoke URL is used only in controlled deployment environments.
  const smokeUrl = String(process.env.DBYPOS_RUNTIME_SMOKE_DATABASE_URL || '').trim();
  if (smokeUrl && !/^postgres(?:ql)?:\/\//i.test(smokeUrl)) {
    throw new Error('DBYPOS_RUNTIME_SMOKE_DATABASE_URL must be a PostgreSQL URL.');
  }
  process.env.DATABASE_URL = smokeUrl || 'postgresql://smoke:smoke@127.0.0.1:5432/smoke';

  const { PrismaClient } = requireFromApp('@prisma/client');
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
  try {
    const requiredDelegates = [
      'ecommerceExport',
      'ecommerceImportBatch',
      'order',
      'inventoryLog',
    ];
    for (const delegateName of requiredDelegates) {
      const delegate = prisma[delegateName];
      if (!delegate || typeof delegate.findFirst !== 'function') {
        throw new Error(
          `Packaged Prisma Client is stale: missing ${delegateName} delegate. Run prisma generate before packaging.`,
        );
      }
    }
    if (smokeUrl) await prisma.$connect();
  } finally {
    await prisma.$disconnect().catch(() => {});
  }

  console.log(
    `PACKAGED_LOGIN_RUNTIME_OK modules=${requiredModules.length} prismaEngine=true database=${smokeUrl ? 'connected' : 'not-requested'}`,
  );
}

main().catch((error) => {
  console.error(`PACKAGED_RUNTIME_FAILED ${error.message}`);
  process.exitCode = 1;
});
