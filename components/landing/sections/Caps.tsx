import type { ReactNode } from "react"
import { CAPS } from "../data"

const CAP_ICONS: Record<string, ReactNode> = {
  target: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3v3.4M12 17.6V21M3 12h3.4M17.6 12H21" />
    </svg>
  ),
  radar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 12V3a9 9 0 1 0 9 9" />
      <circle cx="12" cy="12" r="3.4" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 3L10.5 13.5" />
      <path d="M21 3l-6.6 18-3.9-8.1L2.4 9z" />
    </svg>
  ),
}

export function Caps() {
  return (
    <section className="section caps-section" aria-label="What Arcova does" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="caps reveal">
          {CAPS.map((cap) => (
            <div className="cap" key={cap.title}>
              <div className="cap-top">
                <span className="cap-c">{CAP_ICONS[cap.icon]}</span>
                <b>{cap.title}</b>
              </div>
              <span>{cap.body}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
