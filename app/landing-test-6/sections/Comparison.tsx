"use client"

import { useState } from "react"

// Allowance comparison. Values are the commercial pricing source of truth,
// verified against lib/billing/config.ts — do not alter them. Price and credits
// switch with the billing toggle; every other allowance is the same for monthly
// and annual.
const PRICE = {
  monthly: ["$0", "$149 / month", "$799 / month"],
  annual: ["$0", "$1,490 / year", "$7,990 / year"],
} as const
const CREDITS = {
  monthly: ["100 / month", "2,000 / month", "8,000 / month"],
  annual: ["100 / month", "24,000 upfront", "96,000 upfront"],
} as const

const STATIC_ROWS: [string, string, string, string][] = [
  ["Workspace users", "1", "Unlimited", "Unlimited"],
  ["Workspace lead capacity", "100", "5,000", "10,000"],
  ["Monitoring cadence", "Monthly", "Monthly", "Weekly"],
  ["Exports", "Unlimited", "Unlimited", "Unlimited"],
  ["Purchased rollover credits", "Not available", "$100 / 1,000", "$70 / 1,000"],
]

export function Comparison() {
  const [annual, setAnnual] = useState(false)
  const k = annual ? "annual" : "monthly"
  // 12 months at the monthly rate — struck through in the annual view.
  const priceWas = annual ? ["", "$1,788", "$9,588"] : ["", "", ""]

  return (
    <section className="section" aria-label="Full plan comparison" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="comparison reveal">
          <div className="comparison-head">
            <div>
              <p className="eyebrow">Full comparison</p>
              <h3>Everything included, row by row.</h3>
            </div>
            <div className="bill-toggle" role="group" aria-label="Billing period">
              <button type="button" className={annual ? "" : "on"} aria-pressed={!annual} onClick={() => setAnnual(false)}>Monthly</button>
              <button type="button" className={annual ? "on" : ""} aria-pressed={annual} onClick={() => setAnnual(true)}>Annual <span className="save">2 months free</span></button>
            </div>
          </div>
          <div className="comparison-scroll">
            <table>
              <thead>
                <tr><th>Plan allowance</th><th>Free</th><th>Starter</th><th>Growth</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>Workspace price</td>
                  {PRICE[k].map((v, i) => (
                    <td key={i}>{priceWas[i] ? <span className="cmp-was">{priceWas[i]}</span> : null}{v}</td>
                  ))}
                </tr>
                <tr>
                  <td>Credits included</td>
                  {CREDITS[k].map((v, i) => <td key={i}>{v}</td>)}
                </tr>
                {STATIC_ROWS.map((r) => (
                  <tr key={r[0]}>
                    <td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="comparison-note">
            Included credits reset with the plan. Purchased credits roll over and can be used for any paid action. Lead capacity and monitoring cadence are plan-based.{" "}
            <a className="credit-link" href="/docs/credits">How Arcova credits work <span>→</span></a>
          </p>
        </div>
      </div>
    </section>
  )
}
