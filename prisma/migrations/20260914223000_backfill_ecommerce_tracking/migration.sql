WITH tracking_candidates AS (
  SELECT
    "id",
    BTRIM(SUBSTRING("notes" FROM 'Tracking:[[:space:]]*([^|]+)')) AS "tracking"
  FROM "EcommerceExport"
  WHERE "trackingNumber" IS NULL
    AND "notes" LIKE '%Tracking:%'
)
UPDATE "EcommerceExport" AS export
SET "trackingNumber" = candidate."tracking"
FROM tracking_candidates AS candidate
WHERE export."id" = candidate."id"
  AND candidate."tracking" IS NOT NULL
  AND LOWER(candidate."tracking") NOT IN ('n/a', '-', '—', 'null', 'undefined');
