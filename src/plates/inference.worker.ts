import { createPlateRecognizer } from "./inference";
import type { PlateWorkerReply, PlateWorkerRequest } from "./types";

let recognizer: ReturnType<typeof createPlateRecognizer> | undefined;
let processing = false;
const reply = (message: PlateWorkerReply) => self.postMessage(message);

self.onmessage = async (event: MessageEvent<PlateWorkerRequest>) => {
  const request = event.data;
  if (processing) {
    if (request.kind === "frame") request.image.close();
    reply({ kind: "error", message: "识别任务重复，请重新识别。" });
    return;
  }
  processing = true;
  try {
    recognizer ??= createPlateRecognizer();
    const engine = await recognizer;
    if (request.kind === "initialize") {
      reply({ kind: "ready" });
    } else {
      const hits = await engine.recognize(request.image);
      reply({ kind: "result", requestId: request.requestId, hits });
    }
  } catch {
    reply({
      kind: "error",
      message: "车牌识别暂时失败，请重试。若仍失败，请使用新版桌面浏览器并检查模型文件是否完整。",
    });
  } finally {
    if (request.kind === "frame") request.image.close();
    processing = false;
  }
};
