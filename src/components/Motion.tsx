import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { RiPauseFill, RiPlayFill, RiFullscreenExitLine, RiFullscreenLine } from "@remixicon/react";

/** FLIP the existing camera surfaces without remounting canvases or video. */
export function changeCameraLayout(update: () => void) {
  const grid = document.querySelector<HTMLElement>(".mosaic-grid");
  if (!grid || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  const cameras = [...grid.querySelectorAll<HTMLElement>(".camera")];
  const previous = cameras.map((camera) => camera.getBoundingClientRect());
  cameras.forEach((camera) => camera.getAnimations().forEach((animation) => animation.cancel()));
  flushSync(update);
  const styles = getComputedStyle(grid);
  const durationValue = styles.getPropertyValue("--resize-dur").trim();
  const duration = parseFloat(durationValue) * (durationValue.endsWith("ms") ? 1 : 1000);
  cameras.forEach((camera, index) => {
    const from = previous[index];
    const to = camera.getBoundingClientRect();
    if (!to.width || !to.height) return;
    camera.animate(
      [
        {
          transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
          transformOrigin: "top left",
        },
        { transform: "none", transformOrigin: "top left" },
      ],
      {
        duration: Number.isFinite(duration) ? duration : 300,
        easing: styles.getPropertyValue("--resize-ease").trim() || "ease-out",
      },
    );
  });
}

/** Keep both glyphs mounted so quick toggles reverse the current transition. */
export function PlaybackIcon({ playing }: { playing: boolean }) {
  return (
    <span className="t-icon-swap" data-state={playing ? "b" : "a"} aria-hidden>
      <RiPlayFill className="t-icon size-5" data-icon="a" />
      <RiPauseFill className="t-icon size-5" data-icon="b" />
    </span>
  );
}

export function FullscreenIcon({ expanded }: { expanded: boolean }) {
  return (
    <span className="t-icon-swap" data-state={expanded ? "b" : "a"} aria-hidden>
      <RiFullscreenLine className="t-icon size-4" data-icon="a" />
      <RiFullscreenExitLine className="t-icon size-4" data-icon="b" />
    </span>
  );
}

/** The accessible value updates immediately; only its visual copy waits for the exit. */
export function MotionText({ children }: { children: string | number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const initial = useRef(children);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = String(children);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      el.textContent = next;
      el.classList.remove("is-exit", "is-enter-start");
    };
    if (media.matches || el.textContent === next) reset();
    else {
      const value = getComputedStyle(el).getPropertyValue("--text-swap-dur").trim();
      const duration = parseFloat(value) * (value.endsWith("ms") ? 1 : 1000);
      el.classList.add("is-exit");
      timer = setTimeout(
        () => {
          el.textContent = next;
          el.classList.remove("is-exit");
          el.classList.add("is-enter-start");
          void el.offsetHeight;
          el.classList.remove("is-enter-start");
        },
        Number.isFinite(duration) ? duration : 200,
      );
    }
    media.addEventListener("change", reset);
    return () => {
      clearTimeout(timer);
      media.removeEventListener("change", reset);
      el.classList.remove("is-exit", "is-enter-start");
    };
  }, [children]);
  return (
    <>
      <span className="sr-only">{children}</span>
      <span ref={ref} className="t-text-swap" aria-hidden>
        {initial.current}
      </span>
    </>
  );
}
