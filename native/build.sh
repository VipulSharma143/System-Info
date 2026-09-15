#!/bin/bash
# build.sh — builds the native library and copies it to the backend in one step.
# Run this instead of manually doing cd build && make && cp every time.

set -e  # stop immediately if any command fails

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
BACKEND_DIR="$SCRIPT_DIR/../backend/SystemMonitor.Api"

# BUILD_DIR is gitignored (and stripped from release zips) since it's
# regenerable CMake output — so it won't exist on a fresh clone. Create it
# rather than assuming it's there; `cd` into a missing directory fails
# immediately under `set -e` with a misleading "Native C++ engine build
# failed" from the caller, giving no hint that the real problem was just a
# missing folder.
mkdir -p "$BUILD_DIR"

echo "Building native library..."
cd "$BUILD_DIR"
cmake .. > /dev/null
make

echo "Copying to backend..."
cp libsystemmonitor_native.so "$BACKEND_DIR/"

echo "✅ Done. Library built and copied to $BACKEND_DIR"
