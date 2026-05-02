# Arcova Backlog

## Accounts window (Phase 2 — upsell / new data motion)

The Accounts page is a separate product motion from Leads. Rather than "work what you have", it's "here are your best-fit companies — do you have the right coverage?"

- Rank all enriched companies by ICP company fit score, regardless of whether contacts exist.
- For companies where contacts exist, show how many and a summary contact fit indicator.
- For companies where no contacts (or no good-fit contacts) exist, surface a prominent gap — "0 contacts" or "no contacts matching your buying team profile".
- The "Enrich" / "Find contacts" CTA on a coverage gap is the paid upsell moment: this is how Arcova sells new data to users who believe their CRM data is already fine.
- Key insight from customer research: prospects say "I have 14,000 contacts in HubSpot, my data is fine" — but when shown a ranked list of perfect-fit companies they have zero coverage on, the gap becomes undeniable.
- This is a product-led growth mechanic: the value is visible before the purchase.
- Do not build this as a filter on the Leads page — it is a distinct mode of working and deserves its own window.

## Post-MVP integrations

- HubSpot connector
  - Add OAuth connect flow.
  - Import HubSpot contacts into the existing ingestion pipeline.
  - Reuse Arcova normalization and enrichment after import.
  - Start with one-time import before considering ongoing sync.

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
