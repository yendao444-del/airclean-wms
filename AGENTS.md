# Repository Rules

These instructions apply to every coding task in this repository.

## Mandatory release classification

Before changing code, identify the affected runtime layers. After changing code, state which release file is required. Never recommend or run a smaller release tier than the change requires.

| Change impact | Required release file |
| --- | --- |
| Renderer-only UI, CSS, text, or frontend calculation; no Electron, Prisma, Python, dependency, or packaging change | `updates/RELEASE-SUPPERLITE.bat` |
| Renderer plus Electron/backend code; no Prisma schema/client, Python EXE, new runtime dependency, or base packaging change | `updates/RELEASE-ver3.bat` |
| Prisma schema/migration, Prisma package version, or code using a new Prisma model/delegate/field; no Python EXE change | `updates/RELEASE-PRISMA-PATCH.bat` |
| Prisma impact and Python face-service impact in the same release | `updates/RELEASE-ver2.bat` |
| Electron runtime, native dependency, installer configuration, base runtime layout, or a new backend runtime dependency | `updates/BUILD-INSTALLER.bat` or `updates/RELEASE.bat` as explicitly requested |

Prisma impact includes all of the following, even when `schema.prisma` itself was not edited:

- New code reads or writes a Prisma model, delegate, relation, enum, or field that an installed client may not contain.
- A Prisma migration is added or changed.
- `prisma/schema.prisma`, `prisma`, or `@prisma/client` changes.
- Production reports `Unknown argument`, a missing delegate, or a stale Prisma Client.

## Required release checks

Every release must pass the checks appropriate to its tier before ZIP creation or publication:

1. Run `node scripts/release-preflight.cjs <tier>`.
2. Run `npm run build`; a bare Vite build is not sufficient.
3. For Electron changes, run `node --check electron/ipc-handlers.js` and the relevant focused verification scripts.
4. Run `node scripts/verify-data-safety.js` for backend/data-flow releases.
5. For Prisma patches, run `npx prisma generate` before staging and then `node scripts/patch-runtime-smoke.cjs <staged-app-root>`.
6. Inspect the staged archive contents, not only the source tree.
7. Publish both the ZIP and its matching `.sha256` file. Never expose an update without both assets.

## Release safety

- Do not commit, push, tag, publish a GitHub release, or run a release BAT unless the user explicitly asks.
- Inspect `git status` before release work. Preserve unrelated user changes and never silently include them in a release commit.
- Do not use `updates/RELEASE-SUPPERLITE.bat` after an Electron, Prisma, Python, dependency, or packaging change.
- Do not use `updates/RELEASE-ver3.bat` after any Prisma impact. It intentionally does not contain Prisma Client.
- Do not make `updates/RELEASE-ver3.bat` heavy to solve Prisma problems; use the dedicated Prisma patch tier.
- Do not publish development database configuration, service credentials, OAuth secrets, private keys, or local tokens in a patch.
- Restore the prior `package.json` version when a release fails before publication.
- Treat a successful local build as necessary but not sufficient. The staged runtime and final archive must also pass validation.

The human-readable release guide is `updates/QUY_TAC_PHAT_HANH.md`. Security and credential packaging checks are in `updates/SECURITY-DEPLOYMENT.md`.
