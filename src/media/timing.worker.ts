import { scanRecordingTiming } from "./timing";

/** Prefix sample avoids a full second read before remux on large phone imports. */
const SAMPLE_BYTES = 8 * 1024 * 1024;
const SAMPLE_FRAMES = 120;

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const file = event.data;
    const limit = Math.min(file.size, SAMPLE_BYTES);
    async function* chunks() {
      for (let offset = 0; offset < limit; offset += 256 * 1024) {
        yield new Uint8Array(await file.slice(offset, offset + 256 * 1024).arrayBuffer());
        self.postMessage({ progress: Math.min(1, (offset + 256 * 1024) / limit) });
      }
    }
    const result = await scanRecordingTiming(chunks(), {
      maxBytes: SAMPLE_BYTES,
      maxFrames: SAMPLE_FRAMES,
    });
    self.postMessage({ done: true, timing: result.timing, slicePackets: result.slicePackets });
  } catch {
    self.postMessage({ error: "无法读取录像，请确认 U 盘仍然连接，再重新选择文件。" });
  }
};
