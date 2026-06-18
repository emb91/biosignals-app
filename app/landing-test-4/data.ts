/**
 * Content for the Arcova landing page (variant 4).
 * Copy is in Arcova's voice (American English). Company/people names are the
 * fictional ones already used across the brand assets — no real customers, no
 * invented metrics. Pricing is centralized here so the numbers are a one-line
 * edit while the tiers are being finalized.
 */

export const HERO = {
  // Placeholder headline — leads on real life-science signals ("name the moment").
  // Trivially swappable; final tagline still being decided.
  headlineLead: "Series B, new VP, Phase II —",
  headlineAccent: "reach out first.",
  sub: "Arcova watches your life science market for buying signals, ranks who to reach out to, and drafts the outreach. You just hit send.",
  builtFor: ["CROs", "CDMOs", "Biotech", "Medtech", "Diagnostics", "Life science tools"],
}

export const HERO_ROWS = [
  { name: "Elena Fischer", title: "VP, Clinical Operations", co: "Kronos Biologics", signal: "Series B closed", priority: 94, action: "send", actionLabel: "Send outreach" },
  { name: "Marcus Webb", title: "Head of Commercial", co: "Helix Diagnostics", signal: "New VP hired", priority: 88, action: "send", actionLabel: "Send outreach" },
  { name: "Priya Nair", title: "Director, Business Development", co: "Lumen Genomics", signal: "Phase II complete", priority: 76, action: "monitor", actionLabel: "Monitor" },
  { name: "James Okafor", title: "Chief Scientific Officer", co: "Veritas CDx", signal: "Site expansion", priority: 61, action: "monitor", actionLabel: "Monitor" },
  { name: "Sofia Alvarez", title: "Commercial Lead", co: "Orbital Therapeutics", signal: "No recent signal", priority: 44, action: "source", actionLabel: "Source" },
] as const

export const CRED = [
  { title: "Always-on", body: "Your market is watched continuously — not pulled once and left to go stale." },
  { title: "AI-native", body: "Agents reason about who's ready and why, then act. Not a button bolted onto old software." },
  { title: "Built for life science", body: "It speaks clinical stages, modalities and milestones out of the box." },
]

export const MOMENTS = [
  {
    step: "Target",
    title: "Your market, mapped in minutes.",
    body: "Give Arcova your domain and a couple of competitors. It maps your ICP at the company level and your buyers at the contact level.",
    media: "icp" as const,
  },
  {
    step: "Surface",
    title: "Reach out at the right moment.",
    body: "Funding rounds, new hires and clinical milestones — flagged the second they happen, and scored for whether the account is actually ready.",
    media: "signal" as const,
  },
  {
    step: "Act",
    title: "From signal to sent in two clicks.",
    body: "Arcova drafts the outreach in your voice, grounded in the research behind the account. You just hit send.",
    media: "draft" as const,
  },
  {
    step: "Sustain",
    title: "A market that works while you sleep.",
    body: "Every score, signal and enriched contact stays fresh automatically and flows back to your CRM. Nothing to re-key by hand.",
    media: "crm" as const,
  },
]

export const BRIEFING = [
  { lab: "Overnight", count: 12, title: "New buying signals", body: "Funding, leadership hires and clinical milestones across your market while you slept.", cc: "rgba(0,164,180,.5)" },
  { lab: "Ready to work", count: 8, title: "Leads with outreach drafted", body: "High-fit contacts, sequenced and waiting for your approval.", cc: "rgba(140,217,201,.5)" },
  { lab: "Today", count: 5, title: "On your priority list", body: "Ranked, so your reps start with the best account, not the loudest.", cc: "rgba(0,164,180,.38)" },
]

export const CRM_CHECKS = [
  "Fit score written to your CRM field",
  "Readiness updated on every new signal",
  "Contact enrichment synced both ways",
  "Priority rank & latest signal on the record",
]

export const DIFF = [
  {
    head: "Living, not static.",
    body: "Generic data tools sell you a one-time pull that's stale by the time you work it. Arcova keeps your market fresh automatically.",
    them: "A CSV you re-clean every quarter.",
    us: "A dataset that updates itself.",
  },
  {
    head: "Reasoned, not raw.",
    body: "We explain why an account is ready — the signal, the timing, the fit — instead of handing you a list and wishing you luck.",
    them: "10,000 contacts, no context.",
    us: "The few worth calling, and why.",
  },
  {
    head: "Action-ready, not a data dump.",
    body: "The workflow ends in drafted outreach in your voice, not another export you have to turn into a message yourself.",
    them: "Raw records to process.",
    us: "Outreach ready to send.",
  },
  {
    head: "Life-science-native, not generic.",
    body: "It understands modalities, clinical stages and milestones — so the fit and the framing are right for your market, not retrofitted.",
    them: "Generic firmographics.",
    us: "Therapeutic areas, stages, modalities.",
  },
]

export type Tier = {
  name: string
  note: string
  monthly: string
  annual?: string
  per?: string
  billedNote?: string
  featured?: boolean
  ribbon?: string
  cta: string
  ctaVariant: "primary" | "soft"
  features: string[]
}

export const TIERS: Tier[] = [
  {
    name: "Free",
    note: "Map your market and prove the workflow",
    monthly: "$0",
    cta: "Start for free",
    ctaVariant: "soft",
    features: ["**100** credits / month", "**1** workspace user", "**100** active leads monitored", "**Monthly** monitoring"],
  },
  {
    name: "Starter",
    note: "Build a repeatable outbound motion",
    monthly: "$149",
    annual: "$1,490",
    per: "/workspace/mo",
    billedNote: "per workspace",
    featured: true,
    ribbon: "Most popular",
    cta: "Start for free",
    ctaVariant: "primary",
    features: ["**2,000** credits / month", "**Unlimited** users", "**5,000** active leads monitored", "**Monthly** monitoring"],
  },
  {
    name: "Growth",
    note: "Run an always-on revenue engine",
    monthly: "$799",
    annual: "$7,990",
    per: "/workspace/mo",
    billedNote: "per workspace",
    cta: "Start for free",
    ctaVariant: "soft",
    features: ["**8,000** credits / month", "**Unlimited** users", "**10,000** active leads monitored", "**Weekly** monitoring"],
  },
]
