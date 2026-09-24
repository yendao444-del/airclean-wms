# Renderer Guidance

- Keep React rendering and user interaction in pages/components; move reusable calculations, formatting, and API orchestration into `src/lib/` or `src/lib/hooks/`.
- Before editing a large page, identify its data sources, mutation handlers, and child components. Preserve existing IPC/API contracts unless the task explicitly changes them.
- Do not import Electron internals directly into renderer code. Use the typed preload bridge in `src/types/`.
- Prefer focused tests for calculations and data transformations. Avoid broad formatting-only rewrites of unrelated pages.
- Renderer-only changes use `updates/RELEASE-SUPPERLITE.bat`; changes crossing into Electron/backend require the release tier defined by the root `AGENTS.md`.
