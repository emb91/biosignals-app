"use client"

import type { ReactNode } from "react"
import { useState, useEffect } from "react"
import Link from "next/link"
import { motion, MotionConfig } from "framer-motion"
import { Button } from "@/components/ui/button"
import { AnimatedSection } from "@/components/animated-section"
import { ArrowRight, Check, Users, ExternalLink } from "lucide-react"

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
}

const capabilities = [
  {
    title: "Define the market that matters",
    body: "Describe your ideal customer once. Arcova filters thousands of life science companies down to the accounts that actually fit, and keeps that shortlist current as the market shifts.",
  },
  {
    title: "Catch the moment to act",
    body: "Arcova reads the events that mean a company is moving and flags the ones worth acting on the moment they land, while the trail is still warm.",
  },
  {
    title: "Reach out with real context",
    body: "Every account arrives with the research behind it, so your first message sounds like you did your homework. Draft outreach in your own voice and send when you're ready.",
  },
  {
    title: "Keep your CRM honest",
    body: "Scores and signals flow into HubSpot automatically, so the intelligence lives where your team already works instead of in another tab no one opens.",
  },
]

const scoreModel = [
  { label: "Fit", score: 94, body: "How closely an account matches the customer you actually win." },
  { label: "Readiness", score: 88, body: "Whether the buying signals say now is the time to reach out." },
  { label: "Priority", score: 91, body: "Where it ranks against everything else competing for your week." },
]

const signalTypes = ["Funding rounds", "New hires", "Clinical milestones", "Leadership changes", "M&A"]

type Tier = {
  name: string
  price: string
  priceNote?: string
  bestFor: string
  cta: string
  href: string
  featured?: boolean
  rows: { label: string; value: string }[]
}

const tiers: Tier[] = [
  {
    name: "Free",
    price: "$0",
    bestFor: "Map your market and prove the workflow",
    cta: "Start for free",
    href: "/signup",
    rows: [
      { label: "workspace user", value: "1" },
      { label: "credits / month", value: "100" },
      { label: "active leads monitored", value: "100" },
      { label: "monitoring", value: "Monthly" },
    ],
  },
  {
    name: "Starter",
    price: "$149",
    priceNote: "/workspace/mo",
    bestFor: "Build a repeatable outbound motion",
    cta: "Choose Starter",
    href: "/signup",
    featured: true,
    rows: [
      { label: "workspace users", value: "Unlimited" },
      { label: "credits / month", value: "2,000" },
      { label: "active leads monitored", value: "5,000" },
      { label: "monitoring", value: "Monthly" },
    ],
  },
  {
    name: "Growth",
    price: "$799",
    priceNote: "/workspace/mo",
    bestFor: "Run an always-on revenue engine",
    cta: "Choose Growth",
    href: "/signup",
    rows: [
      { label: "workspace users", value: "Unlimited" },
      { label: "credits / month", value: "8,000" },
      { label: "active leads monitored", value: "10,000" },
      { label: "monitoring", value: "Weekly" },
    ],
  },
]

const PRIMARY_BTN =
  "group rounded-full bg-arcova-teal px-8 py-6 text-base font-semibold text-white shadow-lg shadow-arcova-teal/20 transition-[transform,box-shadow,background-color] duration-300 hover:bg-[#00929f] hover:shadow-xl active:scale-[0.98] active:transition-none"
const GHOST_BTN =
  "rounded-full border-arcova-darkblue/15 bg-white/70 px-8 py-6 text-base font-semibold text-arcova-darkblue backdrop-blur transition-[transform,background-color] duration-300 hover:bg-white active:scale-[0.98] active:transition-none"

export default function LandingTest1() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen flex-col bg-[var(--arcova-surface-wash)] text-arcova-darkblue">
        {/* ---------- Hero ---------- */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 -z-10 [background-image:radial-gradient(circle,rgba(13,53,71,0.06)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:linear-gradient(180deg,black,transparent_72%)]" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white via-arcova-mint/5 to-transparent" />

          <div className="relative mx-auto max-w-6xl px-6 pt-28 pb-20 md:pt-36 md:pb-28">
            <div className="mx-auto max-w-3xl text-center">
              <motion.p
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="mb-6 text-xs font-semibold uppercase tracking-[0.22em] text-arcova-blue"
              >
                Agentic go-to-market for life sciences
              </motion.p>

              <motion.h1
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                transition={{ duration: 0.7, delay: 0.1, ease: "easeOut" }}
                className="text-5xl font-bold leading-[1.05] tracking-[-0.03em] text-arcova-darkblue md:text-7xl"
              >
                Intelligence that grows your revenue.
              </motion.h1>

              <motion.p
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                transition={{ duration: 0.7, delay: 0.2, ease: "easeOut" }}
                className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-arcova-darkblue/70 md:text-xl"
              >
                Arcova reads the market for buying signals and shows your team where the next deal is,
                before competitors notice it.
              </motion.p>

              <motion.div
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                transition={{ duration: 0.7, delay: 0.3, ease: "easeOut" }}
                className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
              >
                <Link href="/login">
                  <Button size="lg" className={PRIMARY_BTN}>
                    Start for free
                    <ArrowRight aria-hidden className="transition-transform duration-300 group-hover:translate-x-1" />
                  </Button>
                </Link>
                <a href="https://calendly.com/emma-arcova/30min" target="_blank" rel="noopener noreferrer">
                  <Button size="lg" variant="outline" className={GHOST_BTN}>
                    Book a call
                  </Button>
                </a>
              </motion.div>

              <motion.div
                initial="hidden"
                animate="visible"
                variants={fadeUp}
                transition={{ duration: 0.7, delay: 0.4, ease: "easeOut" }}
                className="mt-7 flex items-center justify-center gap-1.5 text-sm text-arcova-darkblue/60"
              >
                <span>Built for</span>
                <IcpTypewriter />
              </motion.div>
            </div>

            {/* Product reveal — the protagonist */}
            <motion.div
              initial={{ opacity: 0, y: 36, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.9, delay: 0.55, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto mt-16 max-w-5xl md:mt-20"
            >
              <BrowserFrame glow>
                <AccountsMock mountReveal />
              </BrowserFrame>
            </motion.div>
          </div>
        </section>

        {/* ---------- Trust strip ---------- */}
        <AnimatedSection className="border-y border-[var(--arcova-glass-line)] bg-white/40">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-6 py-10 text-center">
            <p className="text-sm text-arcova-darkblue/65">The signals that move a deal, tracked the moment they happen.</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {signalTypes.map((s) => (
                <TypePill key={s} label={s} />
              ))}
            </div>
          </div>
        </AnimatedSection>

        {/* ---------- Problem ---------- */}
        <AnimatedSection className="mx-auto w-full max-w-6xl px-6 py-24 md:py-32">
          <div className="max-w-2xl">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-arcova-blue">The problem</p>
            <h2 className="text-3xl font-bold leading-[1.1] tracking-[-0.02em] text-arcova-darkblue md:text-[2.6rem]">
              Your best accounts are buying. You just hear about it too late.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-arcova-darkblue/70">
              A funding round closes or a key hire lands, and you find out weeks later. By then a
              competitor already booked the call.
            </p>
          </div>
        </AnimatedSection>

        {/* ---------- How it works ---------- */}
        <AnimatedSection className="mx-auto w-full max-w-6xl px-6 pb-24 md:pb-32">
          <div className="mb-14 max-w-2xl">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-arcova-blue">How it works</p>
            <h2 className="text-3xl font-bold leading-[1.1] tracking-[-0.02em] text-arcova-darkblue md:text-[2.6rem]">
              One loop, from first signal to sent message
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-arcova-darkblue/70">
              It runs while you sleep. You wake up to a ranked list and the reason behind each name.
            </p>
          </div>

          <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
            <motion.ol
              className="space-y-9"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } } }}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-80px" }}
            >
              {capabilities.map((cap, i) => (
                <motion.li
                  key={cap.title}
                  variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } } }}
                  className="flex gap-4"
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-arcova-teal/10 font-mono text-sm font-semibold tabular-nums text-arcova-blue">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="text-xl font-semibold tracking-[-0.01em] text-arcova-darkblue">{cap.title}</h3>
                    <p className="mt-2 leading-relaxed text-arcova-darkblue/70">{cap.body}</p>
                  </div>
                </motion.li>
              ))}
            </motion.ol>

            <div className="lg:sticky lg:top-24">
              <BrowserFrame>
                <ContactsMock />
              </BrowserFrame>
            </div>
          </div>
        </AnimatedSection>

        {/* ---------- The model (dark band) ---------- */}
        <AnimatedSection className="bg-arcova-darkblue text-white">
          <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
            <div className="max-w-2xl">
              <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-arcova-mint">The model underneath</p>
              <h2 className="text-3xl font-bold leading-[1.1] tracking-[-0.02em] md:text-[2.6rem]">
                Every account, scored three ways
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-white/70">
                No guessing. Every account is scored on what it's worth and whether now is the time.
              </p>
            </div>
            <div className="mt-16 grid gap-5 md:grid-cols-3">
              {scoreModel.map((s, i) => (
                <div
                  key={s.label}
                  className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-8 text-center"
                >
                  <ScoreGauge value={s.score} variant="dark" delay={0.25 + i * 0.15} />
                  <h3 className="mt-5 text-lg font-semibold text-white">{s.label}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </AnimatedSection>

        {/* ---------- Pricing ---------- */}
        <AnimatedSection className="mx-auto w-full max-w-6xl px-6 py-24 md:py-32">
          <div className="mb-14 text-center">
            <h2 className="text-3xl font-bold leading-[1.1] tracking-[-0.02em] text-arcova-darkblue md:text-[2.6rem]">
              Pricing that scales with your pipeline
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-arcova-darkblue/70">
              Start free. Upgrade the workspace as your market coverage grows. Every paid plan runs the full loop.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className={`relative flex flex-col rounded-[1.5rem] border p-6 transition-all duration-300 ${
                  tier.featured
                    ? "border-arcova-teal/40 bg-white shadow-[var(--arcova-shadow-card)] lg:-translate-y-3"
                    : "border-[var(--arcova-glass-line)] bg-white/70 hover:-translate-y-1 hover:shadow-[0_18px_40px_-28px_rgba(13,53,71,0.25)]"
                }`}
              >
                {tier.featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-arcova-teal px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-wider text-white">
                    Most popular
                  </span>
                )}
                <h3 className="text-lg font-bold text-arcova-darkblue">{tier.name}</h3>
                <p className="mt-1 text-xs text-arcova-darkblue/60">{tier.bestFor}</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-arcova-darkblue">{tier.price}</span>
                  {tier.priceNote && <span className="text-sm text-arcova-darkblue/60">{tier.priceNote}</span>}
                </div>

                <ul className="mt-6 space-y-3 border-t border-[var(--arcova-glass-line)] pt-6">
                  {tier.rows.map((row) => (
                    <li key={row.label} className="flex items-start gap-2 text-sm">
                      <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-arcova-teal" />
                      <span className="text-arcova-darkblue/75">
                        <span className="font-semibold text-arcova-darkblue">{row.value}</span>{" "}
                        {row.label.toLowerCase()}
                      </span>
                    </li>
                  ))}
                </ul>

                <Link href={tier.href} className="mt-auto block pt-7">
                  <Button
                    className={`w-full rounded-full py-5 text-sm font-semibold transition-[transform,background-color] active:scale-[0.98] active:transition-none ${
                      tier.featured
                        ? "bg-arcova-teal text-white hover:bg-[#00929f]"
                        : "bg-arcova-darkblue/5 text-arcova-darkblue hover:bg-arcova-darkblue/10"
                    }`}
                  >
                    {tier.cta}
                  </Button>
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-arcova-darkblue/60">
            Fixed workspace pricing. Starter is $1,490/year and Growth is $7,990/year.
          </p>
        </AnimatedSection>

        {/* ---------- Closing CTA ---------- */}
        <AnimatedSection className="px-6 pb-28">
          <div className="mx-auto max-w-4xl overflow-hidden rounded-[2rem] bg-gradient-to-br from-arcova-teal to-arcova-blue px-8 py-16 text-center text-white shadow-[var(--arcova-shadow-card)] md:px-16 md:py-20">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-white/75">
              We make revenue growth a science
            </p>
            <h2 className="text-3xl font-bold tracking-[-0.02em] md:text-[2.6rem]">See it run on your market</h2>
            <p className="mx-auto mt-4 max-w-lg text-lg text-white/85">
              Give us your ideal customer. We'll show you the accounts worth a call this week, scored and ready.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/login">
                <Button
                  size="lg"
                  className="group rounded-full bg-white px-8 py-6 text-base font-semibold text-arcova-darkblue transition-[transform,background-color] duration-300 hover:bg-white/90 active:scale-[0.98] active:transition-none"
                >
                  Start for free
                  <ArrowRight aria-hidden className="transition-transform duration-300 group-hover:translate-x-1" />
                </Button>
              </Link>
              <a href="https://calendly.com/emma-arcova/30min" target="_blank" rel="noopener noreferrer">
                <Button
                  size="lg"
                  variant="outline"
                  className="rounded-full border-white/40 bg-transparent px-8 py-6 text-base font-semibold text-white transition-[transform,background-color] duration-300 hover:bg-white/10 active:scale-[0.98] active:transition-none"
                >
                  Book a call
                </Button>
              </a>
            </div>
          </div>
        </AnimatedSection>
      </div>
    </MotionConfig>
  )
}

/* ---------------- ICP typewriter (no fixed-width gap) ---------------- */

const ICPS = [
  "CROs",
  "CDMOs",
  "Biotechs",
  "Pharma",
  "Life Science Tools companies",
  "IVD companies",
  "Medtechs",
  "Clinical labs",
  "CSOs",
]

function IcpTypewriter() {
  const [index, setIndex] = useState(0)
  const [text, setText] = useState("")
  useEffect(() => {
    const full = ICPS[index]
    let char = 0
    const t = setInterval(() => {
      if (char <= full.length) {
        setText(full.slice(0, char))
        char++
      } else {
        clearInterval(t)
        setTimeout(() => setIndex((p) => (p + 1) % ICPS.length), 1500)
      }
    }, 80)
    return () => clearInterval(t)
  }, [index])
  return (
    <span className="relative inline-block text-left font-semibold text-arcova-blue">
      {/* invisible sizing twin reserves the width of the longest phrase */}
      <span aria-hidden className="invisible whitespace-nowrap">
        Life Science Tools companies
      </span>
      <span className="absolute left-0 top-0 whitespace-nowrap">
        {text}
        <span className="animate-pulse text-arcova-teal">|</span>
      </span>
    </span>
  )
}

/* ---------------- Product mocks (mirror the real Accounts / Contacts UI) ---------------- */

const MOCK_CARD =
  "overflow-hidden rounded-[1.5rem] bg-white/95 ring-1 ring-[rgba(13,53,71,0.07)] shadow-[0_1px_1px_rgba(13,53,71,0.04),0_10px_22px_-10px_rgba(13,53,71,0.12),0_44px_84px_-36px_rgba(13,53,71,0.22)] backdrop-blur-md text-left"

function BrowserFrame({ children, glow }: { children: ReactNode; glow?: boolean }) {
  return (
    <div className="relative">
      {glow && (
        <div className="pointer-events-none absolute -inset-x-10 -bottom-12 -z-10 h-40 rounded-[50%] bg-arcova-teal/10 blur-3xl" />
      )}
      {children}
    </div>
  )
}

function WindowChrome({ label, live }: { label: string; live?: boolean }) {
  return (
    <div className="flex items-center gap-2 border-b border-[rgba(13,53,71,0.08)] bg-[rgba(13,53,71,0.015)] px-4 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[rgba(13,53,71,0.14)]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[rgba(13,53,71,0.14)]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[rgba(13,53,71,0.14)]" />
      <span className="ml-3 text-[11px] font-medium text-[#7d909a]">{label}</span>
      {live && (
        <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-arcova-blue">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-arcova-teal opacity-60 motion-reduce:hidden" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-arcova-teal" />
          </span>
          Live
        </span>
      )}
    </div>
  )
}

function ScoreGauge({ value, variant = "table", delay = 0.25 }: { value: number; variant?: "table" | "dark"; delay?: number }) {
  const dark = variant === "dark"
  // teal when active (>=60), quiet neutral when low — no orphan accent color
  const color = dark ? "#8CD9C9" : value >= 60 ? "#00A4B4" : "rgba(13,53,71,0.32)"
  const track = dark ? "rgba(255,255,255,0.12)" : "rgba(13,53,71,0.09)"
  const r = 13
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - value / 100)
  const box = dark ? "h-20 w-20" : "h-9 w-9"
  const svg = dark ? "h-20 w-20" : "h-8 w-8"
  const num = dark ? "text-xl font-semibold text-white" : "text-[11px] font-semibold text-[#0d3547]"
  const sw = dark ? 2.6 : 3
  return (
    <div className={`relative mx-auto flex items-center justify-center ${box}`}>
      <svg viewBox="0 0 32 32" className={`${svg} -rotate-90`} aria-hidden>
        <circle cx="16" cy="16" r={r} fill="none" stroke={track} strokeWidth={sw} />
        <motion.circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          whileInView={{ strokeDashoffset: offset }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay }}
        />
      </svg>
      <span className={`absolute tabular-nums ${num}`}>{value}</span>
    </div>
  )
}

// Restrained palette: teal = action needed, neutral ink = passive/waiting
const ACTION_PILL: Record<string, string> = {
  "Reach out": "bg-arcova-teal/12 text-[#007884] ring-1 ring-arcova-teal/25",
  "Send outreach": "bg-arcova-teal/12 text-[#007884] ring-1 ring-arcova-teal/25",
  Monitor: "bg-[rgba(13,53,71,0.05)] text-[#4a6470] ring-1 ring-[rgba(13,53,71,0.08)]",
  "Await reply": "bg-[rgba(13,53,71,0.05)] text-[#4a6470] ring-1 ring-[rgba(13,53,71,0.08)]",
}

function ActionPill({ label }: { label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${ACTION_PILL[label] ?? ""}`}>
      {label}
    </span>
  )
}

const CRM_BADGE: Record<string, string> = {
  "No deal": "border-[rgba(13,53,71,0.10)] bg-[rgba(13,53,71,0.03)] text-[#7d909a]",
  "Active deal": "border-[rgba(13,53,71,0.12)] bg-[rgba(13,53,71,0.04)] text-[#4a6470]",
  Won: "border-arcova-teal/30 bg-arcova-teal/10 text-[#007884]",
}

function CrmBadge({ label }: { label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${CRM_BADGE[label] ?? ""}`}>
      {label}
    </span>
  )
}

function TypePill({ label }: { label: string }) {
  return (
    <span className="inline-flex w-fit rounded-full bg-[rgba(13,53,71,0.05)] px-2.5 py-1 text-[11px] font-medium leading-tight text-[#4a6470]">
      {label}
    </span>
  )
}

const tableContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.15 } },
}

const tableRow = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } },
}

const ACCOUNT_ROWS = [
  { company: "NeuroSynth Bio", type: "Biotech", priority: 94, contacts: 4, crm: "Active deal", action: "Reach out" },
  { company: "CellCure Therapeutics", type: "CRO", priority: 88, contacts: 6, crm: "No deal", action: "Send outreach" },
  { company: "Lumen Genomics", type: "Pharma", priority: 79, contacts: 3, crm: "No deal", action: "Monitor" },
  { company: "Helix Diagnostics", type: "Medtech", priority: 71, contacts: 2, crm: "Won", action: "Await reply" },
]

function AccountsMock({ mountReveal }: { mountReveal?: boolean }) {
  const cols =
    "grid-cols-[1.4fr_0.8fr_3.25rem] sm:grid-cols-[1.5fr_0.85fr_3.5rem_minmax(3.25rem,3.75rem)_5.25rem_6.5rem]"
  const revealProps = mountReveal
    ? { initial: "hidden" as const, animate: "show" as const }
    : { initial: "hidden" as const, whileInView: "show" as const, viewport: { once: true, margin: "-60px" } }
  return (
    <div className={MOCK_CARD}>
      <WindowChrome label="Accounts" live />
      <div className={`grid ${cols} gap-x-4 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[#7d909a]`}>
        <span>Company</span>
        <span>Type</span>
        <span className="text-center">Priority</span>
        <span className="hidden text-center sm:block">Contacts</span>
        <span className="hidden text-center sm:block">CRM</span>
        <span className="hidden text-center sm:block">Action</span>
      </div>
      <motion.div className="divide-y divide-[rgba(13,53,71,0.06)]" variants={tableContainer} {...revealProps}>
        {ACCOUNT_ROWS.map((r) => (
          <motion.div variants={tableRow} key={r.company} className={`grid ${cols} items-center gap-x-4 px-5 py-3`}>
            <span className="flex items-center gap-1 truncate text-[12px] font-medium text-arcova-blue">
              <span className="truncate">{r.company}</span>
              <ExternalLink aria-hidden className="h-3 w-3 shrink-0 text-arcova-blue/50" />
            </span>
            <span>
              <TypePill label={r.type} />
            </span>
            <ScoreGauge value={r.priority} />
            <span className="hidden justify-center sm:flex">
              <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(13,53,71,0.05)] px-2.5 py-1 text-[11px] font-semibold text-[#4a6470]">
                <Users aria-hidden className="h-3 w-3" />
                {r.contacts}
              </span>
            </span>
            <span className="hidden justify-center sm:flex">
              <CrmBadge label={r.crm} />
            </span>
            <span className="hidden justify-center sm:flex">
              <ActionPill label={r.action} />
            </span>
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}

const CONTACT_ROWS = [
  { name: "Sarah Chen", title: "VP, Clinical Operations", company: "NeuroSynth Bio", priority: 91, action: "Reach out" },
  { name: "Marcus Webb", title: "Head of Commercial", company: "CellCure Therapeutics", priority: 84, action: "Send outreach" },
  { name: "Priya Nair", title: "Director, Business Development", company: "Lumen Genomics", priority: 69, action: "Monitor" },
  { name: "James Okafor", title: "Chief Scientific Officer", company: "Helix Diagnostics", priority: 58, action: "Await reply" },
]

function ContactsMock() {
  const cols = "grid-cols-[1.3fr_1.2fr_3.25rem] sm:grid-cols-[1fr_1.2fr_1fr_3.5rem_6.5rem]"
  return (
    <div className={MOCK_CARD}>
      <WindowChrome label="Contacts" />
      <div className={`grid ${cols} gap-x-4 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-[#7d909a]`}>
        <span>Name</span>
        <span className="hidden sm:block">Title</span>
        <span>Company</span>
        <span className="text-center">Priority</span>
        <span className="hidden text-center sm:block">Action</span>
      </div>
      <motion.div
        className="divide-y divide-[rgba(13,53,71,0.06)]"
        variants={tableContainer}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-60px" }}
      >
        {CONTACT_ROWS.map((r) => (
          <motion.div variants={tableRow} key={r.name} className={`grid ${cols} items-center gap-x-4 px-5 py-3`}>
            <span className="truncate text-[12px] font-medium text-[#0d3547]">{r.name}</span>
            <span className="hidden truncate text-[11px] text-[#4a6470] sm:block">{r.title}</span>
            <span className="flex items-center gap-1 truncate text-[12px] font-medium text-arcova-blue">
              <span className="truncate">{r.company}</span>
            </span>
            <ScoreGauge value={r.priority} />
            <span className="hidden justify-center sm:flex">
              <ActionPill label={r.action} />
            </span>
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}
