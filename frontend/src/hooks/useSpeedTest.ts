
import { useCallback, useRef, useState } from "react";
import type { SpeedTestResult } from "../types/speedtest";

type SpeedTestStatus =
  | "idle"
  | "running"
  | "success"
  | "error";

export type SpeedTestPhase =
  | "idle"
  | "ping"
  | "download"
  | "upload"
  | "complete";

export interface SpeedTestProgress {
  phase: SpeedTestPhase;
  percent: number;
  transferredBytes: number;
  totalBytes: number;
  mbTransferred: number;
  currentMbps: number;
  currentMbPerSecond: number;
}

interface UseSpeedTestResult {
  status: SpeedTestStatus;
  phase: SpeedTestPhase;
  progress: SpeedTestProgress;
  result: SpeedTestResult | null;
  error: string | null;
  runSpeedTest: () => Promise<void>;
}

const SPEED_TEST_BASE_URL = "https://speed.cloudflare.com";

const DOWNLOAD_BYTES = 10_000_000;
const UPLOAD_BYTES = 5_000_000;

const EMPTY_PROGRESS: SpeedTestProgress = {
  phase: "idle",
  percent: 0,
  transferredBytes: 0,
  totalBytes: 0,
  mbTransferred: 0,
  currentMbps: 0,
  currentMbPerSecond: 0,
};

function calculateSpeed(
  bytes: number,
  startedAt: number
) {
  const elapsedSeconds = Math.max(
    (performance.now() - startedAt) / 1000,
    0.001
  );

  const bytesPerSecond = bytes / elapsedSeconds;

  const mbPerSecond =
    bytesPerSecond / 1_000_000;

  const mbps =
    mbPerSecond * 8;

  return {
    mbps,
    mbPerSecond,
  };
}

function createPayload(size: number): ArrayBuffer {
  const payload = new Uint8Array(size);

  for (let i = 0; i < payload.length; i++) {
    payload[i] = (i * 31 + 17) & 0xff;
  }

  return payload.buffer;
}

function createProgress(
  phase: SpeedTestPhase,
  transferredBytes: number,
  totalBytes: number,
  startedAt: number
): SpeedTestProgress {
  const speed = calculateSpeed(
    transferredBytes,
    startedAt
  );

  const percent =
    totalBytes > 0
      ? Math.min(
          (transferredBytes / totalBytes) * 100,
          100
        )
      : 0;

  return {
    phase,
    percent,
    transferredBytes,
    totalBytes,
    mbTransferred:
      transferredBytes / 1_000_000,
    currentMbps: speed.mbps,
    currentMbPerSecond: speed.mbPerSecond,
  };
}

function runDownload(
  onProgress: (progress: SpeedTestProgress) => void
): Promise<{
  bytes: number;
  mbps: number;
  mbPerSecond: number;
}> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    const startedAt = performance.now();

    xhr.open(
      "GET",
      `${SPEED_TEST_BASE_URL}/__down?bytes=${DOWNLOAD_BYTES}&cacheBust=${Date.now()}`,
      true
    );

    xhr.responseType = "arraybuffer";
    xhr.timeout = 30_000;

    xhr.onprogress = (event) => {
      const transferredBytes =
        event.loaded;

      const totalBytes =
        event.lengthComputable && event.total > 0
          ? event.total
          : DOWNLOAD_BYTES;

      onProgress(
        createProgress(
          "download",
          transferredBytes,
          totalBytes,
          startedAt
        )
      );
    };

    xhr.onload = () => {
      if (
        xhr.status < 200 ||
        xhr.status >= 300
      ) {
        reject(
          new Error(
            `Download test failed (${xhr.status}).`
          )
        );
        return;
      }

      const bytes =
        xhr.response?.byteLength ??
        DOWNLOAD_BYTES;

      const speed =
        calculateSpeed(bytes, startedAt);

      onProgress(
        createProgress(
          "download",
          bytes,
          bytes,
          startedAt
        )
      );

      resolve({
        bytes,
        mbps: speed.mbps,
        mbPerSecond: speed.mbPerSecond,
      });
    };

    xhr.onerror = () => {
      reject(
        new Error(
          "The download speed test could not connect to Cloudflare."
        )
      );
    };

    xhr.ontimeout = () => {
      reject(
        new Error(
          "The download speed test timed out."
        )
      );
    };

    xhr.send();
  });
}

function runUpload(
  onProgress: (progress: SpeedTestProgress) => void
): Promise<{
  bytes: number;
  mbps: number;
  mbPerSecond: number;
}> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    const payload =
      createPayload(UPLOAD_BYTES);

    const startedAt = performance.now();

    xhr.open(
      "POST",
      `${SPEED_TEST_BASE_URL}/__up`,
      true
    );

    xhr.timeout = 30_000;

    xhr.setRequestHeader(
      "Content-Type",
      "application/octet-stream"
    );

    xhr.upload.onprogress = (event) => {
      const transferredBytes =
        event.loaded;

      const totalBytes =
        event.lengthComputable && event.total > 0
          ? event.total
          : UPLOAD_BYTES;

      onProgress(
        createProgress(
          "upload",
          transferredBytes,
          totalBytes,
          startedAt
        )
      );
    };

    xhr.onload = () => {
      if (
        xhr.status < 200 ||
        xhr.status >= 300
      ) {
        reject(
          new Error(
            `Upload test failed (${xhr.status}).`
          )
        );
        return;
      }

      const speed =
        calculateSpeed(
          UPLOAD_BYTES,
          startedAt
        );

      onProgress(
        createProgress(
          "upload",
          UPLOAD_BYTES,
          UPLOAD_BYTES,
          startedAt
        )
      );

      resolve({
        bytes: UPLOAD_BYTES,
        mbps: speed.mbps,
        mbPerSecond: speed.mbPerSecond,
      });
    };

    xhr.onerror = () => {
      reject(
        new Error(
          "The upload speed test could not connect to Cloudflare."
        )
      );
    };

    xhr.ontimeout = () => {
      reject(
        new Error(
          "The upload speed test timed out."
        )
      );
    };

    xhr.send(payload);
  });
}

async function measurePing(): Promise<number> {
  const samples: number[] = [];

  for (let i = 0; i < 3; i++) {
    const startedAt = performance.now();

    const response = await fetch(
      `${SPEED_TEST_BASE_URL}/__down?bytes=1&ping=${Date.now()}-${i}`,
      {
        method: "GET",
        cache: "no-store",
      }
    );

    if (!response.ok) {
      throw new Error(
        `Ping test failed (${response.status}).`
      );
    }

    await response.arrayBuffer();

    samples.push(
      performance.now() - startedAt
    );
  }

  if (samples.length === 0) {
    throw new Error(
      "Unable to measure network latency."
    );
  }

  return (
    samples.reduce(
      (total, value) => total + value,
      0
    ) / samples.length
  );
}

export function useSpeedTest(): UseSpeedTestResult {
  const [status, setStatus] =
    useState<SpeedTestStatus>("idle");

  const [phase, setPhase] =
    useState<SpeedTestPhase>("idle");

  const [progress, setProgress] =
    useState<SpeedTestProgress>(
      EMPTY_PROGRESS
    );

  const [result, setResult] =
    useState<SpeedTestResult | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  const runningRef =
    useRef(false);

  const runSpeedTest = useCallback(
    async () => {
      if (runningRef.current) {
        return;
      }

      runningRef.current = true;

      setStatus("running");
      setPhase("ping");
      setProgress({
        ...EMPTY_PROGRESS,
        phase: "ping",
      });
      setResult(null);
      setError(null);

      try {
        /*
         * 1. Ping
         */
        const pingMs =
          await measurePing();

        /*
         * 2. Download
         */
        setPhase("download");

        const download =
          await runDownload(
            setProgress
          );

        /*
         * 3. Upload
         */
        setPhase("upload");

        const upload =
          await runUpload(
            setProgress
          );

        /*
         * 4. Final result
         */
        setPhase("complete");

        setProgress({
          phase: "complete",
          percent: 100,
          transferredBytes:
            UPLOAD_BYTES,
          totalBytes:
            UPLOAD_BYTES,
          mbTransferred:
            UPLOAD_BYTES / 1_000_000,
          currentMbps:
            upload.mbps,
          currentMbPerSecond:
            upload.mbPerSecond,
        });

        setResult({
          download: {
            mbps: Number(
              download.mbps.toFixed(2)
            ),
            mbPerSecond: Number(
              download.mbPerSecond.toFixed(2)
            ),
          },

          upload: {
            mbps: Number(
              upload.mbps.toFixed(2)
            ),
            mbPerSecond: Number(
              upload.mbPerSecond.toFixed(2)
            ),
          },

          pingMs: Number(
            pingMs.toFixed(1)
          ),
        });

        setStatus("success");
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Unable to complete the speed test.";

        setError(message);
        setStatus("error");
        setPhase("idle");
      } finally {
        runningRef.current = false;
      }
    },
    []
  );

  return {
    status,
    phase,
    progress,
    result,
    error,
    runSpeedTest,
  };
}
