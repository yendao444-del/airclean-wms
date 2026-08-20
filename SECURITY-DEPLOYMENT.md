# Security deployment checklist

## Required before the next release

1. Rotate every credential that was present in an older `app.asar`, including
   PostgreSQL, Supabase Service Role, Telegram, and Google OAuth credentials.
2. Close all running Electron instances and run `npm install` so the installed
   modules match `package-lock.json`.
3. Do not restore `electron/config.js` or `electron/supabase-storage.json` to
   the build. The builder explicitly excludes these files.
4. Publish a SHA-256 checksum asset next to every update ZIP. The updater now
   rejects releases without a checksum.

## Runtime configuration

Production configuration is read from runtime environment variables. At a
minimum, the current transitional desktop architecture requires
`DATABASE_URL`; `DIRECT_URL` is optional.

Direct database credentials in a desktop process are not a complete security
boundary. The target architecture must move Prisma and privileged Supabase
Storage operations to a backend or Edge Function. The Electron client should
then receive only a public/publishable key and a user JWT protected by RLS.

`SUPABASE_SERVICE_ROLE_KEY` must not be set or persisted on end-user machines.
Evidence uploads should remain disabled until the server-side upload endpoint
is available.

## Release verification

Run:

```powershell
npm install
npm audit --audit-level=high
npm run build
npx electron-builder --dir
```

Inspect the resulting `app.asar` and verify it contains neither
`electron/config.js` nor `electron/supabase-storage.json` before distribution.
