// Payroll does not use customer labels or product descriptions. Project only
// existing item keys (without coercing aliases/quantities) before transferring.
async function readPackingPayrollOrders(prisma, Prisma, dateFilter, maxRows) {
  const conditions = [Prisma.sql`"status" = 'completed'`];
  if (dateFilter.gte) conditions.push(Prisma.sql`"ecommerceExportDate" >= ${dateFilter.gte}`);
  if (dateFilter.lte) conditions.push(Prisma.sql`"ecommerceExportDate" <= ${dateFilter.lte}`);
  return prisma.$queryRaw(Prisma.sql`
    SELECT "id", "ecommerceExportDate", "createdBy", "pickedBy",
      COALESCE((
        SELECT jsonb_agg(COALESCE((
          SELECT jsonb_object_agg(k, v)
          FROM jsonb_each(item) AS fields(k, v)
          WHERE k IN ('variantSku', 'sku', 'variant_sku', 'product_sku', 'SKU', 'Sku', 'quantity', 'qty')
        ), '{}'::jsonb) ORDER BY ordinal)
        FROM jsonb_array_elements(COALESCE(NULLIF("items", ''), '[]')::jsonb)
          WITH ORDINALITY AS entries(item, ordinal)
      ), '[]'::jsonb) AS "items"
    FROM "EcommerceExport"
    WHERE ${Prisma.join(conditions, ' AND ')}
    ORDER BY "ecommerceExportDate" DESC, "id" DESC
    LIMIT ${maxRows + 1}
  `);
}

module.exports = { readPackingPayrollOrders };
