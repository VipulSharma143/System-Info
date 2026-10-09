// /api/overlay — the live monitor snapshot (CPU, every GPU, RAM, plus a short history) from the native engine.
//
// The engine samples on its own thread; this only returns its latest result, so the call is cheap and never waits on
// a slow operating-system API. 503 means the engine has not produced a sample yet (first moments after start) or is
// unavailable in this build; the body says which.
using SystemMonitor.Api.Services;

namespace SystemMonitor.Api.Endpoints;

public static class OverlayEndpoints
{
    public static void MapOverlayEndpoints(this WebApplication app)
    {
        app.MapGet("/api/overlay", (OverlayService overlay) =>
            {
                if (overlay.Read() is { } snapshot) return Results.Ok(snapshot);
                var reason = overlay.Problem ?? "The monitor is starting; the first sample is not ready yet.";
                return Results.Json(new { error = reason, starting = overlay.Problem is null }, statusCode: StatusCodes.Status503ServiceUnavailable);
            })
            .WithName("GetOverlay");
    }
}
