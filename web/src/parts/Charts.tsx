import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { clock, compact, endOf, startOf, statusLabel } from "../lib";
import type { FleetState } from "../types";
import { Mascot } from "./Mascot";

const BUCKET = 5 * 60_000;

/** Width of a box, kept current as the layout changes. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

function Tip({ x, y, w, children }: { x: number; y: number; w: number; children: ReactNode }) {
  const left = Math.min(Math.max(8, x + 12), w - 200);
  return (
    <div className="tip" style={{ left, top: Math.max(0, y - 10) }}>
      {children}
    </div>
  );
}

/** Round times across the window, at most about eight: every 15 min for a short mission, up to every 12 h for a long one. */
function timeTicks(start: number, end: number) {
  const steps = [15, 30, 60, 120, 240, 360, 720].map((m) => m * 60_000);
  const step = steps.find((x) => (end - start) / x <= 8) ?? steps.at(-1)!;
  const ticks: number[] = [];
  for (let t = Math.ceil(start / step) * step; t <= end; t += step) ticks.push(t);
  return ticks;
}

function niceMax(v: number) {
  if (v <= 5) return 5;
  const step = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / (step / 2)) * (step / 2);
}

export function ChartCard({ title, note, children, wide }: { title: string; note: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`chart-card${wide ? " is-wide" : ""}`}>
      <div className="chart-hd">
        <h2>{title}</h2>
        <p>{note}</p>
      </div>
      {children}
    </section>
  );
}

/** Cumulative tickets created, fixed and verified across the mission. */
export function BurnUp({ s, now }: { s: FleetState; now: number }) {
  const { t: tr, locale } = useI18n();
  const { ref, w } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const start = startOf(s.mission);
  const end = endOf(s.mission);
  const tickets = s.board?.tickets ?? [];
  const series = [
    { key: "created", label: tr("ch.created"), cls: "ln-created", times: tickets.map((t) => Date.parse(t.created)) },
    { key: "done", label: tr("ch.fixed"), cls: "ln-done", times: tickets.filter((t) => t.doneAt).map((t) => Date.parse(t.doneAt!)) },
    { key: "verified", label: tr("ch.verified"), cls: "ln-verified", times: tickets.filter((t) => t.verifiedAt).map((t) => Date.parse(t.verifiedAt!)) },
  ].map((x) => ({ ...x, times: x.times.map((t) => Math.max(start, t)).sort((a, b) => a - b) }));
  const h = 220;
  const pad = { l: 34, r: 14, t: 12, b: 26 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const ymax = niceMax(Math.max(1, ...series.map((x) => x.times.length)));
  const X = (t: number) => pad.l + ((t - start) / (end - start)) * iw;
  const Y = (v: number) => pad.t + ih - (v / ymax) * ih;
  const tNow = Math.min(now, end);
  const countAt = (times: number[], t: number) => times.filter((x) => x <= t).length;
  const path = (times: number[]) => {
    let d = `M${X(start)} ${Y(0)}`;
    let n = 0;
    for (const t of times) {
      if (t > tNow) break;
      d += ` H${X(t)} V${Y(++n)}`;
    }
    return `${d} H${X(tNow)}`;
  };
  const created = series[0]!;
  const area = `${path(created.times)} V${Y(0)} Z`;

  return (
    <div className="chart" ref={ref}>
      <div className="legend">
        {series.map((x) => (
          <span key={x.key} className={x.cls}>
            <i />
            {x.label} <b>{countAt(x.times, tNow)}</b>
          </span>
        ))}
      </div>
      <svg
        width="100%"
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - r.left;
          const t = start + ((x - pad.l) / iw) * (end - start);
          setHover(t >= start && t <= tNow ? { x, t } : null);
        }}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Burn-up ticket"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line className="grid" x1={pad.l} x2={w - pad.r} y1={Y(ymax * f)} y2={Y(ymax * f)} />
            <text className="tick" x={pad.l - 6} y={Y(ymax * f) + 4} textAnchor="end">
              {Math.round(ymax * f)}
            </text>
          </g>
        ))}
        {s.mission.phases.slice(1).map((p) => (
          <line key={p.name + p.from} className="phase-rule" x1={X(Date.parse(p.from))} x2={X(Date.parse(p.from))} y1={pad.t} y2={pad.t + ih} />
        ))}
        {timeTicks(start, end).map((t) => (
          <text key={t} className="tick" x={X(t)} y={h - 8} textAnchor="middle">
            {clock(t, locale)}
          </text>
        ))}
        <path className="area-created" d={area} />
        {series.map((x) => (
          <path key={x.key} className={`line ${x.cls}`} d={path(x.times)} />
        ))}
        <line className="now-rule" x1={X(tNow)} x2={X(tNow)} y1={pad.t} y2={pad.t + ih} />
        {hover && (
          <g>
            <line className="hover-rule" x1={hover.x} x2={hover.x} y1={pad.t} y2={pad.t + ih} />
            {series.map((x) => (
              <circle key={x.key} className={`dot ${x.cls}`} cx={hover.x} cy={Y(countAt(x.times, hover.t))} r="3.5" />
            ))}
          </g>
        )}
      </svg>
      {hover && (
        <Tip x={hover.x} y={20} w={w}>
          <b>{clock(hover.t, locale)}</b>
          {series.map((x) => (
            <span key={x.key} className={x.cls}>
              <i />
              {x.label}: {countAt(x.times, hover.t)}
            </span>
          ))}
        </Tip>
      )}
    </div>
  );
}

/** Tickets at each stage, in flow order. */
export function Funnel({ s }: { s: FleetState }) {
  const { t: tr, locale } = useI18n();
  const tickets = s.board?.tickets ?? [];
  const stages = [...s.flow.flow, ...s.flow.attention, ...s.flow.parked];
  const rows = stages.map((st) => ({ st, n: tickets.filter((t) => t.status === st).length })).filter((r) => r.n > 0 || s.flow.flow.includes(r.st));
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="funnel">
      {rows.map((r) => (
        <div key={r.st} className={`fn-row fn-${r.st}`}>
          <span className="fn-label">{statusLabel(tr, r.st)}</span>
          <span className="fn-track">
            <i style={{ width: `${(r.n / max) * 100}%` }} />
          </span>
          <b className="mono">{r.n}</b>
        </div>
      ))}
    </div>
  );
}

/** Tool calls per agent per 5 minutes: who worked when. */
export function Pulse({ s, now, onAgent }: { s: FleetState; now: number; onAgent: (id: string) => void }) {
  const { t: tr, locale } = useI18n();
  const { ref, w } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; y: number; agent: string; b: number } | null>(null);
  const start = startOf(s.mission);
  const end = endOf(s.mission);
  const n = Math.ceil((end - start) / BUCKET);
  const current = Math.floor((now - start) / BUCKET);
  const label = 150;
  const rowH = 24;
  const cw = (w - label) / n;
  const max = Math.max(4, ...s.agents.flatMap((a) => Object.values(s.telemetry[a.id]?.buckets ?? {})));
  const h = s.agents.length * rowH + 22;
  return (
    <div className="chart" ref={ref}>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={tr("ch.pulse")} onMouseLeave={() => setHover(null)}>
        {timeTicks(start, end).map((t) => {
          const x = label + ((t - start) / (end - start)) * (w - label);
          return (
            <text key={t} className="tick" x={x} y={h - 6} textAnchor="middle">
              {clock(t, locale)}
            </text>
          );
        })}
        {s.agents.map((a, row) => {
          const tele = s.telemetry[a.id];
          return (
            <g key={a.id} transform={`translate(0 ${row * rowH})`}>
              <foreignObject x="0" y="0" width={label - 8} height={rowH}>
                <button type="button" className="pulse-label" onClick={() => onAgent(a.id)}>
                  <Mascot agent={a} size={20} fuzzy={false} />
                  <span>{a.name}</span>
                </button>
              </foreignObject>
              {Array.from({ length: n }, (_, b) => {
                const v = tele?.buckets[String(b)] ?? 0;
                const future = b > current;
                return (
                  <rect
                    key={b}
                    x={label + b * cw + 1}
                    y={3}
                    width={Math.max(1, cw - 2)}
                    height={rowH - 6}
                    rx="2.5"
                    className={future ? "hm-future" : v ? "hm-on" : "hm-off"}
                    style={v && !future ? { opacity: 0.18 + (v / max) * 0.82 } : undefined}
                    onMouseEnter={(e) => {
                      const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                      setHover({ x: e.clientX - r.left, y: row * rowH, agent: a.id, b });
                    }}
                  />
                );
              })}
            </g>
          );
        })}
        {current >= 0 && current < n && <rect className="hm-now" x={label + current * cw} y={0} width={cw} height={s.agents.length * rowH} rx="3" />}
      </svg>
      {hover && (() => {
        const a = s.agents.find((x) => x.id === hover.agent)!;
        const t = s.telemetry[a.id];
        const from = start + hover.b * BUCKET;
        return (
          <Tip x={hover.x} y={hover.y} w={w}>
            <b>
              {a.name} · {clock(from, locale)}–{clock(from + BUCKET, locale)}
            </b>
            <span>{tr("ch.calls", { n: t?.buckets[String(hover.b)] ?? 0 })}</span>
            <span>{tr("ch.tokensOut", { n: compact(t?.tokenBuckets?.[String(hover.b)] ?? 0) })}</span>
          </Tip>
        );
      })()}
    </div>
  );
}

/** Output tokens per 5 minutes, stacked by squad. */
export function TokenBurn({ s, now }: { s: FleetState; now: number }) {
  const { t: tr, locale } = useI18n();
  const { ref, w } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; b: number } | null>(null);
  const start = startOf(s.mission);
  const end = endOf(s.mission);
  const n = Math.ceil((end - start) / BUCKET);
  const current = Math.floor((now - start) / BUCKET);
  const h = 200;
  const pad = { l: 40, r: 10, t: 10, b: 24 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const per = (b: number) =>
    s.squads.map((sq) => ({ sq: sq.id, name: sq.name, v: s.agents.filter((a) => a.squad === sq.id).reduce((x, a) => x + (s.telemetry[a.id]?.tokenBuckets?.[String(b)] ?? 0), 0) }));
  const totals = Array.from({ length: n }, (_, b) => per(b));
  const ymax = niceMax(Math.max(1000, ...totals.map((t) => t.reduce((x, y) => x + y.v, 0))));
  const bw = iw / n;
  const Y = (v: number) => (v / ymax) * ih;
  const sum = s.agents.reduce((x, a) => x + (s.telemetry[a.id]?.outputTokens ?? 0), 0);
  return (
    <div className="chart" ref={ref}>
      <div className="legend">
        {s.squads.map((sq) => (
          <span key={sq.id} className={`lg-${sq.id}`}>
            <i />
            {sq.name}
          </span>
        ))}
        <span className="legend-total">
          {tr("ch.total")} <b>{compact(sum)}</b>
        </span>
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Token output theo squad" onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className="grid" x1={pad.l} x2={w - pad.r} y1={pad.t + ih - Y(ymax * f)} y2={pad.t + ih - Y(ymax * f)} />
            <text className="tick" x={pad.l - 6} y={pad.t + ih - Y(ymax * f) + 4} textAnchor="end">
              {compact(ymax * f)}
            </text>
          </g>
        ))}
        {totals.map((parts, b) => {
          if (b > current) return null;
          let acc = 0;
          return (
            <g key={b} onMouseEnter={() => setHover({ x: pad.l + b * bw, b })}>
              <rect x={pad.l + b * bw} y={pad.t} width={bw} height={ih} fill="transparent" />
              {parts.map((p) => {
                const y = pad.t + ih - Y(acc + p.v);
                const hh = Y(p.v);
                acc += p.v;
                return p.v ? <rect key={p.sq} className={`bar-${p.sq}`} x={pad.l + b * bw + bw * 0.15} y={y} width={bw * 0.7} height={hh} rx="1.5" /> : null;
              })}
            </g>
          );
        })}
        {timeTicks(start, end).map((t) => (
          <text key={t} className="tick" x={pad.l + ((t - start) / (end - start)) * iw} y={h - 6} textAnchor="middle">
            {clock(t, locale)}
          </text>
        ))}
      </svg>
      {hover && (
        <Tip x={hover.x} y={10} w={w}>
          <b>
            {clock(start + hover.b * BUCKET, locale)}–{clock(start + (hover.b + 1) * BUCKET, locale)}
          </b>
          {totals[hover.b]!.map((p) => (
            <span key={p.sq} className={`lg-${p.sq}`}>
              <i />
              {p.name}: {compact(p.v)}
            </span>
          ))}
        </Tip>
      )}
    </div>
  );
}
