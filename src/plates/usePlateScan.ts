import { useEffect, useRef, useState } from "react";
import { scanPlates } from "./scan";
import { invalidatePlateCache, readPlateCache, savePlateCache } from "./cache";
import type { PlateScan } from "./types";

export function usePlateScan({ src, recordingId }: { src: string; recordingId: string }) {
  const [scan, setScan] = useState<PlateScan>({ kind: "checking-cache" });
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const run = new AbortController();
    controller.current = run;
    const start = async () => {
      if (attempt > 0) await invalidatePlateCache(recordingId, run.signal);
      else {
        const cached = await readPlateCache(recordingId, run.signal);
        if (run.signal.aborted) return;
        if (cached.kind === "hit") {
          setScan({ ...cached, kind: "cached" });
          return;
        }
      }
      if (run.signal.aborted) return;
      let completion: Promise<void> | undefined;
      await scanPlates({
        src,
        signal: run.signal,
        onState: (state) => {
          if (run.signal.aborted) return;
          if (state.kind === "complete") {
            completion = savePlateCache({
              recordingId,
              candidates: state.candidates,
              completedAt: Date.now(),
              signal: run.signal,
            }).then(() => {
              if (!run.signal.aborted) setScan(state);
            });
          } else setScan(state);
        },
      });
      await completion;
    };
    void start();
    return () => {
      run.abort();
      if (controller.current === run) controller.current = null;
    };
  }, [src, recordingId, attempt]);
  const stop = () => {
    controller.current?.abort();
    setScan((previous) => ({
      kind: "stopped",
      candidates: "candidates" in previous ? previous.candidates : [],
    }));
  };
  const retry = () => {
    controller.current?.abort();
    setScan({ kind: "loading" });
    setAttempt((previous) => previous + 1);
  };
  return { scan, stop, retry };
}
