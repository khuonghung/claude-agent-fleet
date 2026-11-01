import { useId } from "react";

/**
 * The Agent Fleet mark: one soft arrow in three arched layers — the lead at its tip, the members behind it like stacked
 * wings — moving as one, on a rounded dark tile. The same drawing as `public/favicon.svg` and `docs/media/logo.svg`.
 */
export function Logo({ className, size }: { className?: string; size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#262f40" />
          <stop offset="1" stopColor="#10141d" />
        </linearGradient>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd977" />
          <stop offset="1" stopColor="#f0a42a" />
        </linearGradient>
        {/* One soft arrow: gently curved sides, rounded corners. */}
        <path id={`${id}a`} d="M32 9 Q38.5 24 52.5 51.5 Q42 42.5 32 40 Q22 42.5 11.5 51.5 Q25.5 24 32 9 Z" strokeWidth="4" strokeLinejoin="round" />
        {/* Its three layers, split along two arches. */}
        <clipPath id={`${id}c1`}>
          <path d="M0 0 H64 V36 H58 Q32 10 6 36 H0 Z" />
        </clipPath>
        <clipPath id={`${id}c2`}>
          <path d="M0 36 H6 Q32 10 58 36 H64 V50 H62 Q32 22 2 50 H0 Z" />
        </clipPath>
        <clipPath id={`${id}c3`}>
          <path d="M0 50 H2 Q32 22 62 50 H64 V64 H0 Z" />
        </clipPath>
        <mask id={`${id}m`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <path d="M6 36 Q32 10 58 36 M2 50 Q32 22 62 50" stroke="#000" strokeWidth="2.6" strokeLinecap="round" fill="none" />
        </mask>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="18" fill={`url(#${id}t)`} />
      <rect x="2.5" y="2.5" width="59" height="59" rx="17.5" fill="none" stroke="#fff" strokeOpacity=".08" />
      <g mask={`url(#${id}m)`}>
        <use href={`#${id}a`} clipPath={`url(#${id}c3)`} fill="#8b96ab" stroke="#8b96ab" />
        <use href={`#${id}a`} clipPath={`url(#${id}c2)`} fill="#e2e7f1" stroke="#e2e7f1" />
        <use href={`#${id}a`} clipPath={`url(#${id}c1)`} fill={`url(#${id}l)`} stroke={`url(#${id}l)`} />
      </g>
    </svg>
  );
}
