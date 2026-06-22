import type { Metadata } from "next"
import Link from "next/link"
import { ACTION_CREDITS, FREE_TIER, PLANS } from "@/lib/billing/config"
import "./credits.css"

export const metadata: Metadata = {
  title: "Arcova | Credits and plan allowances",
  description: "Understand Arcova credits, plan allowances, action costs, monitoring, and annual billing.",
}

const plans = [
  {
    name: "Free",
    price: "$0",
    annualPrice: "—",
    monthlyCredits: FREE_TIER.monthlyCredits,
    annualCredits: "—",
    users: "1",
    activeLeads: FREE_TIER.caps.activeMonitoredContacts.toLocaleString(),
    monitoring: "Monthly",
    purchasedCredits: "Not available",
    pack: "Not available",
  },
  {
    name: PLANS.starter.name,
    price: `$${PLANS.starter.monthlyUsd} / month`,
    annualPrice: `$${PLANS.starter.annualUsd.toLocaleString()} / year`,
    monthlyCredits: PLANS.starter.monthlyCredits,
    annualCredits: `${PLANS.starter.annualCredits.toLocaleString()} upfront`,
    users: "Unlimited",
    activeLeads: PLANS.starter.caps.activeMonitoredContacts.toLocaleString(),
    monitoring: "Monthly",
    purchasedCredits: "Available; rollover",
    pack: `$${PLANS.starter.creditPackUsdPer1k} / 1,000`,
  },
  {
    name: PLANS.growth.name,
    price: `$${PLANS.growth.monthlyUsd} / month`,
    annualPrice: `$${PLANS.growth.annualUsd.toLocaleString()} / year`,
    monthlyCredits: PLANS.growth.monthlyCredits,
    annualCredits: `${PLANS.growth.annualCredits.toLocaleString()} upfront`,
    users: "Unlimited",
    activeLeads: PLANS.growth.caps.activeMonitoredContacts.toLocaleString(),
    monitoring: "Weekly",
    purchasedCredits: "Available; rollover",
    pack: `$${PLANS.growth.creditPackUsdPer1k} / 1,000`,
  },
]

const actionRows = [
  ["Enrich an imported contact and company", ACTION_CREDITS.imported_contact_company_enrichment, "Only when fresh enrichment is needed"],
  ["Enrich or refresh a company", ACTION_CREDITS.company_enrichment, "Setup-time company mapping is free"],
  ["Validate an email", ACTION_CREDITS.email_validation, "Only when a billable validation runs"],
  ["Find and validate a new email", ACTION_CREDITS.email_finder, "Charged only when a usable email is found"],
  ["Reveal a phone number", ACTION_CREDITS.phone_reveal, "Always confirmed before the request"],
  ["Deliver a net-new enriched lead", ACTION_CREDITS.net_new_enriched_lead, "Duplicates and undelivered leads are not charged"],
  ["Refresh a contact manually", ACTION_CREDITS.manual_contact_refresh, "Scheduled maintenance remains included"],
  ["Generate a seven-touch sequence", ACTION_CREDITS.outreach_sequence, "Editing and sending the sequence are free"],
] as const

const freeActions = [
  "Importing, storing, and deduplicating records",
  "Cached re-scoring when no fresh data is needed",
  "Scheduled contact and account monitoring",
  "Maintenance after a confirmed job change",
  "Searching, previews, editing, sending, and exports",
]

const buyingPower = [
  ["4-credit actions", "25", "500", "2,000"],
  ["Successful email finds", "9", "181", "727"],
  ["Phone reveals", "5", "100", "400"],
  ["Seven-touch sequences", "20", "400", "1,600"],
]

const planRows: Array<[string, keyof (typeof plans)[number]]> = [
  ["Workspace price", "price"],
  ["Annual price", "annualPrice"],
  ["Workspace users", "users"],
  ["Included monthly credits", "monthlyCredits"],
  ["Annual credits", "annualCredits"],
  ["Workspace lead capacity", "activeLeads"],
  ["Monitoring cadence", "monitoring"],
  ["Purchased credits", "purchasedCredits"],
  ["Credit pack price", "pack"],
]

export default function CreditsDocsPage() {
  return (
    <div className="credits-doc">
      <header className="docs-topbar">
        <Link className="docs-brand" href="/">
          <img src="/arcova-logo.png" alt="Arcova" />
          <span>Docs</span>
        </Link>
        <nav aria-label="Documentation">
          <a href="#overview">Overview</a>
          <a href="#plans">Plans</a>
          <a href="#actions">Action costs</a>
          <a href="#examples">Examples</a>
        </nav>
        <Link className="docs-app-link" href="/login">Open Arcova <span>→</span></Link>
      </header>

      <div className="docs-layout">
        <aside className="docs-sidebar">
          <div className="sidebar-label">Credits and billing</div>
          <a href="#overview">How credits work</a>
          <a href="#plans">Plan allowances</a>
          <a href="#actions">What actions cost</a>
          <a href="#included">What is included</a>
          <a href="#examples">Credit examples</a>
          <a href="#annual">Annual plans</a>
          <a href="#monitoring">Active-lead monitoring</a>
          <a href="#faq">Common questions</a>
        </aside>

        <main>
          <section className="docs-hero" id="overview">
            <div className="docs-kicker">Arcova credits</div>
            <h1>Use credits when Arcova does new work for you.</h1>
            <p className="docs-lead">
              Your plan includes monthly credits for deliberate, on-demand actions—such as enriching a lead,
              finding a verified email, revealing a phone number, or generating outreach. Your scheduled market
              monitoring is included separately and does not spend credits.
            </p>
            <div className="principle-grid">
              <article>
                <span>01</span>
                <h2>Pay for completed work</h2>
                <p>Failed requests, duplicates, and fresh cache hits do not consume settled credits.</p>
              </article>
              <article>
                <span>02</span>
                <h2>Monitoring is included</h2>
                <p>Arcova keeps eligible active leads current at the cadence included in your plan.</p>
              </article>
              <article>
                <span>03</span>
                <h2>Caps keep usage predictable</h2>
                <p>Credits buy paid actions. Plans control workspace capacity and monitoring cadence.</p>
              </article>
            </div>
          </section>

          <section className="docs-section" id="plans">
            <div className="section-heading">
              <div className="docs-kicker">Plan allowances</div>
              <h2>What each workspace receives</h2>
              <p>Paid plans cover the whole workspace, with unlimited users. There is no per-seat charge.</p>
            </div>
            <div className="docs-table-wrap">
              <table className="docs-table plans-table">
                <thead>
                  <tr>
                    <th>Allowance</th>
                    {plans.map((plan) => <th key={plan.name}>{plan.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {planRows.map(([label, key]) => (
                    <tr key={label}>
                      <td>{label}</td>
                      {plans.map((plan) => (
                        <td key={plan.name}>
                          {key === "monthlyCredits" ? `${Number(plan[key]).toLocaleString()} / month` : String(plan[key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td>Exports</td>
                    <td>Unlimited</td><td>Unlimited</td><td>Unlimited</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="docs-callout">
              <strong>Credits and capacity:</strong> Included monthly credits expire at renewal. Purchased
              credits roll over and can be used for any paid action. Buying credits does not increase workspace
              lead capacity or monitoring cadence.
            </div>
          </section>

          <section className="docs-section" id="actions">
            <div className="section-heading">
              <div className="docs-kicker">Action costs</div>
              <h2>How many credits each action uses</h2>
              <p>Arcova shows the cost before an on-demand action starts.</p>
            </div>
            <div className="docs-table-wrap">
              <table className="docs-table action-table">
                <thead><tr><th>Action</th><th>Credits</th><th>When you are charged</th></tr></thead>
                <tbody>
                  {actionRows.map(([action, credits, note]) => (
                    <tr key={action}>
                      <td>{action}</td>
                      <td><span className="credit-pill">{credits}</span></td>
                      <td>{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="docs-section" id="included">
            <div className="section-heading">
              <div className="docs-kicker">Zero-credit work</div>
              <h2>What does not use credits</h2>
            </div>
            <div className="included-grid">
              {freeActions.map((action) => (
                <div key={action}><span>✓</span>{action}</div>
              ))}
            </div>
          </section>

          <section className="docs-section" id="examples">
            <div className="section-heading">
              <div className="docs-kicker">Credit math</div>
              <h2>What your included credits can buy</h2>
              <p>
                These are simple “if used only for this action” illustrations. Credit balance and workspace
                capacity still apply.
              </p>
            </div>
            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead><tr><th>If used only for…</th><th>Free · 100</th><th>Starter · 2,000</th><th>Growth · 8,000</th></tr></thead>
                <tbody>
                  {buyingPower.map((row) => (
                    <tr key={row[0]}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="example-grid">
              <article>
                <div className="example-plan">Free example</div>
                <h3>Explore the core workflow</h3>
                <p>15 enrichments <b>60</b> + 2 sequences <b>10</b> + 1 successful email find <b>11</b></p>
                <div className="example-total"><span>Used</span><b>81 / 100 credits</b></div>
              </article>
              <article>
                <div className="example-plan">Starter example</div>
                <h3>Run a focused outbound month</h3>
                <p>300 imported enrichments <b>1,200</b> + 20 sequences <b>100</b> + 10 email finds <b>110</b> + 10 phone reveals <b>200</b></p>
                <div className="example-total"><span>Used</span><b>1,610 / 2,000 credits</b></div>
              </article>
              <article>
                <div className="example-plan">Growth example</div>
                <h3>Cover a larger active market</h3>
                <p>1,400 imported enrichments <b>5,600</b> + 100 sequences <b>500</b> + 50 email finds <b>550</b> + 50 phone reveals <b>1,000</b></p>
                <div className="example-total"><span>Used</span><b>7,650 / 8,000 credits</b></div>
              </article>
            </div>
          </section>

          <section className="docs-section split-section" id="annual">
            <div>
              <div className="docs-kicker">Annual billing</div>
              <h2>Two months free. All credits upfront.</h2>
            </div>
            <div>
              <p>
                Starter is <b>${PLANS.starter.annualUsd.toLocaleString()} per year</b> with{" "}
                <b>{PLANS.starter.annualCredits.toLocaleString()} credits upfront</b>. Growth is{" "}
                <b>${PLANS.growth.annualUsd.toLocaleString()} per year</b> with{" "}
                <b>{PLANS.growth.annualCredits.toLocaleString()} credits upfront</b>.
              </p>
              <p>
                Annual credits remain available until renewal. Monthly subscription credits expire at rollover.
                Purchased credits roll over and expire 12 months after purchase.
              </p>
            </div>
          </section>

          <section className="docs-section split-section" id="monitoring">
            <div>
              <div className="docs-kicker">Active leads</div>
              <h2>Monitoring is an allowance, not a credit charge.</h2>
            </div>
            <div>
              <p>
                Lead capacity is the number of leads your workspace can hold and monitor. Free and Starter are
                monitored monthly. Growth is monitored weekly.
              </p>
              <p>
                When capacity is full, you can still spend credits on actions for existing leads, but you need
                a higher plan or custom capacity to hold and monitor more leads. Monitoring and confirmed
                job-change maintenance use zero customer credits.
              </p>
            </div>
          </section>

          <section className="docs-section" id="faq">
            <div className="section-heading">
              <div className="docs-kicker">FAQ</div>
              <h2>Common questions</h2>
            </div>
            <div className="faq-list">
              <details>
                <summary>Do unused monthly credits roll over?</summary>
                <p>No. Monthly subscription credits expire at the monthly rollover. Annual credits remain available until annual renewal.</p>
              </details>
              <details>
                <summary>Can purchased credits take me beyond a plan cap?</summary>
                <p>Purchased credits can be used for any paid action, but they do not increase workspace lead capacity or monitoring cadence.</p>
              </details>
              <details>
                <summary>What happens if an action fails?</summary>
                <p>Reserved credits are returned when the action fails or does not produce a billable result. Retrying the same operation does not charge twice.</p>
              </details>
              <details>
                <summary>Does every person on my team need a paid seat?</summary>
                <p>No. Starter and Growth use fixed workspace pricing and include unlimited users.</p>
              </details>
              <details>
                <summary>Does monitoring spend credits every week or month?</summary>
                <p>No. Scheduled monitoring is included within your active-lead allowance and plan cadence.</p>
              </details>
            </div>
          </section>

          <section className="docs-footer-cta">
            <div>
              <div className="docs-kicker">Ready to use Arcova?</div>
              <h2>Start with your own market.</h2>
              <p>Map your ICP, enrich the right leads, and see what your first 100 credits can do.</p>
            </div>
            <Link href="/signup">Start for free <span>→</span></Link>
          </section>
        </main>
      </div>
    </div>
  )
}
