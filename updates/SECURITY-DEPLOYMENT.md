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

The installer deliberately does not contain `.env`, `DATABASE_URL`, or
`DIRECT_URL`. Provision these variables through the service/user environment
before starting DBY POS (for example, a locked-down launcher or managed
Windows environment variables). Verify with the packaged runtime smoke script
by passing `DBYPOS_RUNTIME_SMOKE_DATABASE_URL` only in a controlled test
environment; never put that value in the installer command or archive.

Direct database credentials in a desktop process are not a complete security
boundary. The target architecture must move Prisma and privileged Supabase
Storage operations to a backend or Edge Function. The Electron client should
then receive only a public/publishable key and a user JWT protected by RLS.

`SUPABASE_SERVICE_ROLE_KEY` must not be set or persisted on end-user machines.
Evidence uploads should remain disabled until the server-side upload endpoint
is available.

Telegram WMS tokens and Google OAuth credentials are also runtime configuration.
The build no longer generates `electron/wms-bot-runtime.js` or
`electron/google-oauth-config.json`; configure them through the managed runtime
environment or the server-side integration before enabling those features.

## Release verification

Release scripts now run `scripts/verify-release-archive-secrets.cjs` before
uploading. The check rejects database files, backups, OAuth/Google tokens,
service credentials, private keys, and embedded bot tokens from every update
ZIP. Do not bypass this check; move privileged operations behind a server-side
endpoint before publishing another desktop update.

Run:

```powershell
npm install
npm audit --audit-level=high
npm run build
npx electron-builder --dir
```

Inspect the resulting `app.asar` and verify it contains neither
`electron/config.js` nor `electron/supabase-storage.json` before distribution.
