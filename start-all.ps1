# start-all.ps1 — one-command launcher for System Info (Windows)
# Run: powershell -ExecutionPolicy Bypass -File start-all.ps1
#
# Mirrors start-all.sh: starts backend, analytics, frontend in order,
# waits for each to actually respond before starting the next, fails
# loudly with the real log tail on timeout, and pins the frontend port
# with --strictPort so a silent port bump never masquerades as success.

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $ProjectRoot "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$AnalyticsPort = 8001
$FrontendPort  = 5173
$Jobs = @()

function Fail-WithLog($service, $logfile) {
    Write-Host ""
    Write-Host "=================================================="
    Write-Host " [ERROR] $service did not start correctly." -ForegroundColor Red
    Write-Host "=================================================="
    Write-Host "Last 20 lines of ${logfile}:"
    Write-Host "--------------------------------------------------"
    Get-Content $logfile -Tail 20 -ErrorAction SilentlyContinue
    Write-Host "--------------------------------------------------"
    Cleanup
    exit 1
}

function Cleanup {
    Write-Host ""
    Write-Host "Shutting down..."
    foreach ($j in $Jobs) {
        Stop-Job $j -ErrorAction SilentlyContinue | Out-Null
        Remove-Job $j -Force -ErrorAction SilentlyContinue | Out-Null
    }
}

function Port-InUse($port) {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

Write-Host "=================================================="
Write-Host " System Info — starting all services"
Write-Host "=================================================="

# --- 1. MONGO_URI sanity check ---
if (-not $env:MONGO_URI) {
    Write-Host "[ERROR] MONGO_URI is not set." -ForegroundColor Red
    Write-Host "        Run: `$env:MONGO_URI = 'mongodb+srv://...'"
    exit 1
}
Write-Host "[OK] MONGO_URI is set."

# --- 2. Preflight port check ---
Write-Host "Checking required ports are free..."
$conflict = $false
foreach ($port in $FrontendPort, $AnalyticsPort) {
    if (Port-InUse $port) {
        Write-Host "[ERROR] Port $port is already in use." -ForegroundColor Red
        $conflict = $true
    }
}
if ($conflict) {
    Write-Host ""
    Write-Host "Free the port(s) above and re-run start-all.ps1."
    exit 1
}
Write-Host "[OK] Ports $FrontendPort and $AnalyticsPort are free."

# --- 3. Start backend ---
Write-Host "[1/3] Starting backend (.NET)..."
$backendLog = Join-Path $LogDir "backend.log"
Remove-Item $backendLog -ErrorAction SilentlyContinue
$backendJob = Start-Job -ScriptBlock {
    param($dir, $log)
    Set-Location $dir
    dotnet run *> $log
} -ArgumentList (Join-Path $ProjectRoot "backend\SystemMonitor.Api"), $backendLog
$Jobs += $backendJob

Write-Host "      Waiting for backend to finish building and start listening..."
$BackendPort = $null
$elapsed = 0
while (-not $BackendPort -and $elapsed -lt 90) {
    if (Test-Path $backendLog) {
        $match = Select-String -Path $backendLog -Pattern "Now listening on: http://localhost:(\d+)" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($match) { $BackendPort = $match.Matches[0].Groups[1].Value }
    }
    if ($backendJob.State -eq "Failed" -or $backendJob.State -eq "Completed") {
        Fail-WithLog "Backend" $backendLog
    }
    Start-Sleep -Seconds 1
    $elapsed++
}
if (-not $BackendPort) { Fail-WithLog "Backend (timed out after 90s)" $backendLog }

try {
    Invoke-WebRequest -Uri "http://localhost:$BackendPort/api/system/all" -UseBasicParsing -TimeoutSec 5 | Out-Null
} catch {
    Fail-WithLog "Backend (listening but not responding)" $backendLog
}
Write-Host "[OK] Backend is up on port $BackendPort."

# --- 4. Start analytics service ---
Write-Host "[2/3] Starting analytics service (Python)..."
$analyticsLog = Join-Path $LogDir "analytics.log"
Remove-Item $analyticsLog -ErrorAction SilentlyContinue
$analyticsJob = Start-Job -ScriptBlock {
    param($dir, $log, $port)
    Set-Location $dir
    uvicorn analytics_service:app --port $port --ws none *> $log
} -ArgumentList (Join-Path $ProjectRoot "analytics"), $analyticsLog, $AnalyticsPort
$Jobs += $analyticsJob

Write-Host "      Waiting for analytics service to respond..."
$elapsed = 0
$analyticsReady = $false
while ($elapsed -lt 30) {
    try {
        Invoke-WebRequest -Uri "http://localhost:$AnalyticsPort/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
        $analyticsReady = $true
        break
    } catch {}
    if ($analyticsJob.State -eq "Failed" -or $analyticsJob.State -eq "Completed") {
        Fail-WithLog "Analytics service" $analyticsLog
    }
    Start-Sleep -Seconds 1
    $elapsed++
}
if (-not $analyticsReady) { Fail-WithLog "Analytics service (timed out after 30s)" $analyticsLog }
Write-Host "[OK] Analytics service is up on port $AnalyticsPort."

# --- 5. Start frontend ---
Write-Host "[3/3] Starting frontend (React)..."
$frontendLog = Join-Path $LogDir "frontend.log"
Remove-Item $frontendLog -ErrorAction SilentlyContinue
$frontendJob = Start-Job -ScriptBlock {
    param($dir, $log, $port)
    Set-Location $dir
    npm run dev -- --port $port --strictPort *> $log
} -ArgumentList (Join-Path $ProjectRoot "frontend"), $frontendLog, $FrontendPort
$Jobs += $frontendJob

Write-Host "      Waiting for frontend dev server..."
$elapsed = 0
$frontendReady = $false
while ($elapsed -lt 30) {
    if ((Test-Path $frontendLog) -and (Select-String -Path $frontendLog -Pattern "Local:" -Quiet)) {
        $frontendReady = $true
        break
    }
    if ($frontendJob.State -eq "Failed" -or $frontendJob.State -eq "Completed") {
        Fail-WithLog "Frontend" $frontendLog
    }
    Start-Sleep -Seconds 1
    $elapsed++
}
if (-not $frontendReady) { Fail-WithLog "Frontend (timed out after 30s)" $frontendLog }
Write-Host "[OK] Frontend is up on port $FrontendPort."

Write-Host ""
Write-Host "=================================================="
Write-Host " Everything is running and verified."
Write-Host ""
Write-Host " Frontend:   http://localhost:$FrontendPort"
Write-Host " Backend:    http://localhost:$BackendPort"
Write-Host " Analytics:  http://localhost:$AnalyticsPort"
Write-Host ""
Write-Host " Logs in: $LogDir"
Write-Host " Press Ctrl+C to stop everything."
Write-Host "=================================================="

try {
    while ($true) { Start-Sleep -Seconds 1 }
} finally {
    Cleanup
}
