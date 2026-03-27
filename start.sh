#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# JumpShip — Quick-start script (no Docker)
# Prerequisites: Python 3.11+, Node 18+, Ollama (optional)
# ─────────────────────────────────────────────────────────────────
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║         JumpShip — Start             ║"
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
if [ ! -f ".env" ]; then
  cp .env.example .env 2>/dev/null || true
  echo "   ⚠  Created .env — configure your LLM provider if needed"
fi

echo "   Starting backend on http://localhost:8000 …"
PYTHONPATH="$ROOT" uvicorn backend.main:app --reload --port 8000 &
BACKEND_PID=$!

# ── Frontend ──────────────────────────────────────────────────────
echo ""
echo "▶  Setting up frontend…"
cd "$ROOT/frontend"

if [ ! -d "node_modules" ]; then
  echo "   Installing npm dependencies…"
  npm install
fi

echo "   Starting frontend on http://localhost:5173 …"
npm run dev &
FRONTEND_PID=$!

# ── Done ──────────────────────────────────────────────────────────
echo ""
echo "✅  Both servers are running!"
echo "   Frontend : http://localhost:5173"
echo "   Backend  : http://localhost:8000"
echo "   API Docs : http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
