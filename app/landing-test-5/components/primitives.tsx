/**
 * Primitives for the Arcova landing page (variant 5).
 * Presentational only; styled by ./landing.css (scoped #lt5).
 */
import type { ReactNode } from "react"

export function ArrowIcon({ size = 17 }: { size?: number }) {
  return (
    <svg className="arr" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

export function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

export function MinusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" aria-hidden="true">
      <path d="M6 12h12" />
    </svg>
  )
}

/** Arcova mark — teal badge + upward white triangle. */
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

/* small inline icons used in steppers / frames */
export const Icons = {
  globe: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </svg>
  ),
  target: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </svg>
  ),
  radar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 12V3a9 9 0 1 0 9 9" /><circle cx="12" cy="12" r="4" />
    </svg>
  ),
  spark: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
    </svg>
  ),
}
