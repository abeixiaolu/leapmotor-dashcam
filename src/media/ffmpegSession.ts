import { FFmpeg } from "@ffmpeg/ffmpeg";
import classWorkerURL from "@ffmpeg/ffmpeg/worker?worker&url";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";

let shared: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
let queue: Promise<void> = Promise.resolve();

function resetEngine() {
  shared?.terminate();
  shared = null;
  loading = null;
}

async function getLoaded(
  signal: AbortSignal,
  onProgress?: (text: string) => void,
): Promise<FFmpeg> {
  signal.throwIfAborted();
  if (shared?.loaded) return shared;
  onProgress?.("正在加载本地播放组件，首次打开需要稍等…");
  if (!loading) {
    const ffmpeg = new FFmpeg();
    loading = ffmpeg
      .load({ coreURL, wasmURL, classWorkerURL }, { signal })
      .then(async () => {
        signal.throwIfAborted();
        await ffmpeg.createDir("/input");
        shared = ffmpeg;
        return ffmpeg;
      })
      .catch((error) => {
        resetEngine();
        throw error;
      });
  }
  const ffmpeg = await loading;
  signal.throwIfAborted();
  if (!ffmpeg.loaded) {
    loading = null;
    return getLoaded(signal, onProgress);
  }
  return ffmpeg;
}

/** Warm the ~32 MB WASM worker after import so the first clip waits less. */
export async function prefetchPlaybackEngine(onProgress?: (text: string) => void) {
  try {
    await getLoaded(new AbortController().signal, onProgress);
  } catch {
    // Prefetch is best-effort; prepare will surface real errors.
  }
}

export async function withPlaybackEngine<T>(
  signal: AbortSignal,
  onProgress: (text: string) => void,
  run: (ffmpeg: FFmpeg) => Promise<T>,
): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = queue;
  queue = queue.then(
    () => gate,
    () => gate,
  );
  await previous.catch(() => undefined);
  signal.throwIfAborted();
  const abort = () => resetEngine();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const ffmpeg = await getLoaded(signal, onProgress);
    return await run(ffmpeg);
  } catch (error) {
    if (signal.aborted) resetEngine();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    if (shared?.loaded) {
      try {
        await shared.deleteFile("output.mp4");
      } catch {
        /* missing between jobs */
      }
      try {
        await shared.deleteFile("probe.json");
      } catch {
        /* missing between jobs */
      }
      try {
        await shared.unmount("/input");
      } catch {
        /* missing between jobs */
      }
    }
    release();
  }
}

/** Test helper: drop the warm worker between cases. */
export function resetPlaybackEngineForTests() {
  resetEngine();
  queue = Promise.resolve();
}
