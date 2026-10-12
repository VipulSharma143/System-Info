// /api/system/sensors — drive, motherboard and memory-module temperatures, voltages and fan speeds (see HardwareSensorService).
using SystemMonitor.Api.Services;

namespace SystemMonitor.Api.Endpoints;

public static class SensorEndpoints
{
    public static void MapSensorEndpoints(this WebApplication app)
    {
        app.MapGet("/api/system/sensors", (HardwareSensorService sensors) => Results.Ok(sensors.Read()))
            .WithName("GetHardwareSensors");
    }
}
