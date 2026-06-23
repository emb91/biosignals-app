"use client"

import { Fragment, useState } from "react"
import "./pricing.css"
import { PLANS, COMPARE } from "./data"

function Check() {
  return (
    <svg className="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

function Chevron() {
  return (
    <svg className="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

/** Render a feature string, turning **bold** spans into <b>. */
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

export default function Pricing7() {
  const [annual, setAnnual] = useState(true)
  const [open, setOpen] = useState(false)

  return (
    <div id="pt7" className={annual ? "annual" : ""}>
      <div className="wrap">
        <div className="head">
          <span className="eyebrow">Pricing</span>
          <h1>One workspace. Your whole revenue team.</h1>
          <p>One flat price, unlimited seats. Credits cover the leads you enrich and the outreach you send, so you only pay for what runs.</p>
        </div>

        <div className="bill-row">
          <div className="bill-toggle" role="group" aria-label="Billing period">
            <button type="button" className={annual ? "" : "on"} aria-pressed={!annual} onClick={() => setAnnual(false)}>Monthly</button>
            <button type="button" className={annual ? "on" : ""} aria-pressed={annual} onClick={() => setAnnual(true)}>Annual <span className="save">2 months free</span></button>
          </div>
        </div>

        <div className="cards">
          {PLANS.map((p) => (
            <div className={`card${p.featured ? " feat" : ""}`} key={p.name}>
              {annual && p.paid ? (
                <div className="ribbon ribbon-save">Save {p.annualSave}/year</div>
              ) : p.pop ? (
                <div className="ribbon">{p.pop}</div>
              ) : null}
              <div className="cname">{p.name}</div>
              <div className="ctag">Best for <b>{p.bestFor}</b></div>
              <div className="cprice">
                <span className="amt">{annual && p.paid ? p.annualMonthlyEq : annual ? p.priceAnnual : p.priceMonthly}</span>
                {annual && p.paid && <span className="per">/mo</span>}
              </div>
              <div className="cmeta">
                {!p.paid && <div className="cbilled">Free forever</div>}
                {!annual && p.paid && <div className="cbilled">billed monthly</div>}
                {annual && p.paid && <div className="cbilled"><b>{p.priceAnnual}</b> billed annually</div>}
              </div>
              <div className="cbtn">
                <a className={`btn ${p.featured ? "btn-primary" : "btn-soft"}`} href="/signup">{p.cta}</a>
              </div>
              <ul className="summary">
                {(annual ? p.summaryAnnual : p.summaryMonthly).map((f) => (
                  <li key={f}><Check /><Feature text={f} /></li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="compare-row">
          <button type="button" className="compare-btn" aria-expanded={open} aria-controls="pt7-compare" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide full comparison" : "Compare all features"}
            <Chevron />
          </button>
        </div>

        {open && (
          <div className="compare" id="pt7-compare">
            <div className="compare-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Plan allowance</th>
                    {PLANS.map((p, i) => (
                      <th key={p.name} className={`${p.featured ? "feat" : ""}${annual && i === 0 ? " mutedcol" : ""}`}>{p.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARE.map((g) => {
                    const rows = g.rows.filter((r) => !(r.annualOnly && !annual))
                    if (!rows.length) return null
                    return (
                      <Fragment key={g.group}>
                        <tr className="grouprow"><td colSpan={4}>{g.group}</td></tr>
                        {rows.map((r) => {
                          const cells = r.vals ?? (annual ? r.a! : r.m!)
                          return (
                            <tr key={r.label}>
                              <td className={r.sub ? "sub-label" : undefined}>{r.label}</td>
                              {cells.map((v, i) => (
                                <td key={i} className={`${PLANS[i].featured ? "feat-col" : ""}${annual && i === 0 ? " mutedcol" : ""}`}>
                                  {v === "✓" ? <Check /> : v.startsWith("Save ") ? <span className="cmp-save">{v}</span> : v}
                                </td>
                              ))}
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
        )}
      </div>
    </div>
  )
}
