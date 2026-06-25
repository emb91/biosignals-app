export function Bento() {
  return (
    <section className="section" id="why" aria-label="What you get" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="section-head reveal">
          <span className="eyebrow">The Arcova Engine</span>
          <h2 className="h2" style={{ marginTop: 18 }}>
            Intelligence behind every <span className="grad">priority.</span>
          </h2>
          <p className="lead">
            We don&apos;t just enrich a list of leads. Our agents determine customer fit, track their readiness, and rank your priorities, turning each important moment into an outbound sequence your reps can send.
          </p>
        </div>

        <div className="bento">
          {/* 1 Fit */}
          <div className="cell half fit-wide reveal">
            <span className="ck">1 · Fit</span>
            <h3>Deeper than firmographics.</h3>
            <p>Use life science context to find high-fit accounts your team should work.</p>
            <div className="media">
              <div className="acctcard">
                <div className="ac-rows">
                  <div className="ac-row"><span className="ac-k">Company type</span><span className="ac-pills"><span className="chip teal">Biopharma</span></span></div>
                  <div className="ac-row"><span className="ac-k">Therapeutic areas</span><span className="ac-pills"><span className="chip teal">Oncology</span><span className="chip teal">Haematology</span></span></div>
                  <div className="ac-row"><span className="ac-k">Modalities</span><span className="ac-pills"><span className="chip teal">Cell Therapy</span><span className="chip teal">CAR-T</span></span></div>
                  <div className="ac-row"><span className="ac-k">Development stage</span><span className="ac-pills"><span className="chip teal">Phase I</span><span className="chip teal">Phase II</span></span></div>
                </div>
              </div>
            </div>
          </div>

          {/* 2 Readiness (dark) */}
          <div className="cell half dark read-narrow reveal">
            <span className="ck">2 · Readiness</span>
            <h3>Sharper than saved searches.</h3>
            <p>Track the changes that matter across accounts, contacts and market signals to surface reasons to reach out.</p>
            <div className="watch">
              <div className="watch-top">
                <span className="watch-live"><span className="wd" />Live</span>
                <span className="watch-time">Last swept 04:12</span>
              </div>
              <div className="watch-rows">
                <div className="sigrow">
                  <span className="sig-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" /></svg></span>
                  <div className="sig-tx"><div className="sig-line"><b>Aravelle Bio</b> · Funding · Series B, $80M</div><div className="sig-ago">1w ago</div></div>
                </div>
                <div className="sigrow">
                  <span className="sig-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" /></svg></span>
                  <div className="sig-tx"><div className="sig-line"><b>Seaport Therapeutics</b> · Clinical trial · Phase III registered</div><div className="sig-ago">1w ago</div></div>
                </div>
                <div className="sigrow">
                  <span className="sig-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" /></svg></span>
                  <div className="sig-tx"><div className="sig-line"><b>Illumina</b> · Hiring expansion · 54 open roles</div><div className="sig-ago">1w ago</div></div>
                </div>
              </div>
              <div className="watch-bar"><i /></div>
            </div>
          </div>

          {/* 3 Priority */}
          <div className="cell small reveal">
            <span className="ck">3 · Priority</span>
            <h3>Smarter than static scoring.</h3>
            <p>Accounts are continuously scored as the market, CRM, and relationship context change.</p>
            <div className="media">
              <div className="pscore">
                <div className="pscore-ring">
                  <svg viewBox="0 0 120 120">
                    <circle className="pr-track" cx="60" cy="60" r="52" />
                    <circle className="pr-arc" cx="60" cy="60" r="52" />
                  </svg>
                  <div className="pscore-num"><span id="pscore-n">89</span></div>
                </div>
                <div className="pscore-label">Priority score</div>
              </div>
            </div>
          </div>

          {/* 4 Engagement (wide) */}
          <div className="cell big reveal">
            <span className="ck">4 · Engagement</span>
            <h3>Stronger than one-off outreach.</h3>
            <p>Turn each priority into sequences, grounded in the account, contact, signal and reason to reach out.</p>
            <div className="media">
              <div className="draftbox" id="seqbox">
                <div className="db-head">
                  <span className="db-seq"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M4 12h16M4 17h10" /></svg>Outreach sequence</span>
                  <span className="db-chan" id="seq-chan">Day 1 · Email</span>
                </div>
                <div className="db-dots" id="seq-dots"><i className="on" /><i /><i /><i /><i /><i /></div>
                <div className="db-anim">
                  <div className="db-subject" id="seq-subject">Labs ready to buy</div>
                  <div className="db-body" id="seq-body">Hi Andrea, hope you don&apos;t mind me reaching out to you cold, but I do know that it can be hard to know which prospects are ready to buy, and it&apos;s something we do really well.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
