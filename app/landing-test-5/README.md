# Arcova landing page — variant 5 (`/landing-test-5`)

A fresh, best-in-class marketing landing page for Arcova, built **only** from the
Arcova brand kit (`brand & messaging/Arcova_Brand_Guidelines_2026.md` + the
Messaging Master) — authored from scratch, not ported from any prior landing
markup. Layout patterns were drawn from current best-in-class B2B/AI sites via
Mobbin and rendered entirely in Arcova's visual language.

## Run

```bash
npm run dev        # then open http://localhost:3000/landing-test-5
```

The route is public and full-bleed (no app chrome). `app/ClientLayout.tsx` lists
`/landing-test-4` and `/landing-test-5` as full-bleed marketing routes so they
render with their own nav/footer and without the auth-gated app shell. The other
landing-test pages are untouched.

## What makes it different from test-3 / test-4

| | test-3 / test-4 | **test-5** |
|---|---|---|
| Hero | centered, contacts table below | **split** (copy left, live signal-feed right) |
| Features | static 2×2 bento | **interactive tabs** swapping a browser-framed product canvas |
| Setup | typing-agent demo | **horizontal 3-step stepper** |
| Every morning | three stat cards | stats + a **morning-briefing card** mock |
| Differentiation | small cards | **competitor comparison table** (Arcova vs generic data vs bolt-on AI) |
| Footer | single row | **multi-column** |

## Structure

```
app/landing-test-5/
  page.tsx            # server component — SEO/OG metadata
  LandingPage.tsx     # "use client" orchestrator (nav-scroll + reveal IO)
  landing.css         # design system, fully scoped under #lt5
  data.ts             # all copy/content (pricing centralized here)
  components/primitives.tsx   # Button, Eyebrow, Mark, icons
  sections/           # Nav, Hero, Strip, FeatureTabs, Steps, Briefing,
                      # Compare, Pricing, FinalCta, Footer
```

## Design system

- Tokens (ink / teal / mint / navy / surfaces / status / signature wash), radii,
  and shadows all per the 2026 brand guidelines, scoped under `#lt5`.
- **Manrope** for headers, **Plus Jakarta Sans** for body/UI/data — consumed from
  the `--font-manrope` / `--font-plus-jakarta` variables already loaded globally
  via `next/font` in `app/layout.tsx` (no new font loading).
- Accessible: semantic landmarks, AA body contrast (Ink, never teal/mint),
  keyboard-operable tabs + pricing toggle, `prefers-reduced-motion` respected,
  `aria-label`s on the comparison cells and decorative mocks marked `aria-hidden`.
- Responsive verified at 375 / 768 / 1280 (comparison table collapses to labeled
  cards on mobile; nav links + sign-in hide; grids stack).

## Placeholders to supply before launch

- **Hero headline** — currently `"Know which life science accounts are ready to buy."`
  is a placeholder (final tagline TBD). One-line swap in `data.ts` → `HERO.headline`.
- **Signup / demo URLs** — CTAs link to `/signup` (does not exist yet) and
  `/contact-us`. Point `data.ts` / sections at the real signup route.
- **Pricing** — Free / Starter $149 workspace / Growth $799 workspace. Annual
  prices are $1,490 and $7,990. Edit once in `data.ts` → `TIERS`; commercial
  source of truth is `strategy/pricing/pricing-model-codex-20260619/ARCOVA_PRICING_AND_CREDIT_SPEC.md`.
- **OG image** — reuses `/images/network-og.png`; swap for a landing-specific one.
- **Logos** — no customer logo wall (none available yet); credibility is carried by
  the "Signals we watch" strip + comparison table instead.
