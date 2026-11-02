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

## Project map

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) when a task crosses more than one module or data boundary. Keep this root file focused on operating rules; keep the detailed domain map in that document.

- Stack: React + TypeScript + Vite renderer, Electron main/preload process, Prisma 5, Supabase integrations, and a Python face/attendance service.
- `src/`: renderer UI. Pages live in `src/pages/`; reusable UI in `src/components/`; state and integration helpers in `src/contexts/`, `src/lib/`, and `src/lib/hooks/`.
- `electron/`: desktop runtime, IPC handlers, preload bridge, update handlers, and external-service integrations.
- `prisma/`: schema, migrations, and local development database configuration. Treat model/delegate/field changes as Prisma-impacting even when the schema file is unchanged.
- `python/`: face/attendance runtime and packaged executable inputs.
- `scripts/`: build, release, data-safety, packaging, and verification utilities.
- `tests/`: focused JavaScript/data-flow tests. `tmp/`, `output/`, `dist/`, `build/`, and `release*` are generated or evidence-heavy areas unless a task explicitly targets them.

## Working conventions

- Start with the narrowest relevant file and symbol search. Do not scan `node_modules`, generated builds, release folders, logs, screenshots, or local databases unless the task explicitly requires them.
- Preserve unrelated working-tree changes. Before deleting, moving, or renaming a file, verify that it is not an active source, credential, database, or user evidence artifact.
- For data-flow work, inspect the caller and the persistence boundary together. Never run reset, truncate, destructive seed, or production migration commands without explicit approval.
- Prefer extracting pure calculations and service calls from large renderer pages before changing their behavior. Keep public IPC channels and Prisma contracts stable unless the task explicitly changes them.
- When a task is limited to documentation, instructions, or local search hygiene, do not run a release script or database command.

## Image Generation Routing

- When this project is being worked on inside Codex, use Codex's native image-generation capability first for image demos and visual mockups. Do not launch the external ChatGPT image script just because the request says "demo ảnh".
- Use the external ChatGPT image workflow below only when the project is being worked on outside Codex, or when the user explicitly asks to use ChatGPT's external image tool.

## Image Generation (External ChatGPT fallback)

- When the user needs an AI image or mockup, run directly:
  `"G:\CHATGPT IMAGES\.build-venv\Scripts\python.exe" "G:\DANGKHOA BILLABS	ools\dby_image.py" generate --prompt-file F [--size 1792x1024] [--out DIR]`
  Write the prompt to a file F in the scratchpad first; save demo images to `design-demos/` with `--out`.
- It uses the user's DBY Images tool with their ChatGPT login through OpenAI OAuth; the login is stored encrypted and refreshes itself. Never ask the user for a session token, API key or to copy a session.
- Only if the login has expired (`dby_image.py status` or a generate error says so), run `G:\DANGKHOA BILLABS	ools\dang-nhap-tao-anh.bat` in a terminal so the user can sign in with Google.
- Do not use the 9Router endpoint for demos unless the user asks: it needs a key that is not set on this machine.
- The tool takes a text prompt only, so describe the current UI and any reference image the user sent in words: colors, logo, labels, layout. Prompts must state what to preserve, the exact requested change, and an explicit `Avoid` list. Keep Vietnamese labels with correct diacritics, readable and unclipped.
- When mocking one part of the UI (a menu, a header, a dialog), ask for that part alone; a full-page prompt redraws the whole interface, which the user does not want.
- Never replace a failed generated image with an HTML/CSS screenshot.

## Mandatory Image Demo Gate

- When the user says "demo ảnh" or "demo", and for every Product Design request, the first deliverable is a visual demo image, not code.
- Always make exactly 2 versions with different directions using the selected image-generation tool, showing only the part asked for, and show both images in the response. Then stop and wait for the user to pick one.
- When the user provides a visual target, treat it as the source of truth: both versions follow it, adapted to the DBY POS interface.
- Do not edit application UI code, scaffold a prototype, or wire a route until the user picks a version or says to go ahead.
- After approval, implementation must finish with a `design-qa.md` comparison against the approved image.
