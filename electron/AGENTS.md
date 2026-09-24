# Electron Guidance

- Treat `electron/ipc-handlers.js`, `electron/main.js`, and `electron/preload.js` as runtime boundaries. Make the smallest focused change and preserve existing channel names and payload shapes.
- Check data-flow callers before changing an IPC handler. Do not add destructive Supabase, Prisma, filesystem, or credential operations as part of a UI task.
- Keep secrets and local runtime configuration out of source control and release archives.
- Electron/backend changes require `updates/RELEASE-ver3.bat` at minimum; Prisma, Python, dependency, native, or packaging impact overrides that tier per the root `AGENTS.md`.
