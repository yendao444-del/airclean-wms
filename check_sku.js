const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

process.env.DATABASE_URL = "postgresql://[REDACTED]@supabase/postgres";

async function main() {
    const prisma = new PrismaClient();
    const out = [];

    const testSkus = ['10-5DTHINHPHAT-XANHNHAT', '50-5DMONJI-TRANG'];
    for (const sku of testSkus) {
        out.push(`\n=== Testing "${sku}" ===`);

        // Step 1: Check combo
        const combo = await prisma.comboProduct.findUnique({ where: { sku } });
        out.push(`  Combo: ${combo ? 'YES - ' + combo.name : 'NO'}`);

        // Step 2: Check product direct
        const product = await prisma.product.findUnique({ where: { sku } });
        out.push(`  Product: ${product ? 'YES - ' + product.name : 'NO'}`);

        // Step 3: Check variants
        if (!product) {
            const vps = await prisma.product.findMany({ where: { variants: { contains: sku } } });
            out.push(`  Variant contains: ${vps.length} results`);
            for (const vp of vps) {
                const variants = JSON.parse(vp.variants);
                const exact = variants.find(v => v.sku === sku);
                out.push(`    "${vp.name}": exact=${exact ? 'YES' : 'NO(false positive)'}`);
            }
        }
    }

    // Also check what refund items look like
    const refunds = await prisma.refund.findMany({
        where: { status: 'received' },
        take: 3,
        select: { id: true, orderNumber: true, items: true }
    });
    out.push(`\n=== Sample received refunds ===`);
    for (const r of refunds) {
        out.push(`Refund #${r.id} Order: ${r.orderNumber}`);
        try {
            const items = JSON.parse(r.items);
            for (const it of items) {
                out.push(`  variantSku="${it.variantSku}" qty=${it.quantity}`);
            }
        } catch { }
    }

    fs.writeFileSync('check_sku_result.txt', out.join('\n'), 'utf8');
    console.log('Done! Check check_sku_result.txt');
    await prisma.$disconnect();
}

main().catch(console.error);
