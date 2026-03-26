#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Jumpship — Quick-start script (no Docker)
# Requirements: Python 3.11+, Node 18+, npm
# ─────────────────────────────────────────────────────────────────
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║           Jumpship — Start           ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── Backend ───────────────────────────────────────────────────────
echo "▶  Setting up backend…"
cd "$ROOT"

if [ ! -d ".venv" ]; then
  echo "   Creating virtual environment…"
  python3 -m venv .venv
fi

source .venv/bin/activate

echo "   Installing Python dependencies…"
pip install --quiet -r backend/requirements.txt

# Copy .env if missing
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo "   ⚠  Created backend/.env — add your ANTHROPIC_API_KEY (or configure via Settings UI)"
fi

echo "   Starting backend on http://localhost:8000 …"
uvicorn backend.main:app --reload --port 8000 &
BACKEND_PID=$!

# ── Frontend ──────────────────────────────────────────────────────
echo ""
echo "▶  Setting up frontend…"
cd "$ROOT/frontend"

if [ ! -d "node_modules" ]; then
  echo "   Installing npm dependencies…"
  npm install
fi

if [ ! -f ".env.local" ]; then
  cp .env.local.example .env.local
fi

echo "   Starting frontend on http://localhost:3000 …"
npm run dev &
FRONTEND_PID=$!

# ── Done ──────────────────────────────────────────────────────────
echo ""
echo "✅  Both servers are running!"
echo "   Frontend : http://localhost:3000"
echo "   Backend  : http://localhost:8000"
echo "   API Docs : http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
