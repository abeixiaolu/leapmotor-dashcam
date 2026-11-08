import { useLayoutEffect, useRef } from "react";
import type { PointerEvent } from "react";

/** Animate only the painted surface. React Aria and saved values stay immediate. */
export function useFieldMotion(start: number, end: number, disabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const target = useRef({ start, end, pull: 0 });
  const animate = useRef<() => void>(() => {});
  const pointer = useRef<{ id: number; left: number; right: number } | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const current = { ...target.current };
    const from = { start: current.start, end: current.end };
    const goal = { ...from };
    let tweenStart = performance.now();
    let pullVelocity = 0;
    let pullEdge = 1;
    let pullLimit = 2;
    let frame = 0;
    let last = 0;
    const paint = () => {
      node.style.setProperty("--field-start", `${Math.max(0, Math.min(1, current.start)) * 100}%`);
      node.style.setProperty("--field-end", `${Math.max(0, Math.min(1, current.end)) * 100}%`);
      node.style.setProperty(
        "--field-pull",
        `${pullEdge * Math.max(0, Math.min(pullLimit, pullEdge * current.pull))}px`,
      );
      node.dataset.elastic = String(Math.abs(current.pull) > 0.01);
      node.dataset.visualEdge = String(current.end < 0.0001 || current.end > 0.9999);
    };
    const tick = (now: number) => {
      // Bounded steps avoid a jump after a background tab resumes.
      const dt = Math.min((now - last) / 1000 || 1 / 60, 1 / 60);
      last = now;
      const fraction = Math.min(1, (now - tweenStart) / 300);
      const eased = 1 - (1 - fraction) ** 5;
      for (const key of ["start", "end"] as const) {
        current[key] = from[key] + (target.current[key] - from[key]) * eased;
      }
      const distance = target.current.pull - current.pull;
      pullVelocity += (distance * 400 - pullVelocity * 26) * dt;
      current.pull += pullVelocity * dt;
      const pullSettled = Math.abs(distance) < 0.005 && Math.abs(pullVelocity) < 0.05;
      if (pullSettled) {
        current.pull = target.current.pull;
        pullVelocity = 0;
      }
      const settled = fraction === 1 && pullSettled;
      paint();
      frame = settled ? 0 : requestAnimationFrame(tick);
    };
    const update = () => {
      if (goal.start !== target.current.start || goal.end !== target.current.end) {
        from.start = current.start;
        from.end = current.end;
        goal.start = target.current.start;
        goal.end = target.current.end;
        tweenStart = performance.now();
      }
      if (media.matches || node.dataset.disabled === "true") {
        cancelAnimationFrame(frame);
        frame = 0;
        Object.assign(current, target.current, { pull: 0 });
        from.start = current.start;
        from.end = current.end;
        tweenStart = performance.now() - 300;
        pullVelocity = 0;
        paint();
      } else if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    animate.current = update;
    const release = () => {
      pointer.current = null;
      target.current.pull = 0;
      node.dataset.dragging = "false";
      update();
    };
    const move = (event: globalThis.PointerEvent) => {
      const active = pointer.current;
      if (!active || active.id !== event.pointerId || media.matches) return;
      const distance =
        event.clientX < active.left
          ? event.clientX - active.left
          : Math.max(0, event.clientX - active.right);
      const limit = Math.min(2, Math.max(1, active.right - active.left) * 0.006);
      pullLimit = limit;
      if (distance !== 0) pullEdge = Math.sign(distance);
      target.current.pull =
        Math.sign(distance) * limit * (1 - Math.exp((-Math.abs(distance) * 0.08) / limit));
      update();
    };
    const endPointer = (event: globalThis.PointerEvent) => {
      if (pointer.current?.id === event.pointerId) release();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") release();
    };
    paint();
    media.addEventListener("change", release);
    window.addEventListener("keydown", escape);
    window.addEventListener("lostpointercapture", endPointer, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", endPointer, true);
    window.addEventListener("pointercancel", endPointer, true);
    window.addEventListener("blur", release);
    return () => {
      cancelAnimationFrame(frame);
      animate.current = () => {};
      pointer.current = null;
      media.removeEventListener("change", release);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("lostpointercapture", endPointer, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", endPointer, true);
      window.removeEventListener("pointercancel", endPointer, true);
      window.removeEventListener("blur", release);
    };
  }, []);

  useLayoutEffect(() => {
    target.current.start = start;
    target.current.end = end;
    if (disabled) {
      target.current.pull = 0;
      pointer.current = null;
      if (ref.current) ref.current.dataset.dragging = "false";
    }
    animate.current();
  }, [start, end, disabled]);

  const onPointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || pointer.current || event.button !== 0 || !event.isPrimary) return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointer.current = { id: event.pointerId, left: rect.left, right: rect.right };
    event.currentTarget.dataset.dragging = "true";
  };
  return { ref, onPointerDownCapture };
}
