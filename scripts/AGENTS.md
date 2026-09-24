# Script Guidance

- Scripts may have external side effects. Read the target paths and environment variables before running them.
- Prefer verification scripts and dry-run/report modes. Do not run release, migration, upload, reset, or cleanup scripts unless the task explicitly requires it.
- Keep generated logs and evidence under existing temporary/evidence directories rather than the source tree.
