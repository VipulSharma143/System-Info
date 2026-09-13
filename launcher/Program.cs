// SystemInfo.Launcher — production launcher.
//
// This is what SystemInfo.exe actually is after the packaging rework. It
// replaces the old start-all.ps1 (ps2exe-compiled) launcher, which ran
// `dotnet run` / `npm run dev` / `python -m uvicorn` — i.e. it required a
// full development toolchain on the end user's PC. This launcher only ever
// starts already-built executables that are installed next to it:
//
//     backend\SystemMonitor.Api.exe   (self-contained .NET publish)
//     analytics\analytics.exe         (PyInstaller build of run_analytics.py)
//
// No dotnet/npm/python/pip is required on the machine this runs on.

using System.Diagnostics;
using System.Linq;
using System.Net.Http;
using System.Text.RegularExpressions;

var appDir = AppContext.BaseDirectory;
var dataDir = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
    "SystemInfo");
var logDir = Path.Combine(dataDir, "logs");
var configDir = Path.Combine(dataDir, "config");
Directory.CreateDirectory(logDir);
Directory.CreateDirectory(configDir);

var backendLog = Path.Combine(logDir, "backend.log");
var analyticsLog = Path.Combine(logDir, "analytics.log");

// Optional: %LOCALAPPDATA%\SystemInfo\config\mongo_uri.txt lets a user opt
// into historical/analytics logging by dropping their connection string in
// one file. Both the backend and analytics service already degrade
// gracefully (documented in SnapshotLogger.cs / analytics_service.py) when
// MONGO_URI isn't set, so this is optional, not a blocking setup step.
var mongoUriFile = Path.Combine(configDir, "mongo_uri.txt");
var mongoUri = File.Exists(mongoUriFile) ? File.ReadAllText(mongoUriFile).Trim() : null;

var children = new List<Process>();

AppDomain.CurrentDomain.ProcessExit += (_, _) => KillChildren();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; KillChildren(); Environment.Exit(0); };

try
{
    var backendExe = Path.Combine(appDir, "backend", "SystemMonitor.Api.exe");
    var backendPort = StartBackendAndWaitForPort(backendExe, appDir, backendLog, mongoUri);
    if (backendPort is null)
    {
        Fail("Backend", backendLog);
        return 1;
    }

    var analyticsExe = Path.Combine(appDir, "analytics", "analytics.exe");
    var analyticsPort = 8001;
    StartAnalytics(analyticsExe, appDir, analyticsLog, analyticsPort, mongoUri);
    if (!WaitForHttp($"http://127.0.0.1:{analyticsPort}/health", TimeSpan.FromSeconds(30)))
    {
        // Analytics is non-critical for the dashboard to load — log and continue,
        // matching AnalyticsEndpoints.cs's graceful 503 degradation on the backend.
        File.AppendAllText(analyticsLog, "\n[launcher] analytics did not become ready in time; continuing without it.\n");
    }

    var url = $"http://127.0.0.1:{backendPort}";
    if (!WaitForHttp(url, TimeSpan.FromSeconds(20)))
    {
        Fail("Backend (listening but not responding)", backendLog);
        return 1;
    }

    Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });

    // Stay alive (tray-less background process) until the OS kills us on
    // logoff/shutdown, or a child process we're supervising exits early.
    while (true)
    {
        Thread.Sleep(2000);
        if (children.Any(p => p.HasExited)) break;
    }
    return 0;
}
finally
{
    KillChildren();
}

int? StartBackendAndWaitForPort(string exePath, string workingDir, string logFile, string? mongoUri)
{
    if (!File.Exists(exePath))
    {
        File.AppendAllText(logFile, $"[launcher] backend executable not found: {exePath}\n");
        return null;
    }

    var psi = new ProcessStartInfo(exePath)
    {
        WorkingDirectory = Path.GetDirectoryName(exePath),
        UseShellExecute = false,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        CreateNoWindow = true,
    };
    psi.Environment["ASPNETCORE_URLS"] = "http://127.0.0.1:0"; // OS-assigned free port
    psi.Environment["ASPNETCORE_ENVIRONMENT"] = "Production";
    if (mongoUri is not null) psi.Environment["MONGO_URI"] = mongoUri;

    var proc = Process.Start(psi)!;
    children.Add(proc);

    var logWriter = new StreamWriter(File.Open(logFile, FileMode.Create, FileAccess.Write, FileShare.Read)) { AutoFlush = true };
    int? port = null;
    var portRegex = new Regex(@"Now listening on:\s*http://[^:]+:(\d+)");

    proc.OutputDataReceived += (_, e) =>
    {
        if (e.Data is null) return;
        logWriter.WriteLine(e.Data);
        var m = portRegex.Match(e.Data);
        if (m.Success && port is null) port = int.Parse(m.Groups[1].Value);
    };
    proc.ErrorDataReceived += (_, e) => { if (e.Data is not null) logWriter.WriteLine(e.Data); };
    proc.BeginOutputReadLine();
    proc.BeginErrorReadLine();

    var deadline = DateTime.UtcNow.AddSeconds(60);
    while (port is null && DateTime.UtcNow < deadline && !proc.HasExited)
        Thread.Sleep(200);

    return port;
}

void StartAnalytics(string exePath, string workingDir, string logFile, int port, string? mongoUri)
{
    if (!File.Exists(exePath))
    {
        File.AppendAllText(logFile, $"[launcher] analytics executable not found: {exePath}\n");
        return;
    }

    var psi = new ProcessStartInfo(exePath, $"--port {port} --host 127.0.0.1")
    {
        WorkingDirectory = Path.GetDirectoryName(exePath),
        UseShellExecute = false,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        CreateNoWindow = true,
    };
    if (mongoUri is not null) psi.Environment["MONGO_URI"] = mongoUri;

    var proc = Process.Start(psi)!;
    children.Add(proc);

    var logWriter = new StreamWriter(File.Open(logFile, FileMode.Create, FileAccess.Write, FileShare.Read)) { AutoFlush = true };
    proc.OutputDataReceived += (_, e) => { if (e.Data is not null) logWriter.WriteLine(e.Data); };
    proc.ErrorDataReceived += (_, e) => { if (e.Data is not null) logWriter.WriteLine(e.Data); };
    proc.BeginOutputReadLine();
    proc.BeginErrorReadLine();
}

bool WaitForHttp(string url, TimeSpan timeout)
{
    using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
    var deadline = DateTime.UtcNow + timeout;
    while (DateTime.UtcNow < deadline)
    {
        try
        {
            var resp = client.GetAsync(url).GetAwaiter().GetResult();
            if ((int)resp.StatusCode < 500) return true;
        }
        catch { /* not up yet */ }
        Thread.Sleep(500);
    }
    return false;
}

void Fail(string service, string logFile)
{
    Console.Error.WriteLine($"[SystemInfo] {service} failed to start. See log: {logFile}");
}

void KillChildren()
{
    foreach (var p in children)
    {
        try { if (!p.HasExited) p.Kill(entireProcessTree: true); } catch { /* already gone */ }
    }
}
