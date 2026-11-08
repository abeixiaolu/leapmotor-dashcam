import { FFmpeg, FFFSType } from "@ffmpeg/ffmpeg";
import classWorkerURL from "@ffmpeg/ffmpeg/worker?worker&url";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";
import type { RecordedTiming } from "./timing";
import { remuxArguments, remuxTiming } from "./remux";

const MAX_FILE_SIZE = 512 * 1024 * 1024;

function readTiming(file: File, signal: AbortSignal, onProgress: (text: string) => void) {
  return new Promise<RecordedTiming | undefined>((resolve, reject) => {
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
    worker.onmessage = (
      event: MessageEvent<{
        progress?: number;
        done?: boolean;
        timing?: RecordedTiming;
        error?: string;
      }>,
    ) => {
      if (event.data.error) {
        cleanup();
        reject(new Error(event.data.error));
      } else if (event.data.done) {
        cleanup();
        resolve(event.data.timing);
      } else onProgress(`正在读取录像时间… ${Math.round((event.data.progress ?? 0) * 100)}%`);
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error("录像读取失败，请重新选择文件后重试。"));
    };
    worker.postMessage(file);
  });
}

/** Each job owns its worker. Cancel/switch releases all WASM memory immediately. */
export async function prepareRecording(
  file: File,
  signal: AbortSignal,
  onProgress: (text: string) => void,
): Promise<Blob> {
  signal.throwIfAborted();
  if (!file.size) throw new Error("录像为空，请选择其他片段。");
  if (file.size > MAX_FILE_SIZE)
    throw new Error("这段录像超过 512 MB，暂不支持在浏览器中处理，请选择较小的片段。");
  const recorded = await readTiming(file, signal, onProgress);
  signal.throwIfAborted();
  const ffmpeg = new FFmpeg();
  const abort = () => ffmpeg.terminate();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 180000);
  try {
    onProgress("正在加载本地播放组件，首次打开需要稍等…");
    await ffmpeg.load({ coreURL, wasmURL, classWorkerURL }, { signal });
    signal.throwIfAborted();
    await ffmpeg.createDir("/input");
    // WORKERFS reads slices directly from the File; no full input copy or upload.
    const mounted = await ffmpeg.mount(
      FFFSType.WORKERFS,
      { blobs: [{ name: "recording.h264", data: file }] },
      "/input",
    );
    if (!mounted) throw new Error("当前浏览器无法读取本地录像，请使用较新版本的浏览器。");
    let packets = 0;
    if (recorded) {
      onProgress("正在核对录像时间…");
      await ffmpeg.ffprobe(
        [
          "-v",
          "error",
          "-count_packets",
          "-show_entries",
          "stream=nb_read_packets",
          "-of",
          "json",
          "/input/recording.h264",
          "-o",
          "probe.json",
        ],
        120000,
        { signal },
      );
      // ffprobe in core 0.12.10 can return -1 after successfully writing JSON.
      // Validate its output rather than treating that exit status as failure.
      const probe = JSON.parse((await ffmpeg.readFile("probe.json", "utf8")) as string);
      packets = Number(probe.streams?.[0]?.nb_read_packets);
      if (!Number.isSafeInteger(packets) || packets <= 0)
        throw new Error("未找到有效视频帧，请选择其他录像。");
    }
    const { numerator, denominator } = remuxTiming(recorded, packets);
    onProgress("正在本地封装播放格式，录像不会上传…");
    const code = await ffmpeg.exec(remuxArguments(numerator, denominator), 120000, { signal });
    if (code !== 0) throw new Error("无法封装这段录像，文件可能损坏或处理超时，请尝试其他片段。");
    signal.throwIfAborted();
    const data = await ffmpeg.readFile("output.mp4");
    if (typeof data === "string" || !data.length)
      throw new Error("未生成有效录像，请尝试其他片段。");
    return new Blob([data as Uint8Array<ArrayBuffer>], { type: "video/mp4" });
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw error instanceof Error
      ? error
      : new Error("本地处理失败或内存不足，请关闭其他页面后重试，或选择较小的录像。");
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    ffmpeg.terminate();
  }
}
