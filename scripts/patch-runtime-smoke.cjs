const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const appRoot = path.resolve(process.argv[2] || '_patch_prisma_temp/resources/app');
const packagePath = path.join(appRoot, 'package.json');

function requireFile(filePath, description) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${description} is missing: ${filePath}`);
  }
}

async function main() {
  requireFile(packagePath, 'Patch package.json');
  const requireFromPatch = createRequire(packagePath);
  const clientEntry = requireFromPatch.resolve('@prisma/client');
  const enginePath = path.join(
    appRoot,
    'node_modules',
    '.prisma',
    'client',
    'query_engine-windows.dll.node',
  );
  requireFile(enginePath, 'Windows Prisma query engine');

  const { Prisma, PrismaClient } = requireFromPatch('@prisma/client');
  const prisma = new PrismaClient();
  try {
    if (!prisma.ecommerceImportBatch || typeof prisma.ecommerceImportBatch.findFirst !== 'function') {
      throw new Error('Prisma Client is stale: ecommerceImportBatch delegate is missing.');
    }

    const exportModel = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === 'EcommerceExport',
    );
    if (!exportModel) throw new Error('Prisma Client is stale: EcommerceExport model is missing.');

    const actualFields = new Set(exportModel.fields.map((field) => field.name));
    const requiredFields = [
      'trackingNumber',
      'orderPlacedAt',
      'slaDeadlineAt',
      'completedAt',
      'mismatchAt',
      'mismatchReason',
      'lastSeenImportBatchId',
    ];
    const missingFields = requiredFields.filter((field) => !actualFields.has(field));
    if (missingFields.length > 0) {
      throw new Error(`Prisma Client is stale: missing EcommerceExport fields: ${missingFields.join(', ')}`);
    }
  } finally {
    await prisma.$disconnect().catch(() => {});
  }

  console.log(`PATCH_RUNTIME_OK client=${clientEntry} prismaEngine=true ecommerceSla=true`);
}

main().catch((error) => {
  console.error(`PATCH_RUNTIME_FAILED ${error.message}`);
  process.exitCode = 1;
});
