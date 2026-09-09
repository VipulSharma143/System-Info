#!/usr/bin/env bash
# start-all.sh — one-command launcher for System Info.
# Place this at the project root: ./start-all.sh
#
# Starts, in order:
#   1. A quick MONGO_URI sanity check (fails fast with a clear message,
#      rather than three services separately failing later)
#   2. The .NET backend
#   3. The Python analytics service
#   4. The React frontend
#
# All three run as background processes; their output is logged to
# ./logs/ instead of interleaving in one terminal. Ctrl+C here stops
# all three cleanly.
#
# This replaces manually opening 3+ terminal tabs — it does NOT replace
# a real installer (.exe/.dmg with a double-clickable icon); see
# PROJECT_STATUS.md Phase 9/10 for that as a separate, larger goal.

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOG_DIR"

echo "=================================================="
echo " System Info — starting all services"
echo "=================================================="

# --- 1. Sanity check: MONGO_URI must be set ---
if [ -z "$MONGO_URI" ]; then
    echo "[ERROR] MONGO_URI is not set."
    echo "        Run: export MONGO_URI=\"mongodb+srv://...\""
    echo "        (add it to ~/.bashrc so this check passes automatically next time)"
    exit 1
fi
echo "[OK] MONGO_URI is set."

# --- Track PIDs so we can clean up on exit ---
PIDS=()

cleanup() {
    echo ""
    echo "Shutting down..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    exit 0
}
trap cleanup SIGINT SIGTERM

# --- 2. Backend (.NET) ---
echo "[1/3] Starting backend (.NET)..."
(
    cd "$PROJECT_ROOT/backend/SystemMonitor.Api"
    dotnet run > "$LOG_DIR/backend.log" 2>&1
) &
PIDS+=($!)
sleep 3  # give it a head start before the frontend/analytics try to reach it

# --- 3. Analytics service (Python/FastAPI) ---
echo "[2/3] Starting analytics service (Python)..."
(
    cd "$PROJECT_ROOT/analytics"
    uvicorn analytics_service:app --port 8001 --ws none > "$LOG_DIR/analytics.log" 2>&1
) &
PIDS+=($!)

# --- 4. Frontend (React/Vite) ---
echo "[3/3] Starting frontend (React)..."
(
    cd "$PROJECT_ROOT/frontend"
    npm run dev > "$LOG_DIR/frontend.log" 2>&1
) &
PIDS+=($!)

sleep 2
echo ""
echo "=================================================="
echo " All services starting. Logs in: $LOG_DIR"
echo "   - backend.log"
echo "   - analytics.log"
echo "   - frontend.log"
echo ""
echo " Frontend:   http://localhost:5173"
echo " Backend:    http://localhost:5132 (check backend.log for actual port)"
echo " Analytics:  http://localhost:8001"
echo ""
echo " Press Ctrl+C to stop everything."
echo "=================================================="

# Wait on all background jobs so the script (and trap) stays alive
wait
