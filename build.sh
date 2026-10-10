#!/usr/bin/env bash

# ============================================================
# build.sh — System Info full project build and validation
#
# Pipeline (fails fast; nothing starts until everything passes):
#   1. Project structure, feature files and wiring
#   2. Required commands and versions
#   3. Environment (OS, disk, memory, writable folders)
#   4. Native C++ / Assembly engine  (+ exported-symbol check)
#   5. .NET backend                  (restore, build, endpoints)
#   6. Frontend                      (install, lint, build, bundle)
#   7. Tests                         (native ctest, backend, frontend)
#   8. Final validation              (scripts, version consistency)
#   -> If EVERYTHING passes, it asks how to open the app:
#        1) Browser  - backend + frontend on localhost, opens your browser
#        2) Tauri    - the desktop app window (it starts the backend itself)
#        3) Neither  - build only
#
# Every command writes its own log under logs/build/. When
# something fails you get: the step, the exact command, where
# it ran, the exit code, the error lines, the last output, the
# most likely cause and how to fix it. A pass/fail table of
# every step is always printed at the end.
#
# Usage:   ./build.sh [options]
#   --browser      skip the question: start and open in your browser
#   --tauri        skip the question: start the Tauri desktop app
#   --no-start     skip the question: build and validate only
#   --skip-tests   skip step 7 (not recommended)
#   -v, --verbose  stream every command's output live
#   -h, --help     show this help
#
# Environment:
#   BUILD_LAUNCH             browser | tauri | none  (same as the flags above)
#   BROWSER                  browser command to use for the Browser option
#   BUILD_MIN_DOTNET_MAJOR   minimum .NET SDK major (default 10)
#   SYSTEMINFO_LOG_DIR       log folder (default ./logs)
#   NO_COLOR                 disable colours
# ============================================================

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${SYSTEMINFO_LOG_DIR:-$PROJECT_ROOT/logs}"
BUILD_LOG="$LOG_DIR/build.log"
CMD_LOG_DIR="$LOG_DIR/build"
MIN_DOTNET_MAJOR="${BUILD_MIN_DOTNET_MAJOR:-10}"

# ------------------------------------------------------------
# Options
# ------------------------------------------------------------

LAUNCH="${BUILD_LAUNCH:-}"      # browser | tauri | none | (empty = ask)
RUN_TESTS=1
VERBOSE=0

usage() {
    awk 'NR >= 3 { sub(/^# ?/, ""); print; if ($0 ~ /^=+$/ && ++rule == 2) exit }' "${BASH_SOURCE[0]}"
}

case "$LAUNCH" in
    ""|browser|tauri|none) ;;
    *) echo "BUILD_LAUNCH must be browser, tauri or none (got: $LAUNCH)" >&2; exit 2 ;;
esac

while [ $# -gt 0 ]; do
    case "$1" in
        --no-start)   LAUNCH=none ;;
        --browser)    LAUNCH=browser ;;
        --tauri)      LAUNCH=tauri ;;
        --skip-tests) RUN_TESTS=0 ;;
        -v|--verbose) VERBOSE=1 ;;
        -h|--help)    usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; echo "Try: ./build.sh --help" >&2; exit 2 ;;
    esac
    shift
done

mkdir -p "$LOG_DIR"
rm -rf "$CMD_LOG_DIR"
mkdir -p "$CMD_LOG_DIR"
rm -f "$BUILD_LOG"

# ------------------------------------------------------------
# Colours (only on a terminal; the log file never has any)
# ------------------------------------------------------------

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[0;31m'
    CYAN=$'\033[0;36m';  BOLD=$'\033[1m';      DIM=$'\033[2m'; NC=$'\033[0m'
else
    GREEN=''; YELLOW=''; RED=''; CYAN=''; BOLD=''; DIM=''; NC=''
fi

# ------------------------------------------------------------
# Output helpers: console (coloured) + build.log (plain)
# ------------------------------------------------------------

strip_ansi() { sed -E $'s/\x1B\\[[0-9;]*[A-Za-z]//g'; }

emit() {
    printf '%s\n' "$*"
    printf '%s\n' "$*" | strip_ansi >> "$BUILD_LOG"
}

OK_COUNT=0
WARNINGS=()

ok()   { OK_COUNT=$((OK_COUNT + 1)); emit "${GREEN}[ OK ]${NC} $*"; }
info() { emit "${DIM}[info]${NC} $*"; }
warn() { WARNINGS+=("$*"); emit "${YELLOW}[WARN]${NC} $*"; }
bad()  { emit "${RED}[FAIL]${NC} $*"; }

now()  { date +%s; }

fmt_secs() {
    local s=$1
    if   [ "$s" -ge 3600 ]; then printf '%dh%02dm%02ds' $((s / 3600)) $((s % 3600 / 60)) $((s % 60))
    elif [ "$s" -ge 60 ];   then printf '%dm%02ds' $((s / 60)) $((s % 60))
    else printf '%ds' "$s"; fi
}

slug() { printf '%s' "$1" | tr -cs 'A-Za-z0-9' '-' | tr 'A-Z' 'a-z' | sed 's/^-*//; s/-*$//' | cut -c1-48; }

rel() { local p="${1#"$PROJECT_ROOT"/}"; [ "$p" = "$PROJECT_ROOT" ] && p="."; printf '%s' "$p"; }

# ------------------------------------------------------------
# Step registry (every step is listed in the final table, even
# the ones never reached)
# ------------------------------------------------------------

STEP_TITLES=(
    "Project structure, feature files and wiring"
    "Required commands and versions"
    "Environment"
    "Native C++ / Assembly engine"
    ".NET backend"
    "Frontend"
    "Tests"
    "Final validation"
)
TOTAL_STEPS=${#STEP_TITLES[@]}
STEP_STATUS=()
STEP_SECS=()
STEP_DETAIL=()
for ((i = 0; i < TOTAL_STEPS; i++)); do STEP_STATUS[i]="NOT RUN"; STEP_SECS[i]=0; STEP_DETAIL[i]=""; done

CUR=-1
STEP_STARTED=0
BUILD_STARTED=$(now)
REPORTED=0

begin_step() {
    CUR=$1
    STEP_STARTED=$(now)
    STEP_STATUS[CUR]="RUNNING"
    emit ""
    emit "${CYAN}==================================================${NC}"
    emit "${CYAN} [$((CUR + 1))/$TOTAL_STEPS] ${STEP_TITLES[CUR]}${NC}"
    emit "${CYAN}==================================================${NC}"
}

detail() { STEP_DETAIL[CUR]+="${STEP_DETAIL[CUR]:+$'\n'}$*"; }

end_step() {
    local status="${1:-PASS}"
    STEP_STATUS[CUR]="$status"
    STEP_SECS[CUR]=$(($(now) - STEP_STARTED))
    case "$status" in
        PASS) emit "${GREEN}  ✔ Step $((CUR + 1)) passed${NC} ($(fmt_secs "${STEP_SECS[CUR]}"))" ;;
        SKIP) emit "${YELLOW}  - Step $((CUR + 1)) skipped${NC}" ;;
    esac
}

# ------------------------------------------------------------
# Failure reporting
# ------------------------------------------------------------

exit_code_meaning() {
    case "$1" in
        1)   echo "general failure" ;;
        2)   echo "misuse of a shell command" ;;
        124) echo "timed out" ;;
        126) echo "command found but not executable (permissions)" ;;
        127) echo "command not found" ;;
        130) echo "interrupted (Ctrl+C)" ;;
        137) echo "killed — usually out of memory" ;;
        139) echo "segmentation fault" ;;
        *)   echo "non-zero exit" ;;
    esac
}

# diagnose <logfile> <label> — print the most likely cause and the fix, based on what the command printed.
diagnose() {
    local log="$1" found=0
    local -a hits=()

    match() {  # match <regex> <cause> <fix>
        if [ -n "$log" ] && [ -f "$log" ] && grep -Eqi -- "$1" "$log"; then
            hits+=("$2|$3"); found=1
        fi
    }

    match 'No CMAKE_ASM_NASM_COMPILER|nasm: (command )?not found|Could not find compiler set in environment variable ASM_NASM' \
          "The NASM assembler is missing (the native engine links assembly files)." \
          "Install it:  sudo apt install nasm"
    match 'cmake: (command )?not found|CMake Error: CMake was unable to find a build program' \
          "CMake or a build tool (make) is missing." \
          "Install them:  sudo apt install cmake build-essential"
    match 'fatal error: .*: No such file or directory' \
          "A C/C++ header file is missing." \
          "Install the compiler toolchain:  sudo apt install build-essential  (the missing header is named in the error lines above)"
    match 'undefined reference to' \
          "Linker error: a function is declared but not defined, or its source file is not listed in native/CMakeLists.txt." \
          "Find the symbol in the error lines above, make sure its .cpp/.asm file is in native/CMakeLists.txt, then rebuild."
    match 'error: .*(was not declared|has no member|does not name a type|expected .*before)|: error: ' \
          "C++ compile error in the native engine." \
          "Open the file:line shown in the error lines above and fix that line."
    match 'NETSDK1045|does not support targeting \.NET|requires .NET SDK|A compatible .NET SDK was not found|The framework .* was not found' \
          "The installed .NET SDK is too old for this project (it targets .NET ${MIN_DOTNET_MAJOR})." \
          "Install the .NET ${MIN_DOTNET_MAJOR} SDK: https://dotnet.microsoft.com/download  then run 'dotnet --version' to confirm."
    match 'Unable to load the service index|NU1301|NU1101|NU1102|Name or service not known|Temporary failure in name resolution|Could not resolve host' \
          "NuGet could not download packages (no internet, DNS, proxy or firewall)." \
          "Check your connection/proxy, then re-run. Packages cached from an earlier online build are reused."
    match 'error CS[0-9]+' \
          "C# compile error in the backend." \
          "Open the file(line,col) shown in the error lines above and fix it."
    match 'error TS[0-9]+' \
          "TypeScript compile error in the frontend." \
          "Open the file(line,col) shown in the error lines above and fix it."
    match 'EBADENGINE|Unsupported engine|requires Node|engine.*node' \
          "Your Node.js version is not supported by the frontend tools." \
          "Install Node.js 20.19+ or 22.12+ (e.g. with nvm), then re-run."
    match 'ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|network (request|timeout)' \
          "npm could not reach the registry (network problem)." \
          "Check your connection/proxy, then re-run."
    match 'Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND' \
          "A frontend dependency is missing or the install is incomplete." \
          "Delete frontend/node_modules and re-run ./build.sh to reinstall cleanly."
    match 'EACCES|Permission denied|Operation not permitted' \
          "A permission problem (a folder or file is not writable/executable)." \
          "Check ownership:  ls -l <path from the error>  ;  avoid running parts of the build with sudo."
    match 'ENOSPC|No space left on device' \
          "The disk is full." \
          "Free some space (try ./clean.sh to remove generated build output) and re-run."
    match 'Cannot allocate memory|std::bad_alloc|Out of memory|^Killed$|JavaScript heap out of memory' \
          "The machine ran out of memory." \
          "Close other programs or add swap, then re-run."
    match '(^|[^a-z])FAIL: ' \
          "A test assertion failed (lines starting with FAIL: above name it)." \
          "Read the FAIL lines; the message says which check broke. This usually means a code change broke behaviour."
    match '^[[:space:]]*(not ok [0-9]+|# fail [1-9])' \
          "A frontend test failed (see 'Failed tests' above for its name and the expected/actual values)." \
          "Fix the code or the test: run  cd frontend && npm test  to repeat it quickly."
    match '\*\*\*Failed|tests failed out of|[1-9][0-9]* tests? failed' \
          "One or more tests failed." \
          "The failing test names are in the error lines above; run that test alone for details."
    match 'npm (ERR!|error)' \
          "npm reported an error." \
          "Read the 'npm error' lines above; deleting frontend/node_modules and re-running fixes most install problems."

    emit ""
    emit "${BOLD}Likely cause and fix${NC}"
    if [ "$found" -eq 1 ]; then
        local hit
        for hit in "${hits[@]}"; do
            emit "  ${RED}cause:${NC} ${hit%%|*}"
            emit "  ${GREEN}fix:${NC}   ${hit#*|}"
            emit ""
        done
    else
        emit "  No known pattern matched. Read the error lines and the last output above;"
        emit "  the complete output is in: $(rel "$log")"
    fi
}

# fail_report <what failed> <command> <exit code> <logfile|""> <directory>
fail_report() {
    local what="$1" cmd="$2" rc="$3" log="$4" dir="$5"
    REPORTED=1
    trap - ERR

    local step_label="(before the first step)"
    if [ "$CUR" -ge 0 ]; then
        step_label="$((CUR + 1))/$TOTAL_STEPS — ${STEP_TITLES[CUR]}"
        STEP_STATUS[CUR]="FAIL"
        STEP_SECS[CUR]=$(($(now) - STEP_STARTED))
    fi

    emit ""
    emit "${RED}==================================================${NC}"
    emit "${RED} BUILD FAILED${NC}"
    emit "${RED}==================================================${NC}"
    emit "${BOLD}Step      :${NC} $step_label"
    emit "${BOLD}Task      :${NC} $what"
    [ -n "$cmd" ] && emit "${BOLD}Command   :${NC} $cmd"
    [ -n "$dir" ] && emit "${BOLD}Directory :${NC} $(rel "$dir")"
    emit "${BOLD}Exit code :${NC} $rc ($(exit_code_meaning "$rc"))"
    [ -n "$log" ] && emit "${BOLD}Full log  :${NC} $(rel "$log")"

    if [ -n "$log" ] && [ -f "$log" ]; then
        local failed
        failed="$(strip_ansi < "$log" | grep -nE '^[[:space:]]*not ok [0-9]+|\*\*\*Failed|^FAIL|^[[:space:]]*(expected|actual|message):|AssertionError' | head -n 20 || true)"
        if [ -n "$failed" ]; then
            emit ""
            emit "${BOLD}Failed tests${NC} (line number: text)"
            while IFS= read -r l; do emit "  ${RED}$l${NC}"; done <<< "$failed"
        fi
        local errs
        errs="$(strip_ansi < "$log" | grep -nEi '(^|[^a-z])(error|fatal|failed|FAIL:|undefined reference|Cannot find|not found)' \
                | grep -Evi '(^|[^0-9a-z])0 (error|failed)|warning|^[0-9]+:[[:space:]]*(ok [0-9]+|# Subtest)' | head -n 15 || true)"
        if [ -n "$errs" ]; then
            emit ""
            emit "${BOLD}Error lines found in the output${NC} (line number: text)"
            while IFS= read -r l; do emit "  ${RED}$l${NC}"; done <<< "$errs"
        fi
        emit ""
        emit "${BOLD}Last 25 lines of output${NC}"
        while IFS= read -r l; do emit "  ${DIM}$l${NC}"; done < <(strip_ansi < "$log" | tail -n 25)
    fi

    diagnose "$log"
}

# Stop the build after a failure that has already been reported.
abort() { exit "${1:-1}"; }

# fail_now <what> <detail...> — a failed check that has no command (missing file, bad version, ...)
fail_now() {
    local what="$1"; shift
    REPORTED=1
    trap - ERR
    local step_label="(before the first step)"
    if [ "$CUR" -ge 0 ]; then
        step_label="$((CUR + 1))/$TOTAL_STEPS — ${STEP_TITLES[CUR]}"
        STEP_STATUS[CUR]="FAIL"
        STEP_SECS[CUR]=$(($(now) - STEP_STARTED))
    fi
    emit ""
    emit "${RED}==================================================${NC}"
    emit "${RED} BUILD FAILED${NC}"
    emit "${RED}==================================================${NC}"
    emit "${BOLD}Step :${NC} $step_label"
    emit "${BOLD}Task :${NC} $what"
    emit ""
    local l
    for l in "$@"; do emit "  $l"; done
    abort 1
}

# ------------------------------------------------------------
# run_cmd [-C dir] [-s] "label" command args...
#   Runs a command, logs everything to logs/build/NN-label.log
#   -C dir : run in this directory (default: project root)
#   -s     : "soft" — on failure warn and return 1 instead of stopping
# ------------------------------------------------------------

CMD_COUNT=0
LAST_LOG=""

run_cmd() {
    local soft=0 dir="$PROJECT_ROOT"
    while [ $# -gt 0 ]; do
        case "$1" in
            -s) soft=1; shift ;;
            -C) dir="$2"; shift 2 ;;
            *)  break ;;
        esac
    done
    local label="$1"; shift

    CMD_COUNT=$((CMD_COUNT + 1))
    local logfile
    printf -v logfile '%s/%02d-%s.log' "$CMD_LOG_DIR" "$CMD_COUNT" "$(slug "$label")"
    LAST_LOG="$logfile"

    emit ""
    emit "  ${BOLD}▶ $label${NC}"
    emit "    ${DIM}\$ $*${NC}  ${DIM}(in $(rel "$dir"))${NC}"

    {
        printf '# step  : %s\n# task  : %s\n# cwd   : %s\n# cmd   : %s\n# start : %s\n\n' \
            "${STEP_TITLES[CUR]:-n/a}" "$label" "$dir" "$*" "$(date '+%Y-%m-%d %H:%M:%S')"
    } > "$logfile"

    local started rc
    started=$(now)
    # "&& rc=0 || rc=$?" captures the exit code without tripping the ERR trap
    # (the trap fires on any failing command, even with errexit switched off).
    if [ "$VERBOSE" -eq 1 ]; then
        ( cd "$dir" && "$@" ) 2>&1 | tee -a "$logfile" && rc=0 || rc=$?     # pipefail: rc is the command's, not tee's
    else
        ( cd "$dir" && "$@" ) >> "$logfile" 2>&1 && rc=0 || rc=$?
    fi
    local took=$(($(now) - started))

    # Copy the command's output into build.log too, so one file has everything.
    {
        printf -- '\n----- output of: %s -----\n' "$label"
        strip_ansi < "$logfile"
        printf -- '----- end of: %s (exit %s) -----\n' "$label" "$rc"
    } >> "$BUILD_LOG"

    if [ "$rc" -eq 0 ]; then
        emit "    ${GREEN}✔ done${NC} in $(fmt_secs "$took")  ${DIM}log: $(rel "$logfile")${NC}"
        return 0
    fi

    if [ "$soft" -eq 1 ]; then
        warn "$label failed (exit $rc) — continuing. Log: $(rel "$logfile")"
        return 1
    fi

    fail_report "$label" "$*" "$rc" "$logfile" "$dir"
    abort "$rc"
}

# ------------------------------------------------------------
# Check collectors: gather every problem, then report them all
# at once instead of stopping at the first one.
# ------------------------------------------------------------

MISSING=()

check_dir() {
    if [ -d "$PROJECT_ROOT/$1" ]; then ok "directory  $1"
    else bad "directory  $1  (missing)"; MISSING+=("missing directory: $1"); fi
}

check_file() {
    if [ -f "$PROJECT_ROOT/$1" ]; then ok "file       $1"
    else bad "file       $1  (missing)"; MISSING+=("missing file: $1"); fi
}

check_contains() {  # check_contains <file> <fixed text> <what it proves>
    if [ -f "$PROJECT_ROOT/$1" ] && grep -Fq -- "$2" "$PROJECT_ROOT/$1"; then ok "wiring     $3  ($1)"
    else bad "wiring     $3  ($1 does not contain: $2)"; MISSING+=("$3 — '$2' not found in $1"); fi
}

finish_checks() {  # finish_checks <what> <hint>
    if [ "${#MISSING[@]}" -gt 0 ]; then
        local lines=("${MISSING[@]}" "" "$2")
        fail_now "$1" "${lines[@]}"
    fi
}

# ------------------------------------------------------------
# Traps
# ------------------------------------------------------------

print_summary() {
    local total=$(($(now) - BUILD_STARTED))
    emit ""
    emit "${BOLD}==================================================${NC}"
    emit "${BOLD} BUILD SUMMARY${NC}"
    emit "${BOLD}==================================================${NC}"
    local i icon col
    for ((i = 0; i < TOTAL_STEPS; i++)); do
        case "${STEP_STATUS[i]}" in
            PASS)    icon="✔ PASS    "; col="$GREEN" ;;
            WARN)    icon="! PASS+WARN"; col="$YELLOW" ;;
            SKIP)    icon="- SKIPPED "; col="$YELLOW" ;;
            FAIL|RUNNING) icon="✘ FAILED  "; col="$RED" ;;
            *)       icon="· NOT RUN "; col="$DIM" ;;
        esac
        emit "  ${col}${icon}${NC}  $((i + 1)). ${STEP_TITLES[i]}  ${DIM}($(fmt_secs "${STEP_SECS[i]}"))${NC}"
        if [ -n "${STEP_DETAIL[i]}" ]; then
            while IFS= read -r l; do emit "                 ${DIM}$l${NC}"; done <<< "${STEP_DETAIL[i]}"
        fi
    done
    if [ "${#WARNINGS[@]}" -gt 0 ]; then
        emit ""
        emit "${YELLOW}${#WARNINGS[@]} warning(s):${NC}"
        local w
        for w in "${WARNINGS[@]}"; do emit "  ${YELLOW}•${NC} $w"; done
    fi
    emit ""
    emit "Checks passed : $OK_COUNT"
    emit "Total time    : $(fmt_secs "$total")"
    emit "Build log     : $(rel "$BUILD_LOG")   (everything, in one file)"
    emit "Per-command   : $(rel "$CMD_LOG_DIR")/   (one log per command)"
}

on_err() {  # unexpected failure outside run_cmd (a bug in this script or an unguarded command)
    local rc=$1 line=$2 cmd=$3
    [ "$REPORTED" -eq 1 ] && return
    fail_report "Unexpected error in build.sh at line $line" "$cmd" "$rc" "" "$PROJECT_ROOT"
    emit ""
    emit "This is a build.sh problem, not a project problem. Re-run with: bash -x ./build.sh"
    abort "$rc"
}

on_signal() {
    REPORTED=1
    emit ""
    emit "${YELLOW}Interrupted ($1). Stopping.${NC}"
    if [ "$CUR" -ge 0 ] && [ "${STEP_STATUS[CUR]}" = "RUNNING" ]; then STEP_STATUS[CUR]="FAIL"; fi
    exit 130
}

on_exit() {
    local rc=$?
    trap - EXIT ERR INT TERM
    if [ "$CUR" -ge 0 ] && [ "${STEP_STATUS[CUR]}" = "RUNNING" ]; then
        STEP_STATUS[CUR]="FAIL"
        STEP_SECS[CUR]=$(($(now) - STEP_STARTED))
    fi
    print_summary
    if [ "$rc" -ne 0 ]; then
        emit ""
        emit "${RED}RESULT: FAILED${NC} (exit $rc). Nothing was started."
    fi
    exit "$rc"
}

trap 'on_err $? $LINENO "$BASH_COMMAND"' ERR
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM
trap on_exit EXIT

# ============================================================
# Start
# ============================================================

emit "=================================================="
emit " System Info — Full Build & Validation"
emit "=================================================="
info "Project root : $PROJECT_ROOT"
info "Started      : $(date '+%Y-%m-%d %H:%M:%S')"
info "Options      : launch=${LAUNCH:-ask} tests=$RUN_TESTS verbose=$VERBOSE"

# ============================================================
# 1. Project structure, feature files and wiring
# ============================================================

begin_step 0

emit "Core folders and files"
check_dir  "backend"
check_dir  "backend/SystemMonitor.Api"
check_dir  "backend/SystemMonitor.Tests"
check_dir  "frontend"
check_dir  "frontend/src"
check_dir  "native"
check_dir  "assembly"
check_dir  "tests/native"
check_file "start-all.sh"
check_file "setup.sh"
check_file "native/build.sh"
check_file "native/CMakeLists.txt"
check_file "backend/SystemMonitor.Api/SystemMonitor.Api.csproj"
check_file "backend/SystemMonitor.Api/Program.cs"
check_file "backend/SystemMonitor.Tests/SystemMonitor.Tests.csproj"
check_file "frontend/package.json"
check_file "frontend/tsconfig.json"
check_file "frontend/vite.config.ts"
check_file "scripts/check-version.mjs"

emit "CPU tab files"
check_file "native/src/cpu_detail.cpp"
check_file "native/src/cpu_detail.h"
check_file "native/platform/linux/cpu_detail.cpp"
check_file "native/platform/windows/cpu_detail.cpp"
check_file "tests/native/cpu_detail_test.cpp"
check_file "backend/SystemMonitor.Api/services/Cpu/CpuDetailService.cs"
check_file "backend/SystemMonitor.Api/services/Cpu/CpuDetailModels.cs"
check_file "backend/SystemMonitor.Api/Endpoints/CpuEndpoints.cs"
check_file "backend/SystemMonitor.Tests/CpuDetailTests.cs"
check_file "frontend/src/components/views/CpuView.tsx"
check_file "frontend/src/components/views/cpu/model.ts"
check_file "frontend/src/hooks/useCpuDetail.ts"
check_file "frontend/src/types/cpu.ts"
check_file "frontend/tests/cpuModel.test.ts"

emit "Other feature files"
check_file "frontend/src/types/speedtest.ts"
check_file "frontend/src/hooks/useSpeedTest.ts"
check_file "frontend/src/components/SpeedTestCard.tsx"

emit "Wiring (each new piece is actually hooked in)"
check_contains "native/CMakeLists.txt"                      "src/cpu_detail.cpp"          "CMake builds the shared CPU detail source"
check_contains "native/CMakeLists.txt"                      "cpu_detail_test"             "CMake registers the CPU detail test"
check_contains "native/include/native_engine.h"             "si_cpu_detail_json"          "native header exports the CPU detail call"
check_contains "backend/SystemMonitor.Api/Native/NativeInterop.cs" "si_cpu_detail_json"   "C# imports the CPU detail call"
check_contains "backend/SystemMonitor.Api/Program.cs"       "CpuDetailService"            "backend registers CpuDetailService"
check_contains "backend/SystemMonitor.Api/Program.cs"       "MapCpuEndpoints"             "backend maps the CPU endpoint"
check_contains "backend/SystemMonitor.Tests/SystemMonitor.Tests.csproj" "CpuDetailService.cs" "test project links the CPU service"
check_contains "backend/SystemMonitor.Tests/Program.cs"     "CpuDetailTests"              "test runner runs the CPU tests"
check_contains "frontend/src/lib/sections.ts"               "id: 'cpu'"                   "the CPU tab is in the section list"
check_contains "frontend/src/App.tsx"                       "CpuView"                     "App renders the CPU view"
check_contains "frontend/src/components/layout/Sidebar.tsx" "cpu: Cpu"                    "the sidebar has a CPU icon"

finish_checks "Required project files or wiring are missing" \
    "Restore them (git status / git checkout -- <file>) or unzip the project again, then re-run ./build.sh."

detail "$OK_COUNT checks passed"
end_step PASS

# ============================================================
# 2. Required commands and versions
# ============================================================

begin_step 1

hint_for() {
    case "$1" in
        dotnet)             echo "Install the .NET ${MIN_DOTNET_MAJOR} SDK: https://dotnet.microsoft.com/download" ;;
        node|npm)           echo "Install Node.js 20.19+ or 22.12+ (https://nodejs.org or nvm); npm comes with it" ;;
        cmake|gcc|g++|make) echo "sudo apt install build-essential cmake" ;;
        nasm)               echo "sudo apt install nasm" ;;
        nm|file)            echo "sudo apt install binutils file" ;;
        *)                  echo "Install '$1' and make sure it is on your PATH" ;;
    esac
}

MISSING=()
for tool in dotnet node npm cmake gcc g++ make nasm; do
    if command -v "$tool" >/dev/null 2>&1; then
        ok "$tool  ($(command -v "$tool"))"
    else
        bad "$tool is not installed or not on PATH"
        MISSING+=("$tool — $(hint_for "$tool")")
    fi
done
# nasm assembles assembly/*.asm which native/CMakeLists.txt always links in; without it the
# failure would otherwise show up much later as an obscure CMake error.
finish_checks "Required commands are missing" "Install the commands above, open a new terminal, and re-run ./build.sh."

# Optional tools: used for extra verification only.
for tool in nm file; do
    if command -v "$tool" >/dev/null 2>&1; then ok "$tool (optional, used for native checks)"
    else warn "$tool not found — some native verification will be skipped ($(hint_for "$tool"))"; fi
done

DOTNET_VERSION="$(dotnet --version 2>/dev/null || echo unknown)"
NODE_VERSION="$(node --version 2>/dev/null || echo unknown)"
NPM_VERSION="$(npm --version 2>/dev/null || echo unknown)"
CMAKE_VERSION="$(cmake --version 2>/dev/null | head -n1 | awk '{print $3}')"
GCC_VERSION="$(g++ -dumpfullversion 2>/dev/null || g++ -dumpversion 2>/dev/null || echo unknown)"
NASM_VERSION="$(nasm -v 2>/dev/null | awk '{print $3}')"

info ".NET  : $DOTNET_VERSION"
info "Node  : $NODE_VERSION"
info "npm   : $NPM_VERSION"
info "CMake : $CMAKE_VERSION"
info "g++   : $GCC_VERSION"
info "NASM  : $NASM_VERSION"
detail ".NET $DOTNET_VERSION · Node $NODE_VERSION · npm $NPM_VERSION · CMake $CMAKE_VERSION · g++ $GCC_VERSION · NASM $NASM_VERSION"

# --- .NET: the project targets a specific major version; older SDKs cannot build it.
DOTNET_MAJOR="${DOTNET_VERSION%%.*}"
if [[ "$DOTNET_MAJOR" =~ ^[0-9]+$ ]] && [ "$DOTNET_MAJOR" -ge "$MIN_DOTNET_MAJOR" ]; then
    ok ".NET SDK $DOTNET_VERSION is new enough (need $MIN_DOTNET_MAJOR+)"
else
    fail_now ".NET SDK is too old" \
        "Found .NET SDK : $DOTNET_VERSION" \
        "Required       : $MIN_DOTNET_MAJOR.x or newer (the backend targets net${MIN_DOTNET_MAJOR}.0)" \
        "" \
        "Fix: install the .NET ${MIN_DOTNET_MAJOR} SDK from https://dotnet.microsoft.com/download" \
        "     then check with: dotnet --version"
fi

# --- CMake: native/CMakeLists.txt needs 3.10.
CMAKE_MAJOR="${CMAKE_VERSION%%.*}"; CMAKE_MINOR="${CMAKE_VERSION#*.}"; CMAKE_MINOR="${CMAKE_MINOR%%.*}"
if [[ "$CMAKE_MAJOR" =~ ^[0-9]+$ && "$CMAKE_MINOR" =~ ^[0-9]+$ ]] && { [ "$CMAKE_MAJOR" -gt 3 ] || { [ "$CMAKE_MAJOR" -eq 3 ] && [ "$CMAKE_MINOR" -ge 10 ]; }; }; then
    ok "CMake $CMAKE_VERSION is new enough (need 3.10+)"
else
    fail_now "CMake is too old" "Found CMake $CMAKE_VERSION, need 3.10 or newer." "Fix: sudo apt install cmake  (or pip install cmake)"
fi

# --- Node: Vite needs 20.19+ or 22.12+. A warning, not a failure, in case the tooling accepts yours.
NODE_NUM="${NODE_VERSION#v}"; NODE_MAJOR="${NODE_NUM%%.*}"; NODE_REST="${NODE_NUM#*.}"; NODE_MINOR="${NODE_REST%%.*}"
if [[ "$NODE_MAJOR" =~ ^[0-9]+$ && "$NODE_MINOR" =~ ^[0-9]+$ ]]; then
    if [ "$NODE_MAJOR" -gt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -ge 12 ]; } || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -ge 19 ]; }; then
        ok "Node $NODE_NUM is supported"
    else
        warn "Node $NODE_NUM is older than the 20.19+/22.12+ the frontend tools expect — the frontend build may fail."
    fi
fi

# --- g++: the native engine uses C++17 (std::filesystem).
GCC_MAJOR="${GCC_VERSION%%.*}"
if [[ "$GCC_MAJOR" =~ ^[0-9]+$ ]]; then
    if [ "$GCC_MAJOR" -ge 8 ]; then ok "g++ $GCC_VERSION supports C++17"
    else warn "g++ $GCC_VERSION may be too old for C++17 <filesystem> (need 8+)."; fi
fi

end_step PASS

# ============================================================
# 3. Environment
# ============================================================

begin_step 2

OS_NAME="$(uname -s)"
if [ "$OS_NAME" = "Linux" ]; then
    ok "Operating system: Linux ($(uname -r))"
else
    fail_now "This script builds the Linux version" \
        "Detected OS: $OS_NAME" \
        "" \
        "On Windows use setup.ps1 and start-all.ps1 instead."
fi

if [ -w "$PROJECT_ROOT" ]; then ok "Project folder is writable"
else fail_now "Project folder is not writable" "$PROJECT_ROOT" "Fix: check ownership/permissions of the folder (do not build as root unless the files are root-owned)."; fi

if [ -w "$LOG_DIR" ]; then ok "Log folder is writable: $(rel "$LOG_DIR")"
else fail_now "Log folder is not writable" "$LOG_DIR"; fi

DATA_DIR_CHECK="${SYSTEM_INFO_DATA_DIR:-$HOME/.local/share/SystemInfo/data}"
if mkdir -p "$DATA_DIR_CHECK/snapshots" 2>/dev/null && [ -w "$DATA_DIR_CHECK" ]; then
    ok "Local data folder is writable: $DATA_DIR_CHECK"
else
    warn "Local data folder is not writable: $DATA_DIR_CHECK (set SYSTEM_INFO_DATA_DIR to override)"
fi

FREE_KB="$(df -Pk "$PROJECT_ROOT" 2>/dev/null | awk 'NR==2 {print $4}')"
if [[ "${FREE_KB:-}" =~ ^[0-9]+$ ]]; then
    FREE_MB=$((FREE_KB / 1024))
    if [ "$FREE_MB" -ge 2048 ]; then ok "Free disk space: ${FREE_MB} MB"
    elif [ "$FREE_MB" -ge 700 ]; then warn "Free disk space is lowish: ${FREE_MB} MB (a full build needs about 1-2 GB)"
    else fail_now "Not enough free disk space" "Only ${FREE_MB} MB free; a full build needs about 1-2 GB." "Fix: free space (./clean.sh removes generated output) and re-run."; fi
    detail "disk free ${FREE_MB} MB"
fi

if [ -r /proc/meminfo ]; then
    MEM_MB=$(($(awk '/MemAvailable/ {print $2}' /proc/meminfo) / 1024))
    if [ "$MEM_MB" -ge 1024 ]; then ok "Available memory: ${MEM_MB} MB"
    else warn "Only ${MEM_MB} MB of memory available — the .NET and Vite builds may run out of memory."; fi
    detail "memory available ${MEM_MB} MB"
fi

JOBS="$(nproc 2>/dev/null || echo 2)"
info "CPU threads for parallel builds: $JOBS"

end_step PASS

# ============================================================
# 4. Native C++ / Assembly engine
# ============================================================

begin_step 3

if [ ! -x "$PROJECT_ROOT/native/build.sh" ]; then
    warn "native/build.sh was not executable — fixed."
    chmod +x "$PROJECT_ROOT/native/build.sh"
fi

run_cmd -C "$PROJECT_ROOT/native" "Build native engine (native/build.sh)" bash ./build.sh

NATIVE_LIBRARY="$PROJECT_ROOT/backend/SystemMonitor.Api/libsystemmonitor_native.so"

if [ -f "$NATIVE_LIBRARY" ]; then
    ok "Library copied to the backend: $(rel "$NATIVE_LIBRARY") ($(($(stat -c %s "$NATIVE_LIBRARY") / 1024)) KB)"
else
    fail_now "The native build finished but produced no library" \
        "Expected: $(rel "$NATIVE_LIBRARY")" \
        "Look in $(rel "$LAST_LOG") for the CMake/make output and check native/build.sh copies the .so to the backend folder."
fi

if command -v file >/dev/null 2>&1; then
    FILE_INFO="$(file -b "$NATIVE_LIBRARY")"
    if [[ "$FILE_INFO" == *"ELF 64-bit"* ]]; then ok "Library is a 64-bit Linux shared object"
    else fail_now "The native library is not a valid 64-bit Linux library" "file says: $FILE_INFO"; fi
fi

if command -v nm >/dev/null 2>&1; then
    EXPORTS="$(nm -D --defined-only "$NATIVE_LIBRARY" 2>/dev/null || true)"
    MISSING=()
    for sym in si_overlay_start si_overlay_snapshot_json si_cpu_detail_json si_cpu_detail_set_root si_get_cpu_topology si_get_cpu_logical_info si_read_host_snapshot; do
        if grep -Eq "[[:space:]]T[[:space:]]+${sym}\$" <<< "$EXPORTS"; then ok "exports $sym"
        else bad "missing export $sym"; MISSING+=("the library does not export $sym"); fi
    done
    finish_checks "The native library is missing functions the backend calls" \
        "Make sure each function is declared NATIVE_API in native/include/native_engine.h, defined in a source listed in native/CMakeLists.txt, and rebuild."
    detail "native library OK, all required functions exported"
else
    detail "native library built (export check skipped: nm not installed)"
fi

end_step PASS

# ============================================================
# 5. .NET backend
# ============================================================

begin_step 4

BACKEND_DIR="$PROJECT_ROOT/backend/SystemMonitor.Api"

run_cmd -C "$BACKEND_DIR" "Restore .NET packages" dotnet restore
run_cmd -C "$BACKEND_DIR" "Build backend (Release)" dotnet build --configuration Release --no-restore

BACKEND_DLL="$(find "$BACKEND_DIR/bin/Release" -maxdepth 3 -name 'SystemMonitor.Api.dll' 2>/dev/null | head -n1 || true)"
if [ -n "$BACKEND_DLL" ]; then ok "Backend assembly built: $(rel "$BACKEND_DLL")"
else fail_now "The backend build reported success but no SystemMonitor.Api.dll was produced" "Looked in: $(rel "$BACKEND_DIR")/bin/Release" "See: $(rel "$LAST_LOG")"; fi

MISSING=()
for ep in MapSystemEndpoints MapOverlayEndpoints MapCpuEndpoints; do
    if grep -Fq "$ep" "$BACKEND_DIR/Program.cs"; then ok "Program.cs registers $ep"
    else bad "Program.cs does not call $ep"; MISSING+=("Program.cs does not call $ep()"); fi
done
finish_checks "A required API endpoint group is not registered" \
    "Add the missing app.Map...Endpoints(); call to backend/SystemMonitor.Api/Program.cs."

if grep -Fq "MapSpeedTestEndpoints" "$BACKEND_DIR/Program.cs"; then ok "Program.cs registers MapSpeedTestEndpoints"
else warn "MapSpeedTestEndpoints was not found in Program.cs (speed test API will be missing)."; fi

detail "backend built: $(rel "$BACKEND_DLL")"
end_step PASS

# ============================================================
# 6. Frontend
# ============================================================

begin_step 5

FRONTEND_DIR="$PROJECT_ROOT/frontend"

need_install=0
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    info "node_modules not found — dependencies must be installed."
    need_install=1
elif [ ! -x "$FRONTEND_DIR/node_modules/.bin/vite" ] || [ ! -x "$FRONTEND_DIR/node_modules/.bin/tsc" ]; then
    warn "node_modules exists but vite/tsc are missing (incomplete install) — reinstalling."
    need_install=1
else
    ok "Frontend dependencies already installed"
fi

if [ "$need_install" -eq 1 ]; then
    if [ -f "$FRONTEND_DIR/package-lock.json" ]; then
        ok "package-lock.json found — using the exact locked versions (npm ci)"
        if ! run_cmd -s -C "$FRONTEND_DIR" "Install dependencies (npm ci)" npm ci; then
            warn "npm ci failed (lockfile out of sync?) — falling back to npm install."
            run_cmd -C "$FRONTEND_DIR" "Install dependencies (npm install)" npm install
        fi
    else
        warn "package-lock.json not found — using npm install (versions may differ between machines)."
        run_cmd -C "$FRONTEND_DIR" "Install dependencies (npm install)" npm install
    fi
fi

# Lint is advisory: findings are reported but do not block the build.
if run_cmd -s -C "$FRONTEND_DIR" "Lint (oxlint)" npm run lint; then
    LINT_SUMMARY="$(strip_ansi < "$LAST_LOG" | grep -E 'Found [0-9]+ warnings? and [0-9]+ errors?' | tail -n1 || true)"
    [ -n "$LINT_SUMMARY" ] && info "Lint: $LINT_SUMMARY"
fi

# tsc -b (type check) + vite build
run_cmd -C "$FRONTEND_DIR" "Production build (type check + bundle)" npm run build

if [ -f "$FRONTEND_DIR/dist/index.html" ]; then ok "dist/index.html generated"
else fail_now "The frontend build reported success but dist/index.html is missing" "See: $(rel "$LAST_LOG")"; fi

if compgen -G "$FRONTEND_DIR/dist/assets/CpuView-*.js" >/dev/null; then ok "CPU tab is in the production bundle (dist/assets/CpuView-*.js)"
else fail_now "The CPU tab was not bundled" "dist/assets/CpuView-*.js is missing." "Check frontend/src/App.tsx lazy-imports ./components/views/CpuView and rebuild."; fi

detail "frontend built: $(find "$FRONTEND_DIR/dist" -type f | wc -l) files in dist/"
end_step PASS

# ============================================================
# 7. Tests
# ============================================================

begin_step 6

if [ "$RUN_TESTS" -eq 0 ]; then
    warn "Tests were skipped (--skip-tests)."
    detail "skipped by --skip-tests"
    end_step SKIP
else
    # --- 7a. Native / Assembly tests (ctest)
    NATIVE_TEST_DIR="$PROJECT_ROOT/native/build-tests"
    run_cmd "Configure native tests" cmake -S "$PROJECT_ROOT/native" -B "$NATIVE_TEST_DIR" -DBUILD_NATIVE_TESTS=ON
    run_cmd "Build native tests" cmake --build "$NATIVE_TEST_DIR" -j"$JOBS"
    run_cmd -C "$NATIVE_TEST_DIR" "Run native tests (ctest)" ctest --output-on-failure

    CTEST_LINE="$(strip_ansi < "$LAST_LOG" | grep -E 'tests passed' | tail -n1 || true)"
    [ -n "$CTEST_LINE" ] && ok "ctest: $CTEST_LINE"
    if strip_ansi < "$LAST_LOG" | grep -Eq 'cpu_detail_test .*Passed'; then ok "cpu_detail_test passed"
    else fail_now "cpu_detail_test did not run/pass" "See: $(rel "$LAST_LOG")"; fi
    detail "native: ${CTEST_LINE:-passed}"

    # --- 7b. Backend tests (analytics, storage, memory, GPU, overlay, CPU) against the real native library
    run_cmd "Run backend tests" env "SYSTEMINFO_NATIVE_DIR=$PROJECT_ROOT/native/build" \
        dotnet run --project "$PROJECT_ROOT/backend/SystemMonitor.Tests"

    BACKEND_LINE="$(strip_ansi < "$LAST_LOG" | grep -E '^all [0-9]+ checks passed' | tail -n1 || true)"
    if [ -n "$BACKEND_LINE" ]; then ok "backend: $BACKEND_LINE"
    else fail_now "Backend tests did not report success" "Expected a line like 'all N checks passed'." "See: $(rel "$LAST_LOG")"; fi
    SKIPPED_LINES="$(strip_ansi < "$LAST_LOG" | grep -E '^SKIPPED' || true)"
    if [ -n "$SKIPPED_LINES" ]; then
        while IFS= read -r l; do warn "backend test coverage reduced — $l"; done <<< "$SKIPPED_LINES"
    else
        ok "backend: no tests were skipped (native library round trips ran)"
    fi
    detail "backend: $BACKEND_LINE"

    # --- 7c. Frontend tests (node --test)
    run_cmd -C "$FRONTEND_DIR" "Run frontend tests" npm test

    FE_PASS="$(strip_ansi < "$LAST_LOG" | sed -nE 's/^[[:space:]]*ℹ[[:space:]]+pass[[:space:]]+([0-9]+)[[:space:]]*$/\1/p; s/^[[:space:]]*#[[:space:]]*pass[[:space:]]+([0-9]+)[[:space:]]*$/\1/p' | tail -n1)"
    FE_FAIL="$(strip_ansi < "$LAST_LOG" | sed -nE 's/^[[:space:]]*ℹ[[:space:]]+fail[[:space:]]+([0-9]+)[[:space:]]*$/\1/p; s/^[[:space:]]*#[[:space:]]*fail[[:space:]]+([0-9]+)[[:space:]]*$/\1/p' | tail -n1)"

    if [[ "${FE_PASS:-}" =~ ^[0-9]+$ ]] && [[ "${FE_FAIL:-}" =~ ^[0-9]+$ ]] && [ "$FE_FAIL" -eq 0 ]; then
        ok "frontend: $FE_PASS tests passed, 0 failed"
    else
        fail_now "Frontend tests did not report a clean pass" \
            "pass=${FE_PASS:-?} fail=${FE_FAIL:-?}" \
            "See: $(rel "$LAST_LOG")"
    fi
    detail "frontend: ${FE_PASS} tests passed"


    end_step PASS
fi

# ============================================================
# 8. Final validation
# ============================================================

begin_step 7

for script in start-all.sh setup.sh build.sh native/build.sh; do
    if [ -f "$PROJECT_ROOT/$script" ] && [ ! -x "$PROJECT_ROOT/$script" ]; then
        warn "$script was not executable — fixed."
        chmod +x "$PROJECT_ROOT/$script"
    fi
    if bash -n "$PROJECT_ROOT/$script" 2>"$CMD_LOG_DIR/syntax-error.txt"; then ok "$script: shell syntax is valid"
    else fail_now "$script has a shell syntax error" "$(cat "$CMD_LOG_DIR/syntax-error.txt")"; fi
done

# Every file that carries the app version must agree with the top CHANGELOG entry.
run_cmd "Version consistency (check-version)" node "$PROJECT_ROOT/scripts/check-version.mjs"
VERSION_LINE="$(strip_ansi < "$LAST_LOG" | grep -E 'Expected version' | head -n1 || true)"
[ -n "$VERSION_LINE" ] && info "$VERSION_LINE"
detail "${VERSION_LINE:-versions consistent}"

ok "All validation checks passed"
end_step PASS

# ============================================================
# Launch helpers
# ============================================================

FRONTEND_PORT="$(grep -oP '^FRONTEND_PORT=\K[0-9]+' "$PROJECT_ROOT/start-all.sh" 2>/dev/null | head -n1 || true)"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"     # the same port start-all.sh and tauri.conf.json use
TAURI_BACKEND_PORT=5132                    # fixed in frontend/src-tauri/src/process.rs
APP_URL="http://localhost:$FRONTEND_PORT"

desktop_session() { [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; }

port_busy() {  # port_busy <port> — true if something is listening there
    if command -v lsof >/dev/null 2>&1; then
        lsof -i ":$1" -sTCP:LISTEN -t >/dev/null 2>&1
    elif command -v ss >/dev/null 2>&1; then
        ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"
    else
        # Neither tool installed: try to connect (IPv4 and IPv6 loopback). Works in plain bash.
        ( exec 3<>"/dev/tcp/127.0.0.1/$1" ) 2>/dev/null || ( exec 3<>"/dev/tcp/::1/$1" ) 2>/dev/null
    fi
}

port_owner() {
    local pid
    pid="$(lsof -i ":$1" -sTCP:LISTEN -t 2>/dev/null | head -n1 || true)"
    if [ -n "$pid" ]; then echo "PID $pid ($(ps -p "$pid" -o comm= 2>/dev/null || echo '?'))"; else echo "another program"; fi
}

browser_command() {  # prints the command that can open a URL, or nothing
    if [ -n "${BROWSER:-}" ] && command -v "${BROWSER%% *}" >/dev/null 2>&1; then echo "$BROWSER"; return 0; fi
    local c
    for c in xdg-open sensible-browser x-www-browser gnome-open "gio open"; do
        if command -v "${c%% *}" >/dev/null 2>&1; then echo "$c"; return 0; fi
    done
    return 0
}

# Opens the browser once THIS run of start-all.sh reports the frontend ready (its frontend.log gets a fresh
# "Local:" line, written only after the backend was verified) and the URL answers. Waiting for the log, not just
# the port, means an unrelated program on the same port can never trigger it. Runs in the background; ends when
# the app is up, when build.sh's process (which becomes start-all.sh) is gone, or after 5 minutes.
open_when_ready() {  # open_when_ready <url> <pid-to-watch> <browser-command>
    local url="$1" watch="$2" opener="$3"
    local since logfile="$LOG_DIR/frontend.log"
    since="$(now)"
    (
        trap - EXIT ERR INT TERM
        set +e +E
        i=0
        while [ "$i" -lt 300 ]; do
            kill -0 "$watch" 2>/dev/null || exit 0
            mtime="$(stat -c %Y "$logfile" 2>/dev/null || echo 0)"
            if [ "$mtime" -ge "$since" ] && grep -q 'Local:' "$logfile" 2>/dev/null; then
                if ! command -v curl >/dev/null 2>&1 || curl -fsS -o /dev/null --max-time 2 "$url" >/dev/null 2>&1; then
                    # shellcheck disable=SC2086
                    $opener "$url" >/dev/null 2>&1 &
                    exit 0
                fi
            fi
            sleep 1
            i=$((i + 1))
        done
        exit 0
    ) >/dev/null 2>&1 &
    disown 2>/dev/null || true
}

# Each check prints what it found; it returns 1 if the mode cannot start.
browser_check() {
    local problems=0
    emit "${BOLD}Checking what the browser option needs${NC}"
    if port_busy "$FRONTEND_PORT"; then
        bad "port $FRONTEND_PORT is already in use by $(port_owner "$FRONTEND_PORT") — the frontend cannot start"
        problems=$((problems + 1))
    else
        ok "port $FRONTEND_PORT is free"
    fi
    if command -v curl >/dev/null 2>&1; then ok "curl is available"
    else bad "curl is missing (start-all.sh needs it to check the backend): sudo apt install curl"; problems=$((problems + 1)); fi
    if desktop_session && [ -n "$(browser_command)" ]; then ok "a browser can be opened automatically ($(browser_command))"
    else warn "no desktop session or opener found — the browser will not open by itself; open $APP_URL yourself"; fi
    [ "$problems" -eq 0 ]
}

tauri_check() {
    local problems=0 lib
    emit "${BOLD}Checking what the Tauri desktop app needs${NC}"
    if [ -f "$HOME/.cargo/env" ]; then . "$HOME/.cargo/env"; fi    # rustup installs cargo here; non-login shells miss it

    if command -v cargo >/dev/null 2>&1; then ok "cargo: $(cargo --version 2>/dev/null)"
    else bad "cargo (Rust) is not installed"; problems=$((problems + 1)); fi
    if command -v rustc >/dev/null 2>&1; then ok "rustc: $(rustc --version 2>/dev/null)"
    else bad "rustc is not installed"; problems=$((problems + 1)); fi

    if [ -x "$PROJECT_ROOT/frontend/node_modules/.bin/tauri" ]; then ok "Tauri CLI is installed (frontend/node_modules/.bin/tauri)"
    else bad "Tauri CLI is missing from frontend/node_modules"; problems=$((problems + 1)); fi

    if command -v pkg-config >/dev/null 2>&1; then
        for lib in webkit2gtk-4.1 gtk+-3.0; do
            if pkg-config --exists "$lib" 2>/dev/null; then ok "system library $lib"
            else bad "system library $lib is missing"; problems=$((problems + 1)); fi
        done
    else
        bad "pkg-config is missing, so the Tauri system libraries cannot be checked"; problems=$((problems + 1))
    fi

    if desktop_session; then ok "desktop session found (${WAYLAND_DISPLAY:-$DISPLAY})"
    else bad "no desktop session (DISPLAY / WAYLAND_DISPLAY is empty) — a window cannot open from here"; problems=$((problems + 1)); fi

    local port
    for port in "$FRONTEND_PORT" "$TAURI_BACKEND_PORT"; do
        if port_busy "$port"; then bad "port $port is already in use by $(port_owner "$port")"; problems=$((problems + 1))
        else ok "port $port is free"; fi
    done

    if find "$PROJECT_ROOT/backend/SystemMonitor.Api/bin" -type f -name SystemMonitor.Api 2>/dev/null | grep -q .; then
        ok "backend program found for the app to start"
    else
        warn "no built backend program (backend/SystemMonitor.Api/bin/**/SystemMonitor.Api) — the app may not find its backend"
    fi

    if [ "$problems" -gt 0 ]; then
        emit ""
        emit "${BOLD}How to fix${NC}"
        emit "  Rust:              curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   (then open a new terminal)"
        emit "  Debian/Ubuntu:     sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev build-essential pkg-config"
        emit "  Fedora:            sudo dnf install webkit2gtk4.1-devel gtk3-devel openssl-devel libxdo-devel librsvg2-devel"
        emit "  Tauri CLI:         cd frontend && npm install"
        emit "  Busy port:         stop the program named above (kill <PID>)"
        return 1
    fi
    return 0
}

launch_unavailable() {  # the build is fine; the chosen way to open it is not
    emit ""
    emit "${YELLOW}The build itself succeeded, but the app cannot be started this way (see above).${NC}"
    emit "Fix it and run ./build.sh again, or choose another option:  --browser  --tauri  --no-start"
    exit 1
}

launch_browser() {
    emit ""
    emit "${BOLD}Starting backend + frontend, then opening your browser${NC}"
    local opener=""
    if desktop_session; then opener="$(browser_command)"; fi
    if [ -n "$opener" ]; then
        emit "  Your browser opens at ${BOLD}$APP_URL${NC} as soon as everything is ready."
        open_when_ready "$APP_URL" "$$" "$opener"
    else
        emit "  Open ${BOLD}$APP_URL${NC} in a browser once it says 'Everything is running'."
        emit "  (Over SSH: ssh -L $FRONTEND_PORT:localhost:$FRONTEND_PORT <this-machine>, then open it locally.)"
    fi
    emit "  Press Ctrl+C to stop everything."
    emit ""
    exec "$PROJECT_ROOT/start-all.sh"
}

launch_tauri() {
    emit ""
    emit "${BOLD}Starting the Tauri desktop app${NC}"
    emit "  Tauri starts the frontend (port $FRONTEND_PORT) and the backend (port $TAURI_BACKEND_PORT) itself;"
    emit "  start-all.sh is not used."
    emit "  The first launch compiles the Rust shell and can take several minutes; later launches take seconds."
    emit "  Close the app window, or press Ctrl+C here, to stop everything."
    emit ""
    cd "$PROJECT_ROOT/frontend"
    exec npm run tauri dev
}

choose_launch() {
    # A flag or BUILD_LAUNCH decides without asking.
    if [ -n "$LAUNCH" ]; then
        case "$LAUNCH" in
            browser) browser_check || launch_unavailable ;;
            tauri)   tauri_check   || launch_unavailable ;;
        esac
        return 0
    fi

    # No terminal to ask on (pipe, CI): keep the old behaviour — start in the browser setup.
    if [ ! -t 0 ] || [ ! -t 1 ]; then
        info "Not an interactive terminal — using the default (browser). Use --tauri or --no-start to change it."
        LAUNCH=browser
        browser_check || launch_unavailable
        return 0
    fi

    local answer
    while true; do
        emit ""
        emit "${CYAN}==================================================${NC}"
        emit "${CYAN} How do you want to open System Info?${NC}"
        emit "${CYAN}==================================================${NC}"
        emit "  ${BOLD}1)${NC} Browser   backend + frontend on localhost, opens your default browser  ${DIM}(default)${NC}"
        emit "  ${BOLD}2)${NC} Tauri     the desktop app window; it starts the backend itself"
        emit "  ${BOLD}3)${NC} Neither   build only — start later with ./start-all.sh or ./build.sh --tauri"
        printf '%s' "Choose 1, 2 or 3 [1]: "
        read -r answer || answer=""
        printf 'Choose 1, 2 or 3 [1]: %s\n' "$answer" | strip_ansi >> "$BUILD_LOG"
        case "$(printf '%s' "$answer" | tr 'A-Z' 'a-z')" in
            ""|1|b|browser) emit ""; LAUNCH=browser; browser_check && return 0 ;;
            2|t|tauri)      emit ""; LAUNCH=tauri;   tauri_check   && return 0 ;;
            3|n|none|q)     LAUNCH=none; return 0 ;;
            *)              emit "${YELLOW}Please type 1, 2 or 3.${NC}"; continue ;;
        esac
        emit ""
        emit "${YELLOW}That option cannot start right now (see above). Pick another, or choose 3 and fix it first.${NC}"
    done
}

# ============================================================
# Done
# ============================================================

emit ""
emit "${GREEN}==================================================${NC}"
if [ "${#WARNINGS[@]}" -gt 0 ]; then
    emit "${GREEN} BUILD SUCCESSFUL${NC} ${YELLOW}(with ${#WARNINGS[@]} warning(s) — see below)${NC}"
else
    emit "${GREEN} BUILD SUCCESSFUL${NC}"
fi
emit "${GREEN}==================================================${NC}"

trap - EXIT ERR INT TERM
print_summary

choose_launch

case "$LAUNCH" in
    browser) launch_browser ;;
    tauri)   launch_tauri ;;
    *)
        emit ""
        emit "Build finished. Nothing was started."
        emit "  Browser:  ./start-all.sh          (then open $APP_URL)"
        emit "  Desktop:  cd frontend && npm run tauri dev"
        exit 0
        ;;
esac