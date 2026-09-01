const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const appRoot = path.resolve(process.argv[2] || 'release-installer/win-unpacked/resources/app');
const requireFromApp = createRequire(path.join(appRoot, 'package.json'));
const requiredModules = [
  'dotenv',
  '@prisma/client',
  'bcryptjs',
  'xlsx',
  'adm-zip',
  'archiver',
  'glob',
  'googleapis',
  'nodemailer',
  'uuid',
];

async function main() {
  for (const moduleName of requiredModules) requireFromApp.resolve(moduleName);

  const runtimeEnvPath = path.join(appRoot, '.env');
  const runtimeEnv = requireFromApp('dotenv').parse(fs.readFileSync(runtimeEnvPath));
  if (!/^postgres(?:ql)?:\/\//i.test(runtimeEnv.DATABASE_URL || '')) {
    throw new Error('Packaged DATABASE_URL is missing or invalid.');
  }
  if (!/^postgres(?:ql)?:\/\//i.test(runtimeEnv.DIRECT_URL || '')) {
    throw new Error('Packaged DIRECT_URL is missing or invalid.');
  }

  process.env.DATABASE_URL = runtimeEnv.DATABASE_URL;
  process.env.DIRECT_URL = runtimeEnv.DIRECT_URL;

  const { PrismaClient } = requireFromApp('@prisma/client');
  const prisma = new PrismaClient({
    datasources: { db: { url: runtimeEnv.DATABASE_URL } },
  });
  try {
    await prisma.$connect();
  } finally {
    await prisma.$disconnect().catch(() => {});
  }

  console.log(
    `PACKAGED_LOGIN_RUNTIME_OK modules=${requiredModules.length} prismaEngine=true database=true`,
  );
}

main().catch((error) => {
  console.error(`PACKAGED_RUNTIME_FAILED ${error.message}`);
  process.exitCode = 1;
});
