// Seed script để thêm categories mặc định vào database
const { PrismaClient } = require('@prisma/client');
const path = require('path');

// Load .env
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient();

async function seedCategories() {
    console.log('🌱 Seeding categories...');

    const defaultCategories = [
        'Khẩu Trang',
    ];

    for (const categoryName of defaultCategories) {
        // Check if exists
        const existing = await prisma.category.findFirst({
            where: { name: categoryName }
        });

        if (!existing) {
            const created = await prisma.category.create({
                data: { name: categoryName }
            });
            console.log(`  ✅ Created category: ${created.name}`);
        } else {
            console.log(`  ⏭️  Category already exists: ${categoryName}`);
        }
    }

    console.log('✅ Categories seeded successfully!');
}

seedCategories()
    .catch((error) => {
        console.error('❌ Error seeding categories:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
