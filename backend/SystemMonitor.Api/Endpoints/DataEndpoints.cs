// /api/battery/history — the charge and discharge sessions of the last 7 days.
// /api/data/usage      — how much disk space the saved data uses (see DataUsageService).
// /api/data/reset      — deletes the kinds of saved data the person picked on the System page (see DataResetService).
using SystemMonitor.Api.Services;

namespace SystemMonitor.Api.Endpoints;

public static class DataEndpoints
{
    // Same idea as the sensor-driver install: a custom header makes a browser send a CORS preflight first, so a web page the
    // person happens to visit cannot trigger a delete. The app's own frontend adds it.
    public const string ActionHeader = "X-SystemInfo-Action";

    public static void MapDataEndpoints(this WebApplication app)
    {
        app.MapGet("/api/battery/history", (BatteryHistoryService history) => Results.Ok(history.Read()))
            .WithName("GetBatteryHistory");

        app.MapGet("/api/data/usage", (DataUsageService usage) => Results.Ok(usage.Read()))
            .WithName("GetDataUsage");

        app.MapPost("/api/data/reset", async (HttpRequest request, DataResetService reset, CancellationToken ct) =>
            {
                if (!request.Headers.ContainsKey(ActionHeader))
                    return Results.Json(new DataResetResult(false, [], [], "Missing request header."), statusCode: StatusCodes.Status400BadRequest);

                DataResetRequest? body;
                try { body = await request.ReadFromJsonAsync<DataResetRequest>(ct); }
                catch (System.Text.Json.JsonException) { body = null; }

                if (DataResetService.Validate(body) is { } problem)
                    return Results.Json(new DataResetResult(false, [], [], problem), statusCode: StatusCodes.Status400BadRequest);

                var result = reset.Reset(body!);
                return Results.Json(result, statusCode: result.Ok ? StatusCodes.Status200OK : StatusCodes.Status500InternalServerError);
            })
            .WithName("ResetData");
    }
}
