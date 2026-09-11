
#!/usr/bin/env bash

# ============================================================
# build.sh — System Info full project build and validation
#
# Pipeline:
#   1. Validate project structure
#   2. Validate required commands
#   3. Validate required project files
#   4. Build native C++ engine
#   5. Restore/build .NET backend
#   6. Install/check frontend dependencies
#   7. Build frontend
#   8. Validate Python analytics service
#   9. If EVERYTHING passes -> run ./start-all.sh
#
# The script intentionally fails fast.
# Nothing is started until the entire project passes validation.
# ============================================================

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
BUILD_LOG="$LOG_DIR/build.log"

mkdir -p "$LOG_DIR"

# ============================================================
# Colors
# ============================================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

# ============================================================
# Helpers
# ============================================================

timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}

log() {
    echo "[$(timestamp)] $*" | tee -a "$BUILD_LOG"
}

ok() {
    echo -e "${GREEN}[OK]${NC} $1" | tee -a "$BUILD_LOG"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$BUILD_LOG"
}

fail() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$BUILD_LOG"
}

step() {
    echo "" | tee -a "$BUILD_LOG"
    echo -e "${CYAN}==================================================${NC}" | tee -a "$BUILD_LOG"
    echo -e "${CYAN} $1${NC}" | tee -a "$BUILD_LOG"
    echo -e "${CYAN}==================================================${NC}" | tee -a "$BUILD_LOG"
}

run_command() {
    echo "" | tee -a "$BUILD_LOG"
    echo "+ $*" | tee -a "$BUILD_LOG"

    if "$@" >> "$BUILD_LOG" 2>&1; then
        return 0
    fi

    return 1
}

require_command() {
    local command_name="$1"

    if command -v "$command_name" >/dev/null 2>&1; then
        ok "$command_name is available."
    else
        fail "$command_name is not installed or not available in PATH."
        return 1
    fi
}

require_directory() {
    local directory="$1"

    if [ -d "$PROJECT_ROOT/$directory" ]; then
        ok "Directory exists: $directory"
    else
        fail "Required directory is missing: $directory"
        return 1
    fi
}

require_file() {
    local file="$1"

    if [ -f "$PROJECT_ROOT/$file" ]; then
        ok "File exists: $file"
    else
        fail "Required file is missing: $file"
        return 1
    fi
}

# ============================================================
# Error handler
# ============================================================

on_error() {
    local exit_code=$?
    local line_number="${1:-unknown}"

    echo "" | tee -a "$BUILD_LOG"
    echo -e "${RED}==================================================${NC}" | tee -a "$BUILD_LOG"
    echo -e "${RED} BUILD FAILED${NC}" | tee -a "$BUILD_LOG"
    echo -e "${RED}==================================================${NC}" | tee -a "$BUILD_LOG"
    echo "Failed near line: $line_number" | tee -a "$BUILD_LOG"
    echo "Exit code: $exit_code" | tee -a "$BUILD_LOG"
    echo "" | tee -a "$BUILD_LOG"
    echo "Full build log:" | tee -a "$BUILD_LOG"
    echo "  $BUILD_LOG" | tee -a "$BUILD_LOG"
    echo "" | tee -a "$BUILD_LOG"

    exit "$exit_code"
}

trap 'on_error $LINENO' ERR

# ============================================================
# Start
# ============================================================

rm -f "$BUILD_LOG"

echo "==================================================" | tee -a "$BUILD_LOG"
echo " System Info — Full Build & Validation" | tee -a "$BUILD_LOG"
echo "==================================================" | tee -a "$BUILD_LOG"
echo "" | tee -a "$BUILD_LOG"

log "Project root: $PROJECT_ROOT"
log "Build started."

# ============================================================
# 1. Project structure
# ============================================================

step "1/8 — Checking project structure"

require_directory "backend"
require_directory "backend/SystemMonitor.Api"

require_directory "frontend"
require_directory "frontend/src"

require_directory "analytics"

require_directory "native"

require_file "start-all.sh"
require_file "setup.sh"

require_file "backend/SystemMonitor.Api/SystemMonitor.Api.csproj"
require_file "backend/SystemMonitor.Api/Program.cs"

require_file "frontend/package.json"
require_file "frontend/tsconfig.json"
require_file "frontend/vite.config.ts"

require_file "analytics/analytics_service.py"

require_file "native/build.sh"

ok "Project structure validation passed."

# ============================================================
# 2. Required commands
# ============================================================

step "2/8 — Checking build prerequisites"

require_command dotnet
require_command node
require_command npm
require_command python3
require_command cmake
require_command gcc
require_command g++
require_command make

ok "Required build commands are available."

# ============================================================
# 3. Environment validation
# ============================================================

step "3/8 — Checking environment"

if [ -z "${MONGO_URI:-}" ]; then
    warn "MONGO_URI is not set."
    warn "Build will continue because MongoDB is required at runtime, not compilation time."
else
    ok "MONGO_URI is configured."
fi

NODE_VERSION="$(node --version)"
NPM_VERSION="$(npm --version)"
DOTNET_VERSION="$(dotnet --version)"
PYTHON_VERSION="$(python3 --version 2>&1)"

log "Node:    $NODE_VERSION"
log "npm:     $NPM_VERSION"
log ".NET:    $DOTNET_VERSION"
log "Python:  $PYTHON_VERSION"

ok "Environment validation passed."

# ============================================================
# 4. Native C++ engine
# ============================================================

step "4/8 — Building native C++ engine"

cd "$PROJECT_ROOT/native"

if [ ! -x "./build.sh" ]; then
    warn "native/build.sh is not executable. Making it executable."
    chmod +x "./build.sh"
fi

if run_command bash "./build.sh"; then
    ok "Native C++ engine built successfully."
else
    fail "Native C++ engine build failed."
    exit 1
fi

NATIVE_LIBRARY="$PROJECT_ROOT/backend/SystemMonitor.Api/libsystemmonitor_native.so"

if [ -f "$NATIVE_LIBRARY" ]; then
    ok "Native library exists: backend/SystemMonitor.Api/libsystemmonitor_native.so"
else
    fail "Native build completed but libsystemmonitor_native.so was not produced."
    exit 1
fi

# ============================================================
# 5. .NET backend
# ============================================================

step "5/8 — Restoring and building .NET backend"

cd "$PROJECT_ROOT/backend/SystemMonitor.Api"

log "Restoring .NET dependencies..."

if run_command dotnet restore; then
    ok ".NET restore completed."
else
    fail ".NET restore failed."
    exit 1
fi

log "Building .NET backend..."

if run_command dotnet build --configuration Release --no-restore; then
    ok ".NET backend build completed successfully."
else
    fail ".NET backend build failed."
    exit 1
fi

# Verify expected endpoint registrations exist.

if grep -q "MapSpeedTestEndpoints" Program.cs; then
    ok "Speed test endpoint registration found."
else
    warn "MapSpeedTestEndpoints was not found in Program.cs."
fi

if grep -q "MapSystemEndpoints" Program.cs; then
    ok "System endpoint registration found."
else
    warn "MapSystemEndpoints was not found in Program.cs."
fi

ok ".NET backend validation passed."

# ============================================================
# 6. Frontend
# ============================================================

step "6/8 — Installing/checking frontend dependencies"

cd "$PROJECT_ROOT/frontend"

if [ ! -d "node_modules" ]; then
    log "node_modules not found. Running npm install..."

    if run_command npm install; then
        ok "Frontend dependencies installed."
    else
        fail "Frontend npm install failed."
        exit 1
    fi
else
    ok "Frontend node_modules already exists."
fi

if [ ! -f "package-lock.json" ]; then
    warn "package-lock.json was not found."
    warn "npm install will be used instead of npm ci."
else
    ok "package-lock.json found."
fi

# ------------------------------------------------------------
# Frontend TypeScript/Vite production build
# ------------------------------------------------------------

log "Running frontend production build..."

if run_command npm run build; then
    ok "Frontend production build completed successfully."
else
    fail "Frontend build failed."
    exit 1
fi

if [ -d "$PROJECT_ROOT/frontend/dist" ]; then
    ok "Frontend dist directory generated."
else
    fail "Frontend build reported success but dist directory was not generated."
    exit 1
fi

# ------------------------------------------------------------
# Check speed test frontend files
# ------------------------------------------------------------

SPEED_TEST_FILES=(
    "frontend/src/types/speedtest.ts"
    "frontend/src/hooks/useSpeedTest.ts"
    "frontend/src/components/SpeedTestCard.tsx"
)

for file in "${SPEED_TEST_FILES[@]}"; do
    require_file "$file"
done

ok "Speed test frontend files validated."

# ============================================================
# 7. Python analytics service
# ============================================================

step "7/8 — Validating Python analytics service"

cd "$PROJECT_ROOT/analytics"

log "Checking Python syntax..."

if run_command python3 -m py_compile analytics_service.py; then
    ok "Python syntax validation passed."
else
    fail "Python syntax validation failed."
    exit 1
fi

log "Checking required Python modules..."

if python3 - <<'PY' >> "$BUILD_LOG" 2>&1
import fastapi
import uvicorn
import pymongo
print("fastapi:", fastapi.__version__)
print("uvicorn:", uvicorn.__version__)
print("pymongo:", pymongo.version)
PY
then
    ok "Required Python modules are available."
else
    fail "Required Python analytics dependencies are missing."
    echo "Run: pip3 install fastapi uvicorn pymongo --break-system-packages"
    exit 1
fi

log "Checking analytics application import..."

if run_command python3 -c "from analytics_service import app; print(app)"; then
    ok "Analytics application imports successfully."
else
    fail "Analytics application failed to import."
    exit 1
fi

ok "Analytics service validation passed."

# ============================================================
# 8. Final validation
# ============================================================

step "8/8 — Final validation"

# Check scripts are executable.

if [ ! -x "$PROJECT_ROOT/start-all.sh" ]; then
    warn "start-all.sh is not executable. Making it executable."
    chmod +x "$PROJECT_ROOT/start-all.sh"
fi

if [ ! -x "$PROJECT_ROOT/setup.sh" ]; then
    warn "setup.sh is not executable. Making it executable."
    chmod +x "$PROJECT_ROOT/setup.sh"
fi

# Basic shell syntax validation.

log "Checking shell script syntax..."

if bash -n "$PROJECT_ROOT/start-all.sh"; then
    ok "start-all.sh syntax is valid."
else
    fail "start-all.sh contains a shell syntax error."
    exit 1
fi

if bash -n "$PROJECT_ROOT/setup.sh"; then
    ok "setup.sh syntax is valid."
else
    fail "setup.sh contains a shell syntax error."
    exit 1
fi

if bash -n "$PROJECT_ROOT/build.sh"; then
    ok "build.sh syntax is valid."
else
    fail "build.sh contains a shell syntax error."
    exit 1
fi

ok "All validation checks passed."

# ============================================================
# Build complete
# ============================================================

echo "" | tee -a "$BUILD_LOG"
echo "==================================================" | tee -a "$BUILD_LOG"
echo -e " ${GREEN}BUILD SUCCESSFUL${NC}" | tee -a "$BUILD_LOG"
echo "==================================================" | tee -a "$BUILD_LOG"
echo "" | tee -a "$BUILD_LOG"

echo "Everything compiled and validated successfully." | tee -a "$BUILD_LOG"
echo "" | tee -a "$BUILD_LOG"
echo "Build log:" | tee -a "$BUILD_LOG"
echo "  $BUILD_LOG" | tee -a "$BUILD_LOG"
echo "" | tee -a "$BUILD_LOG"

# ============================================================
# Automatically start the application
# ============================================================

echo "Starting the application..." | tee -a "$BUILD_LOG"
echo "" | tee -a "$BUILD_LOG"

exec "$PROJECT_ROOT/start-all.sh"