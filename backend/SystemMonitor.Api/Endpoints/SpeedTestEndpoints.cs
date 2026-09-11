using System.Diagnostics;
using System.Net.Http.Headers;

namespace SystemMonitor.Api.Endpoints;

public static class SpeedTestEndpoints
{
    private const string SpeedTestBaseUrl = "https://speed.cloudflare.com";

    // Test sizes.
    // 10 MB download and 5 MB upload keep the test reasonably quick
    // without unnecessarily consuming bandwidth.
    private const int DownloadBytes = 10_000_000;
    private const int UploadBytes = 5_000_000;

    public static void MapSpeedTestEndpoints(this WebApplication app)
    {
        app.MapGet("/api/speed-test", async (HttpContext context) =>
        {
            try
            {
                using var client = CreateClient();

                var pingMs = await MeasureLatencyAsync(
                    client,
                    context.RequestAborted);

                var download = await MeasureDownloadAsync(
                    client,
                    context.RequestAborted);

                var upload = await MeasureUploadAsync(
                    client,
                    context.RequestAborted);

                return Results.Ok(new
                {
                    download = new
                    {
                        mbps = Math.Round(download.Mbps, 2),
                        mbPerSecond = Math.Round(download.MegabytesPerSecond, 2)
                    },

                    upload = new
                    {
                        mbps = Math.Round(upload.Mbps, 2),
                        mbPerSecond = Math.Round(upload.MegabytesPerSecond, 2)
                    },

                    pingMs = Math.Round(pingMs, 1)
                });
            }
            catch (OperationCanceledException)
                when (context.RequestAborted.IsCancellationRequested)
            {
                return Results.StatusCode(
                    StatusCodes.Status499ClientClosedRequest);
            }
            catch (OperationCanceledException)
            {
                return Results.Problem(
                    detail: "The speed test timed out.",
                    statusCode: StatusCodes.Status504GatewayTimeout);
            }
            catch (HttpRequestException ex)
            {
                return Results.Problem(
                    detail: $"Speed test server could not be reached: {ex.Message}",
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }
            catch (Exception ex)
            {
                return Results.Problem(
                    detail: $"Speed test failed: {ex.Message}",
                    statusCode: StatusCodes.Status500InternalServerError);
            }
        })
        .WithName("RunSpeedTest");
    }

    private static HttpClient CreateClient()
    {
        var client = new HttpClient
        {
            BaseAddress = new Uri(SpeedTestBaseUrl),
            Timeout = TimeSpan.FromSeconds(30)
        };

        client.DefaultRequestHeaders.UserAgent.Add(
            new ProductInfoHeaderValue("SystemMonitor", "1.0"));

        return client;
    }

    private static async Task<double> MeasureLatencyAsync(
        HttpClient client,
        CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();

        using var response = await client.GetAsync(
            "/__down?bytes=1",
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);

        response.EnsureSuccessStatusCode();

        await response.Content.ReadAsByteArrayAsync(
            cancellationToken);

        stopwatch.Stop();

        return stopwatch.Elapsed.TotalMilliseconds;
    }

    private static async Task<SpeedMeasurement> MeasureDownloadAsync(
        HttpClient client,
        CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();

        using var response = await client.GetAsync(
            $"/__down?bytes={DownloadBytes}",
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);

        response.EnsureSuccessStatusCode();

        long totalBytes = 0;

        var buffer = new byte[64 * 1024];

        await using var stream =
            await response.Content.ReadAsStreamAsync(
                cancellationToken);

        while (true)
        {
            var bytesRead = await stream.ReadAsync(
                buffer,
                cancellationToken);

            if (bytesRead == 0)
                break;

            totalBytes += bytesRead;
        }

        stopwatch.Stop();

        return CreateMeasurement(
            totalBytes,
            stopwatch.Elapsed);
    }

    private static async Task<SpeedMeasurement> MeasureUploadAsync(
        HttpClient client,
        CancellationToken cancellationToken)
    {
        var payload = new byte[UploadBytes];

        FillPayload(payload);

        using var content = new ByteArrayContent(payload);

        content.Headers.ContentType =
            new MediaTypeHeaderValue("application/octet-stream");

        var stopwatch = Stopwatch.StartNew();

        using var response = await client.PostAsync(
            "/__up",
            content,
            cancellationToken);

        response.EnsureSuccessStatusCode();

        stopwatch.Stop();

        return CreateMeasurement(
            payload.LongLength,
            stopwatch.Elapsed);
    }

    private static void FillPayload(byte[] payload)
    {
        // Deterministic non-zero data.
        // Avoids generating random data while still providing
        // a real payload for the upload measurement.
        for (var i = 0; i < payload.Length; i++)
        {
            payload[i] = (byte)(i * 31 + 17);
        }
    }

    private static SpeedMeasurement CreateMeasurement(
        long bytes,
        TimeSpan elapsed)
    {
        var seconds = Math.Max(
            elapsed.TotalSeconds,
            0.001);

        var bytesPerSecond =
            bytes / seconds;

        // Decimal network units:
        //
        // 1 MB = 1,000,000 bytes
        // 1 Mbps = 1,000,000 bits
        //
        // Therefore:
        // MB/s × 8 = Mbps

        var megabytesPerSecond =
            bytesPerSecond / 1_000_000d;

        var mbps =
            megabytesPerSecond * 8d;

        return new SpeedMeasurement(
            bytesPerSecond,
            megabytesPerSecond,
            mbps);
    }

    private readonly record struct SpeedMeasurement(
        double BytesPerSecond,
        double MegabytesPerSecond,
        double Mbps);
}