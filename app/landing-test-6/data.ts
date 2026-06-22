/**
 * Content for the Arcova landing page (variant 6). Implemented from the Claude
 * Design project "Landing Test 6". Pricing (PLANS) is the commercial source of
 * truth and is left exactly as set — do not change it here.
 */

export const HERO = {
  eyebrow: "Revenue engine for life science",
  headlineLead: "The revenue engine built for",
  headlineAccent: "life sciences.",
  sub: "Arcova watches your market, ranks who's ready to buy, and drafts the outreach. Your team just hits send.",
  note: "Free to start · No credit card · Set up with your domain in minutes",
}

// Capability strip
export const CAPS = [
  { icon: "globe", title: "Set up in minutes", body: "Start with your domain and an example customer. No lists to build, no rules to write." },
  { icon: "radar", title: "Watched 24/7", body: "Funding, trials, patents, hires and publications, tracked across your market." },
  { icon: "pen", title: "Drafted in your voice", body: "Your priorities arrive with a sequence drafted in your tone, ready to review." },
]

// How it works — connected timeline
export const FLOW = [
  { title: "Tell us your company", body: "We read your website and build your company profile, so Arcova learns what you sell and who buys it." },
  { title: "We map your market", body: "You set your ideal customer. Arcova maps the matching accounts and the people who buy." },
  { title: "You work the priorities", body: "Every morning, a ranked board: new signals, leads scored on fit and readiness, and outreach drafted for your priorities." },
]

// Differentiation — signal categories that feed the readiness score
export const CONTRASTS: { key: string; title: string; sub: string; items: string[] }[] = [
  { key: "capital", title: "Capital", sub: "Fresh budget to spend", items: ["Series A to D / IPO", "Grant awarded", "Licensing deal", "Milestone payment"] },
  { key: "momentum", title: "Momentum", sub: "Programs advancing fast", items: ["Phase transition", "Trial site expansion", "New indication", "FDA approval"] },
  { key: "people", title: "People", sub: "New decision-makers in seat", items: ["CMC leader hired", "New commercial head", "Contact changed companies", "Hiring surge"] },
  { key: "direction", title: "Direction", sub: "Strategy on the move", items: ["Co-development deal", "New therapeutic area", "Strategic partnership", "Pipeline restructure"] },
]

// Act tile — animated outreach sequence
export const ACT_STEPS = [
  { chan: "Day 1 · Email", subject: "Scaling commercial for Phase III", body: "Hi Nadia, saw Aravelle's Series B land. As you scale toward Phase III, teams at your stage usually start lining up commercial to move in step with the science…" },
  { chan: "Day 3 · LinkedIn", subject: "", body: "Sent a connection note, Nadia, sharing how a similar team staged commercial alongside their Phase III readout." },
  { chan: "Day 5 · Email", subject: "One bottleneck most teams miss", body: "The bottleneck at Phase III is rarely the science. It's having commercial ready the day data reads out. Worth 15 minutes?" },
  { chan: "Day 8 · Email", subject: "Re: Scaling commercial", body: "Bumping this up. Happy to share the playbook two of your peers used right after their Series B. No pitch, just what worked." },
  { chan: "Day 11 · Call", subject: "", body: "Voicemail: a quick idea on lining commercial up with your Phase III timeline. I'll follow with a short note." },
  { chan: "Day 14 · Email", subject: "Last note from me", body: "I'll stop here, Nadia. If timing's better next quarter as Phase III ramps, I'm around whenever it's useful." },
  { chan: "Day 18 · LinkedIn", subject: "", body: "Congrats on the new trial site expansion. Exactly the kind of milestone we help teams move on. Door's open when you are." },
]

export type Plan = {
  name: string
  desc: string
  priceMonthly: string
  priceAnnual: string
  annualList?: string // 12 months at the monthly rate — shown struck through in the annual view
  per?: string
  paid?: boolean
  featured?: boolean
  pop?: string
  cta: string
  featuresHeading: string
  // Checklists are billing-period specific: credits differ between a monthly
  // subscription and an annual (upfront) plan. Values mirror lib/billing/config.ts.
  featuresMonthly: string[]
  featuresAnnual: string[]
}

export const PLANS: Plan[] = [
  {
    name: "Free",
    desc: "Try Arcova on a real slice of your market.",
    priceMonthly: "$0",
    priceAnnual: "$0",
    cta: "Start for free",
    featuresHeading: "Includes",
    featuresMonthly: ["**100** credits / month", "**1** workspace user", "**100** lead capacity", "**Monthly** monitoring"],
    featuresAnnual: ["**100** credits / month", "**1** workspace user", "**100** lead capacity", "**Monthly** monitoring"],
  },
  {
    name: "Starter",
    desc: "Build a repeatable outbound motion.",
    priceMonthly: "$149",
    priceAnnual: "$1,490",
    annualList: "$1,788",
    per: "/workspace/mo",
    paid: true,
    featured: true,
    pop: "Most teams start here",
    cta: "Start for free",
    featuresHeading: "Everything in Free, plus",
    featuresMonthly: ["**2,000** credits / month", "**Unlimited** users", "**5,000** lead capacity", "**Monthly** monitoring"],
    featuresAnnual: ["**24,000** credits upfront", "**Unlimited** users", "**5,000** lead capacity", "**Monthly** monitoring"],
  },
  {
    name: "Growth",
    desc: "Run an always-on revenue engine.",
    priceMonthly: "$799",
    priceAnnual: "$7,990",
    annualList: "$9,588",
    per: "/workspace/mo",
    paid: true,
    cta: "Start for free",
    featuresHeading: "Everything in Starter, plus",
    featuresMonthly: ["**8,000** credits / month", "**Unlimited** users", "**10,000** lead capacity", "**Weekly** monitoring"],
    featuresAnnual: ["**96,000** credits upfront", "**Unlimited** users", "**10,000** lead capacity", "**Weekly** monitoring"],
  },
]

export const FOOTER_COLS = [
  { h: "Product", links: ["How it works", "Why Arcova", "Pricing"] },
  { h: "Company", links: ["About", "Careers", "Contact"] },
  { h: "Legal", links: ["Privacy", "Terms"] },
]
