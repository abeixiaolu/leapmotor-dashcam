import { describe, expect, it, vi } from "vite-plus/test";
import { controlPlayback } from "./playback";
import type { PlaybackIntent } from "./playback";

class Media extends EventTarget {
  src = "blob:recording";
  duration = 100;
  playbackRate = 1;
  readyState = 4;
  seeking = false;
  paused = true;
  error: Pick<MediaError, "code" | "message"> | null = null;
  loadCount = 0;
  position = 0;
  nextPlay: Promise<void> = Promise.resolve();

  get currentTime() {
    return this.position;
  }

  get ended() {
    return this.readyState >= 2 && this.position >= this.duration;
  }

  set currentTime(time: number) {
    this.position = time;
    this.seeking = true;
    this.readyState = 1;
  }

  getAttribute(name: string) {
    return name === "src" ? this.src : null;
  }

  load() {
    this.loadCount++;
    this.position = 0;
    this.readyState = 0;
    this.error = null;
    this.seeking = false;
    this.paused = true;
  }

  pause() {
    this.paused = true;
  }

  play() {
    if (this.ended) this.position = 0;
    this.paused = false;
    return this.nextPlay;
  }

  metadata() {
    this.readyState = 1;
    this.dispatchEvent(new Event("loadedmetadata"));
  }

  frame() {
    this.readyState = 4;
    this.seeking = false;
    const ended = this.ended;
    this.dispatchEvent(new Event("loadeddata"));
    this.dispatchEvent(new Event("seeked"));
    if (ended) {
      this.paused = true;
      this.dispatchEvent(new Event("ended"));
    }
  }

  fail() {
    this.error = { code: 3, message: "decoder failed" };
    this.dispatchEvent(new Event("error"));
  }

  advance(seconds: number) {
    if (!this.paused && !this.seeking && !this.error && this.readyState >= 2)
      this.position += seconds * this.playbackRate;
  }
}

function setup(video = new Media()) {
  const onError = vi.fn();
  const onRecovered = vi.fn();
  const controller = controlPlayback({ video, src: video.src, onError, onRecovered });
  const intent: PlaybackIntent = { playing: false, rate: 1, seek: { time: 0, token: 0 } };
  controller.update(intent);
  return { video, controller, intent, onError, onRecovered };
}

describe("video playback recovery", () => {
  it("restores a paused plate position after a decoder error and can play afterward", () => {
    const { video, controller, intent, onError, onRecovered } = setup();
    video.position = 91;
    video.fail();
    const seek = { ...intent, seek: { time: 41, token: 1 } };
    controller.update(seek);
    expect(video.loadCount).toBe(1);
    video.metadata();
    expect(video.currentTime).toBe(41);
    video.frame();
    expect(video.error).toBeNull();
    expect(video.paused).toBe(true);
    expect(onRecovered).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("decoder failed"));
    controller.update({ ...seek, playing: true });
    video.advance(2);
    expect(video.currentTime).toBe(43);
    expect(video.loadCount).toBe(1);
    controller.dispose();
  });

  it("uses the latest seek and pause received while recovery is loading", () => {
    const { video, controller, intent, onRecovered } = setup();
    video.fail();
    controller.update({ ...intent, seek: { time: 41, token: 1 } });
    controller.update({ ...intent, playing: true, seek: { time: 67, token: 2 } });
    video.metadata();
    expect(video.currentTime).toBe(67);
    controller.update({ ...intent, seek: { time: 77, token: 3 } });
    video.frame();
    video.advance(2);
    expect(video.currentTime).toBe(77);
    expect(video.paused).toBe(true);
    expect(video.loadCount).toBe(1);
    expect(onRecovered).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("recovers a play request at the current position instead of an old seek target", () => {
    const { video, controller, intent } = setup();
    video.position = 24;
    video.fail();
    controller.update({ ...intent, playing: true, rate: 2 });
    video.metadata();
    video.frame();
    video.advance(1);
    expect(video.currentTime).toBe(26);
    expect(video.loadCount).toBe(1);
    controller.dispose();
  });

  it("keeps an early seek until initial metadata and its decoded frame arrive", () => {
    const video = new Media();
    video.readyState = 0;
    const { controller, intent, onRecovered } = setup(video);
    controller.update({ ...intent, playing: true, seek: { time: 30, token: 1 } });
    expect(video.paused).toBe(true);
    video.metadata();
    expect(video.currentTime).toBe(30);
    video.frame();
    video.advance(1);
    expect(video.currentTime).toBe(31);
    expect(video.loadCount).toBe(0);
    expect(onRecovered).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("does not retry a failed recovery until another explicit command", () => {
    const { video, controller, intent, onRecovered } = setup();
    video.fail();
    const seek = { ...intent, seek: { time: 41, token: 1 } };
    controller.update(seek);
    video.metadata();
    video.fail();
    controller.update(seek);
    video.frame();
    expect(video.loadCount).toBe(1);
    expect(onRecovered).not.toHaveBeenCalled();
    controller.update({ ...seek, seek: { time: 40, token: 2 } });
    expect(video.loadCount).toBe(2);
    controller.dispose();
  });

  it("keeps healthy playback usable when the clock advances before seek notification", () => {
    const { video, controller, intent } = setup();
    controller.update({ ...intent, playing: true });
    const seek = { ...intent, playing: true, seek: { time: 41, token: 1 } };
    controller.update(seek);
    video.position = 41.1;
    video.frame();
    controller.update({ ...seek, playing: false });
    controller.update(seek);
    video.advance(2);
    expect(video.currentTime).toBe(43.1);
    expect(video.loadCount).toBe(0);
    controller.dispose();
  });

  it.each(["play", "restart"])(
    "stays at the end after seeking there and accepts an explicit %s",
    (command) => {
      const { video, controller, intent } = setup();
      controller.update({ ...intent, playing: true });
      const seek = { ...intent, playing: true, seek: { time: video.duration, token: 1 } };
      controller.update(seek);
      video.frame();
      expect(video.currentTime).toBe(video.duration);
      expect(video.ended).toBe(true);
      expect(video.paused).toBe(true);
      controller.update({ ...seek, playing: false });
      controller.update(command === "play" ? seek : { ...seek, seek: { time: 0, token: 2 } });
      video.frame();
      video.advance(1);
      expect(video.currentTime).toBe(1);
      expect(video.paused).toBe(false);
      expect(video.loadCount).toBe(0);
      controller.dispose();
    },
  );

  it("ignores a play rejection after pause, disposal or replacement of the source", async () => {
    for (const supersede of ["pause", "dispose", "source"]) {
      const { video, controller, intent, onError } = setup();
      let rejectPlay: (reason: unknown) => void = () => {
        throw new Error("No pending play request");
      };
      video.nextPlay = new Promise<void>((_, reject) => {
        rejectPlay = reject;
      });
      controller.update({ ...intent, playing: true });
      if (supersede === "pause") controller.update(intent);
      else if (supersede === "dispose") controller.dispose();
      else video.src = "blob:another-recording";
      rejectPlay(new DOMException("old play failed", "NotAllowedError"));
      await Promise.resolve();
      expect(onError).not.toHaveBeenCalled();
      controller.dispose();
    }
  });
});
