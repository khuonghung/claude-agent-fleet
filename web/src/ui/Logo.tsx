import { useId } from "react";

/**
 * The Agent Fleet mark: one arrow made of three layers — the lead at its tip, the members behind it — moving as one,
 * on a dark tile. The same drawing as `public/favicon.svg` and `docs/media/logo.svg`.
 */
export function Logo({ className, size }: { className?: string; size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#232b3b" />
          <stop offset="1" stopColor="#0e121a" />
        </linearGradient>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd56b" />
          <stop offset="1" stopColor="#ee9f1f" />
        </linearGradient>
        {/* The two cuts that split the arrow into layers. */}
        <mask id={`${id}m`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <path d="M14 33 L32 24 L50 33 M8 45 L32 33 L56 45" stroke="#000" strokeWidth="2.6" fill="none" />
        </mask>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="14" fill={`url(#${id}t)`} />
      <rect x="2.5" y="2.5" width="59" height="59" rx="13.5" fill="none" stroke="#fff" strokeOpacity=".08" />
      <g mask={`url(#${id}m)`} strokeWidth="1.4" strokeLinejoin="round">
        <path d="M17.6 40.2 L32 33 L46.4 40.2 L52 52 L32 42 L12 52 Z" fill="#8b96ab" stroke="#8b96ab" />
        <path d="M23.3 28.4 L32 24 L40.7 28.4 L46.4 40.2 L32 33 L17.6 40.2 Z" fill="#dfe5f0" stroke="#dfe5f0" />
        <path d="M32 10 L40.7 28.4 L32 24 L23.3 28.4 Z" fill={`url(#${id}l)`} stroke={`url(#${id}l)`} />
      </g>
    </svg>
  );
}
