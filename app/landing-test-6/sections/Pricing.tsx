"use client"

import { Fragment, useState } from "react"
import { Eyebrow, CheckIcon, Button } from "../components/primitives"
import { PLANS } from "../data"

function Feature({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>
      )}
    </span>
  )
}

export function Pricing() {
  const [annual, setAnnual] = useState(false)

  return (
    <section className="section" id="pricing" aria-label="Pricing">
      <div className="wrap">
        <div className="pricing-top reveal">
          <div className="section-head" style={{ maxWidth: "none" }}>
            <Eyebrow>Pricing</Eyebrow>
            <h2 className="h2" style={{ marginTop: 18 }}>One workspace. Your whole revenue team.</h2>
          </div>
          <div className="bill-toggle" role="group" aria-label="Billing period">
            <button type="button" className={annual ? "" : "on"} aria-pressed={!annual} onClick={() => setAnnual(false)}>Monthly</button>
            <button type="button" className={annual ? "on" : ""} aria-pressed={annual} onClick={() => setAnnual(true)}>Annual <span className="save">2 months free</span></button>
          </div>
        </div>

        <div className="plans reveal">
          {PLANS.map((p) => (
            <div className={`plan${p.featured ? " feat" : ""}`} key={p.name}>
              <div className="pbadge">{p.pop && <span className="pop">{p.pop}</span>}</div>
              <div className="pname">{p.name}</div>
              <div className="pdesc">{p.desc}</div>
              <div className="pprice">
                {annual && p.annualList && <span className="amt-was">{p.annualList}</span>}
                <span className="amt">{annual ? p.priceAnnual : p.priceMonthly}</span>
                {p.per && <span className="per">{annual ? "/workspace/yr" : p.per}</span>}
              </div>
              <div className="pbilled">{p.paid ? (annual ? "billed annually" : "billed monthly") : ""}</div>
              <div className="pbtn">
                <Button variant={p.featured ? "primary" : "soft"} href="/signup">{p.cta}</Button>
              </div>
              <div className="pfeat-h">{p.featuresHeading}</div>
              <ul>
                {(annual ? p.featuresAnnual : p.featuresMonthly).map((f) => (
                  <li key={f}><CheckIcon size={15} /><Feature text={f} /></li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="ent reveal">
          <div className="et">
            <h4>Enterprise</h4>
            <p>For larger teams that need custom volumes, security and hands-on onboarding.</p>
          </div>
          <div className="efeat">
            <span><CheckIcon size={14} />Negotiated volumes</span>
            <span><CheckIcon size={14} />Unlimited active leads</span>
            <span><CheckIcon size={14} />SSO &amp; onboarding</span>
          </div>
          <div className="ebtn"><a className="btn btn-primary" href="/contact-us">Contact sales</a></div>
        </div>

        <p className="price-note reveal">All plans include the full engine: signals, scoring, drafted outreach and CRM sync.</p>
      </div>
    </section>
  )
}
