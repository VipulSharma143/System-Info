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

app.Run();