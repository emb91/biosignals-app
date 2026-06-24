"use client"

import { useId } from "react"

/**
 * Arcova "eclipse" mark (lab candidate C6) — a teal-to-pink ring with a centre
 * orb and an offset bright arc. Self-contained: gradient ids are scoped per
 * instance so multiple marks can render on one page.
 */
export function ArcovaEclipse({
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
  const stroke = `ecl-stroke-${uid}`
  const orb = `ecl-orb-${uid}`

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
        <linearGradient id={stroke} gradientUnits="userSpaceOnUse" x1="26" y1="94" x2="94" y2="26">
          <stop offset="0" stopColor="#00a4b4" />
          <stop offset="0.44" stopColor="#46cabf" />
          <stop offset="0.74" stopColor="#b9acd9" />
          <stop offset="1" stopColor="#f3a9c2" />
        </linearGradient>
        <radialGradient id={orb} cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#f1fbf8" />
          <stop offset="22%" stopColor="#9fe1d3" />
          <stop offset="60%" stopColor="#00a4b4" />
          <stop offset="100%" stopColor="#00788a" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="34" fill="none" stroke={`url(#${stroke})`} strokeWidth={6} strokeLinecap="round" />
      <circle cx="60" cy="60" r="16" fill={`url(#${orb})`} />
      <circle cx="54.56" cy="53.6" r="3.84" fill="#fff" opacity={0.9} />
      <circle
        cx="60"
        cy="60"
        r="34"
        fill="none"
        stroke={`url(#${stroke})`}
        strokeWidth={6}
        strokeDasharray="40 200"
        strokeLinecap="round"
        transform="rotate(-35 60 60)"
      />
    </svg>
  )
}
