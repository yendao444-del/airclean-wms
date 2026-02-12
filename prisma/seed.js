const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding categories...');

    const categories = [
        { id: 1, name: 'Áo', description: null, parentId: null },
        { id: 2, name: 'Quần', description: null, parentId: null },
        { id: 3, name: 'Giày dép', description: null, parentId: null },
        { id: 4, name: 'Phụ kiện', description: null, parentId: null },
        { id: 5, name: 'Túi xách', description: null, parentId: null },
    ];

    for (const cat of categories) {
        await prisma.category.upsert({
            where: { id: cat.id },
            update: cat,
            create: cat,
        });
        console.log(`✅ Seeded category: ${cat.name}`);
    }

    console.log('✅ Seeding completed!');
}

main()
    .catch((e) => {
        console.error('❌ Seed error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
