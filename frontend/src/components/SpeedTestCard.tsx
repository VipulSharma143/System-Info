import { useSpeedTest } from "../hooks/useSpeedTest";

function formatSpeed(value: number): string {
  return value.toFixed(2);
}

function getPhaseLabel(phase: string): string {
  switch (phase) {
    case "ping":
      return "Checking network latency";

    case "download":
      return "Testing download speed";

    case "upload":
      return "Testing upload speed";

    case "complete":
      return "Speed test complete";

    default:
      return "Ready to test";
  }
}

function getPhaseDescription(phase: string): string {
  switch (phase) {
    case "ping":
      return "Measuring the response time of your connection.";

    case "download":
      return "Downloading test data to measure your connection speed.";

    case "upload":
      return "Uploading test data to measure your connection speed.";

    default:
      return "";
  }
}

function SpeedMeter({
  value,
  max,
}: {
  value: number;
  max: number;
}) {
  const width = Math.min(
    100,
    Math.max(3, (value / max) * 100)
  );

  return (
    <div className="speed-test-meter">
      <div
        className="speed-test-meter-fill"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

export default function SpeedTestCard() {
  const {
    status,
    result,
    error,
    progress,
    runSpeedTest,
  } = useSpeedTest();

  const isRunning = status === "running";

  const phase = progress?.phase ?? "idle";

  const isTransferPhase =
    phase === "download" ||
    phase === "upload";

  const progressPercent = Math.min(
    100,
    Math.max(0, progress?.percent ?? 0)
  );

  const transferredMb =
    progress?.mbTransferred ?? 0;

  const totalMb = progress?.totalBytes
    ? progress.totalBytes / 1_000_000
    : 0;

  const currentMbps =
    progress?.currentMbps ?? 0;

  const currentMbPerSecond =
    progress?.currentMbPerSecond ?? 0;

  return (
    <section className="speed-test-card">

      {/* =====================================================
          Header
          ===================================================== */}

      <div className="speed-test-header">
        <div>
          <span className="speed-test-eyebrow">
            Network
          </span>

          <h2>Speed Test</h2>

          <p>
            Measure your current download, upload,
            and network latency.
          </p>
        </div>

        <button
          type="button"
          className="speed-test-button"
          onClick={runSpeedTest}
          disabled={isRunning}
        >
          {isRunning
            ? "Testing..."
            : "Start Speed Test"}
        </button>
      </div>


      {/* =====================================================
          Running State
          ===================================================== */}

      {isRunning && (
        <div className="speed-test-status">

          <div className="speed-test-status__top">

            <div className="speed-test-status__identity">

              <span className="speed-test-spinner" />

              <div>
                <div className="speed-test-status__title">
                  {getPhaseLabel(phase)}
                </div>

                <div className="speed-test-status__description">
                  {getPhaseDescription(phase)}
                </div>
              </div>

            </div>

            <span className="speed-test-phase">
              {phase}
            </span>

          </div>


          {/* -------------------------------------------------
              Download / Upload
              ------------------------------------------------- */}

          {isTransferPhase && (
            <div className="speed-test-transfer">

              <div className="speed-test-transfer__header">

                <span className="speed-test-transfer__label">
                  {phase === "download"
                    ? "DOWNLOAD TRANSFER"
                    : "UPLOAD TRANSFER"}
                </span>

                <span className="speed-test-transfer__percent">
                  {progressPercent.toFixed(0)}%
                </span>

              </div>


              {/* Real transfer progress */}

              <div className="speed-test-progress">

                <div
                  className="speed-test-progress-fill"
                  style={{
                    width: `${progressPercent}%`,
                  }}
                />

              </div>


              {/* Live transfer statistics */}

              <div className="speed-test-transfer-stats">

                <div className="speed-test-transfer-stat">

                  <span className="speed-test-transfer-stat__label">
                    Transferred
                  </span>

                  <span className="speed-test-transfer-stat__value">
                    {formatSpeed(transferredMb)} MB
                  </span>

                  {totalMb > 0 && (
                    <span className="speed-test-transfer-stat__detail">
                      of {formatSpeed(totalMb)} MB
                    </span>
                  )}

                </div>


                <div className="speed-test-transfer-stat">

                  <span className="speed-test-transfer-stat__label">
                    Current speed
                  </span>

                  <span className="speed-test-transfer-stat__value">
                    {formatSpeed(currentMbps)}
                  </span>

                  <span className="speed-test-transfer-stat__detail">
                    Megabits per second
                  </span>

                </div>


                <div className="speed-test-transfer-stat">

                  <span className="speed-test-transfer-stat__label">
                    Transfer rate
                  </span>

                  <span className="speed-test-transfer-stat__value">
                    {formatSpeed(currentMbPerSecond)}
                  </span>

                  <span className="speed-test-transfer-stat__detail">
                    Megabytes per second
                  </span>

                </div>

              </div>


              {/* Current live speed */}

              <div className="speed-test-live-speed">

                <span className="speed-test-live-speed__value">
                  {formatSpeed(currentMbps)}
                </span>

                <span className="speed-test-live-speed__unit">
                  Megabits per second
                </span>

              </div>

            </div>
          )}


          {/* -------------------------------------------------
              Ping
              ------------------------------------------------- */}

          {phase === "ping" && (
            <div className="speed-test-ping">
              Sending network requests and measuring
              response time...
            </div>
          )}

        </div>
      )}


      {/* =====================================================
          Error
          ===================================================== */}

      {error && (
        <div
          className="speed-test-error"
          role="alert"
        >
          {error}
        </div>
      )}


      {/* =====================================================
          Final Results
          ===================================================== */}

      {result && !isRunning && !error && (
        <div className="speed-test-results">


          {/* =================================================
              DOWNLOAD
              ================================================= */}

          <div className="speed-test-result">

            <span className="speed-test-result-label">
              Download
            </span>


            {/* Mbps */}

            <div className="speed-test-primary">

              <span className="speed-test-primary__label">
                Network speed
              </span>

              <div className="speed-test-primary__value">

                <span className="speed-test-primary__number">
                  {formatSpeed(
                    result.download.mbps
                  )}
                </span>

                <span className="speed-test-primary__unit">
                  Megabits per second
                </span>

              </div>

            </div>


            {/* MB/s */}

            <div className="speed-test-secondary-block">

              <div className="speed-test-secondary-block__label">
                <span>
                  Transfer rate
                </span>

                <strong>
                  MB/s
                </strong>
              </div>

              <div className="speed-test-secondary-block__value">

                <span className="speed-test-secondary-block__number">
                  {formatSpeed(
                    result.download.mbPerSecond
                  )}
                </span>

                <span className="speed-test-secondary-block__unit">
                  Megabytes per second
                </span>

              </div>

            </div>


            <SpeedMeter
              value={result.download.mbps}
              max={100}
            />

          </div>


          {/* =================================================
              UPLOAD
              ================================================= */}

          <div className="speed-test-result">

            <span className="speed-test-result-label">
              Upload
            </span>


            {/* Mbps */}

            <div className="speed-test-primary">

              <span className="speed-test-primary__label">
                Network speed
              </span>

              <div className="speed-test-primary__value">

                <span className="speed-test-primary__number">
                  {formatSpeed(
                    result.upload.mbps
                  )}
                </span>

                <span className="speed-test-primary__unit">
                  Megabits per second
                </span>

              </div>

            </div>


            {/* MB/s */}

            <div className="speed-test-secondary-block">

              <div className="speed-test-secondary-block__label">

                <span>
                  Transfer rate
                </span>

                <strong>
                  MB/s
                </strong>

              </div>

              <div className="speed-test-secondary-block__value">

                <span className="speed-test-secondary-block__number">
                  {formatSpeed(
                    result.upload.mbPerSecond
                  )}
                </span>

                <span className="speed-test-secondary-block__unit">
                  Megabytes per second
                </span>

              </div>

            </div>


            <SpeedMeter
              value={result.upload.mbps}
              max={100}
            />

          </div>


          {/* =================================================
              PING
              ================================================= */}

          <div className="speed-test-result speed-test-ping-result">

            <span className="speed-test-result-label">
              Ping
            </span>

            <div className="speed-test-ping-value">

              <span className="speed-test-ping-value__number">
                {formatSpeed(
                  result.pingMs
                )}
              </span>

              <span className="speed-test-ping-value__unit">
                milliseconds
              </span>

              <div className="speed-test-ping-description">
                Network response latency
              </div>

            </div>


            <SpeedMeter
              value={Math.max(
                0,
                200 - result.pingMs
              )}
              max={200}
            />

          </div>

        </div>
      )}


      {/* =====================================================
          Empty State
          ===================================================== */}

      {!result && !error && !isRunning && (
        <div className="speed-test-empty">
          Run a test to measure your current
          connection speed.
        </div>
      )}

    </section>
  );
}