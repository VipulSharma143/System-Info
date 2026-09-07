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

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();
app.UseCors("AllowFrontend");

app.MapSystemEndpoints();
app.MapNativeEndpoints();

app.Run();