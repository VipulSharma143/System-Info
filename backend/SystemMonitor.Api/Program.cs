using SystemMonitor.Api.Interface;
using SystemMonitor.Api.Services;
using SystemMonitor.Api.Endpoints;

var builder = WebApplication.CreateBuilder(args);

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
        policy.WithOrigins("http://localhost:5173")
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