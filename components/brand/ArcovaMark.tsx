"use client"

import { useId } from "react"

export type ArcovaVariant = "teal-pink" | "teal" | "white" | "navy"

const BARS = [
  "M16.5 94L16.5 73.5A7.5 7.5 0 0 1 31.5 73.5L31.5 94A4 4 0 0 1 27.5 98L20.5 98A4 4 0 0 1 16.5 94Z",
  "M34.5 94L34.5 51.5A7.5 7.5 0 0 1 49.5 51.5L49.5 94A4 4 0 0 1 45.5 98L38.5 98A4 4 0 0 1 34.5 94Z",
  "M52.5 94L52.5 39.5A7.5 7.5 0 0 1 67.5 39.5L67.5 94A4 4 0 0 1 63.5 98L56.5 98A4 4 0 0 1 52.5 94Z",
  "M70.5 94L70.5 51.5A7.5 7.5 0 0 1 85.5 51.5L85.5 94A4 4 0 0 1 81.5 98L74.5 98A4 4 0 0 1 70.5 94Z",
  "M88.5 94L88.5 73.5A7.5 7.5 0 0 1 103.5 73.5L103.5 94A4 4 0 0 1 99.5 98L92.5 98A4 4 0 0 1 88.5 94Z",
]

/**
 * Arcova brand mark — five bars tracing a soft triangle.
 * `teal-pink` is the primary website variant. `white` / `navy` are the
 * one-colour versions for monochrome contexts.
 */
export function ArcovaMark({
  variant = "teal-pink",
  size = 28,
  className,
  title = "Arcova",
  viewBox = "0 0 120 120",
}: {
  variant?: ArcovaVariant
  size?: number
  className?: string
  title?: string
  /** Override to crop tighter; the art's bounding box is roughly "12 17 96 96". */
  viewBox?: string
}) {
  const uid = useId().replace(/:/g, "")
  const gid = `arcova-${uid}`

  let fill: string
  if (variant === "white") fill = "#ffffff"
  else if (variant === "navy") fill = "#003344"
  else fill = `url(#${gid})`

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
      {variant === "teal-pink" && (
        <defs>
          <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="20" y1="98" x2="100" y2="28">
            <stop offset="0" stopColor="#00a4b4" />
            <stop offset="0.44" stopColor="#7fd8cd" />
            <stop offset="0.76" stopColor="#d8c6e6" />
            <stop offset="1" stopColor="#f6cdda" />
          </linearGradient>
        </defs>
      )}
      {variant === "teal" && (
        <defs>
          <linearGradient id={gid} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#006c79" />
            <stop offset="0.32" stopColor="#00a4b4" />
            <stop offset="0.62" stopColor="#2bbfb8" />
            <stop offset="0.84" stopColor="#7adfd2" />
            <stop offset="1" stopColor="#d6f7ef" stopOpacity="0.25" />
          </linearGradient>
        </defs>
      )}
      <g fill={fill}>
        {BARS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  )
}
