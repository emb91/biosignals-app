"use client"

import { Fragment, useState, type ReactNode } from "react"
import { CALENDLY_BOOKING_URL, PLANS, COMPARE } from "../data"

function CK() {
  return (
    <svg className="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

/** Render a `**bold**` string into React nodes. */
function feat(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const m = part.match(/^\*\*([^*]+)\*\*$/)
    return m ? <b key={i}>{m[1]}</b> : <Fragment key={i}>{part}</Fragment>
  })
}

function paidSignupHref(planName: string, annual: boolean) {
  const plan = planName.toLowerCase()
  const billing = annual ? "annual" : "monthly"
  const next = `/settings/billing?plan=${encodeURIComponent(plan)}&billing=${billing}`
  return `/signup?next=${encodeURIComponent(next)}`
}

export function Pricing() {
  const [annual, setAnnual] = useState(false)
  const [open, setOpen] = useState(false)

  return (
    <section id="pricing" aria-label="Pricing">
      <div id="pt7" className={annual ? "annual" : ""}>
        <div className="wrap">
          <div className="head reveal">
            <span className="eyebrow">Pricing</span>
            <h1>
              One workspace. Your whole <span className="grad">revenue team</span>.
            </h1>
            <p>One flat price, unlimited seats. Credits cover the leads you enrich and the outreach you send, so you only pay for what runs.</p>
          </div>

          <div className="bill-row reveal">
            <div className="bill-toggle" role="group" aria-label="Billing period">
              <button type="button" className={annual ? "" : "on"} aria-pressed={!annual} onClick={() => setAnnual(false)}>
                Monthly
              </button>
              <button type="button" className={annual ? "on" : ""} aria-pressed={annual} onClick={() => setAnnual(true)}>
                Annual <span className="save">2 months free</span>
              </button>
            </div>
          </div>

          <div className="cards reveal">
            {PLANS.map((p) => {
              const amt = annual && p.paid ? p.annualMonthlyEq : annual ? p.priceAnnual : p.priceMonthly
              const summary = annual ? p.summaryAnnual : p.summaryMonthly
              return (
                <div className={`card${p.featured ? " feat" : ""}`} key={p.name}>
                  {annual && p.paid ? (
                    <div className="ribbon ribbon-save">Save {p.annualSave}/year</div>
                  ) : p.pop ? (
                    <div className="ribbon">{p.pop}</div>
                  ) : null}
                  <div className="cname">{p.name}</div>
                  <div className="ctag">
                    Best for <b>{p.bestFor}</b>
                  </div>
                  <div className="cprice">
                    <span className="amt">{amt}</span>
                    {annual && p.paid ? <span className="per">/mo</span> : null}
                  </div>
                  <div className="cmeta">
                    {!p.paid ? (
                      <div className="cbilled">Free forever</div>
                    ) : !annual ? (
                      <div className="cbilled">billed monthly</div>
                    ) : (
                      <div className="cbilled">
                        <b>{p.priceAnnual}</b> billed annually
                      </div>
                    )}
                  </div>
                  <div className="cbtn">
                    <a className={`btn ${p.featured ? "btn-primary" : "btn-soft"}`} href={p.paid ? paidSignupHref(p.name, annual) : "/signup"}>
                      {p.cta}
                    </a>
                  </div>
                  <ul className="summary">
                    {summary.map((f, i) => (
                      <li key={i}>
                        <CK />
                        <span>{feat(f)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>

          <div className="compare-row reveal">
            <button type="button" className="compare-btn" aria-expanded={open} aria-controls="pt7-compare" onClick={() => setOpen((o) => !o)}>
              <span className="cbtn-txt">{open ? "Hide full comparison" : "Compare all features"}</span>
              <svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>

          {open ? (
            <div className="compare" id="pt7-compare">
              <div className="compare-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Plan allowance</th>
                      {PLANS.map((p, i) => {
                        const cls = `${p.featured ? "feat" : ""}${annual && i === 0 ? " mutedcol" : ""}`.trim()
                        return (
                          <th key={p.name} className={cls || undefined}>
                            {p.name}
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {COMPARE.map((g) => {
                      const rows = g.rows.filter((r) => !(r.annualOnly && !annual))
                      if (!rows.length) return null
                      return (
                        <Fragment key={g.group}>
                          <tr className="grouprow">
                            <td colSpan={4}>{g.group}</td>
                          </tr>
                          {rows.map((r) => {
                            const cells = r.vals || (annual ? r.a! : r.m!)
                            return (
                              <tr key={r.label}>
                                <td className={r.sub ? "sub-label" : undefined}>{r.label}</td>
                                {cells.map((v, i) => {
                                  const cls = `${PLANS[i].featured ? "feat-col" : ""}${annual && i === 0 ? " mutedcol" : ""}`.trim()
                                  const inner = v === "✓" ? <CK /> : /^Save /.test(v) ? <span className="cmp-save">{v}</span> : v
                                  return (
                                    <td key={i} className={cls || undefined}>
                                      {inner}
                                    </td>
                                  )
                                })}
                              </tr>
                            )
                          })}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="ent">
            <div className="et">
              <h4>Enterprise</h4>
              <p>For larger teams that need custom volumes, integrations and security.</p>
            </div>
            <div className="efeat">
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>Custom signals
              </span>
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>Unlimited lead capacity
              </span>
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>Custom integrations
              </span>
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>First-party engagement tracking
              </span>
              <span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>SSO &amp; onboarding
              </span>
            </div>
            <div className="ebtn">
              <a className="btn btn-primary" href={CALENDLY_BOOKING_URL} target="_blank" rel="noopener noreferrer">
                Contact sales
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
