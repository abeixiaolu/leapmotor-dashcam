import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { cx } from "@/utils/cx";
import { directions, labels } from "./library";
import type { Direction } from "./library";
import { quadrants } from "./mosaicMath";
import { controlPlayback } from "./media/playback";
import type { PlaybackIntent } from "./media/playback";
import { Badge } from "@/components/base/badges/badge";
import { CLARITY_FRAGMENT_SHADER } from "@/clarityShader";
import type { ClarityMode, ClaritySettings } from "@/videoClarity";

const clarityModes = { original: 0, enhanced: 1, comparison: 2 } satisfies Record<
  ClarityMode,
  number
>;

type Props = PlaybackIntent & {
  src: string;
  correct: boolean;
  fov: number;
  strength: number;
  clarity: ClaritySettings;
  layout: "focus" | "grid";
  primary: Direction;
  onPrimary: (d: Direction) => void;
  onTime: (n: number) => void;
  onDuration: (n: number) => void;
  onPlaying: (b: boolean) => void;
  onError: (s: string) => void;
  onRecovered: () => void;
};

function View({
  frameSerial,
  video,
  direction,
  correct,
  fov,
  strength,
  clarity,
  onError,
}: {
  frameSerial: RefObject<number>;
  video: HTMLVideoElement | null;
  direction: Direction;
  correct: boolean;
  fov: number;
  strength: number;
  clarity: ClaritySettings;
  onError: (s: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settings = useRef({ correct, fov, strength, clarity });
  settings.current = { correct, fov, strength, clarity };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false });
    if (!gl) {
      onError("无法启动画面渲染，请使用支持 WebGL 的浏览器。");
      return;
    }
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error("画面渲染初始化失败");
      return shader;
    };
    let vertex: WebGLShader | undefined,
      fragment: WebGLShader | undefined,
      program: WebGLProgram | null = null;
    try {
      vertex = compile(
        gl.VERTEX_SHADER,
        "attribute vec2 pos;varying vec2 uv;void main(){uv=vec2(pos.x*.5+.5,.5-pos.y*.5);gl_Position=vec4(pos,0.,1.);}",
      );
      fragment = compile(gl.FRAGMENT_SHADER, CLARITY_FRAGMENT_SHADER);
      program = gl.createProgram();
      gl.attachShader(program!, vertex);
      gl.attachShader(program!, fragment);
      gl.linkProgram(program!);
      if (!gl.getProgramParameter(program!, gl.LINK_STATUS)) throw Error("画面渲染初始化失败");
    } catch (e) {
      onError(String(e));
      return;
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const pos = gl.getAttribLocation(program!, "pos");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T])
      gl.texParameteri(gl.TEXTURE_2D, axis, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.uniform2f(gl.getUniformLocation(program!, "quadrant"), ...quadrants[direction]);
    const fovUniform = gl.getUniformLocation(program!, "fov"),
      strengthUniform = gl.getUniformLocation(program!, "strength"),
      pixelUniform = gl.getUniformLocation(program!, "pixel"),
      clarityModeUniform = gl.getUniformLocation(program!, "clarityMode"),
      clarityAmountUniform = gl.getUniformLocation(program!, "clarityAmount");
    let raf = 0,
      lastFrame = -1,
      lastSettings = "",
      failed = false;
    const draw = () => {
      const s = settings.current;
      const signature = `${s.correct}-${s.fov}-${s.strength}-${s.clarity.mode}-${s.clarity.amount}`;
      if (
        video.readyState >= 2 &&
        video.videoWidth &&
        (frameSerial.current !== lastFrame || signature !== lastSettings)
      ) {
        const width = Math.min(video.videoWidth / 2, 1280),
          height = video.videoHeight / 2;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          gl.viewport(0, 0, width, height);
        }
        gl.uniform1f(clarityModeUniform, clarityModes[s.clarity.mode]);
        gl.uniform1f(clarityAmountUniform, s.clarity.amount);
        gl.uniform1f(fovUniform, s.fov);
        gl.uniform1f(strengthUniform, s.correct ? s.strength : 0);
        gl.uniform2f(pixelUniform, 1 / video.videoWidth, 1 / video.videoHeight);
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          lastFrame = frameSerial.current;
          lastSettings = signature;
        } catch {
          if (!failed) {
            failed = true;
            onError("视频画面渲染失败，请重新打开片段。");
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    };
  }, [video, direction, onError, frameSerial]);
  return (
    <canvas ref={canvasRef} className="mosaic-canvas" aria-label={`${labels[direction]}录像画面`} />
  );
}

export function MosaicPlayer(p: Props) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const frameSerial = useRef(0);
  const callbacks = useRef(p);
  callbacks.current = p;
  const playback = useRef<ReturnType<typeof controlPlayback> | null>(null);

  useEffect(() => {
    if (!video) return;
    const controller = controlPlayback({
      video,
      src: p.src,
      onError: (message) => {
        callbacks.current.onPlaying(false);
        callbacks.current.onError(message);
      },
      onRecovered: () => callbacks.current.onRecovered(),
    });
    playback.current = controller;
    return () => {
      controller.dispose();
      if (playback.current === controller) playback.current = null;
    };
  }, [video, p.src]);

  useEffect(() => {
    playback.current?.update({ playing: p.playing, rate: p.rate, seek: p.seek });
  }, [video, p.src, p.playing, p.rate, p.seek]);

  useEffect(() => {
    if (!video) return;
    let raf = 0,
      frameCallback = 0,
      last = -1,
      lastNotify = -Infinity,
      fallbackFrame = -1;
    const hasFrameCallback = typeof video.requestVideoFrameCallback === "function";
    const onFrame: VideoFrameRequestCallback = () => {
      frameSerial.current++;
      frameCallback = video.requestVideoFrameCallback(onFrame);
    };
    if (hasFrameCallback) frameCallback = video.requestVideoFrameCallback(onFrame);
    const notify = () => {
      last = video.currentTime;
      lastNotify = performance.now();
      callbacks.current.onTime(last);
    };
    const forceFrame = () => {
      frameSerial.current++;
      notify();
    };
    video.addEventListener("seeked", forceFrame);
    video.addEventListener("loadeddata", forceFrame);
    video.addEventListener("ended", forceFrame);
    video.addEventListener("pause", notify);
    const tick = (now: number) => {
      if (!hasFrameCallback) {
        const currentFrame = Math.floor(video.currentTime * 25);
        if (currentFrame !== fallbackFrame) {
          fallbackFrame = currentFrame;
          frameSerial.current++;
        }
      }
      if (video.currentTime !== last && now - lastNotify >= 100) notify();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (hasFrameCallback) video.cancelVideoFrameCallback(frameCallback);
      video.removeEventListener("seeked", forceFrame);
      video.removeEventListener("loadeddata", forceFrame);
      video.removeEventListener("ended", forceFrame);
      video.removeEventListener("pause", notify);
    };
  }, [video]);

  return (
    <div
      className={cx(
        "camera-grid mosaic-grid",
        p.layout === "focus" ? "layout-focus" : "layout-grid",
      )}
    >
      <video
        ref={setVideo}
        src={p.src || undefined}
        muted
        playsInline
        preload="auto"
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
        onLoadedMetadata={(e) => p.onDuration(e.currentTarget.duration)}
        onEnded={() => p.onPlaying(false)}
      />
      {directions.map((d) => (
        <section key={d} className={cx("camera", `camera-${d}`, p.primary === d && "is-primary")}>
          <View
            frameSerial={frameSerial}
            video={video}
            direction={d}
            correct={p.correct}
            fov={p.fov}
            strength={p.strength}
            clarity={p.clarity}
            onError={p.onError}
          />
          {p.clarity.mode === "comparison" && (
            <div className="pointer-events-none absolute inset-0 z-2" aria-hidden>
              <div className="absolute inset-y-0 left-1/2 border-s border-border-button-default" />
              <Badge
                color="neutral"
                className="absolute bottom-2 left-2 bg-background-primary-default"
              >
                原画
              </Badge>
              <Badge
                color="neutral"
                className="absolute right-2 bottom-2 bg-background-primary-default"
              >
                增强
              </Badge>
            </div>
          )}
          <button
            className="camera-select"
            aria-label={`设为主视角：${labels[d]}`}
            onClick={() => p.onPrimary(d)}
          />
          <div className="camera-top">
            <span>
              <i className="green-dot" />
              {labels[d]}
              {p.primary === d ? <small className="motion-enter">主视角</small> : null}
            </span>
          </div>
        </section>
      ))}
    </div>
  );
}
