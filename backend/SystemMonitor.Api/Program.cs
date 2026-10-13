using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Services;
using SystemMonitor.Api.Endpoints;

var builder = WebApplication.CreateBuilder(args);

var dataDir = AppDataPath.ResolveAndEnsureCreated();
Console.WriteLine($"[Startup] Local data directory: {dataDir}");
var snapshotStore = new LocalJsonSnapshotStore(dataDir);
builder.Services.AddSingleton<ISnapshotStore>(snapshotStore);
// Battery plug-in / unplug sessions (local JSON, last 7 days only), the saved-data size readout, and the "reset data" action.
var batteryHistory = new BatteryHistoryService(dataDir, info: message => Console.WriteLine($"[BatteryHistory] {message}"));
SnapshotLogger.Initialize(snapshotStore, batteryHistory);
builder.Services.AddSingleton(_ => batteryHistory);   // factory registration, so the container disposes it (a final save) at shutdown
builder.Services.AddSingleton(sp => new DataResetService(
    sp.GetRequiredService<ISnapshotStore>(), sp.GetRequiredService<BatteryHistoryService>(), dataDir, sp.GetRequiredService<ILogger<DataResetService>>()));
builder.Services.AddSingleton(new DataUsageService(dataDir));

builder.Services.AddSingleton<HostSnapshotService>();
builder.Services.AddSingleton<HardwareSensorService>();
if (OperatingSystem.IsWindows())
{
    builder.Services.AddSingleton<ISystemInfoProvider, WindowsSystemInfoProvider>();
}
else if (OperatingSystem.IsLinux())
{
    builder.Services.AddSingleton<ISystemInfoProvider, LinuxSystemInfoProvider>();
}
else
{
    throw new PlatformNotSupportedException("This application only supports Windows and Linux.");
}
// On-disk cache for slow-to-collect system info (see SystemInfoCache); lives beside the history.
builder.Services.AddSingleton(sp => new SystemInfoCache(
    Path.Combine(dataDir, "cache"), sp.GetRequiredService<ILogger<SystemInfoCache>>()));
builder.Services.AddSingleton<SystemInfoService>();
builder.Services.AddSingleton<SystemMonitorBackgroundService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<SystemMonitorBackgroundService>());
builder.Services.AddSingleton<SystemSnapshotService>();
builder.Services.AddSingleton<MemoryHardwareService>();
if (OperatingSystem.IsWindows())
{
    // Windows has no public CPU temperature API; this fills in what the native engine cannot (see CpuSensorSelection).
    builder.Services.AddSingleton<ICpuSensorSource, LibreHardwareCpuSensorSource>();
    // Integrated Intel/AMD GPU temperature, the same way and only where the native engine has none (see GpuSensorSelection).
    builder.Services.AddSingleton<IGpuSensorSource, LibreHardwareGpuSensorSource>();
    // Drive, motherboard and memory-module sensors (see HardwareSensorSelection); Linux reads sysfs instead.
    builder.Services.AddSingleton<IHardwareSensorSource, LibreHardwareBoardSensorSource>();
    // Installs the bundled PawnIO sensor driver once (when elevated and missing) so CPU temperatures need no manual setup.
    builder.Services.AddHostedService(sp => new SensorDriverBootstrap(dataDir, sp.GetRequiredService<ILogger<SensorDriverBootstrap>>()));
}
builder.Services.AddSingleton<IOverlayEngine, NativeOverlayEngine>();
builder.Services.AddSingleton<OverlayService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<OverlayService>());
builder.Services.AddSingleton<ICpuDetailEngine, NativeCpuDetailEngine>();
builder.Services.AddSingleton<CpuDetailService>();
builder.Services.AddSingleton<INvmlSource, OverlayNvmlInfo>();
builder.Services.AddSingleton<IGpuLiveSource, EngineGpuLiveSource>();
builder.Services.AddSingleton(new PciIds());
if (OperatingSystem.IsWindows())
{
    builder.Services.AddSingleton<IGpuCollector>(sp => new WindowsGpuCollector(
        (WindowsSystemInfoProvider)sp.GetRequiredService<ISystemInfoProvider>(), sp.GetRequiredService<INvmlSource>()));
}
else
{
    builder.Services.AddSingleton<IGpuCollector>(sp => new LinuxGpuCollector(
        sp.GetRequiredService<INvmlSource>(), sp.GetRequiredService<PciIds>()));
}
builder.Services.AddSingleton<GpuService>();
builder.Services.AddSingleton<AnalyticsService>();

builder.Services.AddOpenApi();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.WithOrigins(
                  "http://localhost:5173",   // `npm run dev` (Vite)
                  "http://tauri.localhost",  // Tauri on Windows (WebView2)
                  "tauri://localhost")       // Tauri on Linux
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors("AllowFrontend");

// Readiness probe for the Tauri supervisor; touches no provider.
app.MapGet("/health", () => Results.Ok(new { status = "ok" }))
   .WithName("HealthCheck");

app.MapSystemEndpoints();
app.MapOverlayEndpoints();
app.MapCpuEndpoints();
app.MapNativeEndpoints();
app.MapAnalyticsEndpoints();
app.MapDataEndpoints();
app.MapSensorEndpoints();
app.MapSpeedTestEndpoints();

// Packaged app: serve the built frontend from wwwroot (absent in development).
var webRootPath = app.Environment.WebRootPath;
if (!string.IsNullOrEmpty(webRootPath) && Directory.Exists(webRootPath))
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
    app.MapFallbackToFile("index.html");
}

// Background warm-up, so the first requests find their data ready. RAM first (cheapest, needed by the
// dashboard); the cache loads and fresh reads then run once the server is already listening.
_ = Task.Run(async () =>
{
    try
    {
        await app.Services.GetRequiredService<ISystemInfoProvider>().GetRamAsync();
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "Provider warm-up failed (non-fatal).");
    }
});

app.Lifetime.ApplicationStarted.Register(() => _ = Task.WhenAll(
    app.Services.GetRequiredService<SystemSnapshotService>().WarmUpAsync(),
    app.Services.GetRequiredService<SystemInfoService>().WarmUpAsync(),
    app.Services.GetRequiredService<MemoryHardwareService>().WarmUpAsync(),
    app.Services.GetRequiredService<GpuService>().WarmUpAsync())
    .ContinueWith(t => app.Logger.LogWarning(t.Exception, "Cache warm-up failed (non-fatal)."), TaskContinuationOptions.OnlyOnFaulted));

app.Lifetime.ApplicationStarted.Register(() =>
    Console.WriteLine($"[Startup] listening {(DateTime.Now - System.Diagnostics.Process.GetCurrentProcess().StartTime).TotalMilliseconds:F0} ms after process start"));

app.Run();

