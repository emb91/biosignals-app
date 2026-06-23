const SRC_ARROW = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 17L17 7M9 7h8v8" />
  </svg>
)

export function Signals() {
  return (
    <section className="section sigsec" id="signals" aria-label="Signals Arcova tracks">
      <div className="wrap">
        <div className="section-head center reveal">
          <span className="eyebrow">Signals Arcova tracks</span>
          <h2 className="h2" style={{ marginTop: 18 }}>
            Every priority starts with a <span className="grad">change.</span>
          </h2>
          <p className="lead">
            Arcova watches 40+ life science signals, then matches them to the accounts and contacts your team can act on.
          </p>
        </div>

        <div className="sig-grid reveal">
          {/* LEFT — the signal universe */}
          <div className="sig-universe">
            <div className="su-head">
              <div className="su-stat">
                <span className="su-num">40+</span>
                <span className="su-htext">
                  <span className="su-htitle">Life science signals</span>
                  <span className="su-hsub">Tracked out of the box</span>
                </span>
              </div>
              <span className="su-live"><i />Live</span>
            </div>
            <div className="su-catlabel">Signal categories</div>
            <div className="su-lanes">
              <div className="su-lane">
                <span className="su-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg></span>
                <span className="su-lane-tt"><span className="su-name">Capital</span><span className="su-ex">Funding rounds · IPOs · grants · milestones</span></span>
              </div>
              <div className="su-lane">
                <span className="su-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 7-7" /><path d="M17 7h4v4" /></svg></span>
                <span className="su-lane-tt"><span className="su-name">Clinical</span><span className="su-ex">Trial starts · phase changes · new sites &amp; indications</span></span>
              </div>
              <div className="su-lane is-live live-green">
                <span className="su-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3 4-3 9-3 9 1.34 9 3z" /><path d="M12 3v6M12 15v6" /></svg></span>
                <span className="su-lane-tt"><span className="su-name">Regulatory</span><span className="su-ex">FDA approvals · Fast Track · Breakthrough · Priority Review</span></span>
                <span className="su-pulse" />
              </div>
              <div className="su-lane is-live live-amber">
                <span className="su-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h4" /></svg></span>
                <span className="su-lane-tt"><span className="su-name">IP &amp; research</span><span className="su-ex">Patents · applications · portfolio · publications</span></span>
                <span className="su-pulse" />
              </div>
              <div className="su-lane is-live live-teal">
                <span className="su-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5.5a3 3 0 0 1 0 5.5" /><path d="M21 20a6 6 0 0 0-4-5.6" /></svg></span>
                <span className="su-lane-tt"><span className="su-name">People &amp; hiring</span><span className="su-ex">New roles · promotions · job moves</span></span>
                <span className="su-pulse" />
              </div>
              <div className="su-lane">
                <span className="su-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5" /><path d="M21 3l-7 7" /><path d="M8 21H3v-5" /><path d="M3 21l7-7" /></svg></span>
                <span className="su-lane-tt"><span className="su-name">Deals &amp; direction</span><span className="su-ex">Partnerships · licensing · M&amp;A</span></span>
              </div>
              <div className="su-lane">
                <span className="su-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" /><path d="M9 9v.01M9 13v.01M9 17v.01" /></svg></span>
                <span className="su-lane-tt"><span className="su-name">Facilities</span><span className="su-ex">New sites · manufacturing expansion</span></span>
              </div>
            </div>

            <div className="su-custom">
              <span className="su-custom-title">Custom signals</span>
              <span className="su-custom-ex">Website visits · Demo requests · Events · Outreach replies</span>
            </div>
          </div>

          {/* RIGHT — contacts product view */}
          <div className="sig-product">
            <div className="sp-bar"><span className="d" /><span className="d" /><span className="d" /><span className="addr">app.arcova.bio/contacts</span></div>
            <div className="sp-body">
              <div className="sp-head">
                <span className="sp-eyebrow" />
                <div className="sp-title">Ranked contacts</div>
                <div className="sp-sub">Sorted by priority score <span className="sp-sort"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M6 15l6 6 6-6" /></svg></span></div>
              </div>
              <div className="sp-list">
                {/* Sofia — unfolded */}
                <div className="sp-expanded">
                  <div className="sp-exp-head">
                    <span className="sp-chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M6 15l6-6 6 6" /></svg></span>
                    <span className="sp-id"><span className="sp-nm">Sofia Lindqvist</span><span className="sp-job">Illumina</span></span>
                    <span className="sp-donut"><svg viewBox="0 0 36 36"><circle className="trk" cx="18" cy="18" r="15" fill="none" strokeWidth={3} /><circle className="fl" cx="18" cy="18" r="15" fill="none" stroke="#00a4b4" strokeWidth={3} strokeDasharray="94.2" strokeDashoffset="10.4" /></svg><span className="n">89</span></span>
                    <span className="sp-act send">Send outreach</span>
                  </div>
                  <div className="sp-matched">
                    <div className="sp-matched-head"><span className="sp-matched-pulse" /><span className="sp-matched-label">Active signals</span><span className="sp-matched-rule" /></div>
                    <div className="sp-cards">
                      <div className="sp-card">
                        <div className="sp-card-top"><span className="sp-card-t">Hiring Expansion</span><span className="sp-card-dot teal" /><span className="sp-card-time">today</span></div>
                        <div className="sp-card-b">47 open roles across multiple functions — broad hiring expansion.</div>
                        <span className="sp-card-src">View source {SRC_ARROW}</span>
                      </div>
                      <div className="sp-card fda">
                        <div className="sp-card-top"><span className="sp-card-t">FDA Approval</span><span className="sp-card-dot green" /><span className="sp-card-time">3 days ago</span></div>
                        <div className="sp-card-b">PMA supplement approval for TruSight Oncology Comprehensive.</div>
                        <span className="sp-card-src">View source {SRC_ARROW}</span>
                      </div>
                      <div className="sp-card pub">
                        <div className="sp-card-top"><span className="sp-card-t">Publication</span><span className="sp-card-dot amber" /><span className="sp-card-time">2w ago</span></div>
                        <div className="sp-card-b">New peer-reviewed publication from the Illumina research group.</div>
                        <span className="sp-card-src">View source {SRC_ARROW}</span>
                      </div>
                    </div>
                  </div>
                </div>
                {/* more contacts, blurred */}
                <div className="sp-blur" aria-hidden="true">
                  <div className="sp-row">
                    <span className="sp-id"><span className="sp-nm">Priya Raman</span></span>
                    <span className="sp-co">Moderna</span>
                    <span className="sp-donut"><svg viewBox="0 0 36 36"><circle className="trk" cx="18" cy="18" r="15" fill="none" strokeWidth={3} /><circle className="fl" cx="18" cy="18" r="15" fill="none" stroke="#00a4b4" strokeWidth={3} strokeDasharray="94.2" strokeDashoffset="11.3" /></svg><span className="n">88</span></span>
                    <span className="sp-act reach">Reach out</span>
                  </div>
                  <div className="sp-row">
                    <span className="sp-id"><span className="sp-nm">Daniel Okafor</span></span>
                    <span className="sp-co">BioNTech</span>
                    <span className="sp-donut"><svg viewBox="0 0 36 36"><circle className="trk" cx="18" cy="18" r="15" fill="none" strokeWidth={3} /><circle className="fl" cx="18" cy="18" r="15" fill="none" stroke="#00a4b4" strokeWidth={3} strokeDasharray="94.2" strokeDashoffset="13.2" /></svg><span className="n">86</span></span>
                    <span className="sp-act reach">Reach out</span>
                  </div>
                  <div className="sp-row">
                    <span className="sp-id"><span className="sp-nm">Hannah Webb</span></span>
                    <span className="sp-co">Enzene Biosciences</span>
                    <span className="sp-donut"><svg viewBox="0 0 36 36"><circle className="trk" cx="18" cy="18" r="15" fill="none" strokeWidth={3} /><circle className="fl" cx="18" cy="18" r="15" fill="none" stroke="#c79330" strokeWidth={3} strokeDasharray="94.2" strokeDashoffset="26.4" /></svg><span className="n">72</span></span>
                    <span className="sp-act monitor">Monitor</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
