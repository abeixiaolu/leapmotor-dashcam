import { playbackErrorMessage } from "./playbackError";

export type PlaybackIntent = {
  playing: boolean;
  rate: number;
  seek: { time: number; token: number };
};

type PlaybackMedia = Pick<
  HTMLMediaElement,
  | "currentTime"
  | "duration"
  | "ended"
  | "playbackRate"
  | "readyState"
  | "seeking"
  | "load"
  | "pause"
  | "play"
  | "getAttribute"
  | "addEventListener"
  | "removeEventListener"
> & { readonly error: Pick<MediaError, "code" | "message"> | null };

type Position =
  | { kind: "ready" }
  | { kind: "loading" | "seeking"; target: number; recovering: boolean }
  | { kind: "failed" };

export function controlPlayback({
  video,
  src,
  onError,
  onRecovered,
}: {
  video: PlaybackMedia;
  src: string;
  onError: (message: string) => void;
  onRecovered: () => void;
}) {
  let active = true;
  let intent: PlaybackIntent | undefined;
  let position: Position = { kind: "ready" };
  let playRequest = 0;
  const current = () => active && video.getAttribute("src") === src;

  const failed = () => {
    if (!current() || position.kind === "failed") return;
    position = { kind: "failed" };
    playRequest++;
    onError(playbackErrorMessage(video.error));
  };

  const applyPlaying = () => {
    if (!current() || !intent || position.kind !== "ready") return;
    video.playbackRate = intent.rate;
    const request = ++playRequest;
    if (!intent.playing) {
      video.pause();
      return;
    }
    void video.play().catch((error: unknown) => {
      if (!current() || request !== playRequest || !intent?.playing) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (video.error) failed();
      else onError("无法播放此片段，请尝试重新载入。");
    });
  };

  const frameReady = () => {
    if (
      !current() ||
      position.kind !== "seeking" ||
      video.error ||
      video.seeking ||
      video.readyState < 2 ||
      (position.recovering && Math.abs(video.currentTime - position.target) > 0.05)
    )
      return;
    const recovered = position.recovering;
    position = { kind: "ready" };
    if (recovered) onRecovered();
    if (!video.ended) applyPlaying();
  };

  const metadataReady = () => {
    if (
      !current() ||
      position.kind !== "loading" ||
      video.error ||
      video.readyState < 1 ||
      !Number.isFinite(video.duration)
    )
      return;
    const target = Math.max(0, Math.min(position.target, video.duration));
    position = { ...position, kind: "seeking", target };
    if (video.currentTime !== target) video.currentTime = target;
    frameReady();
  };

  video.addEventListener("loadedmetadata", metadataReady);
  video.addEventListener("loadeddata", frameReady);
  video.addEventListener("seeked", frameReady);
  video.addEventListener("error", failed);

  return {
    update(next: PlaybackIntent) {
      if (!current()) return;
      const newSeek = next.seek.token !== intent?.seek.token;
      const newPlay = next.playing && !intent?.playing;
      intent = next;
      video.playbackRate = next.rate;
      if (!next.playing) {
        playRequest++;
        video.pause();
      }
      if (video.error && (newSeek || newPlay)) {
        playRequest++;
        position = {
          kind: "loading",
          target: newSeek ? next.seek.time : video.currentTime,
          recovering: true,
        };
        video.load();
        return;
      }
      if (newSeek) {
        playRequest++;
        position = {
          kind: "loading",
          target: next.seek.time,
          recovering:
            (position.kind === "loading" || position.kind === "seeking") && position.recovering,
        };
        metadataReady();
      } else applyPlaying();
    },
    dispose() {
      active = false;
      playRequest++;
      video.removeEventListener("loadedmetadata", metadataReady);
      video.removeEventListener("loadeddata", frameReady);
      video.removeEventListener("seeked", frameReady);
      video.removeEventListener("error", failed);
    },
  };
}
