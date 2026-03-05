#!/bin/bash
set -e

# ── Backend ──────────────────────────────────────────────────────────────────
cd /app/backend
pip install -r requirements.txt
python3 main.py &

# ── Frontend ─────────────────────────────────────────────────────────────────
cd /app/frontend
npm install
npm run dev &
