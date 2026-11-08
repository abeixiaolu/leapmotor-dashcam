import { it, expect } from "vite-plus/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsbLibrary } from "./usb";
const exec = promisify(execFile);
const ffmpeg = "/opt/homebrew/bin/ffmpeg",
  ffprobe = "/opt/homebrew/bin/ffprobe";
const frameHashes = async (file: string) => {
  const { stdout } = await exec(
    ffmpeg,
    [
      "-v",
      "error",
      "-i",
      file,
      "-vf",
      "select=eq(n\\,0)+eq(n\\,25)",
      "-fps_mode",
      "passthrough",
      "-frames:v",
      "2",
      "-f",
      "framemd5",
      "-",
    ],
    { maxBuffer: 1024 * 1024 },
  );
  return stdout
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(",").at(-1)?.trim());
};
it.skipIf(!existsSync(ffmpeg) || !existsSync(ffprobe))(
  "畸形裸流时间基无损封装后保持25fps、正确时长和逐帧像素",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "dashcam-remux-test-"));
    const volumes = join(root, "volumes"),
      sourceDir = join(volumes, "USB", "driverecord");
    const source = join(sourceDir, "2026-11-07_163334Z+0800_0002.h264");
    const library = new UsbLibrary(volumes, join(root, "cache"));
    try {
      await mkdir(sourceDir, { recursive: true });
      // Reproduce the camera's extreme raw timing metadata while retaining 50 real frames.
      await exec(ffmpeg, [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=64x64:rate=25",
        "-frames:v",
        "50",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-bf",
        "0",
        "-bsf:v",
        "h264_metadata=tick_rate=2400000/1",
        "-f",
        "h264",
        source,
      ]);
      const before = await readFile(source),
        beforeInfo = await stat(source);
      const recording = (await library.scan())[0].recordings[0];
      await library.prepare(recording.id, true);
      await expect
        .poll(async () => (await library.prepare(recording.id, false)).status, { timeout: 15000 })
        .toBe("ready");
      const ready = await library.prepare(recording.id, false),
        cached = await library.media(recording.id);
      expect(ready.duration).toBe(2);
      const probe = JSON.parse(
        (
          await exec(ffprobe, [
            "-v",
            "error",
            "-count_frames",
            "-show_entries",
            "stream=nb_read_frames,avg_frame_rate",
            "-of",
            "json",
            cached,
          ])
        ).stdout,
      );
      expect(probe.streams[0]).toMatchObject({ nb_read_frames: "50", avg_frame_rate: "25/1" });
      expect(await frameHashes(cached)).toEqual(await frameHashes(source));
      expect(await readFile(source)).toEqual(before);
      expect((await stat(source)).mtimeMs).toBe(beforeInfo.mtimeMs);
    } finally {
      library.dispose();
      await rm(root, { recursive: true, force: true });
    }
  },
  30000,
);
