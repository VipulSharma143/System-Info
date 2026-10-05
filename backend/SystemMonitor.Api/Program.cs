using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Services;
using SystemMonitor.Api.Endpoints;

var builder = WebApplication.CreateBuilder(args);

var dataDir = AppDataPath.ResolveAndEnsureCreated();
Console.WriteLine($"[Startup] Local data directory: {dataDir}");
var snapshotStore = new LocalJsonSnapshotStore(dataDir);
SnapshotLogger.Initialize(snapshotStore);
builder.Services.AddSingleton<ISnapshotStore>(snapshotStore);

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
builder.Services.AddSingleton<INvmlSource>(NvmlGpuSource.Shared);
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
app.MapNativeEndpoints();
app.MapAnalyticsEndpoints();
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

app.Run();