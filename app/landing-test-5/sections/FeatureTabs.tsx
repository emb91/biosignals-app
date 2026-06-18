"use client"

import { useState } from "react"
import { Eyebrow } from "../components/primitives"
import { FEATURES, type FeatureKey } from "../data"

function Panel({ k }: { k: FeatureKey }) {
  if (k === "target") {
    return (
      <div className="panel-fade" key="target">
        <div className="p-kicker">Ideal customer profile</div>
        <div className="p-h">Who actually buys from you</div>
        <div className="pk">Looks like</div>
        <div><span className="chip">Revvity</span><span className="chip">Enzene</span><span className="chip">PhenoVista</span></div>
        <div className="pk">Therapeutic areas</div>
        <div><span className="chip teal">Oncology</span><span className="chip teal">Immunology</span><span className="chip teal">Rare disease</span></div>
        <div className="pk">Modalities</div>
        <div><span className="chip">mAb</span><span className="chip">Cell therapy</span><span className="chip">Diagnostics</span></div>
        <div className="pk">Company size</div>
        <div><span className="chip">500–5,000 employees</span></div>
      </div>
    )
  }
  if (k === "surface") {
    return (
      <div className="panel-fade" key="surface">
        <div className="p-kicker">Signals · this week</div>
        <div className="p-h">Ranked by who's ready</div>
        {[
          { n: "Kronos Biologics", t: "VP, Clinical Operations", s: "Series B closed", hot: true },
          { n: "Helix Diagnostics", t: "Head of Commercial", s: "New VP hired", hot: false },
          { n: "Lumen Genomics", t: "Director, BD", s: "Phase II complete", hot: false },
        ].map((r) => (
          <div className={`prow${r.hot ? " hot" : ""}`} key={r.n}>
            <div className="pn">{r.n}<small>{r.t}</small></div>
            <div className="psig">{r.s}</div>
            <span className="pri"><span className="pdot" />{r.hot ? 94 : r.n[0] === "H" ? 88 : 76}</span>
          </div>
        ))}
      </div>
    )
  }
  if (k === "act") {
    return (
      <div className="panel-fade" key="act">
        <div className="p-kicker">Outreach · drafted in your voice</div>
        <div className="p-h">No blank page</div>
        <div className="compose">
          <div className="ch"><span>To: Elena Fischer · Kronos Biologics</span><span>Draft</span></div>
          <div className="cb">
            Hi Elena — congrats on closing the Series B. As you scale capacity ahead of Phase III, teams like yours usually start scoping how to keep commercial moving in step with the science. Worth a short conversation?
          </div>
          <div className="cf">
            <a className="btn btn-primary" href="#">Approve &amp; send</a>
            <a className="btn btn-ghost" href="#">Edit</a>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="panel-fade" key="sustain">
      <div className="p-kicker">Synced to your CRM</div>
      <div className="p-h">Kept fresh, automatically</div>
      <div className="rec">
        <div className="rr"><span className="rk">Fit score</span><span className="rv teal">94 · High fit</span></div>
        <div className="rr"><span className="rk">Readiness</span><span className="rv teal">88 · Buying window</span></div>
        <div className="rr"><span className="rk">Priority rank</span><span className="rv">#1 this week</span></div>
        <div className="rr"><span className="rk">Latest signal</span><span className="rv">Series B · 2h ago</span></div>
        <div className="rr"><span className="rk">Pushed to</span><span className="rv">HubSpot · Outreach</span></div>
      </div>
    </div>
  )
}

export function FeatureTabs() {
  const [active, setActive] = useState<FeatureKey>("target")

  return (
    <section className="section" id="how" aria-label="How it works">
      <div className="wrap">
        <div className="section-head reveal">
          <Eyebrow>How it works</Eyebrow>
          <h2 className="h2" style={{ marginTop: 18 }}>Four moments, one always-on engine.</h2>
          <p className="lead">Target the right accounts, surface the moment they&rsquo;re ready, act on it, and keep the whole thing fresh — automatically.</p>
        </div>

        <div className="tabs-wrap reveal">
          <div className="tab-list" role="tablist" aria-label="Product capabilities">
            {FEATURES.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={active === f.key}
                className={`tab${active === f.key ? " on" : ""}`}
                onClick={() => setActive(f.key)}
              >
                <span className="tk"><span className="tn">{f.step}</span>{f.tab}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </button>
            ))}
          </div>

          <div className="canvas canvas-glow">
            <div className="frame">
              <div className="frame-bar">
                <span className="d" /><span className="d" /><span className="d" />
                <span className="addr">app.arcova.bio</span>
              </div>
              <div className="frame-body">
                <Panel k={active} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
