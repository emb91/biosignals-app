/**
 * Content for the Arcova landing page (variant 5). Arcova voice, American
 * English, fictional company/people names only, no invented metrics. Pricing
 * centralized for easy edits. The commercial source of truth is
 * strategy/pricing/pricing-model-codex-20260619/ARCOVA_PRICING_AND_CREDIT_SPEC.md.
 */

export const HERO = {
  headline: "Know which life science accounts are ready to buy.",
  // Placeholder hero headline (final tagline TBD) — a one-line swap.
  sub: "Arcova watches your market for the moments that matter — funding, new hires, clinical milestones — ranks who's ready, and drafts the outreach. Your team just hits send.",
  industries: ["CROs", "CDMOs", "Biotech", "Medtech", "Diagnostics"],
}

export const FEED = [
  { co: "Kronos Biologics", meta: "Series B · 2h ago", sig: "Closed $80M to scale Phase III capacity", tag: "Funding", tagClass: "fund", priority: 94, action: "Send outreach", actionClass: "", barClass: "" },
  { co: "Helix Diagnostics", meta: "Leadership · today", sig: "Hired a new VP of Commercial", tag: "New hire", tagClass: "", priority: 88, action: "Send outreach", actionClass: "", barClass: "" },
  { co: "Lumen Genomics", meta: "Clinical · 1d ago", sig: "Phase II readout complete", tag: "Milestone", tagClass: "", priority: 76, action: "Monitor", actionClass: "warn", barClass: "warn" },
]

export const MARQUEE = ["Series B closed", "New VP, Commercial", "Phase II complete", "510(k) clearance", "IND filing", "Site expansion", "New CSO hired", "Phase III start", "Grant awarded", "M&A announced"]

export type FeatureKey = "target" | "surface" | "act" | "sustain"

export const FEATURES: { key: FeatureKey; step: string; tab: string; title: string; body: string }[] = [
  { key: "target", step: "01", tab: "Target", title: "Your market, mapped in minutes.", body: "Give Arcova your domain and a couple of competitors. Its agents map your ICP at the company level and your buyers at the contact level — framed in your therapeutic areas, modalities and stages." },
  { key: "surface", step: "02", tab: "Surface", title: "Reach out at the right moment.", body: "Funding rounds, new hires and clinical milestones, flagged the second they happen — and scored for whether the account is actually ready to buy, not just active." },
  { key: "act", step: "03", tab: "Act", title: "From signal to sent in two clicks.", body: "Arcova drafts the outreach in your voice, grounded in the research behind the account. Review, approve, send — no blank page, no guessing." },
  { key: "sustain", step: "04", tab: "Sustain", title: "A market that works while you sleep.", body: "Every score, signal and enriched contact stays fresh automatically and flows back to your CRM and outreach tools. Nothing to re-key, nothing to keep in sync by hand." },
]

export const STEPS = [
  { icon: "globe" as const, title: "Drop in your domain", body: "No spreadsheets, no rules to write. Just your company name and a couple of competitors." },
  { icon: "target" as const, title: "Agents map your market", body: "Arcova defines who buys from you and pulls a targeted, enriched, scored database." },
  { icon: "radar" as const, title: "Your market gets watched", body: "From then on it runs on its own — surfacing signals and prioritizing your day." },
]

export const BRIEF_STATS = [
  { num: 12, title: "New buying signals", body: "Funding, leadership hires and clinical milestones across your market overnight." },
  { num: 8, title: "Leads with outreach drafted", body: "High-fit contacts, sequenced and waiting for your approval." },
  { num: 5, title: "On today's priority list", body: "Ranked, so reps start with the best account — not the loudest." },
]

export const BRIEF_ITEMS = [
  { t: "Kronos Biologics", d: "Series B closed · VP Clinical Ops", link: "Send →" },
  { t: "Helix Diagnostics", d: "New VP hired · Head of Commercial", link: "Send →" },
  { t: "Lumen Genomics", d: "Phase II complete · Director, BD", link: "Review →" },
  { t: "Veritas CDx", d: "Site expansion · CSO", link: "Monitor" },
]

export type CompareVal = "yes" | "no" | "partial"
export const COMPARE: { feat: string; sub: string; arcova: CompareVal; generic: CompareVal; bolton: CompareVal }[] = [
  { feat: "Understands life science", sub: "Modalities, clinical stages, milestones", arcova: "yes", generic: "no", bolton: "partial" },
  { feat: "Always-on living dataset", sub: "Refreshes itself, never goes stale", arcova: "yes", generic: "no", bolton: "no" },
  { feat: "Explains why an account is ready", sub: "Reasoned intent, not raw records", arcova: "yes", generic: "no", bolton: "partial" },
  { feat: "Drafts the outreach for you", sub: "Ends in a message, not a CSV", arcova: "yes", generic: "no", bolton: "partial" },
  { feat: "Writes back to your CRM", sub: "Fit, readiness, priority, latest signal", arcova: "yes", generic: "partial", bolton: "partial" },
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
  { name: "Free", note: "Map your market and prove the workflow", monthly: "$0", cta: "Start for free", ctaVariant: "soft",
    features: ["**100** credits / month", "**1** workspace user", "**100** active leads monitored", "**Monthly** monitoring"] },
  { name: "Starter", note: "Build a repeatable outbound motion", monthly: "$149", annual: "$1,490", per: "/workspace/mo", billedNote: "per workspace", featured: true, ribbon: "Most popular", cta: "Start for free", ctaVariant: "primary",
    features: ["**2,000** credits / month", "**Unlimited** users", "**5,000** active leads monitored", "**Monthly** monitoring"] },
  { name: "Growth", note: "Run an always-on revenue engine", monthly: "$799", annual: "$7,990", per: "/workspace/mo", billedNote: "per workspace", cta: "Start for free", ctaVariant: "soft",
    features: ["**8,000** credits / month", "**Unlimited** users", "**10,000** active leads monitored", "**Weekly** monitoring"] },
]

export const FOOTER_COLS = [
  { h: "Product", links: ["How it works", "Pricing", "Integrations", "Security"] },
  { h: "Company", links: ["About", "Careers", "Contact"] },
  { h: "Legal", links: ["Privacy", "Terms"] },
]
