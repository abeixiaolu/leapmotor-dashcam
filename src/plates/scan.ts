import { directions } from "@/library";
import { quadrants } from "@/mosaicMath";
import { mergePlateHits } from "./observations";
import type { PlateCandidate, PlateScan, PlateWorkerReply, PlateWorkerRequest } from "./types";

const MAX_SAMPLE_POSITIONS = 360;

export const plateSampleInterval = (duration: number) =>
  Math.max(1, duration / MAX_SAMPLE_POSITIONS);

function delay(milliseconds: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function waitForVideo(
  video: HTMLVideoElement,
  eventName: "loadeddata" | "seeked",
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(eventName, ready);
      video.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
    };
    const ready = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("无法读取识别画面，可重新识别。录像仍可继续播放。"));
    };
    const aborted = () => {
      cleanup();
      reject(signal.reason);
    };
    const timer = window.setTimeout(failed, 30000);
    video.addEventListener(eventName, ready, { once: true });
    video.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
  });
}

function requestWorker(worker: Worker, request: PlateWorkerRequest, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<PlateWorkerReply>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      worker.removeEventListener("message", received);
      worker.removeEventListener("error", failed);
      worker.removeEventListener("messageerror", failed);
      signal.removeEventListener("abort", aborted);
    };
    const received = (event: MessageEvent<PlateWorkerReply>) => {
      const reply = event.data;
      if (reply.kind === "error") {
        cleanup();
        reject(new Error(reply.message));
      } else if (
        (request.kind === "initialize" && reply.kind === "ready") ||
        (request.kind === "frame" &&
          reply.kind === "result" &&
          reply.requestId === request.requestId)
      ) {
        cleanup();
        resolve(reply);
      }
    };
    const failed = () => {
      cleanup();
      reject(new Error("车牌识别组件运行失败，可重新识别。录像仍可继续播放。"));
    };
    const aborted = () => {
      cleanup();
      reject(signal.reason);
    };
    const timer = window.setTimeout(
      () => {
        cleanup();
        reject(
          new Error(
            request.kind === "initialize"
              ? "识别组件加载超时，请检查网络后重新识别。"
              : "这一帧识别耗时过长，请重新识别。录像仍可继续播放。",
          ),
        );
      },
      request.kind === "initialize" ? 180000 : 60000,
    );
    worker.addEventListener("message", received);
    worker.addEventListener("error", failed);
    worker.addEventListener("messageerror", failed);
    signal.addEventListener("abort", aborted, { once: true });
    try {
      worker.postMessage(request, request.kind === "frame" ? [request.image] : []);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export async function scanPlates({
  src,
  signal,
  onState,
}: {
  src: string;
  signal: AbortSignal;
  onState: (state: PlateScan) => void;
}) {
  let candidates: PlateCandidate[] = [];
  let worker: Worker | undefined;
  let video: HTMLVideoElement | undefined;
  const dispose = () => {
    worker?.terminate();
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  };
  const publish = (state: PlateScan) => {
    if (!signal.aborted) onState(state);
  };
  signal.addEventListener("abort", dispose, { once: true });
  try {
    signal.throwIfAborted();
    publish({ kind: "loading" });
    await delay(1200, signal);
    if (
      typeof Worker === "undefined" ||
      typeof createImageBitmap !== "function" ||
      typeof OffscreenCanvas === "undefined"
    ) {
      throw new Error("当前浏览器不支持后台车牌识别，请使用新版桌面浏览器。");
    }
    worker = new Worker(new URL("./inference.worker.ts", import.meta.url), { type: "module" });
    await requestWorker(worker, { kind: "initialize" }, signal);
    signal.throwIfAborted();
    video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const loaded = waitForVideo(video, "loadeddata", signal);
    video.src = src;
    video.load();
    await loaded;
    if (
      !Number.isFinite(video.duration) ||
      video.duration <= 0 ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      throw new Error("无法确定录像长度或画面尺寸，暂时不能识别车牌。");
    }
    const interval = plateSampleInterval(video.duration);
    const positions = Math.min(MAX_SAMPLE_POSITIONS, Math.ceil(video.duration / interval));
    const total = positions * directions.length;
    let completed = 0;
    publish({ kind: "scanning", completed, total, candidates });
    for (let position = 0; position < positions; position++) {
      signal.throwIfAborted();
      const time = position * interval;
      if (Math.abs(video.currentTime - time) > 0.001) {
        const sought = waitForVideo(video, "seeked", signal);
        video.currentTime = time;
        await sought;
      }
      signal.throwIfAborted();
      const width = Math.floor(video.videoWidth / 2);
      const height = Math.floor(video.videoHeight / 2);
      for (const direction of directions) {
        signal.throwIfAborted();
        const [column, row] = quadrants[direction];
        const image = await createImageBitmap(video, column * width, row * height, width, height);
        try {
          signal.throwIfAborted();
          const reply = await requestWorker(
            worker,
            { kind: "frame", requestId: completed, image },
            signal,
          );
          signal.throwIfAborted();
          if (reply.kind === "result")
            candidates = mergePlateHits(candidates, reply.hits, direction, time);
        } finally {
          image.close();
        }
        completed++;
        publish({ kind: "scanning", completed, total, candidates });
        await delay(75, signal);
      }
    }
    publish({ kind: "complete", candidates });
  } catch (error) {
    if (!signal.aborted) {
      publish({
        kind: "error",
        candidates,
        message: error instanceof Error ? error.message : "车牌识别失败，可重新识别。",
      });
    }
  } finally {
    signal.removeEventListener("abort", dispose);
    dispose();
  }
}
