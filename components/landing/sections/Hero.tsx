export function Hero() {
  return (
    <header className="hero" id="top">
      <div className="hero-grid" />
      <div className="hero-glow" />
      <div className="wrap hero-in">
        <h1 className="display">
          The revenue engine built for <span className="hl">life sciences.</span>
        </h1>
        <p className="lead">
          Arcova watches your market, ranks the accounts worth working, and drafts the outreach. You just hit send.
        </p>
        <div className="hero-cta">
          <form className="hero-form" action="/signup" method="get">
            <span className="hero-form-ic" aria-hidden="true"><span className="hero-form-live" /></span>
            <input className="hero-input" type="text" name="domain" placeholder="Enter your company to map your market" aria-label="Company domain" />
            <button type="submit" className="hero-go" aria-label="Map your market">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 2L11 13" />
                <path d="M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          </form>
          <a className="hero-demo" href="/contact-us">
            or Book a demo
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </a>
        </div>
      </div>

      {/* Command center — the real /today view */}
      <div className="cc-stage" aria-hidden="true">
        <div className="cc-float">
          <span className="fi">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 12V3a9 9 0 1 0 9 9" />
              <circle cx="12" cy="12" r="4" />
            </svg>
          </span>
          <div>
            <div className="fl">New signal</div>
            <div className="ft">Aravelle Bio</div>
            <div className="fd">Clinical Trial registered</div>
          </div>
        </div>

        <div className="cc-frame">
          <div className="cc-bar">
            <span className="d" />
            <span className="d" />
            <span className="d" />
            <span className="addr">app.arcova.bio/today</span>
          </div>
          <div className="cc-body">
            <div className="tdy">
              <div className="tdy-eyebrow" id="tdy-date">Daily briefing · Thursday, 18 June</div>
              <div className="tdy-title">
                <span className="greet" id="tdy-greet">Good evening</span>, <span className="ac">Maya</span>
              </div>
              <div className="tdy-sub">Here&apos;s your day. Work through your priorities, or talk it through with the agent.</div>

              <div className="tdy-grid">
                {/* Agent column */}
                <section className="tile tdy-agent">
                  <div className="ag-meta">
                    <span className="ag-status"><span className="ag-dot" />Agent · ready</span>
                    <span className="ag-time" id="ag-time">20:00 local</span>
                  </div>
                  <div className="ag-orbwrap">
                    <span className="ag-ring" />
                    <span className="ag-ring" />
                    <span className="ag-ring" />
                    <div className="ag-orb"><span className="ag-orb-shine" /></div>
                  </div>
                  <div className="ag-foot">
                    <div className="ag-bubble"><b>25 accounts moved overnight.</b> Do you already know what you&apos;d like to work on, or shall I suggest a good place to start?</div>
                    <div className="ag-chips">
                      <span className="ag-chip">+ Suggest where to start</span>
                      <span className="ag-chip">+ Summarise overnight</span>
                      <span className="ag-chip">+ Just the top lead</span>
                    </div>
                    <div className="ag-input">
                      <span className="ag-spark">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
                          <path d="M18.5 14l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6z" />
                        </svg>
                      </span>
                      <span className="ag-ph">Ask anything…</span>
                      <span className="ag-send muted">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 3L10.5 13.5" />
                          <path d="M21 3l-6.6 18-3.9-8.1L2.4 9z" />
                        </svg>
                        Send
                      </span>
                    </div>
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
                    <div className="pr-row"><span className="pr-num">1</span><div className="pr-body"><div className="pr-t">Send a staged outreach sequence</div><div className="pr-d">Drafted &amp; ready · Priya Raman</div></div><span className="pr-cta">Open ›</span></div>
                    <div className="pr-row"><span className="pr-num">2</span><div className="pr-body"><div className="pr-t">Review new contacts</div><div className="pr-d">Import finished · 142 ready</div></div><span className="pr-cta">Open ›</span></div>
                    <div className="pr-row"><span className="pr-num">3</span><div className="pr-body"><div className="pr-t">Work the best leads</div><div className="pr-d">5 high-fit contacts ready</div></div><span className="pr-cta">Review ›</span></div>
                    <div className="pr-row"><span className="pr-num">4</span><div className="pr-body"><div className="pr-t">Review 2 new accounts</div><div className="pr-d">Recently added: Vir Biotechnology, Inc., Guardant Health</div></div><span className="pr-cta">Review ›</span></div>
                    <div className="pr-row"><span className="pr-num">5</span><div className="pr-body"><div className="pr-t">Check CRM sync</div><div className="pr-d">2 need attention</div></div><span className="pr-cta">Open ›</span></div>
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
