# Arcova Backlog

## Product briefing — for agents

### What Arcova is
Arcova is a **biotech-specific data sourcing and intelligence layer**. It is not a CRM, not a sequencing tool, and not a workflow product. It sits behind the tools CROs already use (HubSpot, LinkedIn Sales Nav) and makes their data smarter.

### The customer
CROs at early-stage biotech companies. They typically have HubSpot with ZoomInfo data, but their contacts are stale, their TAM/SAM coverage is incomplete, and they have no systematic prioritisation process. Their current workflow: open HubSpot, pick accounts by gut feel, go to Sales Nav, find people, send emails. No signal awareness, no fit scoring, entirely manual.

### The core insight from customer research
CROs think they have a data problem solved because they have thousands of contacts in HubSpot. What they actually have is stale contact details, poor TAM/SAM coverage, and no fit context. The pain they articulate is "I don't know who to reach out to." The real pain is "I don't have good enough data."

### The four value layers — in build order

**Layer 1 — Data quality** (largely built)
Clean, enrich, and score what's already in HubSpot. Prove that the data is better. This is the wedge — the reason a CRO connects Arcova to their HubSpot in the first place.

**Layer 2 — Outreach context** (partially built)
Company summaries, ICP fit breakdowns, competitor data, customer segments — the raw material for "here's what to say when you reach out." Talking point generation per contact is the near-term build.

**Layer 3 — Coverage / new data** (not built)
Find net-new contacts at good-fit companies the user already knows, and net-new companies in their SAM they don't have at all. This is the upsell once the base is sticky. Surfaces via the Accounts page.

**Layer 4 — Signals** (not built)
Third-party public signals (job postings, funding announcements, clinical trial registrations, LinkedIn activity, FDA approvals, conference presentations). Signals are **triggers**, not ranking inputs. Fit gets the shortlist, signals tell you when to act and what to say. Signal strength hierarchy: pricing/demo intent (strong) → webinar/content engagement (medium) → LinkedIn activity (weak). Biotech-specific signals (CMC hires, phase transitions, IND filings) are the moat — meaningless to generic tools, highly relevant to biotech BD.

### The product sequence
1. **HubSpot sync** — closes the data quality loop, delivers the enriched/scored data where the CRO works
2. **Monitoring infrastructure** — built on top of sync, watches for changes that trigger re-enrichment
3. **Signals** — built on top of monitoring infrastructure
4. **Coverage / new data** — the upsell once the base is sticky

### What Arcova is not trying to be
- Not replacing HubSpot or Sales Nav
- Not a first-party signal tracker (email opens, website visits — those stay in HubSpot)
- Not a sequencing or outreach tool
- Not a place people live day-to-day long-term — the UI is a configuration and review surface; the value is delivered into HubSpot

### The moat
Biotech-specific ICP modelling, taxonomy (therapeutic areas, modalities, development stages), and signal awareness. Generic tools cannot replicate this without domain knowledge baked into the scoring and enrichment pipeline.

---

## Accounts window (Phase 2 — upsell / new data motion)

The Accounts page is a separate product motion from Leads. Rather than "work what you have", it's "here are your best-fit companies — do you have the right coverage?"

- Rank all enriched companies by ICP company fit score, regardless of whether contacts exist.
- For companies where contacts exist, show how many and a summary contact fit indicator.
- For companies where no contacts (or no good-fit contacts) exist, surface a prominent gap — "0 contacts" or "no contacts matching your buying team profile".
- The "Enrich" / "Find contacts" CTA on a coverage gap is the paid upsell moment: this is how Arcova sells new data to users who believe their CRM data is already fine.
- Key insight from customer research: prospects say "I have 14,000 contacts in HubSpot, my data is fine" — but when shown a ranked list of perfect-fit companies they have zero coverage on, the gap becomes undeniable.
- This is a product-led growth mechanic: the value is visible before the purchase.
- Do not build this as a filter on the Leads page — it is a distinct mode of working and deserves its own window.

## Product direction — core thesis

Arcova is a **data enrichment and intelligence layer that sits behind HubSpot**, not beside it. The user (CRO) works in HubSpot and LinkedIn Sales Nav as normal — Arcova's job is to answer the question they currently skip: which accounts should I be working right now, and who specifically should I talk to.

The workflow Arcova replaces: open HubSpot → pick some accounts by gut feel → go to Sales Nav → find people → send emails. No prioritisation, no signal awareness, entirely manual.

The Arcova loop:
1. Sync contacts from HubSpot
2. Enrich and score against ICP (fit score)
3. Monitor public signals on high-fit accounts (trigger layer)
4. Surface a short prioritised list with context — who to contact today and why
5. Forward: one-click to LinkedIn profile with talking point
6. Backward: push enriched data + fit scores back to HubSpot as custom fields (never overwriting native fields)

**Key decisions:**
- Arcova owns fit score and signals. HubSpot owns contact identity. No field conflicts.
- Multiple email fields: HubSpot native email untouched, Arcova verified email as a custom property. Only surfaced if meaningfully different.
- Leads view is a monitoring/review surface, not an action surface. Action happens in LinkedIn and HubSpot.
- Signals are triggers, not ranking inputs. Fit gets the shortlist, signals tell you when to act and what to say.
- Signal strength hierarchy: pricing enquiry > demo request (strong) → webinar attendance, content download (medium) → LinkedIn engagement, post comments (weak). Mostly third-party/public signals — Arcova does not own first-party engagement data.

## HubSpot integration

**Sync architecture:**
- **Primary:** HubSpot webhooks — register a webhook URL, HubSpot POSTs on contact create/update. Simple to implement (one API route, signature verification, idempotent processing). Not as much infrastructure as it sounds.
- **Safety net:** nightly pull using `lastmodifieddate` filter to catch anything missed by webhooks.
- New contacts added to HubSpot overnight are picked up automatically via webhook or next nightly pull.

**Enrichment cadence:**
- **Nightly:** signal scrape on high-fit accounts
- **Monthly:** full re-enrichment of contact details
- **Triggered:** immediate re-enrichment when a signal like a job change is detected (job change = contact details likely stale)

**Push back to HubSpot:**
- Arcova fit score, signal alerts, talking points written as custom HubSpot properties
- Never touch HubSpot native fields
- Additive layer only — CRO sees Arcova fields alongside existing data in HubSpot

**Build estimate:** ~2-3 weeks total for OAuth, webhook handler, field mapping, and push-back.

## Enrichment follow-up

- Replace the mocked contact details drawer with a real second-pass contact enrichment source.
- Replace the mocked company details drawer with a real firmographic/company enrichment source.
- Decide the production source of truth for current company and current role.
- Revisit Apollo phone reveal via webhook flow once credit impact is clear.

## Product workflow

- Bring company, role, fit, and intent into the main Leads working view once the second-pass resolver is ready.
- Design the paid upgrade experience for contacts held back by the enrichment cap.
- Decide whether fit and intent scoring runs automatically or via explicit user action.
- Enforce minimum required fields during the data upload step so rows without enough information to resolve and enrich are blocked or clearly flagged before import.

## Product storytelling and reveal

- Make the product feel more like Arcova is actively doing work on the user's behalf, rather than silently outputting tables and boxes.
- Add a clearer reveal of what Arcova did with the data after company analysis and lead enrichment.
- Show flow progress in a more agentic way, using step-by-step processing language that makes the work visible.
- Explore subtle animation or motion to support the sense of analysis, reveal, and payoff without feeling gimmicky.
- Rework underwhelming result moments so the user sees the transformation from raw input to resolved insight.

## My Profile

- Build a "My Profile" step in the setup flow, styled and structured like the My Company page.
- Scrape and enrich data on the individual user (name, role, LinkedIn, background) rather than the company.
- Store the output against the user record for use in positioning, outreach personalisation, and context-aware messaging later in the product.

## Onboarding flow

- Redesign onboarding so it feels guided and sequential rather than optional and open-ended.
- On first login, show a much simpler screen with only the first required action instead of the full product shell.
- Hide or defer other tabs, navigation items, and secondary destinations until the user completes the current onboarding step.
- Make the first-run experience feel like there is only one obvious button to press, so the user naturally follows the next prompt.
- Turn onboarding into a structured sequence of steps, with each screen clearly telling the user what to do next.
- Add visible progress cues such as "Step 1 of 4", "Step 2 of 4", and so on, so the user knows where they are and how much setup is left.
- Keep the layout more minimal during onboarding so the user is not distracted by empty states, advanced functionality, or unfinished areas of the product.
- Reintroduce the broader navigation only after the user has completed the key setup flow.
