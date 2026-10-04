#!/usr/bin/env bash
# clean.sh — remove generated build output so the repository can be zipped or archived.
# Never touches source, .git, lock files, configuration, documentation or user data.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
removed=0

remove() {
    [[ -e "$1" ]] || return 0
    rm -rf "$1"
    echo "removed ${1#"$ROOT"/}"
    removed=$((removed + 1))
}

for path in \
    frontend/node_modules frontend/dist frontend/.vite frontend/node_modules/.vite \
    frontend/src-tauri/target frontend/src-tauri/supervisor-tests/target \
    frontend/src-tauri/gen/schemas \
    native/build native/build-tests native/cmake-build-debug native/cmake-build-release \
    node_modules logs; do
    remove "$ROOT/$path"
done

# Staged backend payload: keep the tracked .gitkeep so the Tauri resource folder exists.
find "$ROOT/frontend/src-tauri/resources/backend" -mindepth 1 ! -name .gitkeep -delete 2>/dev/null || true

# .NET output. Scoped to backend/ on purpose: other directories named "bin" can be source
# (frontend/src-tauri/supervisor-tests/src/bin holds the fake service the Rust tests build).
while IFS= read -r -d '' dir; do
    remove "$dir"
done < <(find "$ROOT/backend" -type d \( -name bin -o -name obj \) -prune -print0)

# Stray native build products and editor/temp files.
while IFS= read -r -d '' file; do
    remove "$file"
done < <(find "$ROOT" -path "$ROOT/.git" -prune -o -type f \
    \( -name '*.o' -o -name '*.obj' -o -name '*.tmp' -o -name '*.bak' -o -name '*.orig' -o -name '*.swp' -o -name '*~' \) -print0)

echo "Clean: $removed item(s) removed. Rebuild with ./build.sh"
