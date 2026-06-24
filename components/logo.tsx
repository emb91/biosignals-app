import Link from "next/link"
import { ArcovaMark, type ArcovaVariant } from "@/components/brand/ArcovaMark"
import { ArcovaOrb } from "@/components/brand/ArcovaOrb"
import { ArcovaEclipse } from "@/components/brand/ArcovaEclipse"

type BadgeBg = "navy" | "white" | "none"
type MarkShape = "bars" | "orb" | "eclipse"
// the mark's art bounding box, centred — avoids the bars sitting low in the squircle
const MARK_BOX = "12 17 96 96"

interface LogoProps {
  variant?: "full" | "icon"
  /** Height of the icon badge in px. Wordmark scales from this. */
  size?: number
  className?: string
  /** Mark gradient; defaults to the teal-to-pink primary. */
  mark?: ArcovaVariant
  /** Squircle background. Navy is the default app icon; white is the lighter landing treatment. */
  badge?: BadgeBg
  /** Mark artwork: the five bars (default) or the live orb. */
  shape?: MarkShape
}

/** The Arcova app-icon badge: teal-to-pink mark on a navy or white squircle. */
function Badge({ size, mark = "teal-pink", bg = "navy", shape = "bars" }: { size: number; mark?: ArcovaVariant; bg?: BadgeBg; shape?: MarkShape }) {
  const white = bg === "white"
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-grid",
        placeItems: "center",
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: white ? "#ffffff" : "#003344",
        border: white ? "1px solid rgba(13,53,71,0.08)" : undefined,
        boxShadow: white ? "0 1px 2px rgba(13,53,71,.06), 0 6px 16px -8px rgba(13,53,71,.18)" : undefined,
        flex: "none",
      }}
    >
      {shape === "orb" ? (
        <ArcovaOrb size={Math.round(size * 0.92)} />
      ) : shape === "eclipse" ? (
        <ArcovaEclipse size={Math.round(size * 0.82)} />
      ) : (
        <ArcovaMark variant={mark} size={Math.round(size * 0.66)} viewBox={MARK_BOX} />
      )}
    </span>
  )
}

/**
 * Arcova logo. `full` = badge + "arcova" wordmark (Quicksand, inherits text
 * colour via currentColor). `icon` = the navy badge alone.
 */
export function Logo({ variant = "full", size = 36, className = "", mark = "teal-pink", badge = "navy", shape = "bars" }: LogoProps) {
  const markEl =
    badge === "none" ? (
      shape === "orb" ? (
        <ArcovaOrb size={Math.round(size * 1.04)} />
      ) : shape === "eclipse" ? (
        <ArcovaEclipse size={Math.round(size * 1.04)} />
      ) : (
        <ArcovaMark variant={mark} size={Math.round(size * 1.04)} viewBox={MARK_BOX} />
      )
    ) : (
      <Badge size={size} mark={mark} bg={badge} shape={shape} />
    )

  if (variant === "icon") {
    return (
      <span className={className} role="img" aria-label="Arcova" style={{ display: "inline-flex" }}>
        {markEl}
      </span>
    )
  }
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * (badge === "none" ? 0.2 : 0.28)) }}>
      {markEl}
      <span
        style={{
          fontFamily: "var(--font-quicksand), system-ui, sans-serif",
          fontWeight: 500,
          fontSize: Math.round(size * 0.6),
          letterSpacing: "-0.01em",
          color: "currentColor",
          lineHeight: 1,
        }}
      >
        arcova
      </span>
    </span>
  )
}

export function LogoLink({ variant = "full", size, className = "", mark, badge, shape }: LogoProps) {
  return (
    <Link href="/" className={className} aria-label="Arcova home" style={{ color: "inherit", textDecoration: "none" }}>
      <Logo variant={variant} size={size} mark={mark} badge={badge} shape={shape} />
    </Link>
  )
}
