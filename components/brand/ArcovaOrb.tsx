"use client"

import { useId } from "react"

/**
 * Arcova "live orb" mark (lab candidate C5) — a glowing teal-to-pink sphere,
 * the same presence as the in-app agent. Self-contained: gradient + glow filter
 * ids are scoped per instance so multiple orbs can render on one page.
 */
export function ArcovaOrb({
  size = 28,
  className,
  title = "Arcova",
  viewBox = "0 0 120 120",
}: {
  size?: number
  className?: string
  title?: string
  viewBox?: string
}) {
  const uid = useId().replace(/:/g, "")
  const grad = `orb-${uid}`
  const glow = `orbglow-${uid}`
  const glowLg = `orbglowlg-${uid}`

  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={size}
      fill="none"
      className={className}
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <defs>
        <radialGradient id={grad} cx="38%" cy="34%" r="72%">
          <stop offset="0%" stopColor="#f1fbf8" />
          <stop offset="24%" stopColor="#7fd8cd" />
          <stop offset="62%" stopColor="#00a4b4" />
          <stop offset="100%" stopColor="#d98fb1" />
        </radialGradient>
        <filter id={glow} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3.4" />
        </filter>
        <filter id={glowLg} x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      <circle cx="60" cy="60" r="48" fill="#2fd0c6" opacity={0.4} filter={`url(#${glowLg})`} />
      <circle cx="60" cy="60" r="40" fill="#00a4b4" opacity={0.3} filter={`url(#${glow})`} />
      <circle cx="60" cy="60" r="36" fill={`url(#${grad})`} />
      <circle cx="46" cy="44" r="9" fill="#fff" opacity={0.85} />
    </svg>
  )
}
