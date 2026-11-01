// One pointer listener for every mascot on the page: each registered mascot gets --gx/--gy (its pupils' offset, in
// viewBox units) pointing at the pointer, once per animation frame. After a few seconds without movement the mascots
// let go and look around on their own (CSS).

import { type RefObject, useEffect } from "react";

const watchers = new Set<SVGSVGElement>();
let x = 0;
let y = 0;
let frame = 0;
let idle: ReturnType<typeof setTimeout> | undefined;
let listening = false;

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function aim() {
  frame = 0;
  for (const el of watchers) {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) continue;
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height * 0.45);
    const d = Math.hypot(dx, dy) || 1;
    // Full deflection from about 260px away; close by, the eyes move less, so a mascot under the pointer looks up at it.
    const k = Math.min(1, d / 260) * 3.2;
    el.style.setProperty("--gx", `${((dx / d) * k).toFixed(2)}`);
    el.style.setProperty("--gy", `${((dy / d) * k * 0.8).toFixed(2)}`);
    el.dataset.gaze = "follow";
  }
}

function release() {
  for (const el of watchers) delete el.dataset.gaze;
}

function onMove(e: PointerEvent) {
  x = e.clientX;
  y = e.clientY;
  if (!frame) frame = requestAnimationFrame(aim);
  clearTimeout(idle);
  idle = setTimeout(release, 4000);
}

/** Lets the mascot's eyes follow the pointer while `on` (awake and large enough to see it). */
export function useGaze(ref: RefObject<SVGSVGElement | null>, on: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !on || reduced()) return;
    watchers.add(el);
    if (!listening) {
      window.addEventListener("pointermove", onMove, { passive: true });
      listening = true;
    }
    return () => {
      watchers.delete(el);
      delete el.dataset.gaze;
      if (watchers.size === 0 && listening) {
        window.removeEventListener("pointermove", onMove);
        listening = false;
      }
    };
  }, [ref, on]);
}
