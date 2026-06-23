/**
 * Pricing for /pricing-test-7. These figures are exactly as supplied (the final
 * pricing the user landed on) — the commercial source of truth. Do not alter
 * values. The summary list is what shows on the collapsed card; the full
 * comparison opens behind "Compare all features".
 */

export type Plan = {
  name: string
  bestFor: string // rendered as "Best for {bestFor}"
  priceMonthly: string
  priceAnnual: string
  annualList?: string // "$1,788" — 12 months at the monthly rate ("if paid monthly")
  annualMonthlyEq?: string // "$124" — the annual total shown as a per-month headline
  annualSave?: string // "$298" — saved per year vs paying monthly
  paid?: boolean
  featured?: boolean
  pop?: string
  cta: string
  // Collapsed-card bullets (markdown-style **bold** for the value). Annual swaps the
  // credits line to the upfront yearly grant so annual reads as its own offer.
  summaryMonthly: string[]
  summaryAnnual: string[]
}

export const PLANS: Plan[] = [
  {
    name: "Free",
    bestFor: "a first look",
    priceMonthly: "$0",
    priceAnnual: "$0",
    cta: "Start for free",
    summaryMonthly: ["**100** credits", "**1** user", "**100** lead capacity", "**Monthly** monitoring signals"],
    summaryAnnual: ["**100** credits / month", "**1** user", "**100** lead capacity", "**Monthly** monitoring signals"],
  },
  {
    name: "Starter",
    bestFor: "solo outbound",
    priceMonthly: "$149",
    priceAnnual: "$1,490",
    annualList: "$1,788",
    annualMonthlyEq: "$124",
    annualSave: "$298",
    paid: true,
    featured: true,
    pop: "Most teams start here",
    cta: "Start for free",
    summaryMonthly: ["**2,000** credits", "**Unlimited** users", "**5,000** lead capacity", "**Monthly** monitoring signals"],
    summaryAnnual: ["**24,000** credits upfront", "**Unlimited** users", "**5,000** lead capacity", "**Monthly** monitoring signals"],
  },
  {
    name: "Growth",
    bestFor: "full team coverage",
    priceMonthly: "$799",
    priceAnnual: "$7,990",
    annualList: "$9,588",
    annualMonthlyEq: "$666",
    annualSave: "$1,598",
    paid: true,
    cta: "Start for free",
    summaryMonthly: ["**8,000** credits", "**Unlimited** users", "**10,000** lead capacity", "**Weekly** monitoring signals"],
    summaryAnnual: ["**96,000** credits upfront", "**Unlimited** users", "**10,000** lead capacity", "**Weekly** monitoring signals"],
  },
]

// Full comparison (revealed on demand). Order = [Free, Starter, Growth].
// Values switch with the billing toggle: `m` = monthly view, `a` = annual view
// (annual totals). `vals` = identical in both modes. `annualOnly` rows only
// appear in the annual view. "✓" cells render as a check icon.
export type CompareRow = {
  label: string
  vals?: [string, string, string]
  m?: [string, string, string]
  a?: [string, string, string]
  annualOnly?: boolean
  sub?: boolean // indented breakdown row (e.g. the channels inside a sequence)
}
export type CompareGroup = { group: string; rows: CompareRow[] }

export const COMPARE: CompareGroup[] = [
  {
    group: "Pricing",
    rows: [
      { label: "Billing", m: ["Monthly", "Monthly", "Monthly"], a: ["Monthly", "Annual", "Annual"] },
      { label: "Workspace price", m: ["$0", "$149/month", "$799/month"], a: ["$0", "$1,490/year", "$7,990/year"] },
      { label: "Equivalent monthly price", annualOnly: true, a: ["$0", "$124/month", "$666/month"] },
      { label: "Annual savings", annualOnly: true, a: ["—", "Save $298", "Save $1,598"] },
    ],
  },
  {
    group: "Plan & capacity",
    rows: [
      { label: "Credits included", m: ["100/month", "2,000/month", "8,000/month"], a: ["100/month", "24,000 upfront", "96,000 upfront"] },
      { label: "Users", vals: ["1", "Unlimited", "Unlimited"] },
      { label: "Lead capacity", vals: ["100", "5,000", "10,000"] },
      { label: "Monitoring signals", vals: ["Monthly", "Monthly", "Weekly"] },
      { label: "Signals tracked", vals: ["42", "42", "42"] },
    ],
  },
  {
    group: "Enrichment",
    rows: [
      { label: "CRM lead enrichments", m: ["10/month", "250/month", "1,200/month"], a: ["10/month", "3,000/year", "14,400/year"] },
      { label: "New enriched leads", m: ["5/month", "50/month", "200/month"], a: ["5/month", "600/year", "2,400/year"] },
      { label: "Email finds", m: ["1/month", "25/month", "60/month"], a: ["1/month", "300/year", "720/year"] },
      { label: "Phone reveals", m: ["1/month", "3/month", "12/month"], a: ["1/month", "36/year", "144/year"] },
      { label: "Exports", vals: ["Unlimited", "Unlimited", "Unlimited"] },
    ],
  },
  {
    // Each sequence = 4 emails, 2 LinkedIn messages, 1 LinkedIn request.
    group: "Outreach",
    rows: [
      { label: "Generated sequences", m: ["2/month", "95/month", "300/month"], a: ["2/month", "1,140/year", "3,600/year"] },
      { label: "Emails", sub: true, m: ["8/month", "380/month", "1,200/month"], a: ["8/month", "4,560/year", "14,400/year"] },
      { label: "LinkedIn messages", sub: true, m: ["4/month", "190/month", "600/month"], a: ["4/month", "2,280/year", "7,200/year"] },
      { label: "LinkedIn requests", sub: true, m: ["2/month", "95/month", "300/month"], a: ["2/month", "1,140/year", "3,600/year"] },
    ],
  },
  {
    group: "Credits",
    rows: [
      { label: "Extra credit packs", vals: ["—", "$100 / 1,000", "$70 / 1,000"] },
    ],
  },
  {
    // Assumed included on every plan — adjust if tiered.
    group: "Support",
    rows: [
      { label: "Onboarding", vals: ["✓", "✓", "✓"] },
      { label: "Import support", vals: ["✓", "✓", "✓"] },
      { label: "ICP setup", vals: ["✓", "✓", "✓"] },
      { label: "Live support", vals: ["✓", "✓", "✓"] },
    ],
  },
]
