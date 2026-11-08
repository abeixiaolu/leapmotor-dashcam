import { FFFSType } from "@ffmpeg/ffmpeg";
import type { RecordedTiming } from "./timing";
import { remuxArguments, remuxTiming } from "./remux";
import { prefetchPlaybackEngine, withPlaybackEngine } from "./ffmpegSession";

const MAX_FILE_SIZE = 512 * 1024 * 1024;
const CACHE_LIMIT = 2;

type TimingWorkerResult = {
  progress?: number;
  done?: boolean;
  timing?: RecordedTiming;
  slicePackets?: number;
  error?: string;
};

const preparedCache = new Map<string, Blob>();

export function recordingCacheKey(file: File) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export function peekPreparedCache(file: File) {
  const key = recordingCacheKey(file);
  const blob = preparedCache.get(key);
  if (!blob) return undefined;
  preparedCache.delete(key);
  preparedCache.set(key, blob);
  return blob;
}

function rememberPrepared(file: File, blob: Blob) {
  const key = recordingCacheKey(file);
  if (preparedCache.has(key)) preparedCache.delete(key);
  preparedCache.set(key, blob);
  while (preparedCache.size > CACHE_LIMIT) {
    const oldest = preparedCache.keys().next().value;
    if (oldest === undefined) break;
    preparedCache.delete(oldest);
  }
}

/** Test helper. */
export function clearPreparedCacheForTests() {
  preparedCache.clear();
}

/** Test helper. */
export function rememberPreparedForTests(file: File, blob: Blob) {
  rememberPrepared(file, blob);
}

function readTiming(file: File, signal: AbortSignal, onProgress: (text: string) => void) {
  return new Promise<{ timing?: RecordedTiming; slicePackets: number }>((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL("./timing.worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<TimingWorkerResult>) => {
      if (event.data.error) {
        cleanup();
        reject(new Error(event.data.error));
      } else if (event.data.done) {
        cleanup();
        resolve({
          timing: event.data.timing,
          slicePackets: Number(event.data.slicePackets) || 0,
        });
      } else onProgress(`正在读取录像时间… ${Math.round((event.data.progress ?? 0) * 100)}%`);
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error("录像读取失败，请重新选择文件后重试。"));
    };
    worker.postMessage(file);
  });
}

export { prefetchPlaybackEngine };

/** Reuses a warm FFmpeg worker when possible. Cancel still frees WASM immediately. */
export async function prepareRecording(
  file: File,
  signal: AbortSignal,
  onProgress: (text: string) => void,
): Promise<Blob> {
  signal.throwIfAborted();
  if (!file.size) throw new Error("录像为空，请选择其他片段。");
  if (file.size > MAX_FILE_SIZE)
    throw new Error("这段录像超过 512 MB，暂不支持在浏览器中处理，请选择较小的片段。");

  const cached = peekPreparedCache(file);
  if (cached) {
    onProgress("已使用本地缓存，即将播放…");
    return cached;
  }

  // Overlap SEI sampling with WASM load / queue wait.
  const timingPromise = readTiming(file, signal, onProgress);
  void prefetchPlaybackEngine();

  const blob = await withPlaybackEngine(signal, onProgress, async (ffmpeg) => {
    const { timing: recorded, slicePackets } = await timingPromise;
    signal.throwIfAborted();
    // WORKERFS reads slices directly from the File; no full input copy or upload.
    const mounted = await ffmpeg.mount(
      FFFSType.WORKERFS,
      { blobs: [{ name: "recording.h264", data: file }] },
      "/input",
    );
    if (!mounted) throw new Error("当前浏览器无法读取本地录像，请使用较新版本的浏览器。");

    // Trust sampled SEI only when the prefix has one timestamp per slice packet.
    // Mismatch falls back to 25 fps without a second full-file ffprobe pass.
    const { numerator, denominator } = remuxTiming(recorded, slicePackets);
    const onRemuxProgress = ({ progress }: { progress: number }) => {
      onProgress(
        `正在本地封装播放格式… ${Math.max(0, Math.min(100, Math.round(progress * 100)))}%`,
      );
    };
    ffmpeg.on("progress", onRemuxProgress);
    onProgress("正在本地封装播放格式，录像不会上传…");
    let code: number;
    try {
      // Blob URLs already hold the full file, so skip faststart's second write pass.
      code = await ffmpeg.exec(
        remuxArguments(numerator, denominator, { faststart: false }),
        120000,
        { signal },
      );
    } finally {
      ffmpeg.off("progress", onRemuxProgress);
    }
    if (code !== 0) throw new Error("无法封装这段录像，文件可能损坏或处理超时，请尝试其他片段。");
    signal.throwIfAborted();
    const data = await ffmpeg.readFile("output.mp4");
    if (typeof data === "string" || !data.length)
      throw new Error("未生成有效录像，请尝试其他片段。");
    return new Blob([data as Uint8Array<ArrayBuffer>], { type: "video/mp4" });
  });

  rememberPrepared(file, blob);
  return blob;
}
