/// <reference types="node" />
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { it, expect, vi, afterEach } from "vite-plus/test";
import { remuxArguments, remuxTiming } from "../src/media/remux";

type Core = {
  exec: (...args: string[]) => void;
  ffprobe: (...args: string[]) => void;
  ret: number;
  reset: () => void;
  FS: {
    mkdir: (path: string) => void;
    readFile: (path: string, options: { encoding: string }) => string;
  };
};
afterEach(() => vi.unstubAllGlobals());
const require = createRequire(import.meta.url);
const createCore = require("@ffmpeg/core") as (options: {
  wasmBinary: Uint8Array;
}) => Promise<Core>;

it("browser WASM corrects raw SPS timing and level while preserving pixels and duration", async () => {
  vi.stubGlobal("self", { location: { href: "http://localhost/ffmpeg-core.js" } });
  const core = await createCore({
    wasmBinary: await readFile(require.resolve("@ffmpeg/core/wasm")),
  });
  const exec = (args: string[]) => {
    core.exec("-nostdin", "-y", "-v", "error", ...args);
    const code = core.ret;
    core.reset();
    expect(code).toBe(0);
  };
  core.FS.mkdir("/input");
  exec([
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
    "h264_metadata=tick_rate=2400000/1:level=60",
    "-f",
    "h264",
    "/input/recording.h264",
  ]);
  exec(remuxArguments(25, 1));
  core.ffprobe(
    "-v",
    "error",
    "-count_frames",
    "-show_entries",
    "stream=nb_read_frames,avg_frame_rate,level:format=duration",
    "-of",
    "json",
    "output.mp4",
    "-o",
    "probe.json",
  );
  core.reset();
  const probe = JSON.parse(core.FS.readFile("probe.json", { encoding: "utf8" }));
  expect(Number(probe.format.duration)).toBe(2);
  expect(probe.streams[0]).toMatchObject({
    nb_read_frames: "50",
    avg_frame_rate: "25/1",
    level: 10,
  });
  const probeRaw = (input: string, output: string) => {
    core.ffprobe(
      "-v",
      "error",
      "-show_entries",
      "stream=r_frame_rate,level",
      "-of",
      "json",
      input,
      "-o",
      output,
    );
    core.reset();
    return JSON.parse(core.FS.readFile(output, { encoding: "utf8" })).streams[0];
  };
  expect(probeRaw("/input/recording.h264", "source.json")).toMatchObject({
    r_frame_rate: "1200000/1",
    level: 60,
  });
  const extractRaw = () => {
    exec([
      "-i",
      "output.mp4",
      "-c:v",
      "copy",
      "-bsf:v",
      "h264_mp4toannexb",
      "-f",
      "h264",
      "normalized.h264",
    ]);
  };
  // Inspect the elementary stream: container-only timestamp corrections cannot
  // satisfy this assertion, because the original SPS would still be malformed.
  extractRaw();
  expect(probeRaw("normalized.h264", "normalized.json")).toMatchObject({
    r_frame_rate: "25/1",
    level: 10,
  });
  for (const [input, output] of [
    ["/input/recording.h264", "before.txt"],
    ["output.mp4", "after.txt"],
  ]) {
    exec(["-i", input, "-frames:v", "50", "-fps_mode", "passthrough", "-f", "framemd5", output]);
  }
  const hashes = (path: string) =>
    core.FS.readFile(path, { encoding: "utf8" })
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split(",").at(-1)?.trim());
  expect(hashes("after.txt")).toEqual(hashes("before.txt"));
  exec(remuxArguments(1000, 41));
  core.ffprobe(
    "-v",
    "error",
    "-count_packets",
    "-show_entries",
    "stream=nb_read_packets:format=duration",
    "-of",
    "json",
    "output.mp4",
    "-o",
    "measured.json",
  );
  core.reset();
  const measured = JSON.parse(core.FS.readFile("measured.json", { encoding: "utf8" }));
  expect(Number(measured.format.duration)).toBe(2.05);
  expect(Number(measured.streams[0].nb_read_packets)).toBe(50);
  extractRaw();
  expect(probeRaw("normalized.h264", "measured-raw.json")).toMatchObject({
    r_frame_rate: "1000/41",
    level: 10,
  });
}, 30000);

it("uses measured timing only when timestamps match the packet count", () => {
  const recorded = {
    fpsNumerator: 1000,
    fpsDenominator: 41,
    frameCount: 50,
    duration: 2.05,
    timing: "recorded" as const,
  };
  expect(remuxTiming(recorded, 50)).toEqual({ numerator: 1000, denominator: 41 });
  expect(remuxTiming(recorded, 49)).toEqual({ numerator: 25, denominator: 1 });
  expect(remuxTiming(undefined, 0)).toEqual({ numerator: 25, denominator: 1 });
});

it("playback remux without faststart keeps duration, rate, and pixels", async () => {
  vi.stubGlobal("self", { location: { href: "http://localhost/ffmpeg-core.js" } });
  const core = await createCore({
    wasmBinary: await readFile(require.resolve("@ffmpeg/core/wasm")),
  });
  const exec = (args: string[]) => {
    core.exec("-nostdin", "-y", "-v", "error", ...args);
    const code = core.ret;
    core.reset();
    expect(code).toBe(0);
  };
  core.FS.mkdir("/input");
  exec([
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
    "h264_metadata=tick_rate=2400000/1:level=60",
    "-f",
    "h264",
    "/input/recording.h264",
  ]);
  exec(remuxArguments(25, 1, { faststart: false }));
  core.ffprobe(
    "-v",
    "error",
    "-count_frames",
    "-show_entries",
    "stream=nb_read_frames,avg_frame_rate,level:format=duration",
    "-of",
    "json",
    "output.mp4",
    "-o",
    "probe.json",
  );
  core.reset();
  const probe = JSON.parse(core.FS.readFile("probe.json", { encoding: "utf8" }));
  expect(Number(probe.format.duration)).toBe(2);
  expect(probe.streams[0]).toMatchObject({
    nb_read_frames: "50",
    avg_frame_rate: "25/1",
    level: 10,
  });
}, 30000);
