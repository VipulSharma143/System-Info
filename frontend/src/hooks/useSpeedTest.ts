import { useCallback, useRef, useState } from "react";
import type { SpeedTestResult } from "../types/speedtest";

type SpeedTestStatus = "idle" | "running" | "success" | "error";

export type SpeedTestPhase = "idle" | "ping" | "download" | "upload" | "complete";

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

// A single small transfer over one connection undersells real bandwidth —
// it never leaves TCP slow-start and never contends for the link the way
// real usage (or tools like fast.com / Ookla) does. Running several
// connections in parallel over a larger, longer transfer gets much closer
// to a sustained-throughput reading.
const PARALLEL_CONNECTIONS = 6;
const DOWNLOAD_BYTES_PER_CONNECTION = 15_000_000; // 15MB x 6 = 90MB total
const UPLOAD_BYTES_PER_CONNECTION = 8_000_000; // 8MB x 6 = 48MB total
const PING_SAMPLES = 5;

const EMPTY_PROGRESS: SpeedTestProgress = {
  phase: "idle",
  percent: 0,
  transferredBytes: 0,
  totalBytes: 0,
  mbTransferred: 0,
  currentMbps: 0,
  currentMbPerSecond: 0,
};

function calculateSpeed(bytes: number, startedAt: number) {
  const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
  const bytesPerSecond = bytes / elapsedSeconds;
  const mbPerSecond = bytesPerSecond / 1_000_000;
  const mbps = mbPerSecond * 8;
  return { mbps, mbPerSecond };
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
  const speed = calculateSpeed(transferredBytes, startedAt);
  const percent = totalBytes > 0 ? Math.min((transferredBytes / totalBytes) * 100, 100) : 0;

  return {
    phase,
    percent,
    transferredBytes,
    totalBytes,
    mbTransferred: transferredBytes / 1_000_000,
    currentMbps: speed.mbps,
    currentMbPerSecond: speed.mbPerSecond,
  };
}

interface TransferOutcome {
  bytes: number;
  mbps: number;
  mbPerSecond: number;
}

// Runs `connections` transfers concurrently and reports aggregate progress
// across all of them, so the final speed reflects combined throughput
// rather than a single stream's best case.
function runParallelDownload(
  connections: number,
  bytesPerConnection: number,
  onProgress: (progress: SpeedTestProgress) => void
): Promise<TransferOutcome> {
  const startedAt = performance.now();
  const totalBytes = connections * bytesPerConnection;
  const loaded = new Array<number>(connections).fill(0);

  const report = () => {
    const transferred = loaded.reduce((sum, v) => sum + v, 0);
    onProgress(createProgress("download", transferred, totalBytes, startedAt));
  };

  const runOne = (index: number) =>
    new Promise<number>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(
        "GET",
        `${SPEED_TEST_BASE_URL}/__down?bytes=${bytesPerConnection}&cacheBust=${Date.now()}-${index}`,
        true
      );
      xhr.responseType = "arraybuffer";
      xhr.timeout = 45_000;

      xhr.onprogress = (event) => {
        loaded[index] = event.loaded;
        report();
      };

      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`Download test failed (${xhr.status}).`));
          return;
        }
        loaded[index] = xhr.response?.byteLength ?? bytesPerConnection;
        report();
        resolve(loaded[index]);
      };

      xhr.onerror = () => reject(new Error("The download speed test could not connect to Cloudflare."));
      xhr.ontimeout = () => reject(new Error("The download speed test timed out."));

      xhr.send();
    });

  return Promise.all(Array.from({ length: connections }, (_, i) => runOne(i))).then((results) => {
    const bytes = results.reduce((sum, v) => sum + v, 0);
    const speed = calculateSpeed(bytes, startedAt);
    onProgress(createProgress("download", bytes, bytes, startedAt));
    return { bytes, mbps: speed.mbps, mbPerSecond: speed.mbPerSecond };
  });
}

function runParallelUpload(
  connections: number,
  bytesPerConnection: number,
  onProgress: (progress: SpeedTestProgress) => void
): Promise<TransferOutcome> {
  const startedAt = performance.now();
  const totalBytes = connections * bytesPerConnection;
  const loaded = new Array<number>(connections).fill(0);

  const report = () => {
    const transferred = loaded.reduce((sum, v) => sum + v, 0);
    onProgress(createProgress("upload", transferred, totalBytes, startedAt));
  };

  const runOne = (index: number) =>
    new Promise<number>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const payload = createPayload(bytesPerConnection);

      xhr.open("POST", `${SPEED_TEST_BASE_URL}/__up`, true);
      xhr.timeout = 45_000;
      xhr.setRequestHeader("Content-Type", "application/octet-stream");

      xhr.upload.onprogress = (event) => {
        loaded[index] = event.loaded;
        report();
      };

      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`Upload test failed (${xhr.status}).`));
          return;
        }
        loaded[index] = bytesPerConnection;
        report();
        resolve(bytesPerConnection);
      };

      xhr.onerror = () => reject(new Error("The upload speed test could not connect to Cloudflare."));
      xhr.ontimeout = () => reject(new Error("The upload speed test timed out."));

      xhr.send(payload);
    });

  return Promise.all(Array.from({ length: connections }, (_, i) => runOne(i))).then((results) => {
    const bytes = results.reduce((sum, v) => sum + v, 0);
    const speed = calculateSpeed(bytes, startedAt);
    onProgress(createProgress("upload", bytes, bytes, startedAt));
    return { bytes, mbps: speed.mbps, mbPerSecond: speed.mbPerSecond };
  });
}

// Median of several round-trips, dropping the coldest (first) sample —
// the same "discard the warm-up hit" approach most speed-test tools use,
// since the first request pays DNS/TLS/connection setup cost the rest don't.
async function measurePing(): Promise<number> {
  const samples: number[] = [];

  for (let i = 0; i < PING_SAMPLES; i++) {
    const startedAt = performance.now();
    const response = await fetch(`${SPEED_TEST_BASE_URL}/__down?bytes=1&ping=${Date.now()}-${i}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Ping test failed (${response.status}).`);
    }

    await response.arrayBuffer();
    samples.push(performance.now() - startedAt);
  }

  const warm = samples.slice(1);
  const usable = warm.length > 0 ? warm : samples;
  const sorted = [...usable].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function useSpeedTest(): UseSpeedTestResult {
  const [status, setStatus] = useState<SpeedTestStatus>("idle");
  const [phase, setPhase] = useState<SpeedTestPhase>("idle");
  const [progress, setProgress] = useState<SpeedTestProgress>(EMPTY_PROGRESS);
  const [result, setResult] = useState<SpeedTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const runSpeedTest = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;

    setStatus("running");
    setPhase("ping");
    setProgress({ ...EMPTY_PROGRESS, phase: "ping" });
    setResult(null);
    setError(null);

    try {
      const pingMs = await measurePing();

      setPhase("download");
      const download = await runParallelDownload(
        PARALLEL_CONNECTIONS,
        DOWNLOAD_BYTES_PER_CONNECTION,
        setProgress
      );

      setPhase("upload");
      const upload = await runParallelUpload(PARALLEL_CONNECTIONS, UPLOAD_BYTES_PER_CONNECTION, setProgress);

      setPhase("complete");
      setProgress({
        phase: "complete",
        percent: 100,
        transferredBytes: upload.bytes,
        totalBytes: upload.bytes,
        mbTransferred: upload.bytes / 1_000_000,
        currentMbps: upload.mbps,
        currentMbPerSecond: upload.mbPerSecond,
      });

      setResult({
        download: {
          mbps: Number(download.mbps.toFixed(2)),
          mbPerSecond: Number(download.mbPerSecond.toFixed(2)),
        },
        upload: {
          mbps: Number(upload.mbps.toFixed(2)),
          mbPerSecond: Number(upload.mbPerSecond.toFixed(2)),
        },
        pingMs: Number(pingMs.toFixed(1)),
      });

      setStatus("success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to complete the speed test.";
      setError(message);
      setStatus("error");
      setPhase("idle");
    } finally {
      runningRef.current = false;
    }
  }, []);

  return { status, phase, progress, result, error, runSpeedTest };
}
