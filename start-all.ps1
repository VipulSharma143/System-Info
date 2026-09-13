# start-all.ps1 — System Info DEVELOPER launcher
#
# DEV-ONLY. Starts the three services via their dev commands (dotnet run,
# npm run dev, python -m uvicorn) for local development.
#
# This is NO LONGER what ships as SystemInfo.exe — the production launcher
# is launcher/Program.cs, a self-contained .NET executable that starts the
# already-built backend/SystemMonitor.Api.exe and analytics/analytics.exe
# directly, with no dev toolchain required. See
# .github/workflows/build-windows-installer.yml for the production build.
#
# Responsibilities:
#   - Resolve the application directory safely
#   - Validate required application folders/files
#   - Validate MONGO_URI
#   - Check required ports
#   - Start backend, analytics, and frontend in order
#   - Wait for every service to become ready
#   - Write useful logs
#   - Clean up child jobs when the launcher exits
#
# Development:
#   powershell -ExecutionPolicy Bypass -File .\start-all.ps1
#
# Compiled:
#   SystemInfo.exe

$ErrorActionPreference = "Stop"

# ============================================================
# 1. Resolve application root
# ============================================================

$ProjectRoot = $null

# ------------------------------------------------------------
# PS2EXE compiled executable
# ------------------------------------------------------------
# PS2EXE provides $ScriptRoot for the compiled executable.
if (
    $null -ne (Get-Variable -Name "ScriptRoot" -ErrorAction SilentlyContinue) -and
    -not [string]::IsNullOrWhiteSpace($ScriptRoot)
) {
    $ProjectRoot = $ScriptRoot
}

# ------------------------------------------------------------
# Normal PowerShell script
# ------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    if (
        $null -ne (Get-Variable -Name "PSScriptRoot" -ErrorAction SilentlyContinue) -and
        -not [string]::IsNullOrWhiteSpace($PSScriptRoot)
    ) {
        $ProjectRoot = $PSScriptRoot
    }
}

# ------------------------------------------------------------
# PSCommandPath fallback
# ------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    if (
        $null -ne (Get-Variable -Name "PSCommandPath" -ErrorAction SilentlyContinue) -and
        -not [string]::IsNullOrWhiteSpace($PSCommandPath)
    ) {
        try {
            $ProjectRoot = Split-Path -Parent $PSCommandPath
        }
        catch {
            $ProjectRoot = $null
        }
    }
}

# ------------------------------------------------------------
# MyInvocation fallback
# ------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    try {
        $InvocationPath = $MyInvocation.MyCommand.Path

        if (-not [string]::IsNullOrWhiteSpace($InvocationPath)) {
            $ProjectRoot = Split-Path -Parent $InvocationPath
        }
    }
    catch {
        $ProjectRoot = $null
    }
}

# ------------------------------------------------------------
# Compiled executable command-line fallback
# ------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    try {
        $CommandLinePath = [Environment]::GetCommandLineArgs()[0]

        if (-not [string]::IsNullOrWhiteSpace($CommandLinePath)) {
            $CommandLineFullPath = [System.IO.Path]::GetFullPath($CommandLinePath)

            if (
                $CommandLineFullPath.EndsWith(
                    ".exe",
                    [System.StringComparison]::OrdinalIgnoreCase
                )
            ) {
                $ProjectRoot = Split-Path -Parent $CommandLineFullPath
            }
        }
    }
    catch {
        $ProjectRoot = $null
    }
}

# ------------------------------------------------------------
# Final application-domain fallback
# ------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    try {
        $BaseDirectory = [AppDomain]::CurrentDomain.BaseDirectory

        if (-not [string]::IsNullOrWhiteSpace($BaseDirectory)) {
            $ProjectRoot = $BaseDirectory
        }
    }
    catch {
        $ProjectRoot = $null
    }
}

# ------------------------------------------------------------
# Validate root
# ------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Red
    Write-Host " [ERROR] Unable to determine application directory." -ForegroundColor Red
    Write-Host "==================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "System Info could not determine where it is installed."
    Write-Host ""
    Write-Host "Please reinstall the application and try again."
    Write-Host ""
    exit 1
}

try {
    $ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
}
catch {
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Red
    Write-Host " [ERROR] Invalid application directory." -ForegroundColor Red
    Write-Host "==================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host $ProjectRoot
    Write-Host ""
    exit 1
}

# Remove trailing separator except when the path is a root such as C:\
if (
    $ProjectRoot.Length -gt 3 -and
    (
        $ProjectRoot.EndsWith("\") -or
        $ProjectRoot.EndsWith("/")
    )
) {
    $ProjectRoot = $ProjectRoot.TrimEnd('\', '/')
}

# ============================================================
# 2. Application paths
# ============================================================

$LogDir = Join-Path -Path $ProjectRoot -ChildPath "logs"

$BackendDir = Join-Path -Path $ProjectRoot -ChildPath "backend\SystemMonitor.Api"
$AnalyticsDir = Join-Path -Path $ProjectRoot -ChildPath "analytics"
$FrontendDir = Join-Path -Path $ProjectRoot -ChildPath "frontend"

$BackendProject = Join-Path -Path $BackendDir -ChildPath "SystemMonitor.Api.csproj"
$AnalyticsService = Join-Path -Path $AnalyticsDir -ChildPath "analytics_service.py"
$FrontendPackage = Join-Path -Path $FrontendDir -ChildPath "package.json"

$AnalyticsPort = 8001
$FrontendPort = 5173

$Jobs = @()
$CleanupStarted = $false

# ============================================================
# 3. Logging paths
# ============================================================

try {
    New-Item `
        -ItemType Directory `
        -Force `
        -Path $LogDir `
        -ErrorAction Stop |
        Out-Null
}
catch {
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Red
    Write-Host " [ERROR] Could not create log directory." -ForegroundColor Red
    Write-Host "==================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Path:"
    Write-Host $LogDir
    Write-Host ""
    Write-Host "Reason:"
    Write-Host $_.Exception.Message
    Write-Host ""
    exit 1
}

$BackendLog = Join-Path -Path $LogDir -ChildPath "backend.log"
$AnalyticsLog = Join-Path -Path $LogDir -ChildPath "analytics.log"
$FrontendLog = Join-Path -Path $LogDir -ChildPath "frontend.log"

# ============================================================
# 4. Helper functions
# ============================================================

function Write-Header {
    Write-Host ""
    Write-Host "=================================================="
    Write-Host " System Info - starting all services"
    Write-Host "=================================================="
    Write-Host ""
    Write-Host "Application directory:"
    Write-Host ("  {0}" -f $ProjectRoot)
    Write-Host ""
}

function Cleanup {
    if ($script:CleanupStarted) {
        return
    }

    $script:CleanupStarted = $true

    Write-Host ""
    Write-Host "Shutting down System Info..."

    foreach ($CurrentJob in @($script:Jobs)) {

        if ($null -eq $CurrentJob) {
            continue
        }

        try {
            if (
                $CurrentJob.State -eq "Running" -or
                $CurrentJob.State -eq "NotStarted"
            ) {
                Stop-Job `
                    -Job $CurrentJob `
                    -ErrorAction SilentlyContinue |
                    Out-Null
            }
        }
        catch {
            # Ignore cleanup errors.
        }

        try {
            Remove-Job `
                -Job $CurrentJob `
                -Force `
                -ErrorAction SilentlyContinue |
                Out-Null
        }
        catch {
            # Ignore cleanup errors.
        }
    }

    Write-Host "System Info services stopped."
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
    Write-Host (" [ERROR] {0} did not start correctly." -f $Service) -ForegroundColor Red
    Write-Host "==================================================" -ForegroundColor Red

    if (Test-Path -LiteralPath $LogFile) {

        Write-Host ""
        Write-Host ("Last 30 lines of {0}:" -f $LogFile)
        Write-Host "--------------------------------------------------"

        try {
            Get-Content `
                -LiteralPath $LogFile `
                -Tail 30 `
                -ErrorAction SilentlyContinue
        }
        catch {
            Write-Host "Unable to read the service log."
        }

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

function Port-InUse {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    try {
        $Connection = Get-NetTCPConnection `
            -LocalPort $Port `
            -State Listen `
            -ErrorAction SilentlyContinue

        return [bool]$Connection
    }
    catch {
        return $false
    }
}

function Require-Command {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandName
    )

    $Command = Get-Command `
        $CommandName `
        -ErrorAction SilentlyContinue

    if ($null -eq $Command) {

        Write-Host ""
        Write-Host "==================================================" -ForegroundColor Red
        Write-Host (" [ERROR] Required command '{0}' was not found." -f $CommandName) -ForegroundColor Red
        Write-Host "==================================================" -ForegroundColor Red
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
        Write-Host "==================================================" -ForegroundColor Red
        Write-Host (" [ERROR] Required {0} was not found." -f $Description) -ForegroundColor Red
        Write-Host "==================================================" -ForegroundColor Red
        Write-Host ""
        Write-Host "Path:"
        Write-Host $Path
        Write-Host ""
        Write-Host "The System Info installation appears to be incomplete."
        Write-Host "Please reinstall the application."
        Write-Host ""

        Cleanup

        exit 1
    }
}

function Wait-ForHttp {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Uri,

        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds
    )

    $Elapsed = 0

    while ($Elapsed -lt $TimeoutSeconds) {

        try {
            $Response = Invoke-WebRequest `
                -Uri $Uri `
                -UseBasicParsing `
                -TimeoutSec 3 `
                -ErrorAction Stop

            if ($null -ne $Response) {
                return $true
            }
        }
        catch {
            # Service is not ready yet.
        }

        Start-Sleep -Seconds 1
        $Elapsed++
    }

    return $false
}

# ============================================================
# 5. Start
# ============================================================

Write-Header

# ============================================================
# 6. Validate installation
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
# 7. Validate required runtimes
# ============================================================

Write-Host ""
Write-Host "[CHECK] Checking required runtimes..."

Require-Command "dotnet"
Require-Command "python"
Require-Command "npm"

Write-Host "[OK] Required runtimes are available."

# ============================================================
# 8. Validate MONGO_URI
# ============================================================

Write-Host ""
Write-Host "[CHECK] Checking database configuration..."

if ([string]::IsNullOrWhiteSpace($env:MONGO_URI)) {

    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Red
    Write-Host " [ERROR] MONGO_URI is not set." -ForegroundColor Red
    Write-Host "==================================================" -ForegroundColor Red
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
# 9. Port preflight
# ============================================================

Write-Host ""
Write-Host "[CHECK] Checking required ports..."

$PortConflict = $false

foreach ($Port in @($FrontendPort, $AnalyticsPort)) {

    if (Port-InUse -Port $Port) {

        Write-Host `
            ("[ERROR] Port {0} is already in use." -f $Port) `
            -ForegroundColor Red

        $PortConflict = $true
    }
}

if ($PortConflict) {

    Write-Host ""
    Write-Host "Free the port(s) above and restart System Info."
    Write-Host ""

    exit 1
}

Write-Host `
    ("[OK] Ports {0} and {1} are free." -f $FrontendPort, $AnalyticsPort)

# ============================================================
# 10. Clear old logs
# ============================================================

Remove-Item `
    -LiteralPath $BackendLog `
    -Force `
    -ErrorAction SilentlyContinue

Remove-Item `
    -LiteralPath $AnalyticsLog `
    -Force `
    -ErrorAction SilentlyContinue

Remove-Item `
    -LiteralPath $FrontendLog `
    -Force `
    -ErrorAction SilentlyContinue

# ============================================================
# 11. Start backend
# ============================================================

Write-Host ""
Write-Host "[1/3] Starting backend (.NET)..."

$BackendJob = Start-Job -ScriptBlock {

    param(
        [string]$Directory,
        [string]$LogFile
    )

    $ErrorActionPreference = "Continue"

    try {
        Set-Location -LiteralPath $Directory

        dotnet run *> $LogFile
    }
    catch {
        $_ | Out-File `
            -FilePath $LogFile `
            -Append `
            -Encoding utf8
    }

} -ArgumentList $BackendDir, $BackendLog

$Jobs += $BackendJob

Write-Host "      Waiting for backend to build and start..."

$BackendPort = $null
$Elapsed = 0
$BackendTimeout = 120

while (
    [string]::IsNullOrWhiteSpace($BackendPort) -and
    $Elapsed -lt $BackendTimeout
) {

    if (Test-Path -LiteralPath $BackendLog) {

        try {
            $BackendMatches = Select-String `
                -LiteralPath $BackendLog `
                -Pattern "Now listening on:\s*http://(?:localhost|127\.0\.0\.1):(\d+)" `
                -AllMatches `
                -ErrorAction SilentlyContinue

            if ($BackendMatches) {

                foreach ($Result in $BackendMatches) {

                    foreach ($Match in $Result.Matches) {

                        if ($Match.Groups.Count -gt 1) {

                            $DetectedPort = $Match.Groups[1].Value

                            if (-not [string]::IsNullOrWhiteSpace($DetectedPort)) {
                                $BackendPort = $DetectedPort
                                break
                            }
                        }
                    }

                    if (-not [string]::IsNullOrWhiteSpace($BackendPort)) {
                        break
                    }
                }
            }
        }
        catch {
            # Continue waiting.
        }
    }

    if (
        $BackendJob.State -eq "Failed" -or
        $BackendJob.State -eq "Completed"
    ) {

        if ([string]::IsNullOrWhiteSpace($BackendPort)) {
            Fail-WithLog `
                -Service "Backend" `
                -LogFile $BackendLog
        }
    }

    Start-Sleep -Seconds 1
    $Elapsed++
}

if ([string]::IsNullOrWhiteSpace($BackendPort)) {

    Fail-WithLog `
        -Service "Backend (timed out after 120 seconds)" `
        -LogFile $BackendLog
}

Write-Host `
    ("      Backend detected on port {0}. Checking HTTP response..." -f $BackendPort)

$BackendReady = Wait-ForHttp `
    -Uri ("http://localhost:{0}/api/system/all" -f $BackendPort) `
    -TimeoutSeconds 20

if (-not $BackendReady) {

    Fail-WithLog `
        -Service "Backend (listening but not responding)" `
        -LogFile $BackendLog
}

Write-Host `
    ("[OK] Backend is up on port {0}." -f $BackendPort)

# ============================================================
# 12. Start analytics
# ============================================================

Write-Host ""
Write-Host "[2/3] Starting analytics service (Python)..."

$AnalyticsJob = Start-Job -ScriptBlock {

    param(
        [string]$Directory,
        [string]$LogFile,
        [int]$Port
    )

    $ErrorActionPreference = "Continue"

    try {
        Set-Location -LiteralPath $Directory

        python -m uvicorn `
            analytics_service:app `
            --port $Port `
            --ws none *> $LogFile
    }
    catch {
        $_ | Out-File `
            -FilePath $LogFile `
            -Append `
            -Encoding utf8
    }

} -ArgumentList $AnalyticsDir, $AnalyticsLog, $AnalyticsPort

$Jobs += $AnalyticsJob

Write-Host "      Waiting for analytics service..."

$AnalyticsReady = Wait-ForHttp `
    -Uri ("http://localhost:{0}/health" -f $AnalyticsPort) `
    -TimeoutSeconds 30

if (-not $AnalyticsReady) {

    Fail-WithLog `
        -Service "Analytics service" `
        -LogFile $AnalyticsLog
}

Write-Host `
    ("[OK] Analytics service is up on port {0}." -f $AnalyticsPort)

# ============================================================
# 13. Start frontend
# ============================================================

Write-Host ""
Write-Host "[3/3] Starting frontend (React)..."

$FrontendJob = Start-Job -ScriptBlock {

    param(
        [string]$Directory,
        [string]$LogFile,
        [int]$Port
    )

    $ErrorActionPreference = "Continue"

    try {
        Set-Location -LiteralPath $Directory

        npm run dev `
            -- `
            --host 127.0.0.1 `
            --port $Port `
            --strictPort *> $LogFile
    }
    catch {
        $_ | Out-File `
            -FilePath $LogFile `
            -Append `
            -Encoding utf8
    }

} -ArgumentList $FrontendDir, $FrontendLog, $FrontendPort

$Jobs += $FrontendJob

Write-Host "      Waiting for frontend dev server..."

$FrontendReady = Wait-ForHttp `
    -Uri ("http://localhost:{0}" -f $FrontendPort) `
    -TimeoutSeconds 45

if (-not $FrontendReady) {

    Fail-WithLog `
        -Service "Frontend" `
        -LogFile $FrontendLog
}

Write-Host `
    ("[OK] Frontend is up on port {0}." -f $FrontendPort)

# ============================================================
# 14. Final status
# ============================================================

Write-Host ""
Write-Host "=================================================="
Write-Host " Everything is running and verified."
Write-Host "=================================================="
Write-Host ""
Write-Host (" Frontend:   http://localhost:{0}" -f $FrontendPort)
Write-Host (" Backend:    http://localhost:{0}" -f $BackendPort)
Write-Host (" Analytics:  http://localhost:{0}" -f $AnalyticsPort)
Write-Host ""
Write-Host (" Application: {0}" -f $ProjectRoot)
Write-Host (" Logs:        {0}" -f $LogDir)
Write-Host ""
Write-Host " Press Ctrl+C to stop everything."
Write-Host "=================================================="
Write-Host ""

# ============================================================
# 15. Keep launcher alive
# ============================================================

try {

    while ($true) {

        Start-Sleep -Seconds 2

        foreach ($CurrentJob in @($Jobs)) {

            if ($null -eq $CurrentJob) {
                continue
            }

            if ($CurrentJob.State -eq "Failed") {

                Write-Host ""
                Write-Host "==================================================" -ForegroundColor Red
                Write-Host " [ERROR] A System Info service stopped unexpectedly." -ForegroundColor Red
                Write-Host "==================================================" -ForegroundColor Red
                Write-Host ""

                try {
                    Receive-Job `
                        -Job $CurrentJob `
                        -Keep `
                        -ErrorAction SilentlyContinue
                }
                catch {
                    # Ignore secondary receive errors.
                }

                break
            }
        }
    }

}
finally {

    Cleanup
}