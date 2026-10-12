# JumpShip — Documentation

Developer-facing reference. Operator and end-user docs live in the project README.

## Index

| File | Purpose | Status |
|------|---------|--------|
| [rust-migration/PLAN.md](./rust-migration/PLAN.md) | Native Rust desktop port: architecture, phases, decisions | ACTIVE |
| [rust-migration/SOURCES.md](./rust-migration/SOURCES.md) | Per-source scraper specs (endpoints, quirks, fixtures) | ACTIVE |
| [rust-migration/API.md](./rust-migration/API.md) | HTTP contract used by the frontend (+ `openapi.json`) | ACTIVE |
| [rust-migration/LLM.md](./rust-migration/LLM.md) | LLM provider layer spec | ACTIVE |
| [rust-migration/schema.sql](./rust-migration/schema.sql) | SQLite DDL to reuse in the port | ACTIVE |
| [desktop-app-plan.md](./desktop-app-plan.md) | Tauri + PyInstaller desktop wrapper plan | ARCHIVED |

## Conventions

- One topic per file, kebab-case filenames
- Use front-matter or top-of-file admonition for status (`ACTIVE`, `BACKLOG`, `ARCHIVED`)
- Link decisions back to `.jumpship/.hivemind/memory/decisions.log` by ID (e.g. `DEC-20260427-04`)
