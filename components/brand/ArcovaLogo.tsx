"use client"

import { ArcovaMark, type ArcovaVariant } from "./ArcovaMark"

/**
 * Horizontal Arcova lockup: the mark + the "arcova" wordmark in Quicksand.
 * The wordmark colour follows `tone` (defaults to ink for light backgrounds;
 * use "light" on dark backgrounds). Mark defaults to the teal-to-pink primary.
 *
 * Requires the --font-quicksand variable (loaded globally in app/layout.tsx).
 */
export function ArcovaLogo({
  variant = "teal-pink",
  tone = "ink",
  size = 30,
  className,
}: {
  variant?: ArcovaVariant
  tone?: "ink" | "light"
  size?: number
  className?: string
}) {
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.18) }}
    >
      <ArcovaMark variant={variant} size={size} />
      <span
        style={{
          fontFamily: "var(--font-quicksand), system-ui, sans-serif",
          fontWeight: 500,
          fontSize: Math.round(size * 0.82),
          letterSpacing: "-0.01em",
          color: tone === "light" ? "#ffffff" : "#0d3547",
          lineHeight: 1,
        }}
      >
        arcova
      </span>
    </span>
  )
}
