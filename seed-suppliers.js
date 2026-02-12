// Seed suppliers
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function seedSuppliers() {
    console.log('🌱 Seeding suppliers...');

    try {
        // Check existing
        const count = await prisma.supplier.count();
        if (count > 0) {
            console.log(`✅ Already have ${count} suppliers`);
            return;
        }

        // Create suppliers
        const suppliers = await prisma.supplier.createMany({
            data: [
                {
                    code: 'NCC001',
                    name: 'Nhà cung cấp A',
                    phone: '0123456789',
                    email: 'ncc.a@example.com',
                    address: '123 Đường ABC, TP.HCM',
                    status: 'active'
                },
                {
                    code: 'NCC002',
                    name: 'Nhà cung cấp B',
                    phone: '0987654321',
                    email: 'ncc.b@example.com',
                    address: '456 Đường XYZ, Hà Nội',
                    status: 'active'
                },
                {
                    code: 'NCC003',
                    name: 'Công ty TNHH ABC',
                    phone: '0912345678',
                    status: 'active'
                }
            ]
        });

        console.log(`✅ Created ${suppliers.count} suppliers!`);
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await prisma.$disconnect();
    }
}

seedSuppliers();
