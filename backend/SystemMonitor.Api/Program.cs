using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Services;
using SystemMonitor.Api.Endpoints;

var builder = WebApplication.CreateBuilder(args);

// Local historical storage — replaces MongoDB Atlas. Resolves and creates
// the writable app-data directory (dev: ./data, Windows: %LOCALAPPDATA%\SystemInfo\data,
// Linux: ~/.local/share/SystemInfo/data) once at startup, then a single
// LocalJsonSnapshotStore instance is shared for the app's lifetime.
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

// HttpClient for calling the Python analytics_service.py (FastAPI, localhost:8001).
// Named client so the base address and any future auth/headers/timeouts live in
// one place, same reasoning as keeping hardware-provider selection centralized here.
builder.Services.AddHttpClient("AnalyticsService", client =>
{
    client.BaseAddress = new Uri("http://localhost:8001");
    client.Timeout = TimeSpan.FromSeconds(10);
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();
app.UseCors("AllowFrontend");

// Cheap, dependency-free readiness probe for the Tauri process manager
// (src-tauri/src/process.rs) — deliberately NOT under /api/system so it
// never touches ISystemInfoProvider or the background sampler. Mirrors
// analytics_service.py's own /health endpoint, which the same process
// manager already polls the same way.
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

app.Run();