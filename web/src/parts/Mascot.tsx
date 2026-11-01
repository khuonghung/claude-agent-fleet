import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import type { AgentDef, MascotSpec } from "../types";
import { useGaze } from "../ui/gaze";

/**
 * Plush mascots with a bit of life: a soft, lit body; eyes that blink on their own rhythm and follow the pointer;
 * a mouth and cheeks that show the mood; and a way of moving for each state — hopping while it runs a tool, a thought
 * bubble while it thinks, a happy wiggle when it replied, dozing when silent. It perks up on hover, squashes when
 * booped, and jumps with confetti when a ticket of its own is verified (`cheer`).
 */

type Shape = { d: string; extra?: { cx: number; cy: number; r: number }[]; top: number; eyeY: number; dx: number; mouthY: number };

const SHAPES: Record<string, Shape> = {
  cloud: { d: "M24 86 C10 86 6 70 15 63 C7 52 15 38 29 41 C30 27 45 20 56 29 C66 20 84 27 81 43 C93 46 95 66 84 74 C88 82 82 86 76 86 Z", top: 26, eyeY: 60, dx: 11, mouthY: 71 },
  frog: {
    d: "M12 86 C6 70 12 52 26 47 C28 40 34 38 42 40 C46 39 54 39 58 40 C66 38 72 40 74 47 C88 52 94 70 88 86 Z",
    extra: [
      { cx: 35, cy: 38, r: 13 },
      { cx: 65, cy: 38, r: 13 },
    ],
    top: 26,
    eyeY: 37,
    dx: 15,
    mouthY: 62,
  },
  gumdrop: { d: "M50 14 C60 14 80 52 88 72 C92 82 86 88 76 88 L24 88 C14 88 8 82 12 72 C20 52 40 14 50 14 Z", top: 20, eyeY: 62, dx: 13, mouthY: 74 },
  heart: { d: "M50 88 C24 72 8 58 9 40 C10 26 22 18 34 20 C42 21 47 27 50 32 C53 27 58 21 66 20 C78 18 90 26 91 40 C92 58 76 72 50 88 Z", top: 22, eyeY: 48, dx: 15, mouthY: 60 },
  bean: { d: "M16 60 C16 34 30 18 50 18 C70 18 84 34 84 60 L84 74 C84 84 78 88 68 88 L32 88 C22 88 16 84 16 74 Z", top: 19, eyeY: 54, dx: 13, mouthY: 67 },
  dome: { d: "M50 20 C72 20 88 36 88 58 C88 78 72 88 50 88 C28 88 12 78 12 58 C12 36 28 20 50 20 Z", top: 21, eyeY: 56, dx: 13, mouthY: 69 },
};

const FALLBACK_COLORS = ["#2f7cf6", "#8fd63a", "#ffc928", "#ff3fb4", "#ff8a3d", "#22c3ee", "#8b5cf6", "#ff5252", "#18c3b0", "#34d399"];
const HATS = new Set(["beret", "crown", "hardhat"]);
const INK = "#16161a";

function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function mix(hex: string, to: number, amount: number) {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * amount));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function specOf(agent: AgentDef): Required<MascotSpec> {
  const h = hash(agent.id);
  const shapes = Object.keys(SHAPES);
  return {
    shape: agent.mascot?.shape ?? shapes[h % shapes.length]!,
    color: agent.mascot?.color ?? FALLBACK_COLORS[h % FALLBACK_COLORS.length]!,
    eyes: agent.mascot?.eyes ?? "dots",
    accessory: agent.mascot?.accessory ?? "none",
  };
}

/** What the face shows: the agent state (lib `agentStatus` kinds) plus the old board's "quiet". */
type Mood = "busy" | "thinking" | "happy" | "calm" | "sleepy" | "off" | "cheer";
function moodOf(kind: string | undefined, cheering: boolean): Mood {
  if (cheering) return "cheer";
  switch (kind) {
    case "running":
      return "busy";
    case "thinking":
      return "thinking";
    case "replied":
      return "happy";
    case "silent":
    case "quiet":
      return "sleepy";
    case "offline":
      return "off";
    default:
      return "calm";
  }
}

function Eyes({ shape, style, mood }: { shape: Shape; style: string; mood: Mood }) {
  const { eyeY: y, dx } = shape;
  const xs = [50 - dx, 50 + dx];
  if (style === "hidden") return null;
  // Closed (asleep, off) or happy arcs (cheering, the "smile" eye style).
  if (mood === "sleepy" || mood === "off") {
    return (
      <g className="m-eyes">
        {xs.map((x) => (
          <path key={x} d={`M${x - 5.5} ${y + 1} Q${x} ${y + 5} ${x + 5.5} ${y + 1}`} stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
        ))}
      </g>
    );
  }
  if (mood === "cheer" || style === "smile") {
    return (
      <g className="m-eyes">
        {xs.map((x) => (
          <path key={x} d={`M${x - 5.5} ${y + 2} Q${x} ${y - 5} ${x + 5.5} ${y + 2}`} stroke={INK} strokeWidth="3.2" fill="none" strokeLinecap="round" />
        ))}
      </g>
    );
  }
  if (style === "googly") {
    const r = shape.extra ? 8.5 : 8;
    return (
      <g className="m-eyes">
        {xs.map((x) => (
          <g key={x} className="m-eye">
            <circle cx={x} cy={y} r={r} fill="#fff" stroke="rgba(0,0,0,.18)" strokeWidth="1" />
            <g className="m-gaze">
              <circle cx={x} cy={y + 0.5} r={r * 0.52} fill={INK} />
              <circle cx={x + 1.8} cy={y - 1.6} r={r * 0.17} fill="#fff" />
            </g>
          </g>
        ))}
      </g>
    );
  }
  return (
    <g className="m-eyes">
      {xs.map((x) => (
        <g key={x} className="m-eye">
          <g className="m-gaze">
            <ellipse cx={x} cy={y} rx="4.4" ry="6.4" fill={INK} />
            <ellipse cx={x + 1.4} cy={y - 2.6} rx="1.4" ry="1.9" fill="#fff" opacity=".85" />
            <circle cx={x - 1.3} cy={y + 2.6} r=".8" fill="#fff" opacity=".5" />
          </g>
        </g>
      ))}
    </g>
  );
}

function Mouth({ shape, mood }: { shape: Shape; mood: Mood }) {
  const y = shape.mouthY;
  switch (mood) {
    case "busy": // concentrating: a small, determined "o"
      return <ellipse className="m-mouth" cx="50" cy={y} rx="2.6" ry="2.2" fill={INK} />;
    case "thinking": // pursed, off to one side
      return <path className="m-mouth" d={`M45 ${y} q2.5 -2 5 0 t5 0`} stroke={INK} strokeWidth="2.4" fill="none" strokeLinecap="round" />;
    case "happy":
      return (
        <g className="m-mouth">
          <path d={`M43 ${y - 1.5} Q50 ${y + 6} 57 ${y - 1.5} Z`} fill={INK} />
          <path d={`M46.5 ${y + 2.2} Q50 ${y + 4.6} 53.5 ${y + 2.2}`} fill="#ff7a8a" />
        </g>
      );
    case "cheer":
      return (
        <g className="m-mouth">
          <path d={`M41 ${y - 3} Q50 ${y + 9} 59 ${y - 3} Z`} fill={INK} />
          <path d={`M45.5 ${y + 2.4} Q50 ${y + 6.4} 54.5 ${y + 2.4}`} fill="#ff7a8a" />
        </g>
      );
    case "sleepy": // a small snoring "o" that breathes
      return <ellipse className="m-mouth m-snore" cx="50" cy={y + 0.5} rx="1.8" ry="1.6" fill={INK} opacity=".8" />;
    case "off":
      return <path className="m-mouth" d={`M46.5 ${y} L53.5 ${y}`} stroke={INK} strokeWidth="2.2" strokeLinecap="round" />;
    default:
      return <path className="m-mouth" d={`M46 ${y - 0.5} Q50 ${y + 3} 54 ${y - 0.5}`} stroke={INK} strokeWidth="2.4" fill="none" strokeLinecap="round" />;
  }
}

function Accessory({ kind, shape }: { kind: string; shape: Shape }) {
  const t = shape.top;
  const y = shape.eyeY;
  const dx = shape.dx;
  switch (kind) {
    case "beret":
      return (
        <g className="m-acc">
          <ellipse cx="53" cy={t - 1} rx="27" ry="10.5" fill="#1d1d22" transform={`rotate(-8 53 ${t - 1})`} />
          <ellipse cx="50" cy={t + 3} rx="22" ry="4" fill="#111114" />
          <circle cx="51" cy={t - 12} r="4.5" fill="#1d1d22" />
          <ellipse cx="44" cy={t - 5} rx="9" ry="2.6" fill="rgba(255,255,255,.12)" transform={`rotate(-12 44 ${t - 5})`} />
        </g>
      );
    case "crown":
      return (
        <g className="m-acc m-crown">
          <path d={`M33 ${t + 4} L33 ${t - 11} L41.5 ${t - 3} L50 ${t - 16} L58.5 ${t - 3} L67 ${t - 11} L67 ${t + 4} Z`} fill="#f7c948" stroke="#b7860f" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="50" cy={t - 16} r="2.6" fill="#ff5d73" />
          <circle cx="33" cy={t - 11} r="2.2" fill="#5dd6ff" />
          <circle cx="67" cy={t - 11} r="2.2" fill="#5dd6ff" />
          <rect x="33" y={t} width="34" height="4" fill="#e3ad1f" />
          <path className="m-glint" d={`M40 ${t - 2} l3 -6`} stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case "headset":
      return (
        <g className="m-acc" fill="none" strokeLinecap="round">
          <path d={`M19 ${y - 4} C19 ${t - 14} 81 ${t - 14} 81 ${y - 4}`} stroke="#23232a" strokeWidth="5" />
          <rect x="11" y={y - 12} width="12" height="18" rx="5" fill="#2c2c34" />
          <rect x="77" y={y - 12} width="12" height="18" rx="5" fill="#2c2c34" />
          <path d={`M83 ${y + 5} C84 ${y + 20} 70 ${y + 22} 60 ${y + 20}`} stroke="#23232a" strokeWidth="3" />
          <circle className="m-led" cx="58.5" cy={y + 20} r="3.4" fill="#ff5d73" />
        </g>
      );
    case "hardhat":
      return (
        <g className="m-acc">
          <path d={`M27 ${t + 7} C27 ${t - 15} 73 ${t - 15} 73 ${t + 7} Z`} fill="#ffd23f" />
          <rect x="20" y={t + 4} width="60" height="6" rx="3" fill="#f0b400" />
          <path d={`M50 ${t - 9} L50 ${t + 5}`} stroke="#e6a800" strokeWidth="4" strokeLinecap="round" />
          <path d={`M35 ${t - 2} Q38 ${t - 9} 44 ${t - 10}`} stroke="rgba(255,255,255,.6)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </g>
      );
    case "glasses":
      return (
        <g className="m-acc" fill="none" stroke={INK} strokeWidth="3">
          <circle cx={50 - dx} cy={y} r="10.5" fill="rgba(255,255,255,.12)" />
          <circle cx={50 + dx} cy={y} r="10.5" fill="rgba(255,255,255,.12)" />
          <path d={`M${50 - dx + 10.5} ${y - 1} Q50 ${y - 5} ${50 + dx - 10.5} ${y - 1}`} />
          <path d={`M${50 - dx - 10.5} ${y - 2} L${50 - dx - 18} ${y - 5}`} />
          <path d={`M${50 + dx + 10.5} ${y - 2} L${50 + dx + 18} ${y - 5}`} />
        </g>
      );
    case "sunglasses":
      return (
        <g className="m-acc">
          <ellipse cx={50 - dx} cy={y} rx="11" ry="9" fill="#101014" />
          <ellipse cx={50 + dx} cy={y} rx="11" ry="9" fill="#101014" />
          <path d={`M${50 - dx + 10} ${y - 3} Q50 ${y - 7} ${50 + dx - 10} ${y - 3}`} stroke="#101014" strokeWidth="3" fill="none" />
          <ellipse className="m-glint" cx={50 - dx - 3} cy={y - 3.5} rx="3.5" ry="2" fill="rgba(255,255,255,.4)" />
          <ellipse className="m-glint" cx={50 + dx - 3} cy={y - 3.5} rx="3.5" ry="2" fill="rgba(255,255,255,.4)" />
        </g>
      );
    case "goggles":
      return (
        <g className="m-acc">
          <rect x="12" y={y - 4} width="76" height="7" rx="3.5" fill="#3a3a44" />
          <circle cx={50 - dx} cy={y} r="11" fill="rgba(170,225,255,.4)" stroke="#2b2b33" strokeWidth="3.5" />
          <circle cx={50 + dx} cy={y} r="11" fill="rgba(170,225,255,.4)" stroke="#2b2b33" strokeWidth="3.5" />
          <path d={`M${50 - dx - 5} ${y - 5} l4 -2`} stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          <path d={`M${50 + dx - 5} ${y - 5} l4 -2`} stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case "magnifier":
      return (
        <g className="m-acc m-lens">
          <path d="M84 80 L93 92" stroke="#5b3a1e" strokeWidth="5" strokeLinecap="round" />
          <circle cx="77" cy="71" r="11" fill="rgba(200,240,255,.35)" stroke="#2b2b33" strokeWidth="3.5" />
          <path d="M71 67 q3 -4 7 -3" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      );
    case "bowtie":
      return (
        <g className="m-acc">
          <path d="M50 81 L37 74 L37 88 Z" fill="#e11d48" />
          <path d="M50 81 L63 74 L63 88 Z" fill="#e11d48" />
          <circle cx="50" cy="81" r="3.4" fill="#be123c" />
        </g>
      );
    case "bow":
      return (
        <g className="m-acc">
          <ellipse cx="60" cy={t + 1} rx="9" ry="6" fill="#ffe066" transform={`rotate(-25 60 ${t + 1})`} />
          <ellipse cx="76" cy={t + 1} rx="9" ry="6" fill="#ffe066" transform={`rotate(25 76 ${t + 1})`} />
          <circle cx="68" cy={t + 3} r="3.6" fill="#f5c518" />
        </g>
      );
    case "antenna":
      return (
        <g className="m-acc m-antenna">
          <path d={`M50 ${t + 2} Q47 ${t - 6} 50 ${t - 13}`} stroke="#2b2b33" strokeWidth="3" strokeLinecap="round" fill="none" />
          <circle className="m-blink" cx="50" cy={t - 15} r="4.5" fill="#f7c948" />
        </g>
      );
    default:
      return null;
  }
}

/** Little extras around the body for the state: sparks while it works, a thought bubble, Zzz, confetti. */
function Extras({ shape, mood, big, seed }: { shape: Shape; mood: Mood; big: boolean; seed: number }) {
  if (!big) return null;
  const t = shape.top;
  if (mood === "busy") {
    return (
      <g className="m-sparks" stroke="#ffd36b" strokeWidth="2.6" strokeLinecap="round">
        <path d={`M84 ${t + 2} l6 -5`} />
        <path d={`M88 ${t + 12} l8 -1`} />
        <path d={`M15 ${t + 4} l-6 -5`} />
      </g>
    );
  }
  if (mood === "thinking") {
    return (
      <g className="m-bubble">
        <circle cx="80" cy={t + 4} r="2.4" fill="#fff" />
        <circle cx="86" cy={t - 4} r="3.4" fill="#fff" />
        <g transform={`translate(92 ${t - 17})`}>
          <rect x="-13" y="-8.5" width="26" height="17" rx="8.5" fill="#fff" />
          <circle className="m-dot" cx="-6.5" cy="0" r="2.3" fill="#6b7280" />
          <circle className="m-dot" cx="0" cy="0" r="2.3" fill="#6b7280" />
          <circle className="m-dot" cx="6.5" cy="0" r="2.3" fill="#6b7280" />
        </g>
      </g>
    );
  }
  if (mood === "sleepy") {
    return (
      <g className="m-zzz" fill="currentColor" fontWeight="800">
        <text x="78" y={t + 2} fontSize="11">z</text>
        <text x="85" y={t - 7} fontSize="14">z</text>
        <text x="93" y={t - 18} fontSize="17">Z</text>
      </g>
    );
  }
  if (mood === "cheer") {
    const colors = ["#ffd23f", "#ff5d8f", "#5dd6ff", "#7ee08a", "#b48cff", "#ff9f43"];
    return (
      <g className="m-confetti">
        {Array.from({ length: 14 }, (_, i) => {
          const a = (i / 14) * Math.PI * 2 + (seed % 7) * 0.2;
          const r = 34 + ((seed >> i) % 3) * 9;
          const style = { "--cx": `${(Math.cos(a) * r).toFixed(1)}px`, "--cy": `${(Math.sin(a) * r - 18).toFixed(1)}px`, "--cr": `${(i * 47) % 360}deg`, animationDelay: `${(i % 4) * 30}ms` } as CSSProperties;
          return i % 3 === 0 ? <circle key={i} cx="50" cy="45" r="2.6" fill={colors[i % colors.length]} style={style} /> : <rect key={i} x="48.5" y="42" width="3" height="6" rx="1" fill={colors[i % colors.length]} style={style} />;
        })}
      </g>
    );
  }
  return null;
}

interface MascotProps {
  agent: AgentDef;
  /** The agent's state (lib `agentStatus().kind`); none = a still portrait. */
  kind?: string;
  size?: number;
  /** The full figure (state extras like the thought bubble, a finer outline); off for small avatars. */
  fuzzy?: boolean;
  label?: boolean;
  /** A count that rises when the agent has something to celebrate (a ticket of theirs verified): it jumps for joy. */
  cheer?: number;
}

export function Mascot({ agent, kind, size = 40, fuzzy = true, label, cheer }: MascotProps) {
  const uid = useId().replace(/:/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const spec = specOf(agent);
  const shape = SHAPES[spec.shape] ?? SHAPES.dome!;
  const seed = hash(agent.id);
  const [boop, setBoop] = useState(0);
  const [cheering, setCheering] = useState(false);
  const last = useRef(cheer);

  useEffect(() => {
    if (cheer !== undefined && last.current !== undefined && cheer > last.current) {
      setCheering(true);
      const id = setTimeout(() => setCheering(false), 1800);
      last.current = cheer;
      return () => clearTimeout(id);
    }
    last.current = cheer;
  }, [cheer]);

  const mood = moodOf(kind, cheering);
  const awake = mood !== "sleepy" && mood !== "off";
  // The bubble, Zzz and sparks reach past the figure: only where there is room around it (the stage, the drawer).
  const big = size >= 70;
  useGaze(ref, awake && size >= 30 && kind !== undefined);

  const fill = `url(#g${uid})`;
  const outline = mix(spec.color, 0, 0.45);
  // Each mascot blinks and breathes on its own rhythm, so a row of them never moves in lockstep.
  const rhythm = {
    "--blink": `${(3.2 + (seed % 37) / 10).toFixed(1)}s`,
    "--blink-delay": `${-((seed >> 3) % 50) / 10}s`,
    "--breath": `${(3.4 + ((seed >> 5) % 12) / 10).toFixed(1)}s`,
    "--sway-delay": `${-((seed >> 7) % 30) / 10}s`,
  } as CSSProperties;
  const body = (
    <>
      {shape.extra?.map((c) => (
        <circle key={c.cx} cx={c.cx} cy={c.cy} r={c.r} />
      ))}
      <path d={shape.d} />
    </>
  );

  return (
    <svg
      ref={ref}
      className={`mascot m-${kind ?? "still"} mood-${mood}${boop ? " m-boop" : ""}${cheering ? " m-cheer" : ""}`}
      style={rhythm}
      width={size}
      height={size}
      viewBox="-4 -4 108 108"
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label ? agent.name : undefined}
      onPointerDown={() => setBoop((n) => n + 1)}
      onAnimationEnd={(e) => e.animationName === "m-boop" && setBoop(0)}
    >
      <defs>
        <radialGradient id={`g${uid}`} cx="34%" cy="28%" r="80%">
          <stop offset="0%" stopColor={mix(spec.color, 255, 0.45)} />
          <stop offset="45%" stopColor={spec.color} />
          <stop offset="100%" stopColor={mix(spec.color, 0, 0.38)} />
        </radialGradient>
        <radialGradient id={`h${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff" stopOpacity=".75" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`s${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000" stopOpacity=".24" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`d${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000" stopOpacity=".32" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`c${uid}`}>{body}</clipPath>
      </defs>

      <ellipse className="m-shadow" cx="50" cy="93.5" rx="31" ry="5.5" fill={`url(#d${uid})`} />
      <g className="m-rig">
        <g className="m-squash">
          {/* A smooth body: a thin darker outline drawn behind the fill, so only its outer edge shows (no seams
              where the frog's eyes meet its body), then the lit fill. */}
          <g className="m-outline" fill={outline} stroke={outline} strokeWidth={fuzzy ? 2.6 : 3.4} strokeLinejoin="round">
            {body}
          </g>
          <g className="m-body" fill={fill}>
            {body}
          </g>
          {/* Light: a soft highlight top-left, a shaded belly bottom-right. */}
          <g clipPath={`url(#c${uid})`} pointerEvents="none">
            <ellipse cx="36" cy={shape.top + 14} rx="20" ry="13" fill={`url(#h${uid})`} opacity=".75" />
            <ellipse cx="60" cy="94" rx="52" ry="30" fill={`url(#s${uid})`} />
          </g>
          {HATS.has(spec.accessory) && <Accessory kind={spec.accessory} shape={shape} />}
          <g className="m-face">
            <g className="m-cheeks" fill="#ff8fa3">
              <ellipse cx={50 - shape.dx - 8} cy={shape.mouthY - 2} rx="5" ry="3" />
              <ellipse cx={50 + shape.dx + 8} cy={shape.mouthY - 2} rx="5" ry="3" />
            </g>
            <Eyes shape={shape} style={spec.accessory === "sunglasses" ? "hidden" : spec.eyes} mood={mood} />
            <Mouth shape={shape} mood={mood} />
            {!HATS.has(spec.accessory) && <Accessory kind={spec.accessory} shape={shape} />}
          </g>
          {boop > 0 && big && (
            <path key={boop} className="m-heart" d="M50 14 C46 8 38 10 40 17 C41 21 50 26 50 26 C50 26 59 21 60 17 C62 10 54 8 50 14 Z" fill="#ff5d8f" />
          )}
        </g>
        <Extras shape={shape} mood={mood} big={big && fuzzy} seed={seed} />
      </g>
    </svg>
  );
}
