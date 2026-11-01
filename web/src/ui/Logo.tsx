import { useId } from "react";

/**
 * The Agent Fleet mark: a chick (the lead) in front of a cat and a bunny peeking from behind — a small fleet of the
 * dashboard's mascots — on a dark tile with a star. The same drawing as `public/favicon.svg` and `docs/media/logo.svg`.
 */
export function Logo({ className, size }: { className?: string; size?: number }) {
  const id = useId().replace(/:/g, "");
  const line = { stroke: "#0e1118", strokeOpacity: 0.55, strokeWidth: 1.2, strokeLinejoin: "round" } as const;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#262d3d" />
          <stop offset="1" stopColor="#121621" />
        </linearGradient>
        <radialGradient id={`${id}g`} cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset=".5" stopColor="#f7b731" />
          <stop offset="1" stopColor="#d98a12" />
        </radialGradient>
        <radialGradient id={`${id}b`} cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor="#9cc0ff" />
          <stop offset=".55" stopColor="#4f8cff" />
          <stop offset="1" stopColor="#2b5fc4" />
        </radialGradient>
        <radialGradient id={`${id}p`} cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor="#ffb3bb" />
          <stop offset=".55" stopColor="#ff6b7a" />
          <stop offset="1" stopColor="#d43f52" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill={`url(#${id}t)`} />
      <rect x="2.5" y="2.5" width="59" height="59" rx="15.5" fill="none" stroke="#fff" strokeOpacity=".08" />
      <path className="logo-star" d="M51 9 L52.3 12.7 L56 14 L52.3 15.3 L51 19 L49.7 15.3 L46 14 L49.7 12.7 Z" fill="#ffd166" />
      <circle cx="13" cy="15" r="1.4" fill="#ffd166" opacity=".7" />
      <ellipse cx="32" cy="58.5" rx="24" ry="2.6" fill="#000" opacity=".35" />
      <g {...line}>
        <path d="M5.6 39 Q4 28 8 23.5 Q12.6 26.5 14 33.5 Z M24.4 39 Q26 28 22 23.5 Q17.4 26.5 16 33.5 Z" fill="#4f8cff" />
        <circle cx="15" cy="43" r="10.5" fill={`url(#${id}b)`} />
        <ellipse cx="44.5" cy="27" rx="3.2" ry="8.5" transform="rotate(-10 44.5 27)" fill="#ff6b7a" />
        <ellipse cx="53.5" cy="27" rx="3.2" ry="8.5" transform="rotate(10 53.5 27)" fill="#ff6b7a" />
        <circle cx="49" cy="43" r="10.5" fill={`url(#${id}p)`} />
      </g>
      <path d="M7.6 34 Q7 29 8.8 26.6 Q11.4 28.6 12.2 32 Z M22.4 34 Q23 29 21.2 26.6 Q18.6 28.6 17.8 32 Z" fill="#ffc2cc" opacity=".85" />
      <ellipse cx="44.5" cy="28" rx="1.4" ry="5.5" transform="rotate(-10 44.5 28)" fill="#ffc2cc" />
      <ellipse cx="53.5" cy="28" rx="1.4" ry="5.5" transform="rotate(10 53.5 28)" fill="#ffc2cc" />
      <g fill="#16161a">
        <circle cx="10.5" cy="42" r="1.7" />
        <circle cx="53.5" cy="42" r="1.7" />
      </g>
      <g fill="#ff8fa3" opacity=".7">
        <ellipse cx="8" cy="46.5" rx="2.2" ry="1.4" />
        <ellipse cx="56" cy="46.5" rx="2.2" ry="1.4" />
      </g>
      <g {...line}>
        <path d="M30 34 C27.5 27.5 31 24 33.7 25.6 C32.6 27.7 34.8 28.8 36.4 26 C37.6 30.4 35.2 33.6 33 34.2 Z" fill="#f7b731" />
        <ellipse cx="32" cy="46" rx="14" ry="13" fill={`url(#${id}g)`} />
      </g>
      <ellipse cx="27" cy="38.5" rx="5" ry="3" fill="#fff" opacity=".35" />
      <g className="logo-eyes" fill="#16161a">
        <ellipse cx="26.6" cy="44.5" rx="2.5" ry="3.2" />
        <ellipse cx="37.4" cy="44.5" rx="2.5" ry="3.2" />
      </g>
      <g fill="#fff">
        <circle cx="27.5" cy="43.3" r="1" />
        <circle cx="38.3" cy="43.3" r="1" />
      </g>
      <g fill="#ff8fa3" opacity=".75">
        <ellipse cx="22.5" cy="49.5" rx="2.8" ry="1.7" />
        <ellipse cx="41.5" cy="49.5" rx="2.8" ry="1.7" />
      </g>
      <path d="M29.6 48.4 L34.4 48.4 L32 51.6 Z" fill="#ff9f1c" stroke="#d9770b" strokeWidth=".8" strokeLinejoin="round" />
    </svg>
  );
}
