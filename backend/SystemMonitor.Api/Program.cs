using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Services;
using SystemMonitor.Api.Endpoints;

var builder = WebApplication.CreateBuilder(args);

// Local history: one store instance for the app's lifetime (see AppDataPath for the location).
var dataDir = AppDataPath.ResolveAndEnsureCreated();
Console.WriteLine($"[Startup] Local data directory: {dataDir}");
var snapshotStore = new LocalJsonSnapshotStore(dataDir);
SnapshotLogger.Initialize(snapshotStore);
builder.Services.AddSingleton<ISnapshotStore>(snapshotStore);

// Register the correct platform-specific provider at startup
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
builder.Services.AddSingleton<SystemMonitorBackgroundService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<SystemMonitorBackgroundService>());
builder.Services.AddSingleton<SystemSnapshotService>();
builder.Services.AddSingleton<MemoryHardwareService>();
builder.Services.AddSingleton<AnalyticsService>();

builder.Services.AddOpenApi();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.WithOrigins(
                  "http://localhost:5173",   // `npm run dev` (Vite)
                  "http://tauri.localhost",  // Tauri 2's default Windows WebView2 origin
                                              // for the bundled production frontend — see
                                              // frontend/src/lib/apiConfig.ts for why the
                                              // Tauri build talks to this fixed port instead
                                              // of a same-origin relative path.
                  "tauri://localhost")       // non-Windows Tauri targets (custom URI scheme)
              .AllowAnyMethod()
              .AllowAnyHeader();
    });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// No HTTPS redirection: the backend only listens on plain loopback HTTP, so the
// middleware could never find an https port and just logged a warning per request.
app.UseCors("AllowFrontend");

// Cheap, dependency-free readiness probe for the Tauri process manager
// (src-tauri/src/supervisor.rs) — deliberately NOT under /api/system so it
// never touches ISystemInfoProvider or the background sampler.
app.MapGet("/health", () => Results.Ok(new { status = "ok" }))
   .WithName("HealthCheck");

app.MapSystemEndpoints();
app.MapNativeEndpoints();
app.MapAnalyticsEndpoints();
app.MapSpeedTestEndpoints();

// Production: serve the React production build (frontend/dist, copied to
// wwwroot at publish time — see SystemMonitor.Api.csproj) directly from the
// backend, so the packaged app is a single process with no `npm run dev`
// dependency. In development wwwroot won't exist (the frontend runs
// separately via Vite on :5173), so this is skipped rather than erroring.
var webRootPath = app.Environment.WebRootPath;
if (!string.IsNullOrEmpty(webRootPath) && Directory.Exists(webRootPath))
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
    app.MapFallbackToFile("index.html");
}

// Pay the first-call cost of WMI / performance counters now, in the background,
// instead of on the first /api/system/all request the UI makes.
_ = Task.Run(async () =>
{
    try
    {
        var provider = app.Services.GetRequiredService<ISystemInfoProvider>();
        await provider.GetRamAsync();
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "Provider warm-up failed (non-fatal).");
    }
});

app.Run();