#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fix duplicate combo handlers in ipc-handlers.js
Removes ALL combo-related handlers and adds a clean set
"""

import re

# Read backup file
with open(r'g:\QUAN LY BAN HANG\apps\desktop\electron\ipc-handlers.js.backup', 'r', encoding='utf-8') as f:
    content = f.read()

# Find where combo handlers start (search for first occurrence)
combo_start_pattern = r"// ={30,}\s*\n// .*COMBO.*\n// ={30,}"
match = re.search(combo_start_pattern, content, re.IGNORECASE)

if match:
    # Cut everything after this point
    clean_content = content[:match.start()]
    print(f"Found combo section at position {match.start()}")
else:
    # Fallback: search for first combos:getAll
    match = re.search(r"ipcMain\.handle\('combos:getAll'", content)
    if match:
        # Go back to find comment block
        lines = content[:match.start()].split('\n')
        # Remove last few lines (likely comments)
        clean_content = '\n'.join(lines[:-10])
        print(f"Found combos:getAll at position {match.start()}, cutting before it")
    else:
        print("No combo handlers found, using full content")
        clean_content = content

# Add single clean combo handlers section
combo_handlers = """

// ========================================
// COMBO PRODUCTS
// ========================================

ipcMain.handle('combos:getAll', async () => {
    try {
        if (!prisma) return { success: true, data: [] };
        const combos = await prisma.comboProduct.findMany({ orderBy: { createdAt: 'desc' } });
        const products = await prisma.product.findMany();
        const combosWithStock = combos.map(combo => {
            const items = JSON.parse(combo.items || '[]');
            let availableStock = Infinity;
            items.forEach(item => {
                const product = products.find(p => p.id === item.productId);
                if (product && product.variants) {
                    const variants = JSON.parse(product.variants);
                    const variant = variants[item.variantIndex];
                    if (variant) {
                        const possibleCombos = Math.floor((variant.stock || 0) / item.quantity);
                        availableStock = Math.min(availableStock, possibleCombos);
                    }
                } else if (product) {
                    const possibleCombos = Math.floor(product.stock / item.quantity);
                    availableStock = Math.min(availableStock, possibleCombos);
                }
            });
            return { ...combo, stock: availableStock === Infinity ? 0 : availableStock };
        });
        return { success: true, data: combosWithStock };
    } catch (error) {
        console.error('Error getting combos:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('combos:create', async (event, data) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        const combo = await prisma.comboProduct.create({
            data: { sku: data.sku, name: data.name, items: JSON.stringify(data.items), price: data.price, cost: data.cost, status: 'active' }
        });
        return { success: true, data: combo };
    } catch (error) {
        console.error('Error creating combo:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('combos:update', async (event, id, data) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        const combo = await prisma.comboProduct.update({
            where: { id: parseInt(id) },
            data: { sku: data.sku, name: data.name, items: JSON.stringify(data.items), price: data.price, cost: data.cost }
        });
        return { success: true, data: combo };
    } catch (error) {
        console.error('Error updating combo:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('combos:delete', async (event, id) => {
    try {
        if (!prisma) throw new Error('Database not initialized');
        await prisma.comboProduct.delete({ where: { id: parseInt(id) } });
        return { success: true };
    } catch (error) {
        console.error('Error deleting combo:', error);
        return { success: false, error: error.message };
    }
});

module.exports = { prisma };
"""

final_content = clean_content + combo_handlers

# Write to new file
output_path = r'g:\QUAN LY BAN HANG\apps\desktop\electron\ipc-handlers.js'
with open(output_path, 'w', encoding='utf-8') as f:
    f.write(final_content)

print(f"\n✅ SUCCESS!")
print(f"Created new ipc-handlers.js")
print(f"Total lines: {len(final_content.splitlines())}")
print(f"Combo handlers: {final_content.count('ipcMain.handle(\\'combos:')}")
