#!/bin/bash
# build.sh — builds the native library and copies it to the backend in one step.
# Run this instead of manually doing cd build && make && cp every time.

set -e  # stop immediately if any command fails

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
BACKEND_DIR="$SCRIPT_DIR/../backend/SystemMonitor.Api"

echo "Building native library..."
cd "$BUILD_DIR"
cmake .. > /dev/null
make

echo "Copying to backend..."
cp libsystemmonitor_native.so "$BACKEND_DIR/"

echo "✅ Done. Library built and copied to $BACKEND_DIR"
