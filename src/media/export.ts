import { FFmpeg, FFFSType } from "@ffmpeg/ffmpeg";
import classWorkerURL from "@ffmpeg/ffmpeg/worker?worker&url";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";
import type { Direction } from "../library";
import { labels } from "../library";
import { exportFilter, type ExportLayout } from "./exportLayout";

export async function exportRecording({
  file,
  layout,
  primary,
  onProgress,
}: {
  file: File;
  layout: ExportLayout;
  primary: Direction;
  onProgress: (text: string) => void;
}): Promise<File> {
  const ffmpeg = new FFmpeg();
  const timeout = setTimeout(() => ffmpeg.terminate(), 600000);
  try {
    onProgress("正在加载导出组件…");
    await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });
    await ffmpeg.createDir("/input");
    if (
      !(await ffmpeg.mount(
        FFFSType.WORKERFS,
        { blobs: [{ name: "source.mp4", data: file }] },
        "/input",
      ))
    )
      throw new Error("无法读取导出录像。");
    ffmpeg.on("progress", ({ progress }) =>
      onProgress(`正在导出… ${Math.max(0, Math.min(100, Math.round(progress * 100)))}%`),
    );
    onProgress("正在导出…");
    const code = await ffmpeg.exec(
      [
        "-i",
        "/input/source.mp4",
        "-filter_complex",
        exportFilter(layout, primary),
        "-map",
        "[out]",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "output.mp4",
      ],
      600000,
    );
    if (code !== 0) throw new Error("导出失败或处理超时，请尝试较短的录像。");
    const data = await ffmpeg.readFile("output.mp4");
    if (typeof data === "string" || !data.length) throw new Error("未生成有效视频。");
    const bytes = new Uint8Array(data.length);
    bytes.set(data);
    return new File(
      [bytes.buffer],
      `${file.name.replace(/\.[^.]+$/, "")}-${layout === "grid" ? "四宫格" : `${labels[primary]}主视角`}.mp4`,
      { type: "video/mp4" },
    );
  } finally {
    clearTimeout(timeout);
    ffmpeg.terminate();
  }
}
