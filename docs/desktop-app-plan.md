# Plan: JumpShip Desktop App (Tauri + PyInstaller)

> **Status:** BACKLOG (per DEC-20260427-04). Not in active sprint.

**Last updated:** 2026-04-26
**Target platform:** Windows (macOS/Linux future)

---

## Prerequisites

| Tool | Status | Install |
|------|--------|---------|
| Rust + Cargo | ❌ | `winget install Rustlang.Rustup` |
| Node 25 | ✅ | — |
| Python 3.14 | ✅ | — |
| PyInstaller | TBD | `pip install pyinstaller` |
| WebView2 Runtime | pre-installed Win11 | — |

---

## Phase 1 — Bundle backend (PyInstaller)

**`desktop/launcher.py`** — wraps uvicorn, writes chosen port to a temp file:
```python
import uvicorn, socket, pathlib, os

def find_free_port() -> int:
    with socket.socket() as s:
        s.bind(("", 0))
        return s.getsockname()[1]

port = find_free_port()
pathlib.Path(os.getenv("JUMPSHIP_PORT_FILE", "/tmp/jumpship.port")).write_text(str(port))
uvicorn.run("backend.main:app", host="127.0.0.1", port=port)
```

**`desktop/backend.spec`** — PyInstaller spec:
- Entry: `desktop/launcher.py`
- `--onedir` (faster startup vs `--onefile`)
- Hidden imports: `sqlalchemy.dialects.sqlite`, `passlib`, `cryptography`, `multipart`, `uvicorn.logging`, `uvicorn.lifespan.on`
- Data: `backend/data/` included
- Playwright: **excluded from main build** (optional separate install — see Phase 5)

Build command:
```bash
pyinstaller desktop/backend.spec --distpath desktop/dist --workpath desktop/build
```

---

## Phase 2 — Add Tauri to frontend

```bash
cd frontend
npm install --save-dev @tauri-apps/cli @tauri-apps/api
npx tauri init
```

**`src-tauri/tauri.conf.json`** key config:
```json
{
  "build": {
    "devUrl": "http://localhost:5173",
    "frontendDist": "../dist"
  },
  "bundle": {
    "targets": ["msi", "nsis"],
    "resources": ["../../desktop/dist/launcher/"]
  }
}
```

**`src-tauri/src/main.rs`** — Tauri setup:
1. Resolve path to bundled `launcher.exe` via `tauri::AppHandle`
2. Write temp port file path to env `JUMPSHIP_PORT_FILE`
3. Spawn `launcher.exe` subprocess
4. Poll port file until populated (max ~8s, 250ms intervals)
5. Inject port into frontend via Tauri command: `get_backend_port() -> u16`
6. Show main window only after backend responds on `/api/health`
7. Kill subprocess on `on_window_event(CloseRequested)`

---

## Phase 3 — Frontend API base URL

**`frontend/src/lib/api.ts`** — new file:
```typescript
import { invoke } from "@tauri-apps/api/core";

async function getBase(): Promise<string> {
  if (window.__TAURI__) {
    const port = await invoke<number>("get_backend_port");
    return `http://127.0.0.1:${port}`;
  }
  return ""; // Vite proxy handles /api in browser dev mode
}

export const API_BASE = await getBase();
```

All fetch calls prefix with `API_BASE` instead of hardcoded `/api`.

**Playwright pill UX:** show `title="Requires optional Playwright install"` tooltip + dimmed style if `window.__TAURI__` and Playwright not detected. Detection: Tauri command `is_playwright_installed() -> bool` checks if `playwright-chromium` exists in resources.

---

## Phase 4 — Build pipeline

**`build-desktop.bat`**:
```bat
@echo off
echo [1/3] Building Python backend...
pyinstaller desktop/backend.spec --distpath desktop/dist --workpath desktop/build --noconfirm

echo [2/3] Building frontend...
cd frontend && npm run build && cd ..

echo [3/3] Building Tauri installer...
cd frontend && npx tauri build

echo Done. Installer at: frontend/src-tauri/target/release/bundle/
```

Output:
```
frontend/src-tauri/target/release/bundle/
  msi/JumpShip_x.x.x_x64_en-US.msi
  nsis/JumpShip_x.x.x_x64-setup.exe
```

---

## Phase 5 — Playwright optional install (post-ship)

When user enables "Career Pages" scraper for first time:
1. Show dialog: "Career Pages requires Playwright (~300MB). Download now?"
2. On confirm: Tauri spawns `pip install playwright && playwright install chromium`
3. Progress shown in a modal
4. On complete: mark `playwright_installed=true` in local SQLite settings table
5. Playwright pill becomes active

Alternative (simpler): ship a separate `JumpShip-Playwright-Pack.exe` that installs the Playwright browser into the app's data dir.

---

## Bundle size estimate

| Component | Compressed |
|-----------|-----------|
| Python env (PyInstaller onedir) | ~70MB |
| Tauri shell | ~3MB |
| Frontend dist | ~2MB |
| **Total installer (.msi)** | **~80MB** |
| + Playwright optional pack | +~120MB |

---

## Effort estimate

| Phase | Time |
|-------|------|
| 1 — PyInstaller backend | 3–4h |
| 2 — Tauri init + Rust subprocess | 3–4h |
| 3 — Frontend API base | 1–2h |
| 4 — Build script + test installer | 2h |
| 5 — Playwright optional install | 2–3h |
| **Total** | **~12–15h** |

---

## Out of scope (this plan)

- macOS / Linux packaging
- Auto-updater (Tauri has built-in support — Phase 2 addition)
- Code signing (required for Windows Defender bypass in production)
- CI/CD pipeline for releases
