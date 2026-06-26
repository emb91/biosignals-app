/**
 * Content for the Arcova landing page (variant 6). Implemented from the Claude
 * Design project "Landing Test 6" (landing/Landing Test 6.html). Pricing (PLANS
 * + COMPARE) is the commercial source of truth and is left exactly as set —
 * do not change the numbers, tiers, labels or billing copy here.
 */

export const HERO = {
  headlineLead: "The revenue engine built for",
  headlineAccent: "life sciences.",
  sub: "Arcova watches your market, ranks the accounts worth working, and drafts the outreach. You just hit send.",
}

// Built-for strip
export const BUILT_FOR = ["CROs", "CDMOs", "Biotech", "Medtech", "Pharma", "Diagnostics", "Tools & Instruments"]

// Capability strip (3 quiet cards)
export const CAPS = [
  {
    icon: "target",
    title: "Map the right market",
    body: "Arcova learns your company, competitors, and best customers, then maps the segments, buyers, and accounts worth working.",
  },
  {
    icon: "radar",
    title: "Catch the right moment",
    body: "Clinical trials. FDA milestones. Funding. Deals. IP. Research. Facilities, and more. Surfaced as reasons to reach out.",
  },
  {
    icon: "send",
    title: "Send the right message",
    body: "Every draft is grounded in the signal, account context, CRM state and prior relationship, so reps move from signal to sequence in two clicks.",
  },
]

// How it works — connected timeline (3 steps)
export const STEPS = [
  { n: 1, title: "Start with your domain", body: "Arcova learns your company, products, services, competitors and best customers." },
  { n: 2, title: "Build the intelligence layer", body: "Accounts are enriched, matched, monitored and ranked as new signals land." },
  { n: 3, title: "Work the right moments", body: "Your team starts each day with the accounts that need attention now, and the best next step." },
]

// Bento "Act" tile — animated outreach sequence (from the design script)
export const ACT_STEPS = [
  { chan: "Day 1 · Email", subject: "Labs ready to buy", body: "Hi Andrea, hope you don't mind me reaching out to you cold, but I do know that it can be hard to know which prospects are ready to buy, and it's something we do really well." },
  { chan: "Day 4 · Email", subject: "In case it got buried", body: "Just following up in case my last message got missed. We keep an eye on research institutes and diagnostic labs across the US that show signs of buying…" },
  { chan: "Day 8 · LinkedIn message", subject: "Thanks for connecting", body: "Thanks for connecting. Some providers show prospect signals like hiring, but Arcova looks deeper into whether that actually translates into a buying signal…" },
  { chan: "Day 11 · Email", subject: "Clinical labs scaling sequencing", body: "We're tracking oncology labs across the US that have recently raised Series A. Happy to share some of these leads if of any use…" },
  { chan: "Day 14 · LinkedIn message", subject: "A quick demo offer", body: "If automating your GTM motion isn't a priority right now, that's totally fair. If it is, I'd love to demo how we work…" },
  { chan: "Day 21 · Email", subject: "Leaving the door open", body: "I'll leave it here so I'm not filling up your inbox. We monitor signals across US life science companies 24/7, so reach out anytime…" },
]

// ===================== Pricing (test 7) — commercial source of truth =====================
export type Plan = {
  name: string
  bestFor: string
  priceMonthly: string
  priceAnnual: string
  annualList?: string
  annualMonthlyEq?: string
  annualSave?: string
  paid?: boolean
  featured?: boolean
  pop?: string
  cta: string
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
    annualMonthlyEq: "$667",
    annualSave: "$1,598",
    paid: true,
    cta: "Start for free",
    summaryMonthly: ["**8,000** credits", "**Unlimited** users", "**10,000** lead capacity", "**Weekly** monitoring signals"],
    summaryAnnual: ["**96,000** credits upfront", "**Unlimited** users", "**10,000** lead capacity", "**Weekly** monitoring signals"],
  },
]

export type CompareRow = {
  label: string
  sub?: boolean
  annualOnly?: boolean
  vals?: string[]
  m?: string[]
  a?: string[]
}
export type CompareGroup = { group: string; rows: CompareRow[] }

export const COMPARE: CompareGroup[] = [
  {
    group: "Pricing",
    rows: [
      { label: "Billing", m: ["Monthly", "Monthly", "Monthly"], a: ["Monthly", "Annual", "Annual"] },
      { label: "Workspace price", m: ["$0", "$149/month", "$799/month"], a: ["$0", "$1,490/year", "$7,990/year"] },
      { label: "Equivalent monthly price", annualOnly: true, a: ["$0", "$124/month", "$667/month"] },
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
      { label: "Lead enrichment credits", m: ["60/month", "1,200/month", "5,600/month"], a: ["60/month", "14,400/year", "67,200/year"] },
      { label: "Shared enrichment actions", vals: ["Imports, company-only, net-new", "Imports, company-only, net-new", "Imports, company-only, net-new"] },
      { label: "Email finds", m: ["1/month", "25/month", "60/month"], a: ["1/month", "300/year", "720/year"] },
      { label: "Phone reveals", m: ["1/month", "3/month", "12/month"], a: ["1/month", "36/year", "144/year"] },
      { label: "Exports", vals: ["Unlimited", "Unlimited", "Unlimited"] },
    ],
  },
  {
    group: "Outreach",
    rows: [
      { label: "Generated sequences", m: ["1/month", "66/month", "214/month"], a: ["1/month", "792/year", "2,568/year"] },
      { label: "Emails", sub: true, m: ["8/month", "380/month", "1,200/month"], a: ["8/month", "4,560/year", "14,400/year"] },
      { label: "LinkedIn messages", sub: true, m: ["4/month", "190/month", "600/month"], a: ["4/month", "2,280/year", "7,200/year"] },
      { label: "LinkedIn requests", sub: true, m: ["1/month", "66/month", "214/month"], a: ["1/month", "792/year", "2,568/year"] },
    ],
  },
  {
    group: "Credits",
    rows: [{ label: "Extra credit packs", vals: ["—", "$100 / 1,000", "$70 / 1,000"] }],
  },
  {
    group: "Support",
    rows: [
      { label: "Onboarding", vals: ["✓", "✓", "✓"] },
      { label: "Import support", vals: ["✓", "✓", "✓"] },
      { label: "ICP setup", vals: ["✓", "✓", "✓"] },
      { label: "Live support", vals: ["✓", "✓", "✓"] },
    ],
  },
]

export const FOOTER_COLS = [
  { h: "Product", links: ["How it works", "Why Arcova", "Pricing"] },
  { h: "Company", links: ["About", "Careers", "Contact"] },
  { h: "Legal", links: ["Privacy", "Terms"] },
]
