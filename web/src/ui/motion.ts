// Motion helpers on the Web Animations API: FLIP for items that move between places, a pointer spotlight for cards.

import { type RefObject, useLayoutEffect, useRef } from "react";

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * FLIP: every element under `root` with a `data-flip` key glides from where it was to where it is now, after a
 * re-render (a ticket that changes column, a card that changes rank). A new element fades and rises in.
 */
export function useFlip(root: RefObject<HTMLElement | null>, deps: unknown[]) {
  const last = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const now = new Map<string, DOMRect>();
    el.querySelectorAll<HTMLElement>("[data-flip]").forEach((node) => {
      const key = node.dataset.flip!;
      const box = node.getBoundingClientRect();
      now.set(key, box);
      if (reduced()) return;
      const before = last.current.get(key);
      if (before === undefined) {
        if (last.current.size > 0) node.animate([{ opacity: 0, transform: "translateY(8px) scale(.98)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" });
      } else {
        const dx = before.left - box.left;
        const dy = before.top - box.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 520, easing: "cubic-bezier(.2,.9,.25,1)" });
        }
      }
    });
    last.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Sets --mx/--my on a card as the pointer moves over it, for a soft light that follows the pointer. */
export function spotlight(e: React.PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
}
