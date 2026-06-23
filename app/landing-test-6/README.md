# Arcova landing page — variant 6 (`/landing-test-6`)

A fresh landing-page direction, authored from scratch off the Arcova brand kit
(`brand & messaging/Arcova_Brand_Guidelines_2026.md` + the Messaging Master) and
Mobbin inspiration. It does **not** reference the legacy `Landing Page.html`
structure or any other landing-test page — see the memory note
"Landing: no legacy reference."

## Run

```bash
npm run dev        # then open http://localhost:3000/landing-test-6
```

Public, full-bleed route (registered in `app/ClientLayout.tsx`).

## The direction

Centered, product-led hero (two-tone headline over the live `/today`
command-center board), a "Built for Life Sciences" segment band, a quiet
three-up capability strip, an asymmetric **Arcova Engine** bento (Fit /
Readiness / Priority / Engagement), the **Signals Arcova tracks** moat
(signal universe ↔ ranked-contacts product view), a dark always-on
how-it-works panel, the test-7 pricing block, and a punchy final CTA.

Kept in sync with the Claude Design project "Landing Test 6"
(`landing/Landing Test 6.html` + `landing-test-6.css` / `landing-signals.css`
/ `landing-pricing7.css`). The editor-only Tweaks panel and its `@import` /
`@property` chrome are intentionally omitted; fonts come from `next/font`.

## Structure

```
app/landing-test-6/
  page.tsx              # server — SEO/OG metadata
  LandingPage.tsx       # "use client" orchestrator (nav-scroll, reveal IO,
                        #   hero date/greeting, priority-score count-up, sequence anim)
  landing.css           # design system + most sections, scoped under #lt6
  landing-signals.css   # "Signals Arcova tracks" section
  landing-pricing7.css  # pricing block, scoped under #pt7
  data.ts               # copy/content (pricing PLANS + COMPARE centralized)
  components/primitives.tsx
  sections/             # Nav, Hero, BuiltFor, Caps, Bento, Signals,
                        #   HowItWorks, Pricing, FinalCta, Footer
```

## Design system

- Tokens, radii, shadows, signature wash — all from the 2026 brand guidelines,
  scoped under `#lt6`. **Manrope** headers / **Plus Jakarta Sans** body, consumed
  from the global `next/font` variables (no new font loading).
- Accessible: semantic landmarks, AA body contrast, keyboard-operable pricing
  toggle, `prefers-reduced-motion` honored, product mocks `aria-hidden`.
- Responsive verified at 375 / 1280 (bento, pillars, pricing, impact, flow all
  collapse to one column; nav links + floating card hide on mobile).

## Placeholders to supply before launch

- **Hero headline** — use concise product positioning, not old slogan copy
  (final tagline TBD); one-line swap in `data.ts` → `HERO`.
- **Pricing** — Free / Starter $149 workspace / Growth $799 workspace. Annual
  prices are $1,490 and $7,990. Edit once in `data.ts` → `PLANS`; commercial
  source of truth is `strategy/pricing/pricing-model-codex-20260619/ARCOVA_PRICING_AND_CREDIT_SPEC.md`.
- **Signup / demo URLs** — CTAs point at `/signup` (doesn't exist yet) and
  `/contact-us`.
- **OG image** — reuses `/images/network-og.png`.
- **Logos** — no customer logo wall (none available); proof is the impact band +
  pillars instead.
