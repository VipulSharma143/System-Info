# setup.ps1 — System Info setup wizard (Windows)
# Run from an elevated PowerShell: powershell -ExecutionPolicy Bypass -File setup.ps1
#
# Windows equivalent of setup.sh. Checks prerequisites, offers to install
# missing ones via winget, builds the native engine with the Visual Studio
# generator, installs frontend/analytics deps, walks through MONGO_URI,
# checks ports, and offers to launch start-all.ps1.
#
# KNOWN GAP (flagging honestly, not hiding it): this assumes native/CMakeLists.txt
# and the C++ source already build cleanly under MSVC and that
# WindowsSystemInfoProvider.cs is a real implementation, not just the
# "Available: false" stub PROJECT_STATUS.md describes. If native/build.sh
# does `gcc`/`g++`-specific flags, or the C++ code includes <sys/...> Linux
# headers, this step will fail loudly (by design — this script does not
# paper over a broken native build).

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[MISSING] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[ERROR] $msg" -ForegroundColor Red }

function Ask-YesNo($prompt) {
    $reply = Read-Host "$prompt [y/N]"
    return $reply -match '^[Yy]$'
}

Write-Host "=================================================="
Write-Host " System Info — Setup Wizard (Windows)"
Write-Host "=================================================="
Write-Host ""

# --- 1. Check prerequisites ---
Write-Host "Checking prerequisites..."
$Missing = @()

function Check-Cmd($cmd, $wingetId) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) {
        $ver = & $cmd --version 2>&1 | Select-Object -First 1
        Ok "$cmd found ($ver)"
    } else {
        Warn "$cmd not found"
        $script:Missing += $wingetId
    }
}

Check-Cmd "dotnet"  "Microsoft.DotNet.SDK.10"
Check-Cmd "node"    "OpenJS.NodeJS.LTS"
Check-Cmd "npm"     "OpenJS.NodeJS.LTS"
Check-Cmd "python"  "Python.Python.3.12"
Check-Cmd "pip"     "Python.Python.3.12"
Check-Cmd "cmake"   "Kitware.CMake"
Check-Cmd "nasm"    "NASM.NASM"

# MSVC build tools aren't a single command on PATH by default — check for cl.exe
# via vswhere instead of assuming a plain `cl` works outside a Developer shell.
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
    $vsInstall = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($vsInstall) {
        Ok "MSVC Build Tools found at $vsInstall"
    } else {
        Warn "Visual Studio found but C++ Build Tools workload is missing"
        $Missing += "Microsoft.VisualStudio.2022.BuildTools"
    }
} else {
    Warn "MSVC Build Tools not found"
    $Missing += "Microsoft.VisualStudio.2022.BuildTools"
}

Write-Host ""

# --- 2. Offer to install missing packages via winget ---
if ($Missing.Count -gt 0) {
    $UniqueMissing = $Missing | Sort-Object -Unique
    Fail "Missing: $($UniqueMissing -join ', ')"
    if (Ask-YesNo "Install missing packages now via winget?") {
        foreach ($pkg in $UniqueMissing) {
            winget install --id $pkg --source winget --accept-package-agreements --accept-source-agreements
        }
        Ok "Installed missing packages. You may need to restart this shell for PATH changes to take effect."
    } else {
        Fail "Cannot continue without these. Install manually and re-run this script."
        exit 1
    }
} else {
    Ok "All prerequisites already installed."
}

Write-Host ""

# --- 3. Build the native engine ---
Write-Host "Building native C++ engine..."
$NativeLib = Join-Path $ProjectRoot "backend\SystemMonitor.Api\systemmonitor_native.dll"
if (Test-Path $NativeLib) {
    Ok "Native library already built. (delete it and re-run to rebuild)"
} else {
    Push-Location (Join-Path $ProjectRoot "native")
    try {
        cmake -B build -G "Visual Studio 17 2022" -A x64
        cmake --build build --config Release
        $builtDll = Get-ChildItem -Recurse -Filter "systemmonitor_native.dll" -Path "build" | Select-Object -First 1
        if (-not $builtDll) {
            Fail "Build ran but systemmonitor_native.dll was not produced. This likely means native/ source has Linux-only code (sysfs/proc headers) that needs a Windows branch — check native/src for #ifdef __linux__ guards."
            exit 1
        }
        Copy-Item $builtDll.FullName -Destination (Join-Path $ProjectRoot "backend\SystemMonitor.Api\")
        Ok "Native engine built."
    } finally {
        Pop-Location
    }
}

Write-Host ""

# --- 4. Frontend dependencies ---
Write-Host "Installing frontend dependencies..."
Push-Location (Join-Path $ProjectRoot "frontend")
try {
    if (Test-Path "node_modules") {
        Ok "node_modules already present."
    } else {
        npm install
        Ok "Frontend dependencies installed."
    }
} finally {
    Pop-Location
}

Write-Host ""

# --- 5. Analytics dependencies ---
Write-Host "Checking analytics dependencies..."
$check = python -c "import fastapi, uvicorn, pymongo" 2>&1
if ($LASTEXITCODE -eq 0) {
    Ok "fastapi, uvicorn, and pymongo already installed."
} else {
    pip install fastapi uvicorn pymongo --quiet
    Ok "Python analytics dependencies installed."
}

Write-Host ""

# --- 6. MONGO_URI ---
Write-Host "Checking database connection..."
if ($env:MONGO_URI) {
    Ok "MONGO_URI already set in this session."
} else {
    Warn "MONGO_URI is not set."
    Write-Host "You need a MongoDB Atlas connection string (mongodb+srv://user:pass@cluster.../DBNAME)."
    $mongoInput = Read-Host "Paste it now (or press Enter to skip and set it manually later)"
    if ($mongoInput) {
        [System.Environment]::SetEnvironmentVariable("MONGO_URI", $mongoInput, "User")
        $env:MONGO_URI = $mongoInput
        Ok "Saved as a persistent User environment variable and set for this session."
    } else {
        Warn "Skipped. Set MONGO_URI manually before running start-all.ps1."
    }
}

Write-Host ""

# --- 7. Port check ---
Write-Host "Checking ports start-all.ps1 will need..."
$PortWarning = $false
foreach ($port in 5173, 8001) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $pid_ = $conn[0].OwningProcess
        $procName = (Get-Process -Id $pid_ -ErrorAction SilentlyContinue).ProcessName
        Warn "Port $port is currently in use by PID $pid_ ($procName)."
        $PortWarning = $true
    }
}
if ($PortWarning) {
    Write-Host "        start-all.ps1 will refuse to start until the port(s) above are freed."
} else {
    Ok "Ports 5173 and 8001 are free."
}

Write-Host ""
Write-Host "=================================================="
Write-Host " Setup complete."
Write-Host "=================================================="
Write-Host ""

# --- 8. Offer to launch everything ---
if ($PortWarning) {
    Write-Host "Resolve the port conflict above before launching."
} elseif (Ask-YesNo "Start the application now (start-all.ps1)?") {
    & (Join-Path $ProjectRoot "start-all.ps1")
} else {
    Write-Host "Run start-all.ps1 whenever you're ready."
}
