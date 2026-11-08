import { scanRecordingTiming } from "./timing";

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const file = event.data;
    async function* chunks() {
      for (let offset = 0; offset < file.size; offset += 256 * 1024) {
        yield new Uint8Array(await file.slice(offset, offset + 256 * 1024).arrayBuffer());
        self.postMessage({ progress: Math.min(1, (offset + 256 * 1024) / file.size) });
      }
    }
    const timing = await scanRecordingTiming(chunks());
    self.postMessage({ done: true, timing });
  } catch {
    self.postMessage({ error: "无法读取录像，请确认 U 盘仍然连接，再重新选择文件。" });
  }
};
