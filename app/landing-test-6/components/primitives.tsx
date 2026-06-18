/**
 * Primitives for the Arcova landing page (variant 6).
 * Presentational only; styled by ./landing.css (scoped #lt6).
 */
import type { ReactNode } from "react"

export function ArrowIcon({ size = 17 }: { size?: number }) {
  return (
    <svg className="arr" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

export function CheckIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

export function Mark({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`mark ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 5l7 13H5z" fill="currentColor" />
      </svg>
    </span>
  )
}

export function Eyebrow({ children, onDark = false }: { children: ReactNode; onDark?: boolean }) {
  return <span className={`eyebrow${onDark ? " on-dark" : ""}`}>{children}</span>
}

type ButtonVariant = "primary" | "ghost" | "dark" | "soft"

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

const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }

export const Icons: Record<string, ReactNode> = {
  bolt: (<svg viewBox="0 0 24 24" {...s} aria-hidden="true"><path d="M13 2L4 14h6l-1 8 9-12h-6z" /></svg>),
  radar: (<svg viewBox="0 0 24 24" {...s} aria-hidden="true"><path d="M12 12V3a9 9 0 1 0 9 9" /><circle cx="12" cy="12" r="4" /></svg>),
  pen: (<svg viewBox="0 0 24 24" {...s} aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>),
  target: (<svg viewBox="0 0 24 24" {...s} aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /></svg>),
  refresh: (<svg viewBox="0 0 24 24" {...s} aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg>),
  globe: (<svg viewBox="0 0 24 24" {...s} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>),
  brain: (<svg viewBox="0 0 24 24" {...s} aria-hidden="true"><path d="M9 3a3 3 0 0 0-3 3 3 3 0 0 0-1 5 3 3 0 0 0 2 5 3 3 0 0 0 5 1V4a3 3 0 0 0-3-1z" /><path d="M15 3a3 3 0 0 1 3 3 3 3 0 0 1 1 5 3 3 0 0 1-2 5 3 3 0 0 1-5 1" /></svg>),
  send: (<svg viewBox="0 0 24 24" {...s} aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></svg>),
}
