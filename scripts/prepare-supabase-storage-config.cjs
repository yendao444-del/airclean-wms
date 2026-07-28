const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const url = String(process.env.SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const bucket = String(process.env.SUPABASE_EVIDENCE_BUCKET || 'daily-task-evidence').trim();

if (!url || !serviceRoleKey) {
    console.error('[ERROR] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from .env');
    process.exit(1);
}

const outputPath = path.resolve(__dirname, '..', 'electron', 'supabase-storage.json');
fs.writeFileSync(outputPath, JSON.stringify({ supabaseUrl: url, serviceRoleKey, bucket }, null, 2), 'utf8');
console.log('[OK] Supabase Storage runtime configuration prepared.');
