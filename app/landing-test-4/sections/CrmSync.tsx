import { Eyebrow, CheckIcon } from "../components/primitives"
import { CRM_CHECKS } from "../data"

export function CrmSync() {
  return (
    <section className="pad" aria-label="Works where you work">
      <div className="wrap crm">
        <div className="reveal">
          <Eyebrow>Works where you work</Eyebrow>
          <h2 className="section-title" style={{ fontSize: "clamp(1.8rem,1.2rem+2vw,2.6rem)" }}>
            The intelligence lives where your team already works.
          </h2>
          <p style={{ marginTop: 18, fontSize: "1.08rem", lineHeight: 1.6, color: "var(--ink-soft)", maxWidth: "46ch", textWrap: "pretty" }}>
            Your reps work best inside Arcova, but every score, signal and enriched contact also flows back to your CRM and outreach tools automatically. Nothing to re-key, nothing to keep in sync by hand.
          </p>
          <div className="crm-checks">
            {CRM_CHECKS.map((c) => (
              <div className="crm-check" key={c}>
                <span className="ck"><CheckIcon /></span>
                {c}
              </div>
            ))}
          </div>
        </div>

        <div className="crm-panelwrap reveal">
          <div className="crm-glow" style={{ position: "relative" }}>
            <div className="panel">
              <div className="panel-top">
                <div>
                  <div className="panel-kick">Contact · synced</div>
                  <div className="panel-name">Sarah Chen</div>
                </div>
                <div className="panel-av">SC</div>
              </div>
              <div className="panel-tabs">
                <span className="t">Contact</span>
                <span className="t">Fit</span>
                <span className="t">Priority</span>
                <span className="t on">CRM</span>
                <span className="t">Signals</span>
              </div>
              <div className="panel-card">
                <div className="ch">Arcova → CRM</div>
                <div className="kv">
                  <span className="k">Fit score</span><span className="v teal">94 · High fit</span>
                  <span className="k">Readiness</span><span className="v teal">88 · Buying window</span>
                  <span className="k">Priority rank</span><span className="v">#1 this week</span>
                  <span className="k">Last signal</span><span className="v">Series B · 2h ago</span>
                </div>
              </div>
              <div className="panel-card">
                <div className="ch">Enrichment <span className="sync">SYNCED</span></div>
                <div className="kv">
                  <span className="k">Verified email</span><span className="v link">s.chen@helixdx.com</span>
                  <span className="k">Pushed to</span><span className="v">CRM · Outreach</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
