#!/usr/bin/env bash

# ============================================================
# clean.sh — System Info full project cleanup
#
# Purpose:
#   Remove generated build artifacts, dependencies, caches,
#   temporary files, compiled output and project logs so the
#   repository is ready to ZIP, share or archive.
#
# IMPORTANT:
#   This script does NOT remove:
#     - Source code
#     - .git repository
#     - package.json
#     - package-lock.json
#     - .NET project files
#     - Cargo.toml
#     - Cargo.lock
#     - Configuration files
#     - Documentation
#     - .env files
#     - User application data
#
# Cleanup targets:
#   - node_modules
#   - frontend/dist
#   - Vite caches
#   - .NET bin directories
#   - .NET obj directories
#   - Native CMake/build output
#   - Native compiled libraries
#   - Tauri target output
#   - Python __pycache__
#   - Python bytecode
#   - pytest/mypy/ruff caches
#   - Project logs
#   - Temporary/editor files
#
# The cleanup scans the ENTIRE project, not only backend/.
# This catches directories such as:
#
#   launcher/bin
#   launcher/obj
#   backend/SystemMonitor.Api/bin
#   backend/SystemMonitor.Api/obj
#
# After cleanup:
#
#   ./build.sh
#
# can be used to rebuild the entire project from source.
#
# ============================================================

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$PROJECT_ROOT/logs"
CLEAN_LOG="$LOG_DIR/clean.log"

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
    echo "[$(timestamp)] $*" | tee -a "$CLEAN_LOG"
}

ok() {
    echo -e "${GREEN}[OK]${NC} $1" | tee -a "$CLEAN_LOG"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$CLEAN_LOG"
}

fail() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$CLEAN_LOG"
}

step() {
    echo "" | tee -a "$CLEAN_LOG"
    echo -e "${CYAN}==================================================${NC}" | tee -a "$CLEAN_LOG"
    echo -e "${CYAN} $1${NC}" | tee -a "$CLEAN_LOG"
    echo -e "${CYAN}==================================================${NC}" | tee -a "$CLEAN_LOG"
}

remove_path() {
    local path="$1"
    local description="$2"

    if [ -e "$path" ] || [ -L "$path" ]; then
        log "Removing: $path"

        rm -rf -- "$path"

        if [ ! -e "$path" ] && [ ! -L "$path" ]; then
            ok "$description removed."
        else
            fail "Could not completely remove: $path"
            return 1
        fi
    else
        ok "$description not present. Nothing to remove."
    fi
}

# ============================================================
# Error handler
# ============================================================

on_error() {
    local exit_code=$?
    local line_number="${1:-unknown}"

    echo "" | tee -a "$CLEAN_LOG"
    echo -e "${RED}==================================================${NC}" | tee -a "$CLEAN_LOG"
    echo -e "${RED} CLEANUP FAILED${NC}" | tee -a "$CLEAN_LOG"
    echo -e "${RED}==================================================${NC}" | tee -a "$CLEAN_LOG"
    echo "Failed near line: $line_number" | tee -a "$CLEAN_LOG"
    echo "Exit code: $exit_code" | tee -a "$CLEAN_LOG"
    echo "" | tee -a "$CLEAN_LOG"
    echo "Full cleanup log:" | tee -a "$CLEAN_LOG"
    echo "  $CLEAN_LOG" | tee -a "$CLEAN_LOG"
    echo "" | tee -a "$CLEAN_LOG"

    exit "$exit_code"
}

trap 'on_error $LINENO' ERR

# ============================================================
# Start
# ============================================================

rm -f "$CLEAN_LOG"

echo "==================================================" | tee -a "$CLEAN_LOG"
echo " System Info — Full Project Cleanup" | tee -a "$CLEAN_LOG"
echo "==================================================" | tee -a "$CLEAN_LOG"
echo "" | tee -a "$CLEAN_LOG"

log "Project root: $PROJECT_ROOT"
log "Cleanup started."

# ============================================================
# 1. Safety checks
# ============================================================

step "1/9 — Safety checks"

if [ ! -d "$PROJECT_ROOT/.git" ]; then
    fail "This does not appear to be a Git project."
    fail "Expected Git directory: $PROJECT_ROOT/.git"
    exit 1
fi

ok "Project root verified: $PROJECT_ROOT"
ok "Git repository detected."

# ============================================================
# 2. Frontend / Node.js cleanup
# ============================================================

step "2/9 — Cleaning frontend dependencies and build output"

# ------------------------------------------------------------
# Node dependencies
# ------------------------------------------------------------

remove_path \
    "$PROJECT_ROOT/frontend/node_modules" \
    "Frontend node_modules"

# ------------------------------------------------------------
# Frontend production build
# ------------------------------------------------------------

remove_path \
    "$PROJECT_ROOT/frontend/dist" \
    "Frontend dist"

# ------------------------------------------------------------
# Vite cache
# ------------------------------------------------------------

remove_path \
    "$PROJECT_ROOT/frontend/.vite" \
    "Frontend Vite cache"

# ------------------------------------------------------------
# Generic frontend cache
# ------------------------------------------------------------

remove_path \
    "$PROJECT_ROOT/frontend/.cache" \
    "Frontend cache"

# ------------------------------------------------------------
# Local npm cache
# ------------------------------------------------------------

remove_path \
    "$PROJECT_ROOT/frontend/.npm" \
    "Frontend local npm cache"

ok "Frontend cleanup completed."

# ============================================================
# 3. .NET cleanup
# ============================================================

step "3/9 — Cleaning .NET build artifacts"

# ------------------------------------------------------------
# IMPORTANT:
#
# Search the ENTIRE repository for bin directories.
#
# This catches:
#
#   backend/**/bin
#   launcher/bin
#   future-project/bin
#
# .git is explicitly excluded.
# ------------------------------------------------------------

while IFS= read -r -d '' directory; do
    remove_path \
        "$directory" \
        ".NET bin directory"
done < <(
    find "$PROJECT_ROOT" \
        -path "$PROJECT_ROOT/.git" -prune -o \
        -type d \
        -name "bin" \
        -print0 2>/dev/null
)

# ------------------------------------------------------------
# Remove every obj directory in the entire project.
#
# This catches:
#
#   backend/**/obj
#   launcher/obj
#   future-project/obj
#
# .git is explicitly excluded.
# ------------------------------------------------------------

while IFS= read -r -d '' directory; do
    remove_path \
        "$directory" \
        ".NET obj directory"
done < <(
    find "$PROJECT_ROOT" \
        -path "$PROJECT_ROOT/.git" -prune -o \
        -type d \
        -name "obj" \
        -print0 2>/dev/null
)

ok ".NET build artifacts cleaned."

# ============================================================
# 4. Native C++ cleanup
# ============================================================

step "4/9 — Cleaning native C++ build artifacts"

# ------------------------------------------------------------
# Standard native build directory
# ------------------------------------------------------------

remove_path \
    "$PROJECT_ROOT/native/build" \
    "Native build directory"

# ------------------------------------------------------------
# Alternative CMake build directories
# ------------------------------------------------------------

remove_path \
    "$PROJECT_ROOT/native/cmake-build-debug" \
    "Native CMake debug directory"

remove_path \
    "$PROJECT_ROOT/native/cmake-build-release" \
    "Native CMake release directory"

remove_path \
    "$PROJECT_ROOT/native/.cmake" \
    "Native CMake cache directory"

# ------------------------------------------------------------
# Generated CMake files
# ------------------------------------------------------------

remove_path \
    "$PROJECT_ROOT/native/CMakeCache.txt" \
    "Native CMakeCache.txt"

remove_path \
    "$PROJECT_ROOT/native/CMakeFiles" \
    "Native CMakeFiles"

remove_path \
    "$PROJECT_ROOT/native/cmake_install.cmake" \
    "Native cmake_install.cmake"

remove_path \
    "$PROJECT_ROOT/native/Makefile" \
    "Native generated Makefile"

# ------------------------------------------------------------
# Native libraries generated into backend
# ------------------------------------------------------------

remove_path \
    "$PROJECT_ROOT/backend/SystemMonitor.Api/libsystemmonitor_native.so" \
    "Native Linux shared library"

remove_path \
    "$PROJECT_ROOT/backend/SystemMonitor.Api/libsystemmonitor_native.dll" \
    "Native Windows DLL"

remove_path \
    "$PROJECT_ROOT/backend/SystemMonitor.Api/libsystemmonitor_native.dylib" \
    "Native macOS library"

ok "Native C++ artifacts cleaned."

# ============================================================
# 5. Tauri cleanup
# ============================================================

step "5/9 — Cleaning Tauri build artifacts"

if [ -d "$PROJECT_ROOT/frontend/src-tauri" ]; then

    # --------------------------------------------------------
    # Rust / Tauri build directory
    # --------------------------------------------------------

    remove_path \
        "$PROJECT_ROOT/frontend/src-tauri/target" \
        "Tauri target directory"

    # --------------------------------------------------------
    # Tauri generated metadata
    # --------------------------------------------------------

    remove_path \
        "$PROJECT_ROOT/frontend/src-tauri/.tauri" \
        "Tauri generated directory"

    ok "Tauri cleanup completed."

else

    ok "Tauri directory not present. Nothing to clean."

fi

# ============================================================
# 6. Python cleanup
# ============================================================

step "6/9 — Cleaning Python caches"

# ------------------------------------------------------------
# Python __pycache__ directories
# ------------------------------------------------------------

while IFS= read -r -d '' directory; do
    remove_path \
        "$directory" \
        "Python __pycache__ directory"
done < <(
    find "$PROJECT_ROOT" \
        -path "$PROJECT_ROOT/.git" -prune -o \
        -type d \
        -name "__pycache__" \
        -print0 2>/dev/null
)

# ------------------------------------------------------------
# Python compiled bytecode
# ------------------------------------------------------------

while IFS= read -r -d '' file; do
    remove_path \
        "$file" \
        "Python compiled bytecode"
done < <(
    find "$PROJECT_ROOT" \
        -path "$PROJECT_ROOT/.git" -prune -o \
        -type f \
        \( \
            -name "*.pyc" \
            -o -name "*.pyo" \
        \) \
        -print0 2>/dev/null
)

# ------------------------------------------------------------
# Python tool caches
# ------------------------------------------------------------

remove_path \
    "$PROJECT_ROOT/.pytest_cache" \
    "Project pytest cache"

remove_path \
    "$PROJECT_ROOT/.mypy_cache" \
    "Project MyPy cache"

remove_path \
    "$PROJECT_ROOT/.ruff_cache" \
    "Project Ruff cache"

remove_path \
    "$PROJECT_ROOT/analytics/.pytest_cache" \
    "Analytics pytest cache"

remove_path \
    "$PROJECT_ROOT/analytics/.mypy_cache" \
    "Analytics MyPy cache"

remove_path \
    "$PROJECT_ROOT/analytics/.ruff_cache" \
    "Analytics Ruff cache"

ok "Python caches cleaned."

# ============================================================
# 7. Logs and temporary files
# ============================================================

step "7/9 — Cleaning logs and temporary files"

# ------------------------------------------------------------
# Remove project logs
# ------------------------------------------------------------

if [ -d "$PROJECT_ROOT/logs" ]; then

    find "$PROJECT_ROOT/logs" \
        -type f \
        -delete

    ok "Project logs removed."

else

    ok "Project logs directory does not exist."

fi

# ------------------------------------------------------------
# Temporary files
#
# .git is excluded.
# ------------------------------------------------------------

while IFS= read -r -d '' file; do
    remove_path \
        "$file" \
        "Temporary file"
done < <(
    find "$PROJECT_ROOT" \
        -path "$PROJECT_ROOT/.git" -prune -o \
        -type f \
        \( \
            -name "*.tmp" \
            -o -name "*.temp" \
            -o -name "*.bak" \
            -o -name "*.swp" \
            -o -name "*.swo" \
            -o -name "*~" \
        \) \
        -print0 2>/dev/null
)

ok "Temporary files cleaned."

# ============================================================
# 8. Search for remaining generated artifacts
# ============================================================

step "8/9 — Scanning for remaining generated artifacts"

FOUND_GENERATED=0

check_remaining() {
    local pattern="$1"
    local description="$2"

    while IFS= read -r -d '' path; do
        warn "Remaining $description: $path"
        FOUND_GENERATED=1
    done < <(
        find "$PROJECT_ROOT" \
            -path "$PROJECT_ROOT/.git" -prune -o \
            -type d \
            -name "$pattern" \
            -print0 2>/dev/null
    )
}

# ------------------------------------------------------------
# Search for common generated directories
# ------------------------------------------------------------

check_remaining "node_modules" "node_modules directory"
check_remaining "bin" ".NET bin directory"
check_remaining "obj" ".NET obj directory"
check_remaining "__pycache__" "Python cache directory"
check_remaining "target" "Rust/Tauri target directory"
check_remaining "dist" "frontend distribution directory"

if [ "$FOUND_GENERATED" -eq 0 ]; then

    ok "No known generated dependency/build directories remain."

else

    warn "Some generated directories remain. Review the paths above."

fi

# ============================================================
# 9. Final repository validation
# ============================================================

step "9/9 — Final cleanup validation"

# ------------------------------------------------------------
# Critical files that must survive cleanup
# ------------------------------------------------------------

CRITICAL_FILES=(
    "build.sh"
    "clean.sh"
    "start-all.sh"
    "setup.sh"

    "backend/SystemMonitor.Api/SystemMonitor.Api.csproj"
    "backend/SystemMonitor.Api/Program.cs"

    "frontend/package.json"
    "frontend/tsconfig.json"
    "frontend/vite.config.ts"

    "analytics/analytics_service.py"

    "native/build.sh"
)

for file in "${CRITICAL_FILES[@]}"; do

    if [ -f "$PROJECT_ROOT/$file" ]; then

        ok "Preserved: $file"

    else

        fail "Critical project file is missing: $file"
        exit 1

    fi

done

# ------------------------------------------------------------
# Verify Git repository
# ------------------------------------------------------------

if git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then

    ok "Git repository remains intact."

else

    fail "Git repository validation failed."
    exit 1

fi

# ------------------------------------------------------------
# Verify important lockfiles were NOT deleted
# ------------------------------------------------------------

if [ -f "$PROJECT_ROOT/frontend/package-lock.json" ]; then
    ok "Frontend package-lock.json preserved."
else
    warn "frontend/package-lock.json was not found."
fi

if [ -f "$PROJECT_ROOT/frontend/src-tauri/Cargo.lock" ]; then
    ok "Tauri Cargo.lock preserved."
else
    warn "Tauri Cargo.lock was not found."
fi

if [ -f "$PROJECT_ROOT/frontend/src-tauri/Cargo.toml" ]; then
    ok "Tauri Cargo.toml preserved."
else
    warn "Tauri Cargo.toml was not found."
fi

# ============================================================
# Final result
# ============================================================

echo "" | tee -a "$CLEAN_LOG"
echo "==================================================" | tee -a "$CLEAN_LOG"
echo -e " ${GREEN}CLEANUP SUCCESSFUL${NC}" | tee -a "$CLEAN_LOG"
echo "==================================================" | tee -a "$CLEAN_LOG"
echo "" | tee -a "$CLEAN_LOG"

echo "The project has been cleaned for packaging." | tee -a "$CLEAN_LOG"
echo "" | tee -a "$CLEAN_LOG"

echo "Removed:" | tee -a "$CLEAN_LOG"
echo "  - frontend/node_modules" | tee -a "$CLEAN_LOG"
echo "  - frontend/dist" | tee -a "$CLEAN_LOG"
echo "  - frontend/Vite caches" | tee -a "$CLEAN_LOG"
echo "  - ALL .NET bin directories" | tee -a "$CLEAN_LOG"
echo "  - ALL .NET obj directories" | tee -a "$CLEAN_LOG"
echo "  - native CMake/build artifacts" | tee -a "$CLEAN_LOG"
echo "  - native compiled libraries" | tee -a "$CLEAN_LOG"
echo "  - Tauri target/build artifacts" | tee -a "$CLEAN_LOG"
echo "  - Python caches and bytecode" | tee -a "$CLEAN_LOG"
echo "  - project logs" | tee -a "$CLEAN_LOG"
echo "  - temporary/editor files" | tee -a "$CLEAN_LOG"
echo "" | tee -a "$CLEAN_LOG"

echo "Preserved:" | tee -a "$CLEAN_LOG"
echo "  - source code" | tee -a "$CLEAN_LOG"
echo "  - .git repository" | tee -a "$CLEAN_LOG"
echo "  - package.json" | tee -a "$CLEAN_LOG"
echo "  - package-lock.json" | tee -a "$CLEAN_LOG"
echo "  - .NET project files" | tee -a "$CLEAN_LOG"
echo "  - Cargo.toml" | tee -a "$CLEAN_LOG"
echo "  - Cargo.lock" | tee -a "$CLEAN_LOG"
echo "  - configuration files" | tee -a "$CLEAN_LOG"
echo "  - documentation" | tee -a "$CLEAN_LOG"
echo "  - .env files" | tee -a "$CLEAN_LOG"
echo "  - user application data" | tee -a "$CLEAN_LOG"
echo "" | tee -a "$CLEAN_LOG"

echo "The repository is ready to ZIP/share." | tee -a "$CLEAN_LOG"
echo "" | tee -a "$CLEAN_LOG"

echo "Removing cleanup log before packaging..." | tee -a "$CLEAN_LOG"

# ============================================================
# Final log removal
#
# The cleanup log itself is generated data and should NOT end
# up inside the ZIP.
#
# We intentionally remove it as the final filesystem action.
# ============================================================

rm -f "$CLEAN_LOG"
rmdir "$LOG_DIR" 2>/dev/null || true

exit 0
