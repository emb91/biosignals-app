import { ArrowIcon } from "../components/primitives"
import { HERO } from "../data"

const PRIORITIES = [
  { t: "Send a staged outreach sequence", d: "Drafted & ready · Althea Fernandes", cta: "Open ›" },
  { t: "Review new contacts", d: "Import finished · 142 ready", cta: "Open ›" },
  { t: "Work the best leads", d: "5 high-fit contacts ready", cta: "Review ›" },
  { t: "Review enrichment failures", d: "Aisling Ogilvie", cta: "Re-enrich ›" },
  { t: "Check CRM sync", d: "2 need attention", cta: "Open ›" },
]

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

export function Hero() {
  return (
    <header className="hero" id="top">
      <div className="hero-grid" />
      <div className="hero-glow" />
      <div className="wrap hero-in">
        <span className="eyebrow">{HERO.eyebrow}</span>
        <h1 className="display">
          {HERO.headlineLead} <span className="hl">{HERO.headlineAccent}</span>
        </h1>
        <p className="lead">{HERO.sub}</p>
        <div className="hero-cta">
          <a className="btn btn-primary btn-lg" href="/signup">Start for free <ArrowIcon /></a>
          <a className="hero-demo" href="/contact-us">Book a demo<Chevron /></a>
        </div>
        <p className="hero-note">{HERO.note}</p>
      </div>

      {/* Command center — the /today view */}
      <div className="cc-stage" aria-hidden="true">
        <div className="cc-float">
          <span className="fi">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 12V3a9 9 0 1 0 9 9" /><circle cx="12" cy="12" r="4" /></svg>
          </span>
          <div>
            <div className="fl">New signal</div>
            <div className="ft">Aravelle Bio</div>
            <div className="fd">Series B closed · added to today</div>
          </div>
        </div>

        <div className="cc-frame">
          <div className="cc-bar">
            <span className="d" /><span className="d" /><span className="d" />
            <span className="addr">app.arcova.bio/today</span>
          </div>
          <div className="cc-body">
            <div className="tdy">
              <div className="tdy-eyebrow">Daily briefing · Thursday, 18 June</div>
              <div className="tdy-title">Good evening, <span className="ac">Maya</span></div>
              <div className="tdy-sub">Here&rsquo;s your day. Work through your priorities, or talk it through with the agent.</div>

              <div className="tdy-grid">
                {/* Agent column */}
                <section className="tile tdy-agent">
                  <div className="ag-meta">
                    <span className="ag-status"><span className="ag-dot" />Agent · ready</span>
                    <span className="ag-time">20:00 local</span>
                  </div>
                  <div className="ag-orbwrap"><div className="ag-orb" /></div>
                  <div className="ag-foot">
                    <div className="ag-bubble">Good evening, Maya. <b>25 accounts moved overnight.</b> Do you already know what you&rsquo;d like to work on, or shall I suggest a good place to start?</div>
                    <div className="ag-chips">
                      <span className="ag-chip">+ Suggest where to start</span>
                      <span className="ag-chip">+ Summarise overnight</span>
                      <span className="ag-chip">+ Just the top lead</span>
                    </div>
                    <div className="ag-input"><span className="ag-ph">Ask anything…</span><span className="ag-send">Send</span></div>
                  </div>
                </section>

                {/* Priorities column */}
                <section className="tile tdy-pri">
                  <div className="tile-head">
                    <div>
                      <div className="tile-eyebrow">Today</div>
                      <div className="tile-title">Priorities</div>
                    </div>
                    <span className="tile-pill"><b>0</b>/5</span>
                  </div>
                  <div className="pr-list">
                    {PRIORITIES.map((p, i) => (
                      <div className="pr-row" key={p.t}>
                        <span className="pr-num">{i + 1}</span>
                        <div className="pr-body">
                          <div className="pr-t">{p.t}</div>
                          <div className="pr-d">{p.d}</div>
                        </div>
                        <span className="pr-cta">{p.cta}</span>
                      </div>
                    ))}
                  </div>
                  <div className="pr-foot">5 left for today</div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
