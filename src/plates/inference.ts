import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import wasmModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import detectorUrl from "./models/detector.onnx?url";
import recognizerUrl from "./models/recognizer.onnx?url";
import type { PlateHit } from "./types";
import {
  DETECTOR_SIZE,
  RECOGNIZER_HEIGHT,
  RECOGNIZER_WIDTH,
  RECOGNIZER_CLASSES,
  decodeDetections,
  decodeText,
  qualifyPlate,
  letterbox,
  perspective,
  recognitionTensor,
} from "./modelMath";

function canvas2d(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前浏览器无法读取识别画面，请使用新版桌面浏览器。");
  return { canvas, context };
}

async function output(
  session: InferenceSession,
  data: Float32Array,
  shape: number[],
  stride: number,
) {
  const input = new Tensor("float32", data, shape);
  try {
    const results = await session.run({ [session.inputNames[0]]: input });
    try {
      const tensor = results[session.outputNames[0]];
      if (
        !tensor ||
        !(tensor.data instanceof Float32Array) ||
        tensor.dims.at(-1) !== stride ||
        tensor.data.length % stride !== 0
      ) {
        throw new Error("车牌模型输出不匹配，请刷新页面后重试。");
      }
      return tensor.data.slice();
    } finally {
      for (const tensor of Object.values(results)) tensor.dispose();
    }
  } finally {
    input.dispose();
  }
}

export async function createPlateRecognizer() {
  env.wasm.numThreads = 1;
  env.wasm.proxy = false;
  env.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl };
  const options = {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  } satisfies InferenceSession.SessionOptions;
  const detector = await InferenceSession.create(detectorUrl, options);
  let recognizer: InferenceSession;
  try {
    recognizer = await InferenceSession.create(recognizerUrl, options);
  } catch (error) {
    await detector.release();
    throw error;
  }
  const detection = canvas2d(DETECTOR_SIZE, DETECTOR_SIZE);
  return {
    async recognize(image: ImageBitmap): Promise<PlateHit[]> {
      const fit = letterbox(image.width, image.height);
      detection.context.clearRect(0, 0, DETECTOR_SIZE, DETECTOR_SIZE);
      detection.context.drawImage(image, fit.left, fit.top, fit.width, fit.height);
      const pixels = detection.context.getImageData(0, 0, DETECTOR_SIZE, DETECTOR_SIZE).data;
      const plane = DETECTOR_SIZE * DETECTOR_SIZE;
      const data = new Float32Array(plane * 3);
      for (let i = 0; i < plane; i++) {
        data[i] = pixels[i * 4] / 255;
        data[plane + i] = pixels[i * 4 + 1] / 255;
        data[2 * plane + i] = pixels[i * 4 + 2] / 255;
      }
      const boxes = decodeDetections(
        await output(detector, data, [1, 3, DETECTOR_SIZE, DETECTOR_SIZE], 15),
        image.width,
        image.height,
      );
      if (!boxes.length) return [];
      const source = canvas2d(image.width, image.height);
      source.context.drawImage(image, 0, 0);
      const original = source.context.getImageData(0, 0, image.width, image.height);
      const hits: PlateHit[] = [];
      for (const candidate of boxes) {
        const transform = perspective(candidate.corners);
        if (!transform) continue;
        const read = async (start: number, end: number) =>
          decodeText(
            await output(
              recognizer,
              recognitionTensor(original, transform, start, end),
              [1, 3, RECOGNIZER_HEIGHT, RECOGNIZER_WIDTH],
              RECOGNIZER_CLASSES,
            ),
          );
        let text: string;
        let characterScores: number[];
        if (candidate.doubleRow) {
          const top = await read(0, 0.4);
          const bottom = await read(0.4, 1);
          text = top.text + bottom.text;
          characterScores = [...top.characterScores, ...bottom.characterScores];
        } else {
          const result = await read(0, 1);
          text = result.text;
          characterScores = result.characterScores;
        }
        const reading = qualifyPlate({ text, characterScores });
        if (!reading) continue;
        const { x, y, width, height } = candidate.box;
        const crop = canvas2d(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
        crop.context.drawImage(
          image,
          x,
          y,
          width,
          height,
          0,
          0,
          crop.canvas.width,
          crop.canvas.height,
        );
        hits.push({
          ...reading,
          box: candidate.box,
          thumbnail: await crop.canvas.convertToBlob({ type: "image/png" }),
        });
      }
      return hits;
    },
  };
}
