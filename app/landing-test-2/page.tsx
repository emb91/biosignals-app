"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { motion } from "framer-motion"
import { ArrowRight, Check, ChevronRight } from "lucide-react"
import { AnimatedSection } from "@/components/animated-section"

// ─── Types ────────────────────────────────────────────────────────────────────

type SignalType = "Funding" | "Key Hire" | "Clinical" | "Leadership"

interface SignalItem {
  company: string
  domain: string
  signal: string
  type: SignalType
  fit: number
  priority: number
  context: string
  age: string
}

interface PricingTier {
  name: string
  monthly: string | null
  annualPerMonth: string | null
  annualSaving?: string
  note?: string
  featured?: boolean
  cta: string
  ctaHref: string
  features: string[]
  overages?: string[]
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const SIGNALS: SignalItem[] = [
  {
    company: "Kronos Biologics",
    domain: "kronosbio.com",
    signal: "Series B · $52M closed",
    type: "Funding",
    fit: 94,
    priority: 92,
    context: "Expanding bioreactor capacity. VP Manufacturing hired from Lonza last month.",
    age: "2 h ago",
  },
  {
    company: "Heliox Therapeutics",
    domain: "helioxrx.com",
    signal: "Head of Clinical Ops hired (ex-Pfizer)",
    type: "Key Hire",
    fit: 87,
    priority: 81,
    context: "New lead likely scoping CRO partners before Phase III.",
    age: "Yesterday",
  },
  {
    company: "Veritas CDx",
    domain: "veritascdx.com",
    signal: "Phase II enrollment complete",
    type: "Clinical",
    fit: 91,
    priority: 88,
    context: "Moving to Phase III prep — procurement window opening.",
    age: "3 days ago",
  },
]

const TYPE_STYLE: Record<SignalType, { pill: string }> = {
  Funding:    { pill: "bg-teal-50 text-teal-700" },
  "Key Hire": { pill: "bg-blue-50 text-blue-700" },
  Clinical:   { pill: "bg-emerald-50 text-emerald-700" },
  Leadership: { pill: "bg-purple-50 text-purple-700" },
}

const DIFFERENTIATORS = [
  {
    eyebrow: "Domain intelligence",
    title: "Knows what a Phase II completion means for your pipeline.",
    body: "Arcova is built on life science data. It understands clinical stages, company types, therapeutic areas, and regulatory milestones — not as tags, but as buying signals. No configuration. No keyword lists.",
  },
  {
    eyebrow: "Timing, not just fit",
    title: "Not who fits. Who's in a window right now.",
    body: "Fit scores alone don't tell you when to call. Arcova tracks the events that open procurement windows — a funding close, a new operations hire, a phase transition — and flags them the moment they happen.",
  },
  {
    eyebrow: "The daily briefing",
    title: "You don't check Arcova. Arcova finds you.",
    body: "Every morning: a ranked shortlist of the accounts worth your time today, with the reasons behind each one. No dashboard to remember to open. No list to maintain.",
  },
]

const SCORES = [
  {
    label: "Fit",
    value: 94,
    body: "How closely an account matches the customers you actually win — built from your ICP, not a generic model.",
  },
  {
    label: "Readiness",
    value: 88,
    body: "Whether the signals say this company is in a buying window right now.",
  },
  {
    label: "Priority",
    value: 91,
    body: "Where this account sits among every other opportunity competing for your time this week.",
  },
]

const TIERS: PricingTier[] = [
  {
    name: "Free",
    monthly: "$0",
    annualPerMonth: null,
    cta: "Get started free",
    ctaHref: "/login",
    features: [
      "100 credits / month",
      "1 workspace user",
      "100 active leads",
      "Monthly monitoring",
    ],
  },
  {
    name: "Starter",
    monthly: "$149",
    annualPerMonth: "$1,490",
    annualSaving: "2 months free",
    note: "per workspace",
    featured: true,
    cta: "Start Starter",
    ctaHref: "/login",
    features: [
      "2,000 credits / month",
      "Unlimited users",
      "5,000 active leads",
      "Monthly monitoring",
    ],
    overages: ["$100 / 1,000 credits"],
  },
  {
    name: "Growth",
    monthly: "$799",
    annualPerMonth: "$7,990",
    annualSaving: "2 months free",
    note: "per workspace",
    cta: "Start Growth",
    ctaHref: "/login",
    features: [
      "8,000 credits / month",
      "Unlimited users",
      "10,000 active leads",
      "Weekly monitoring",
    ],
    overages: ["$70 / 1,000 credits"],
  },
]

// ─── Sub-components ────────────────────────────────────────────────────────────

function ScorePill({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      <span className="text-[#7d909a]">{label}</span>
      <span className="rounded-full bg-[rgba(0,164,180,0.12)] px-2 py-0.5 font-semibold tabular-nums text-[#007f8c]">
        {value}
      </span>
    </span>
  )
}

function SignalRow({ item, delay = 0 }: { item: SignalItem; delay?: number }) {
  const s = TYPE_STYLE[item.type]
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      className="group flex items-start gap-4 rounded-2xl border border-[rgba(13,53,71,0.06)] bg-white p-5 shadow-[0_2px_16px_-4px_rgba(13,53,71,0.08)] transition-shadow hover:shadow-[0_8px_32px_-8px_rgba(13,53,71,0.14)]"
    >
      {/* Avatar */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eef6f6] text-[12px] font-bold text-[#0d3547]">
        {item.company.slice(0, 2).toUpperCase()}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-sm font-semibold text-[#0d3547]">{item.company}</span>
            <span className="ml-2 text-[11px] text-[#aab8bf]">{item.domain}</span>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${s.pill}`}>
            {item.type}
          </span>
        </div>
        <p className="mt-1 text-sm font-medium text-[#0d3547]">{item.signal}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-[#7d909a]">{item.context}</p>
        <div className="mt-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ScorePill label="Fit" value={item.fit} />
            <ScorePill label="Priority" value={item.priority} />
          </div>
          <span className="text-[11px] text-[#c5d0d5]">{item.age}</span>
        </div>
      </div>
    </motion.div>
  )
}

function PricingCard({ tier, annual }: { tier: PricingTier; annual: boolean }) {
  const displayPrice = annual && tier.annualPerMonth ? tier.annualPerMonth : tier.monthly
  const isEnterprise = !tier.monthly
  const showSaving = annual && tier.annualSaving

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-6 ${
        tier.featured
          ? "border-[#00A4B4]/25 bg-white shadow-[0_16px_48px_-16px_rgba(13,53,71,0.18),0_2px_8px_-2px_rgba(0,164,180,0.08)]"
          : "border-[rgba(13,53,71,0.07)] bg-white/80"
      }`}
    >
      {tier.featured && (
        <span className="absolute -top-3 left-6 rounded-full bg-[#00A4B4] px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white shadow-[0_3px_10px_-2px_rgba(0,164,180,0.4)]">
          Most popular
        </span>
      )}

      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-[#0d3547]">{tier.name}</p>
          {tier.note && <p className="mt-0.5 text-[11px] text-[#7d909a]">{tier.note}</p>}
        </div>
        {showSaving && (
          <span className="rounded-full bg-[rgba(0,164,180,0.08)] px-2 py-0.5 text-[10px] font-semibold text-[#007f8c]">
            {tier.annualSaving}
          </span>
        )}
      </div>

      <div className="mt-4">
        {isEnterprise ? (
          <p className="text-2xl font-bold text-[#0d3547]">Custom</p>
        ) : (
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold tabular-nums text-[#0d3547]">{displayPrice}</span>
            <span className="text-xs text-[#7d909a]">{annual ? "/workspace/yr" : "/workspace/mo"}</span>
          </div>
        )}
        {annual && tier.annualPerMonth && (
          <p className="mt-0.5 text-[11px] text-[#aab8bf]">billed annually</p>
        )}
      </div>

      <ul className="mt-5 space-y-2 border-t border-[rgba(13,53,71,0.05)] pt-5">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-[12px]">
            <Check className="mt-0.5 h-3 w-3 shrink-0 text-[#00A4B4]" />
            <span className="text-[#4a6470]">{f}</span>
          </li>
        ))}
      </ul>

      {tier.overages && (
        <div className="mt-4 rounded-xl bg-[rgba(13,53,71,0.025)] px-3 py-2.5">
          <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#aab8bf]">Overages</p>
          {tier.overages.map((o) => (
            <p key={o} className="text-[11px] text-[#7d909a]">{o}</p>
          ))}
        </div>
      )}

      <div className="mt-auto pt-5">
        <Link
          href={tier.ctaHref}
          className={`flex w-full items-center justify-center rounded-full py-2.5 text-sm font-semibold transition-all duration-200 ${
            tier.featured
              ? "bg-[#00A4B4] text-white hover:bg-[#009aa8]"
              : isEnterprise
              ? "border border-[rgba(13,53,71,0.15)] text-[#0d3547] hover:bg-[rgba(13,53,71,0.04)]"
              : "bg-[rgba(13,53,71,0.05)] text-[#0d3547] hover:bg-[rgba(13,53,71,0.09)]"
          }`}
        >
          {tier.cta}
        </Link>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingTest2() {
  const [annual, setAnnual] = useState(false)

  return (
    <div
      className="overflow-x-hidden"
      style={{ background: "linear-gradient(175deg, #f5fafa 0%, #eef5f5 50%, #f3f1ea 100%)" }}
    >
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-[rgba(13,53,71,0.06)] bg-[rgba(245,250,250,0.88)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/">
            <Image src="/arcova-logo.png" alt="Arcova" width={110} height={28} className="h-7 w-auto" />
          </Link>
          <div className="flex items-center gap-3">
            <a
              href="https://calendly.com/emma-arcova/30min"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden text-sm font-medium text-[#4a6470] hover:text-[#0d3547] sm:inline"
            >
              Book a demo
            </a>
            <Link
              href="/login"
              className="rounded-full bg-[#0d3547] px-5 py-2 text-sm font-semibold text-white hover:bg-[#003344]"
            >
              Get started free
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-4xl px-6 pb-6 pt-36 text-center md:pt-44">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          className="text-[3rem] font-bold leading-[1.06] tracking-[-0.03em] text-[#0d3547] md:text-[4rem]"
        >
          Know which life science
          <br />
          accounts are worth a call.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-[#4a6470]"
        >
          Funding rounds, new hires, clinical milestones. Arcova watches your entire
          market and delivers a ranked briefing every morning.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <Link
            href="/login"
            className="group flex items-center gap-2 rounded-full bg-[#00A4B4] px-8 py-3.5 text-base font-semibold text-white shadow-[0_6px_20px_-6px_rgba(0,164,180,0.4)] hover:bg-[#009aa8]"
          >
            Start for free
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href="https://calendly.com/emma-arcova/30min"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-[rgba(13,53,71,0.14)] bg-white/60 px-8 py-3.5 text-base font-semibold text-[#0d3547] backdrop-blur hover:bg-white"
          >
            Book a demo
          </a>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.32 }}
          className="mt-5 text-[13px] text-[#aab8bf]"
        >
          Free to start · No credit card · HubSpot sync included
        </motion.p>
      </section>

      {/* ── Signal briefing panel ────────────────────────────────────────── */}
      <div className="mx-auto max-w-2xl px-6 pb-24 md:pb-32">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="mt-12 overflow-hidden rounded-3xl border border-[rgba(13,53,71,0.07)] bg-white/50 shadow-[0_24px_80px_-24px_rgba(13,53,71,0.16)] backdrop-blur-sm"
        >
          {/* Panel header */}
          <div className="flex items-center justify-between border-b border-[rgba(13,53,71,0.05)] bg-white/70 px-6 py-4">
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-semibold text-[#0d3547]">Today's briefing</span>
              <span className="rounded-full bg-[#00A4B4] px-2 py-0.5 text-[10px] font-bold text-white">
                3 to review
              </span>
            </div>
            <span className="text-[11px] text-[#c5d0d5]">Updated just now</span>
          </div>

          {/* Signals */}
          <div className="space-y-2.5 p-4">
            {SIGNALS.map((s, i) => (
              <SignalRow key={s.company} item={s} delay={0.38 + i * 0.08} />
            ))}
          </div>
        </motion.div>
      </div>

      {/* ── Differentiators ─────────────────────────────────────────────── */}
      <AnimatedSection className="border-y border-[rgba(13,53,71,0.05)] bg-white/40 py-24 md:py-32">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-14 max-w-lg">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-[#00A4B4]">
              Why Arcova
            </p>
            <h2 className="text-3xl font-bold leading-[1.1] tracking-[-0.025em] text-[#0d3547] md:text-[2.4rem]">
              Apollo scores accounts.
              <br />
              Arcova tells you when to call.
            </h2>
          </div>

          <div className="grid gap-10 md:grid-cols-3">
            {DIFFERENTIATORS.map((d) => (
              <div key={d.eyebrow} className="flex flex-col gap-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#00A4B4]">
                  {d.eyebrow}
                </p>
                <h3 className="text-xl font-bold leading-[1.2] tracking-[-0.02em] text-[#0d3547]">
                  {d.title}
                </h3>
                <p className="text-[15px] leading-relaxed text-[#4a6470]">{d.body}</p>
              </div>
            ))}
          </div>
        </div>
      </AnimatedSection>

      {/* ── Score model (dark) ──────────────────────────────────────────── */}
      <AnimatedSection className="bg-arcova-navy py-24 md:py-32">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-14">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-[#8CD9C9]">
              The model
            </p>
            <h2 className="max-w-lg text-3xl font-bold leading-[1.1] tracking-[-0.025em] text-white md:text-[2.4rem]">
              Every account scored three ways — automatically.
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-white/55">
              Fit, Readiness, and Priority update every time a new signal comes in. No manual work.
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            {SCORES.map((s) => (
              <div
                key={s.label}
                className="rounded-2xl border border-white/[0.07] bg-white/[0.04] p-8"
              >
                <div className="mb-4 flex items-end gap-2">
                  <span className="text-5xl font-bold tabular-nums text-white">{s.value}</span>
                  <span className="mb-1.5 text-sm text-white/35">/ 100</span>
                </div>
                <div className="mb-5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-[#8CD9C9]" style={{ width: `${s.value}%` }} />
                </div>
                <h3 className="mb-2 text-base font-bold text-white">{s.label}</h3>
                <p className="text-[13px] leading-relaxed text-white/50">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </AnimatedSection>

      {/* ── CRM sync callout ────────────────────────────────────────────── */}
      <AnimatedSection className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="overflow-hidden rounded-3xl border border-[rgba(13,53,71,0.07)] bg-white/70 p-10 shadow-[0_8px_48px_-16px_rgba(13,53,71,0.10)] md:p-14">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-[#00A4B4]">
                CRM sync
              </p>
              <h2 className="text-3xl font-bold leading-[1.1] tracking-[-0.025em] text-[#0d3547] md:text-[2.2rem]">
                The intelligence lives where your team already works.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-[#4a6470]">
                Scores and signals sync to HubSpot automatically. Your reps see which
                accounts are hot, inside the tool they already use — without opening
                another tab.
              </p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                {["Fit score → HubSpot field", "Readiness updated on signal", "Contact enrichment synced"].map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(13,53,71,0.08)] bg-[rgba(0,164,180,0.04)] px-3 py-1.5 text-[12px] font-medium text-[#0d3547]"
                  >
                    <Check className="h-3 w-3 text-[#00A4B4]" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            {/* HubSpot record card */}
            <div className="flex items-center justify-center">
              <div className="w-full max-w-[280px] rounded-2xl border border-[rgba(13,53,71,0.07)] bg-white p-5 shadow-[0_8px_32px_-8px_rgba(13,53,71,0.12)]">
                <div className="mb-4 flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-[#F25F3A]" />
                  <p className="text-[11px] font-semibold text-[#7d909a]">HubSpot · Kronos Biologics</p>
                </div>
                {[
                  { label: "Arcova Fit Score", value: "94" },
                  { label: "Arcova Readiness", value: "88" },
                  { label: "Last Signal", value: "Series B · 2h ago" },
                  { label: "Priority Rank", value: "#1 this week" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between border-b border-[rgba(13,53,71,0.05)] py-2.5 last:border-0">
                    <span className="text-[11px] text-[#7d909a]">{label}</span>
                    <span className="text-[11px] font-semibold text-[#0d3547]">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </AnimatedSection>

      {/* ── Pricing ─────────────────────────────────────────────────────── */}
      <AnimatedSection className="py-20 md:py-28" id="pricing">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-10 flex flex-col items-start gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[#00A4B4]">
                Pricing
              </p>
              <h2 className="text-3xl font-bold leading-[1.1] tracking-[-0.025em] text-[#0d3547]">
                Start free. Scale as you grow.
              </h2>
            </div>

            {/* Annual toggle — right-aligned, understated */}
            <div className="flex items-center gap-2.5 rounded-full border border-[rgba(13,53,71,0.08)] bg-white px-1 py-1 shadow-[0_1px_4px_rgba(13,53,71,0.05)]">
              <button
                onClick={() => setAnnual(false)}
                className={`rounded-full px-4 py-1.5 text-[12px] font-semibold transition-all ${
                  !annual ? "bg-[#0d3547] text-white shadow-sm" : "text-[#7d909a]"
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setAnnual(true)}
                className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-semibold transition-all ${
                  annual ? "bg-[#0d3547] text-white shadow-sm" : "text-[#7d909a]"
                }`}
              >
                Annual
                {!annual && (
                  <span className="rounded-full bg-[rgba(0,164,180,0.10)] px-1.5 py-0.5 text-[9px] font-bold text-[#007f8c]">
                    2 months free
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TIERS.map((tier) => (
              <PricingCard key={tier.name} tier={tier} annual={annual} />
            ))}
          </div>
        </div>
      </AnimatedSection>

      {/* ── Final CTA ───────────────────────────────────────────────────── */}
      <AnimatedSection className="mx-auto max-w-6xl px-6 pb-24 md:pb-32">
        <div
          className="relative overflow-hidden rounded-3xl px-12 py-20 text-center md:px-20 md:py-24"
          style={{ background: "#003344" }}
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(ellipse 70% 80% at 15% 50%, rgba(0,164,180,0.22) 0%, transparent 60%), radial-gradient(ellipse 50% 60% at 85% 20%, rgba(140,217,201,0.14) 0%, transparent 55%)",
            }}
          />
          <div className="relative">
            <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.2em] text-[#8CD9C9]">
              Ready to start
            </p>
            <h2 className="mx-auto max-w-xl text-3xl font-bold leading-[1.1] tracking-[-0.025em] text-white md:text-[2.6rem]">
              Your market, ranked and ready every morning.
            </h2>
            <p className="mx-auto mt-4 max-w-sm text-base leading-relaxed text-white/55">
              Set up once. Arcova does the rest. Free to start.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/login"
                className="group flex items-center gap-2 rounded-full bg-[#00A4B4] px-9 py-3.5 text-base font-semibold text-white shadow-[0_6px_24px_-6px_rgba(0,164,180,0.5)] hover:bg-[#009aa8]"
              >
                Start for free
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a
                href="https://calendly.com/emma-arcova/30min"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-white/20 bg-white/[0.06] px-9 py-3.5 text-base font-semibold text-white hover:bg-white/[0.10]"
              >
                Book a demo
              </a>
            </div>
          </div>
        </div>
      </AnimatedSection>
    </div>
  )
}
