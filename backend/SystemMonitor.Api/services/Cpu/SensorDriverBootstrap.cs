using Microsoft.Extensions.Hosting;

namespace SystemMonitor.Api.Services;

/// <summary>
/// Windows only. A few seconds after start, if the app is elevated and the PawnIO sensor driver is missing, installs it from
/// the installer bundled with the app, so CPU temperatures work without the person installing anything. One attempt per app
/// version (a marker file records it), so a failure never loops; the CPU tab button remains for a manual retry.
/// Set SYSTEMINFO_NO_DRIVER_INSTALL=1 to turn the automatic attempt off.
/// </summary>
public sealed class SensorDriverBootstrap : BackgroundService
{
    private readonly string _marker;
    private readonly ILogger<SensorDriverBootstrap> _log;

    public SensorDriverBootstrap(string dataDir, ILogger<SensorDriverBootstrap> log)
    {
        _marker = Path.Combine(dataDir, "sensor-driver-install.txt");
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            if (!OperatingSystem.IsWindows() || Environment.GetEnvironmentVariable("SYSTEMINFO_NO_DRIVER_INSTALL") == "1") return;
            await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
            if (WindowsSensorAccess.SensorDriverRegistered() || !WindowsSensorAccess.IsElevated()) return;
            if (SensorDriverInstaller.BundledInstallerPath() is null) return;   // nothing bundled: leave it to the CPU tab button

            var version = typeof(SensorDriverBootstrap).Assembly.GetName().Version?.ToString() ?? "unknown";
            if (File.Exists(_marker) && File.ReadAllText(_marker).Trim() == version) return;
            Directory.CreateDirectory(Path.GetDirectoryName(_marker)!);
            File.WriteAllText(_marker, version);   // written first: an attempt that crashes must not repeat on every launch

            var (ok, message) = await SensorDriverInstaller.InstallAsync(stoppingToken);
            _log.LogInformation("Automatic sensor driver install: {Ok} - {Message}", ok, message);
        }
        catch (OperationCanceledException) { /* shutting down */ }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Automatic sensor driver install failed.");
        }
    }
}
