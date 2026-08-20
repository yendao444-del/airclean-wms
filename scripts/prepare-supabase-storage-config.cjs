console.error(
    '[SECURITY] This script is disabled: a Supabase Service Role Key must never be written into the Electron application. Use a backend or Edge Function for privileged Storage operations.',
);
process.exit(1);
