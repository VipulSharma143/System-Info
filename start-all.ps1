```powershell
# start-all.ps1 — System Info Windows launcher
#
# Supports:
#   1. Running directly as start-all.ps1
#   2. Running as the compiled SystemInfo.exe created with PS2EXE
#
# Responsibilities:
#   - Resolve the application directory safely
#   - Validate required application folders
#   - Validate MONGO_URI
#   - Check required ports
#   - Start backend, analytics, and frontend in order
#   - Wait for every service to become ready
#   - Write useful logs
#   - Clean up child jobs when the launcher exits
#
# Development launcher:
#   powershell -ExecutionPolicy Bypass -File .\start-all.ps1
#
# Compiled launcher:
#   SystemInfo.exe

$ErrorActionPreference = "Stop"

# ============================================================
# 1. Resolve application root safely
# ============================================================
#
# When running as a normal .ps1 file, use the script location.
#
# When compiled with PS2EXE, $PSScriptRoot and
# $MyInvocation.MyCommand.Path can be unavailable/null.
# PS2EXE exposes $ScriptRoot for the executable location.
#
# We deliberately try multiple safe fallbacks so the launcher
# does not fail with:
#
# "Cannot bind argument to parameter 'Path' because it is null."
#

$ProjectRoot = $null

# Compiled PS2EXE executable
if (-not [string]::IsNullOrWhiteSpace($ScriptRoot)) {
    $ProjectRoot = $ScriptRoot
}

# Normal PowerShell script
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        $ProjectRoot = $PSScriptRoot
    }
}

# MyInvocation fallback for normal .ps1 execution
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $scriptPath = $MyInvocation.MyCommand.Path

    if (-not [string]::IsNullOrWhiteSpace($scriptPath)) {
        $ProjectRoot = Split-Path -Parent $scriptPath
    }
}

# Current executable/process directory as final fallback
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    try {
        $ProjectRoot = [AppDomain]::CurrentDomain.BaseDirectory
    }
    catch {
        $ProjectRoot = $null
    }
}

# Final validation
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Red
    Write-Host " [ERROR] Unable to determine application directory." -ForegroundColor Red
    Write-Host "==================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "System Info could not determine where it was installed."
    Write-Host "Please reinstall the application and try again."
    Write-Host ""
    exit 1
}

try {
    $ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
}
catch {
    Write-Host ""
    Write-Host "[ERROR] Invalid application directory:" -ForegroundColor Red
    Write-Host $ProjectRoot
    Write-Host ""
    exit 1
}

# Remove trailing directory separator except for filesystem root.
$ProjectRoot = $ProjectRoot.TrimEnd('\', '/')

# ============================================================
# 2. Application paths
# ============================================================

$LogDir = Join-Path $ProjectRoot "logs"

$BackendDir = Join-Path $ProjectRoot "backend\SystemMonitor.Api"
$AnalyticsDir = Join-Path $ProjectRoot "analytics"
$FrontendDir = Join-Path $ProjectRoot "frontend"

$BackendProject = Join-Path $BackendDir "SystemMonitor.Api.csproj"
$AnalyticsService = Join-Path $AnalyticsDir "analytics_service.py"
$FrontendPackage = Join-Path $FrontendDir "package.json"

$AnalyticsPort = 8001
$FrontendPort = 5173

$Jobs = @()

# ============================================================
# 3. Logging
# ============================================================

try {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
}
catch {
    Write-Host ""
    Write-Host "[ERROR] Could not create log directory:" -ForegroundColor Red
    Write-Host $LogDir
    Write-Host ""
    Write-Host $_.Exception.Message
    exit 1
}

$BackendLog = Join-Path $LogDir "backend.log"
$AnalyticsLog = Join-Path $LogDir "analytics.log"
$FrontendLog = Join-Path $LogDir "frontend.log"

# ============================================================
# 4. Helper functions
# ============================================================

function Write-Header {
    Write-Host ""
    Write-Host "=================================================="
    Write-Host " System Info — starting all services"
    Write-Host "=================================================="
    Write-Host ""
    Write-Host "Application directory:"
    Write-Host "  $ProjectRoot"
    Write-Host ""
}

function Fail-WithLog {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Service,

        [Parameter(Mandatory = $true)]
        [string]$LogFile
    )

    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Red
    Write-Host " [ERROR] $Service did not start correctly." -ForegroundColor Red
    Write-Host "==================================================" -ForegroundColor Red

    if (Test-Path $LogFile) {
        Write-Host ""
        Write-Host "Last 30 lines of $LogFile:"
        Write-Host "--------------------------------------------------"

        Get-Content `
            -Path $LogFile `
            -Tail 30 `
            -ErrorAction SilentlyContinue

        Write-Host "--------------------------------------------------"
    }
    else {
        Write-Host ""
        Write-Host "Log file was not created:"
        Write-Host $LogFile
    }

    Cleanup

    exit 1
}

function Cleanup {
    Write-Host ""
    Write-Host "Shutting down..."

    foreach ($job in $Jobs) {
        if ($null -ne $job) {
            Stop-Job `
                -Job $job `
                -ErrorAction SilentlyContinue |
                Out-Null

            Remove-Job `
                -Job $job `
                -Force `
                -ErrorAction SilentlyContinue |
                Out-Null
        }
    }
}

function Port-InUse {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    return [bool](
        Get-NetTCPConnection `
            -LocalPort $Port `
            -State Listen `
            -ErrorAction SilentlyContinue
    )
}

function Require-Command {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandName
    )

    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        Write-Host ""
        Write-Host "[ERROR] Required command '$CommandName' was not found." -ForegroundColor Red
        Write-Host ""
        Write-Host "Make sure the required runtime is installed and available on PATH."
        Write-Host ""
        Cleanup
        exit 1
    }
}

function Require-Path {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        Write-Host ""
        Write-Host "[ERROR] Required $Description was not found:" -ForegroundColor Red
        Write-Host "        $Path"
        Write-Host ""
        Write-Host "The System Info installation appears to be incomplete."
        Write-Host "Please reinstall the application."
        Write-Host ""
        Cleanup
        exit 1
    }
}

# ============================================================
# 5. Cleanup on Ctrl+C / termination
# ============================================================

try {
    [Console]::TreatControlCAsInput = $false
}
catch {
    # Ignore if the host does not support this.
}

# ============================================================
# 6. Start
# ============================================================

Write-Header

# ============================================================
# 7. Validate installation
# ============================================================

Write-Host "[CHECK] Validating System Info installation..."

Require-Path `
    -Path $BackendDir `
    -Description "backend directory"

Require-Path `
    -Path $AnalyticsDir `
    -Description "analytics directory"

Require-Path `
    -Path $FrontendDir `
    -Description "frontend directory"

Require-Path `
    -Path $BackendProject `
    -Description "backend project"

Require-Path `
    -Path $AnalyticsService `
    -Description "analytics service"

Require-Path `
    -Path $FrontendPackage `
    -Description "frontend package.json"

Write-Host "[OK] Installation structure is valid."

# ============================================================
# 8. Validate required commands
# ============================================================

Write-Host ""
Write-Host "[CHECK] Checking required runtimes..."

Require-Command "dotnet"
Require-Command "python"
Require-Command "npm"

Write-Host "[OK] Required runtimes are available."

# ============================================================
# 9. MONGO_URI
# ============================================================

Write-Host ""
Write-Host "[CHECK] Checking database configuration..."

if ([string]::IsNullOrWhiteSpace($env:MONGO_URI)) {
    Write-Host ""
    Write-Host "[ERROR] MONGO_URI is not set." -ForegroundColor Red
    Write-Host ""
    Write-Host "Set the MongoDB connection string before starting System Info."
    Write-Host ""
    Write-Host "Example:"
    Write-Host "  `$env:MONGO_URI = 'mongodb+srv://...'"
    Write-Host ""

    exit 1
}

Write-Host "[OK] MONGO_URI is set."

# ============================================================
# 10. Port preflight
# ============================================================

Write-Host ""
Write-Host "[CHECK] Checking required ports..."

$PortConflict = $false

foreach ($Port in @($FrontendPort, $AnalyticsPort)) {
    if (Port-InUse $Port) {
        Write-Host "[ERROR] Port $Port is already in use." -ForegroundColor Red
        $PortConflict = $true
    }
}

if ($PortConflict) {
    Write-Host ""
    Write-Host "Free the port(s) above and restart System Info."
    Write-Host ""
    exit 1
}

Write-Host "[OK] Ports $FrontendPort and $AnalyticsPort are free."

# ============================================================
# 11. Start backend
# ============================================================

Write-Host ""
Write-Host "[1/3] Starting backend (.NET)..."

Remove-Item `
    -LiteralPath $BackendLog `
    -Force `
    -ErrorAction SilentlyContinue

$BackendJob = Start-Job -ScriptBlock {
    param(
        [string]$Directory,
        [string]$LogFile
    )

    Set-Location -LiteralPath $Directory

    dotnet run *> $LogFile

} -ArgumentList $BackendDir, $BackendLog

$Jobs += $BackendJob

Write-Host "      Waiting for backend to finish building and start..."

$BackendPort = $null
$Elapsed = 0
$BackendTimeout = 90

while (-not $BackendPort -and $Elapsed -lt $BackendTimeout) {

    if (Test-Path $BackendLog) {

        $Match = Select-String `
            -Path $BackendLog `
            -Pattern "Now listening on: http://localhost:(\d+)" `
            -ErrorAction SilentlyContinue |
            Select-Object -First 1

        if ($Match) {
            $BackendPort = $Match.Matches[0].Groups[1].Value
        }
    }

    if (
        $BackendJob.State -eq "Failed" -or
        $BackendJob.State -eq "Completed"
    ) {
        Fail-WithLog `
            -Service "Backend" `
            -LogFile $BackendLog
    }

    Start-Sleep -Seconds 1
    $Elapsed++
}

if (-not $BackendPort) {
    Fail-WithLog `
        -Service "Backend (timed out after 90 seconds)" `
        -LogFile $BackendLog
}

try {
    Invoke-WebRequest `
        -Uri "http://localhost:$BackendPort/api/system/all" `
        -UseBasicParsing `
        -TimeoutSec 5 |
        Out-Null
}
catch {
    Fail-WithLog `
        -Service "Backend (listening but not responding)" `
        -LogFile $BackendLog
}

Write-Host "[OK] Backend is up on port $BackendPort."

# ============================================================
# 12. Start analytics
# ============================================================

Write-Host ""
Write-Host "[2/3] Starting analytics service (Python)..."

Remove-Item `
    -LiteralPath $AnalyticsLog `
    -Force `
    -ErrorAction SilentlyContinue

$AnalyticsJob = Start-Job -ScriptBlock {
    param(
        [string]$Directory,
        [string]$LogFile,
        [int]$Port
    )

    Set-Location -LiteralPath $Directory

    uvicorn analytics_service:app `
        --port $Port `
        --ws none *> $LogFile

} -ArgumentList $AnalyticsDir, $AnalyticsLog, $AnalyticsPort

$Jobs += $AnalyticsJob

Write-Host "      Waiting for analytics service..."

$Elapsed = 0
$AnalyticsReady = $false
$AnalyticsTimeout = 30

while ($Elapsed -lt $AnalyticsTimeout) {

    try {
        Invoke-WebRequest `
            -Uri "http://localhost:$AnalyticsPort/health" `
            -UseBasicParsing `
            -TimeoutSec 2 |
            Out-Null

        $AnalyticsReady = $true
        break
    }
    catch {
        # Service is still starting.
    }

    if (
        $AnalyticsJob.State -eq "Failed" -or
        $AnalyticsJob.State -eq "Completed"
    ) {
        Fail-WithLog `
            -Service "Analytics service" `
            -LogFile $AnalyticsLog
    }

    Start-Sleep -Seconds 1
    $Elapsed++
}

if (-not $AnalyticsReady) {
    Fail-WithLog `
        -Service "Analytics service (timed out after 30 seconds)" `
        -LogFile $AnalyticsLog
}

Write-Host "[OK] Analytics service is up on port $AnalyticsPort."

# ============================================================
# 13. Start frontend
# ============================================================

Write-Host ""
Write-Host "[3/3] Starting frontend (React)..."

Remove-Item `
    -LiteralPath $FrontendLog `
    -Force `
    -ErrorAction SilentlyContinue

$FrontendJob = Start-Job -ScriptBlock {
    param(
        [string]$Directory,
        [string]$LogFile,
        [int]$Port
    )

    Set-Location -LiteralPath $Directory

    npm run dev `
        -- `
        --port $Port `
        --strictPort *> $LogFile

} -ArgumentList $FrontendDir, $FrontendLog, $FrontendPort

$Jobs += $FrontendJob

Write-Host "      Waiting for frontend dev server..."

$Elapsed = 0
$FrontendReady = $false
$FrontendTimeout = 30

while ($Elapsed -lt $FrontendTimeout) {

    if (Test-Path $FrontendLog) {

        if (
            Select-String `
                -Path $FrontendLog `
                -Pattern "Local:" `
                -Quiet `
                -ErrorAction SilentlyContinue
        ) {
            $FrontendReady = $true
            break
        }
    }

    if (
        $FrontendJob.State -eq "Failed" -or
        $FrontendJob.State -eq "Completed"
    ) {
        Fail-WithLog `
            -Service "Frontend" `
            -LogFile $FrontendLog
    }

    Start-Sleep -Seconds 1
    $Elapsed++
}

if (-not $FrontendReady) {
    Fail-WithLog `
        -Service "Frontend (timed out after 30 seconds)" `
        -LogFile $FrontendLog
}

Write-Host "[OK] Frontend is up on port $FrontendPort."

# ============================================================
# 14. Final status
# ============================================================

Write-Host ""
Write-Host "=================================================="
Write-Host " Everything is running and verified."
Write-Host "=================================================="
Write-Host ""
Write-Host " Frontend:   http://localhost:$FrontendPort"
Write-Host " Backend:    http://localhost:$BackendPort"
Write-Host " Analytics:  http://localhost:$AnalyticsPort"
Write-Host ""
Write-Host " Application: $ProjectRoot"
Write-Host " Logs:        $LogDir"
Write-Host ""
Write-Host " Press Ctrl+C to stop everything."
Write-Host "=================================================="

# ============================================================
# 15. Keep launcher alive
# ============================================================

try {
    while ($true) {
        Start-Sleep -Seconds 1

        # Detect unexpected job termination.
        foreach ($Job in $Jobs) {

            if ($Job.State -eq "Failed") {
                Write-Host ""
                Write-Host "[ERROR] A System Info service stopped unexpectedly." -ForegroundColor Red
                Write-Host ""

                Receive-Job `
                    -Job $Job `
                    -Keep `
                    -ErrorAction SilentlyContinue

                break
            }
        }
    }
}
finally {
    Cleanup
}
```
