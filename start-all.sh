#!/usr/bin/env bash
# start-all.sh — one-command launcher for System Info.
#
# Starts backend, analytics service, and frontend in order — but unlike
# a fixed sleep, this WAITS for each one to actually respond before
# starting the next, and fails loudly with a clear error (not a silent
# hang or a false "success") if a service doesn't come up within its
# timeout.

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOG_DIR"

BACKEND_PORT=""
ANALYTICS_PORT=8001
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

fail_with_log() {
    local service="$1"
    local logfile="$2"
    echo ""
    echo "=================================================="
    echo " [ERROR] $service did not start correctly."
    echo "=================================================="
    echo "Last 20 lines of $logfile:"
    echo "--------------------------------------------------"
    tail -20 "$logfile"
    echo "--------------------------------------------------"
    cleanup
}

echo "=================================================="
echo " System Info — starting all services"
echo "=================================================="

# --- 1. MONGO_URI sanity check ---
if [ -z "$MONGO_URI" ]; then
    echo "[ERROR] MONGO_URI is not set."
    echo "        Run: export MONGO_URI=\"mongodb+srv://...\""
    exit 1
fi
echo "[OK] MONGO_URI is set."

# --- 2. Start backend, wait for it to actually be listening ---
echo "[1/3] Starting backend (.NET)..."
(
    cd "$PROJECT_ROOT/backend/SystemMonitor.Api"
    dotnet run > "$LOG_DIR/backend.log" 2>&1
) &
PIDS+=($!)

echo "      Waiting for backend to finish building and start listening..."
BACKEND_TIMEOUT=90
elapsed=0
while [ -z "$BACKEND_PORT" ] && [ "$elapsed" -lt "$BACKEND_TIMEOUT" ]; do
    if [ -f "$LOG_DIR/backend.log" ]; then
        BACKEND_PORT=$(grep -oP '(?<=Now listening on: http://localhost:)\d+' "$LOG_DIR/backend.log" 2>/dev/null | head -n1)
    fi
    if [ -n "$BACKEND_PORT" ]; then
        break
    fi
    # Bail early if the dotnet process itself died (e.g. build error)
    if ! kill -0 "${PIDS[0]}" 2>/dev/null; then
        fail_with_log "Backend" "$LOG_DIR/backend.log"
    fi
    sleep 1
    elapsed=$((elapsed + 1))
done

if [ -z "$BACKEND_PORT" ]; then
    fail_with_log "Backend (timed out after ${BACKEND_TIMEOUT}s)" "$LOG_DIR/backend.log"
fi

# Confirm it actually responds, not just that the log line appeared
if ! curl -s -f "http://localhost:$BACKEND_PORT/api/system/all" > /dev/null 2>&1; then
    fail_with_log "Backend (listening but not responding)" "$LOG_DIR/backend.log"
fi
echo "[OK] Backend is up on port $BACKEND_PORT."

# --- 3. Start analytics service, wait for /health ---
echo "[2/3] Starting analytics service (Python)..."
(
    cd "$PROJECT_ROOT/analytics"
    uvicorn analytics_service:app --port "$ANALYTICS_PORT" --ws none > "$LOG_DIR/analytics.log" 2>&1
) &
PIDS+=($!)

echo "      Waiting for analytics service to respond..."
ANALYTICS_TIMEOUT=30
elapsed=0
ANALYTICS_READY=false
while [ "$elapsed" -lt "$ANALYTICS_TIMEOUT" ]; do
    if curl -s -f "http://localhost:$ANALYTICS_PORT/health" > /dev/null 2>&1; then
        ANALYTICS_READY=true
        break
    fi
    if ! kill -0 "${PIDS[1]}" 2>/dev/null; then
        fail_with_log "Analytics service" "$LOG_DIR/analytics.log"
    fi
    sleep 1
    elapsed=$((elapsed + 1))
done

if [ "$ANALYTICS_READY" != true ]; then
    fail_with_log "Analytics service (timed out after ${ANALYTICS_TIMEOUT}s)" "$LOG_DIR/analytics.log"
fi
echo "[OK] Analytics service is up on port $ANALYTICS_PORT."

# --- 4. Start frontend ---
echo "[3/3] Starting frontend (React)..."
(
    cd "$PROJECT_ROOT/frontend"
    npm run dev > "$LOG_DIR/frontend.log" 2>&1
) &
PIDS+=($!)

echo "      Waiting for frontend dev server..."
FRONTEND_TIMEOUT=30
elapsed=0
FRONTEND_READY=false
while [ "$elapsed" -lt "$FRONTEND_TIMEOUT" ]; do
    if grep -q "Local:" "$LOG_DIR/frontend.log" 2>/dev/null; then
        FRONTEND_READY=true
        break
    fi
    if ! kill -0 "${PIDS[2]}" 2>/dev/null; then
        fail_with_log "Frontend" "$LOG_DIR/frontend.log"
    fi
    sleep 1
    elapsed=$((elapsed + 1))
done

if [ "$FRONTEND_READY" != true ]; then
    fail_with_log "Frontend (timed out after ${FRONTEND_TIMEOUT}s)" "$LOG_DIR/frontend.log"
fi
echo "[OK] Frontend is up."

echo ""
echo "=================================================="
echo " Everything is running and verified."
echo ""
echo " Frontend:   http://localhost:5173"
echo " Backend:    http://localhost:$BACKEND_PORT"
echo " Analytics:  http://localhost:$ANALYTICS_PORT"
echo ""
echo " Logs in: $LOG_DIR"
echo " Press Ctrl+C to stop everything."
echo "=================================================="

wait
