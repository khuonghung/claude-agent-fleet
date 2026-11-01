// The dashboard's own controls: a dropdown, tabs and a segmented control with a sliding indicator, a search field, a
// number that counts to its new value. Keyboard first, with the ARIA roles of what they stand for.

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./Icons";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A select-only combobox: a button and an animated list. */
export function Dropdown<T extends string>({ value, options, onChange, label, icon }: { value: T; options: { id: T; label: string; hint?: string }[]; onChange: (id: T) => void; label: string; icon?: Parameters<typeof Icon>[0]["name"] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.id === value) ?? options[0]!;
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => root.current?.contains(e.target as Node) || setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const choose = (i: number) => {
    const o = options[i];
    if (o) onChange(o.id);
    setOpen(false);
  };
  return (
    <div className={`dd${open ? " is-open" : ""}`} ref={root}>
      <button
        type="button"
        className="dd-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => {
          setActive(Math.max(0, options.indexOf(current)));
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setActive(Math.max(0, options.indexOf(current)));
            setOpen(true);
          } else if (open) {
            if (e.key === "Escape") setOpen(false);
            else if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => (a + 1) % options.length));
            else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => (a - 1 + options.length) % options.length));
            else if (e.key === "Enter" || e.key === " ") (e.preventDefault(), choose(active));
          }
        }}
      >
        {icon && <Icon name={icon} />}
        <span>{current.label}</span>
        <Icon name="chevron" className="dd-chev" />
      </button>
      {open && (
        <ul className="dd-list" role="listbox" aria-label={label}>
          {options.map((o, i) => (
            <li key={o.id} role="option" aria-selected={o.id === value} className={`${i === active ? "is-active" : ""}${o.id === value ? " is-on" : ""}`} onMouseEnter={() => setActive(i)} onMouseDown={(e) => (e.preventDefault(), choose(i))}>
              <span>{o.label}</span>
              {o.hint && <small>{o.hint}</small>}
              {o.id === value && <Icon name="check" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A row of choices with an indicator that slides to the chosen one (tabs or a segmented control). */
export function Slider<T extends string>({ items, value, onChange, kind, label }: { items: { id: T; label: ReactNode; badge?: ReactNode }[]; value: T; onChange: (id: T) => void; kind: "tabs" | "seg"; label: string }) {
  const row = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = row.current?.querySelector<HTMLElement>(`[data-id="${value}"]`);
      if (el) setBar({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (row.current) ro.observe(row.current);
    return () => ro.disconnect();
  }, [value, items.length]);
  return (
    <div className={kind === "tabs" ? "tabs" : "seg"} role="tablist" aria-label={label} ref={row}>
      {bar && <span className={kind === "tabs" ? "tabs-bar" : "seg-bar"} style={{ transform: `translateX(${bar.left}px)`, width: bar.width }} aria-hidden="true" />}
      {items.map((it) => (
        <button
          key={it.id}
          data-id={it.id}
          type="button"
          role="tab"
          aria-selected={value === it.id}
          className={value === it.id ? "is-on" : ""}
          onClick={() => onChange(it.id)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            const i = items.findIndex((x) => x.id === value);
            const next = items[(i + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length]!;
            onChange(next.id);
            row.current?.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus();
          }}
        >
          {it.label}
          {it.badge}
        </button>
      ))}
    </div>
  );
}

/** A search field with an icon, a clear button and the "/" shortcut. */
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const slash = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", slash);
    return () => window.removeEventListener("keydown", slash);
  }, []);
  return (
    <label className="search">
      <Icon name="search" />
      <input ref={input} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value ? (
        <button type="button" className="search-x" onClick={() => onChange("")} aria-label="clear">
          <Icon name="close" size={14} />
        </button>
      ) : (
        <kbd>/</kbd>
      )}
    </label>
  );
}

/** A number that counts from its last value to the new one. */
export function Num({ value, format = (n: number) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced() || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let frame = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(a + (value - a) * eased);
      if (k < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span className="num">{format(shown)}</span>;
}
