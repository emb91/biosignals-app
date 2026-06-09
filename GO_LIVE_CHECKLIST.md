# Arcova Go-Live Checklist

## Enrichment and product switches

- Reintroduce the enrichment cap before launch.
  - Current testing state removes the cap entirely so we can validate behavior without quota interference.
  - Restore a freemium threshold before launch so free users cannot enrich unlimited contacts.
  - Current target: `25` free enriched contacts for launch.
- Replace the mocked stage-two contact drawer data with real second-pass enrichment.
- Decide and implement the production source of truth for current company and current role.
- Decide whether stage two runs automatically in the background for every enriched contact or only for plan-eligible contacts.
- Decide whether stage three scoring runs automatically or is triggered explicitly.

## Apollo-specific decisions

- Keep Apollo as the identity/contact layer only unless current-role freshness improves materially.
- Decide whether to implement Apollo phone reveal via webhook flow.
- Confirm the credit impact of Apollo phone reveal before enabling it.
- Confirm which Apollo-returned fields should remain stored-only versus shown in product.

## Security and credentials

- Regenerate all development and test API keys before launch.
- Rotate `APOLLO_API_KEY`.
- Rotate Anthropic keys used during development.
- Rotate any other provider or admin keys touched during testing.
- Verify `.env.local` values are not production values and are not being committed.

## Data and UX checks

- Confirm imported contacts only show trusted stage-one fields in the main Leads view.
- Confirm richer contact details are clearly labeled and sourced correctly before exposing them.
- Add a clear paid-plan experience for contacts held back by the enrichment cap.
- Re-test import, skipped rows, delete, and edit flows after the final stage-two provider is wired in.

## Validation before launch

- Re-run representative import tests on target customer personas, not just VC/operator edge cases.
- Re-check Apollo freshness on recent job movers.
- Resolve the pre-existing TypeScript issues in `app/my-company/page.tsx` and `app/signals/page.tsx`.
- Run a final end-to-end pass from CSV import through Leads rendering and scoring trigger behavior.
