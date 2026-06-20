import type { ReactNode } from "react"
import { CONTRASTS } from "../data"

const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }

const ICONS: Record<string, ReactNode> = {
  capital: (<svg viewBox="0 0 24 24" {...s} aria-hidden="true"><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>),
  momentum: (<svg viewBox="0 0 24 24" {...s} aria-hidden="true"><path d="M3 17l6-6 4 4 7-7" /><path d="M17 7h4v4" /></svg>),
  people: (<svg viewBox="0 0 24 24" {...s} aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5.5a3 3 0 0 1 0 5.5" /><path d="M21 20a6 6 0 0 0-4-5.6" /></svg>),
  direction: (<svg viewBox="0 0 24 24" {...s} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></svg>),
}

export function Statement() {
  return (
    <section className="section statement" aria-label="Why Arcova is different">
      <div className="wrap">
        <div className="stmt-eyebrow reveal"><span className="eyebrow on-dark">Prioritization, scored</span></div>
        <p className="big reveal">Other tools list the signals.<br /><span className="hl">Arcova scores who&rsquo;s ready to buy.</span></p>
        <p className="stmt-sub reveal">Every signal below feeds a live readiness score, so your market arrives ranked, with the highest-intent accounts already at the top of your day.</p>

        <div className="contrasts">
          {CONTRASTS.map((c) => (
            <div className="sigcat reveal" key={c.key}>
              <div className="sigcat-head">
                <span className="cx-i">{ICONS[c.key]}</span>
                <div className="sigcat-tt">
                  <h4>{c.title}</h4>
                  <span className="sigcat-sub">{c.sub}</span>
                </div>
              </div>
              <ul className="sigcat-list">
                {c.items.map((it) => <li key={it}>{it}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
