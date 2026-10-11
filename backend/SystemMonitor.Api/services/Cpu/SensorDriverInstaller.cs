using System.ComponentModel;
using System.Diagnostics;
using System.Security.Cryptography;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Installs the PawnIO sensor driver, which the processor-temperature library needs on Windows. The release build ships the
/// official signed PawnIO installer (PawnIO_setup.exe beside the backend, fetched and hash-checked by
/// scripts/fetch-pawnio.mjs), so nobody has to download anything. Order: the bundled installer (run only if its SHA-256
/// matches the pinned value), then winget as a fallback for builds that do not carry it. Success means the PawnIO service is
/// registered afterwards, not just a zero exit code. The backend is elevated at launch, so no second prompt appears.
/// </summary>
public static class SensorDriverInstaller
{
    /// <summary>A custom header forces a CORS preflight, so a web page on another origin cannot trigger the install.</summary>
    public const string ActionHeader = "X-SystemInfo-Action";

    /// <summary>SHA-256 of PawnIO_setup.exe 2.2.0 (the winget manifest's value). Keep in sync with scripts/fetch-pawnio.mjs.</summary>
    public const string BundledSha256 = "1F519A22E47187F70A1379A48CA604981C4FCF694F4E65B734AAA74A9FBA3032";
    private const string ManualUrl = "https://pawnio.eu";
    private static readonly SemaphoreSlim Gate = new(1, 1);

    public static string? BundledInstallerPath()
    {
        var dir = Path.GetDirectoryName(Environment.ProcessPath);
        if (dir is null) return null;
        // Tauri copies a glob resource flat (no sub-folders), so the installer sits beside the backend exe; "drivers" is
        // checked too for builds that stage it in a sub-folder.
        foreach (var candidate in new[] { Path.Combine(dir, "PawnIO_setup.exe"), Path.Combine(dir, "drivers", "PawnIO_setup.exe") })
            if (File.Exists(candidate)) return candidate;
        return null;
    }

    public static bool HashMatches(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            return string.Equals(Convert.ToHexString(SHA256.HashData(stream)), BundledSha256, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception) { return false; }
    }

    public static async Task<(bool Ok, string Message)> InstallAsync(CancellationToken ct)
    {
        if (!OperatingSystem.IsWindows())
            return (false, "The sensor driver is only needed on Windows.");
        if (!WindowsSensorAccess.IsElevated())
            return (false, "System Info is not running as administrator, so it cannot install a driver. Restart it and accept the Windows prompt.");
        if (WindowsSensorAccess.SensorDriverRegistered())
            return (true, "The sensor driver is already installed. The temperature should appear within a few seconds.");
        if (!await Gate.WaitAsync(0, ct))
            return (false, "An install is already running.");
        try
        {
            string? failure = null;
            if (BundledInstallerPath() is { } bundled)
            {
                if (!HashMatches(bundled))
                    failure = "The bundled sensor-driver installer failed its integrity check, so it was not run.";
                else
                {
                    var start = new ProcessStartInfo(bundled) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
                    start.ArgumentList.Add("-install");
                    start.ArgumentList.Add("-silent");
                    var run = await RunAsync(start, ct);
                    if (WindowsSensorAccess.SensorDriverRegistered())
                        return (true, "The sensor driver is installed. The CPU temperature should appear within about 15 seconds.");
                    failure = run.TimedOut ? "The sensor driver install took too long and was stopped."
                        : "The bundled sensor-driver installer finished (exit code " + run.ExitCode + ") but the driver is not registered.";
                }
            }

            // Fallback for builds without the bundled installer (development, or a build made without the fetch step).
            var winget = new ProcessStartInfo("winget") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (var arg in new[] { "install", "--id", "namazso.PawnIO", "-e", "--silent", "--accept-package-agreements", "--accept-source-agreements" })
                winget.ArgumentList.Add(arg);
            try
            {
                var run = await RunAsync(winget, ct);
                if (WindowsSensorAccess.SensorDriverRegistered())
                    return (true, "The sensor driver is installed. The CPU temperature should appear within about 15 seconds.");
                return (false, (failure is null ? "" : failure + " ") + "winget finished (exit code " + run.ExitCode + ") but the driver is not registered. Install PawnIO from " + ManualUrl + " and reopen System Info.");
            }
            catch (Win32Exception)
            {
                return (false, (failure is null ? "" : failure + " ") + "Neither the bundled installer nor winget is available. Install PawnIO from " + ManualUrl + " and reopen System Info.");
            }
        }
        finally { Gate.Release(); }
    }

    private static async Task<(int ExitCode, bool TimedOut)> RunAsync(ProcessStartInfo start, CancellationToken ct)
    {
        using var process = Process.Start(start) ?? throw new Win32Exception("The process could not be started.");
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(ct);
        limit.CancelAfter(TimeSpan.FromMinutes(3));
        _ = process.StandardOutput.ReadToEndAsync(limit.Token);   // drained so the child never blocks on a full pipe
        _ = process.StandardError.ReadToEndAsync(limit.Token);
        try
        {
            await process.WaitForExitAsync(limit.Token);
            return (process.ExitCode, false);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            try { process.Kill(entireProcessTree: true); } catch (Exception) { /* already gone */ }
            return (-1, true);
        }
    }
}
