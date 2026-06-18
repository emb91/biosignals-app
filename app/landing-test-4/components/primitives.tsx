/**
 * Reusable primitives for the Arcova landing page (variant 4).
 * Plain, presentational building blocks styled by ./landing.css (scoped #lt4).
 */
import type { ReactNode } from "react"

/* ---------- icons (inline SVG, currentColor) ---------- */

export function ArrowIcon({ size = 17 }: { size?: number }) {
  return (
    <svg className="arr" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

export function CheckIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

export function SparkIcon() {
  return (
    <svg className="spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
    </svg>
  )
}

/** The Arcova mark — teal badge + upward white triangle. Scales/recolors cleanly. */
export function Mark({ size = 26, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`mark ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 5l7 13H5z" fill="currentColor" />
      </svg>
    </span>
  )
}

/* ---------- text / layout ---------- */

export function Eyebrow({ children, onDark = false }: { children: ReactNode; onDark?: boolean }) {
  return <p className={`eyebrow${onDark ? " on-dark" : ""}`}>{children}</p>
}

export function SectionTitle({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <h2 className="section-title" style={style}>
      {children}
    </h2>
  )
}

export function Chip({ children, teal = false }: { children: ReactNode; teal?: boolean }) {
  return <span className={`chip${teal ? " teal" : ""}`}>{children}</span>
}

/* ---------- button ---------- */

type ButtonVariant = "primary" | "ghost" | "dark" | "white" | "soft"

export function Button({
  children,
  variant = "primary",
  large = false,
  href = "#",
  className = "",
  withArrow = false,
}: {
  children: ReactNode
  variant?: ButtonVariant
  large?: boolean
  href?: string
  className?: string
  withArrow?: boolean
}) {
  return (
    <a className={`btn btn-${variant}${large ? " btn-lg" : ""} ${className}`} href={href}>
      {children}
      {withArrow && <ArrowIcon />}
    </a>
  )
}

/* ---------- priority ring (SVG donut + number) ---------- */

export function PriorityRing({ value }: { value: number }) {
  const r = 13
  const c = 2 * Math.PI * r
  const col = value >= 60 ? "var(--teal)" : value >= 40 ? "#e0922f" : "rgba(13,53,71,.32)"
  return (
    <span className="ring" role="img" aria-label={`Priority ${value} of 100`}>
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r={r} fill="none" stroke="rgba(13,53,71,.09)" strokeWidth="3" />
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          stroke={col}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
        />
      </svg>
      <span className="num">{value}</span>
    </span>
  )
}
