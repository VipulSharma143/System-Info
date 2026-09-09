#!/usr/bin/env bash
# setup.sh — System Info setup wizard.
# Place this at the project root: ./setup.sh
#
# Checks every prerequisite this project needs, offers to install
# whatever's missing (Linux/apt-based systems), builds the native
# engine, installs frontend/analytics dependencies, walks the user
# through setting MONGO_URI, and finally offers to launch everything
# via start-all.sh.
#
# Designed to be safe to re-run: every step checks "is this already
# done?" before doing it, so running this twice doesn't break anything.

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[MISSING]${NC} $1"; }
fail() { echo -e "${RED}[ERROR]${NC} $1"; }

ask_yes_no() {
    read -r -p "$1 [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]]
}

echo "=================================================="
echo " System Info — Setup Wizard"
echo "=================================================="
echo ""

# --- 1. Check prerequisites ---
echo "Checking prerequisites..."
MISSING=()

check_cmd() {
    if command -v "$1" &> /dev/null; then
        ok "$1 found ($("$1" --version 2>&1 | head -n1))"
    else
        warn "$1 not found"
        MISSING+=("$2")
    fi
}

check_cmd dotnet   "dotnet-sdk-10.0"
check_cmd node     "nodejs"
check_cmd npm      "npm"
check_cmd python3  "python3"
check_cmd pip3     "python3-pip"
check_cmd cmake    "cmake"
check_cmd nasm     "nasm"
check_cmd gcc      "build-essential"

echo ""

# --- 2. Offer to install missing packages ---
if [ ${#MISSING[@]} -gt 0 ]; then
    fail "Missing: ${MISSING[*]}"
    if ask_yes_no "Install missing packages now via apt?"; then
        sudo apt update
        sudo apt install -y "${MISSING[@]}"
        ok "Installed missing packages."
    else
        fail "Cannot continue without these. Install manually and re-run this script."
        exit 1
    fi
else
    ok "All prerequisites already installed."
fi

echo ""

# --- 3. Build the native engine ---
echo "Building native C++ engine..."
if [ -f "$PROJECT_ROOT/backend/SystemMonitor.Api/libsystemmonitor_native.so" ]; then
    ok "Native library already built. (delete it and re-run to rebuild)"
else
    cd "$PROJECT_ROOT/native"
    bash build.sh
    ok "Native engine built."
fi

echo ""

# --- 4. Frontend dependencies ---
echo "Installing frontend dependencies..."
cd "$PROJECT_ROOT/frontend"
if [ -d "node_modules" ]; then
    ok "node_modules already present."
else
    npm install
    ok "Frontend dependencies installed."
fi

echo ""

# --- 5. Analytics dependencies ---
echo "Installing analytics dependencies..."
pip3 install fastapi uvicorn pymongo --break-system-packages --quiet
ok "Python analytics dependencies installed."

echo ""

# --- 6. MONGO_URI ---
echo "Checking database connection..."
if [ -n "$MONGO_URI" ]; then
    ok "MONGO_URI already set in this shell."
else
    warn "MONGO_URI is not set."
    echo "You need a MongoDB Atlas connection string (mongodb+srv://user:pass@cluster.../DBNAME)."
    read -r -p "Paste it now (or press Enter to skip and set it manually later): " mongo_input
    if [ -n "$mongo_input" ]; then
        echo "export MONGO_URI=\"$mongo_input\"" >> "$HOME/.bashrc"
        export MONGO_URI="$mongo_input"
        ok "Saved to ~/.bashrc and set for this session."
    else
        warn "Skipped. Set MONGO_URI manually before running start-all.sh."
    fi
fi

echo ""
echo "=================================================="
echo " Setup complete."
echo "=================================================="
echo ""

# --- 7. Offer to launch everything ---
if ask_yes_no "Start the application now (./start-all.sh)?"; then
    exec "$PROJECT_ROOT/start-all.sh"
else
    echo "Run ./start-all.sh whenever you're ready."
fi
