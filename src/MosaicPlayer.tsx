import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { cx } from "@/utils/cx";
import { directions, labels } from "./library";
import type { Direction } from "./library";
import { quadrants } from "./mosaicMath";
import { playbackErrorMessage } from "./media/playbackError";

type Props = {
  src: string;
  playing: boolean;
  rate: number;
  seek: { time: number; token: number };
  correct: boolean;
  fov: number;
  strength: number;
  layout: "focus" | "grid";
  primary: Direction;
  onPrimary: (d: Direction) => void;
  onTime: (n: number) => void;
  onDuration: (n: number) => void;
  onPlaying: (b: boolean) => void;
  onError: (s: string) => void;
};

function View({
  frameSerial,
  video,
  direction,
  correct,
  fov,
  strength,
  onError,
}: {
  frameSerial: RefObject<number>;
  video: HTMLVideoElement | null;
  direction: Direction;
  correct: boolean;
  fov: number;
  strength: number;
  onError: (s: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settings = useRef({ correct, fov, strength });
  settings.current = { correct, fov, strength };
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
      fragment = compile(
        gl.FRAGMENT_SHADER,
        `precision highp float;varying vec2 uv;uniform sampler2D frame;uniform vec2 quadrant;uniform vec2 pixel;uniform float fov;uniform float strength;void main(){vec2 p=(uv*2.-1.)*tan(radians(fov)*.5);p.y/=1.25;float r=length(p);float k=r>.000001?atan(r)/r/3.14159265:1./3.14159265;vec2 lens=.5+p*k*vec2(1.,1.25);vec2 local=mix(uv,lens,strength);local=clamp(local,pixel,1.-pixel);vec2 source=(local+quadrant)*.5;gl_FragColor=texture2D(frame,source);}`,
      );
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
      pixelUniform = gl.getUniformLocation(program!, "pixel");
    let raf = 0,
      lastFrame = -1,
      lastSettings = "",
      failed = false;
    const draw = () => {
      const s = settings.current;
      const signature = `${s.correct}-${s.fov}-${s.strength}`;
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

  useEffect(() => {
    if (!video) return;
    video.playbackRate = p.rate;
    if (p.playing) {
      void video.play().catch((e: DOMException) => {
        if (e.name !== "AbortError") {
          callbacks.current.onPlaying(false);
          callbacks.current.onError("无法播放此片段，请尝试重新载入。");
        }
      });
    } else video.pause();
  }, [video, p.playing, p.rate, p.src]);

  useEffect(() => {
    if (video && video.readyState >= 1) {
      video.currentTime = Math.max(0, Math.min(p.seek.time, video.duration));
      callbacks.current.onTime(video.currentTime);
    }
  }, [video, p.seek.token, p.seek.time]);

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
        onError={(event) => p.onError(playbackErrorMessage(event.currentTarget.error))}
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
            onError={p.onError}
          />
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
