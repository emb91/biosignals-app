import Image from "next/image"
import { FOOTER_COLS } from "../data"

const HREFS: Record<string, string> = {
  "How it works": "#how",
  "Why Arcova": "#why",
  Pricing: "#pricing",
  Privacy: "/privacy",
  Terms: "/terms",
  Contact: "/contact-us",
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-top">
          <div className="foot-brand">
            <Image src="/arcova-wordmark.png" alt="Arcova" width={120} height={30} style={{ height: 30, width: "auto" }} />
            <p>The AI-native revenue engine for life science. Your whole market, watched and ranked.</p>
          </div>
          {FOOTER_COLS.map((col) => (
            <div className="foot-col" key={col.h}>
              <h5>{col.h}</h5>
              {col.links.map((l) => (
                <a key={l} href={HREFS[l] ?? "#"}>{l}</a>
              ))}
            </div>
          ))}
        </div>
        <div className="foot-bottom">
          <span className="cr">© 2026 Arcova. All rights reserved.</span>
          <span className="tag">Your market, watched and ranked.</span>
        </div>
      </div>
    </footer>
  )
}
