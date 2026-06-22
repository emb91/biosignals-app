<wizard-report>
# PostHog post-wizard report

The wizard completed a deep integration of PostHog analytics into Arcova. The project already had `posthog-js` installed and a `PostHogProvider` wired into the root layout; this run completed the setup by adding a reverse proxy, server-side tracking, and 10 business-critical event captures across 7 files.

**Infrastructure changes:**
- `next.config.mjs` — added `/ingest/*` reverse proxy rewrites and `skipTrailingSlashRedirect: true` to route PostHog traffic through the Next.js server, avoiding ad-blocker interference.
- `app/posthog-provider.tsx` — switched `api_host` to `/ingest`, added `defaults: '2026-01-30'`, enabled `capture_exceptions: true` for error tracking, and removed the hardcoded host fallback.
- `lib/posthog-server.ts` (**new**) — singleton `posthog-node` client for server-side event capture; reads key and host from `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST`.
- `.env.local` — `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` written with the project's real values.

**Events instrumented:**

| Event | Description | File | Side |
|---|---|---|---|
| `login_submitted` | User submitted the login form | `app/login/page.tsx` | Client |
| `signup_submitted` | User submitted the signup form | `app/login/page.tsx` | Client |
| `icp_created` | A new target company profile (ICP) was saved | `app/api/icps/route.ts` | Server |
| `contacts_imported` | A CSV batch of contacts was uploaded and queued for enrichment | `app/api/import-contacts/route.ts` | Server |
| `outreach_dispatched` | Outreach sequences sent to lemlist | `app/outreach/page.tsx` | Client |
| `outreach_step_edited` | A sequence message step was saved after editing | `app/outreach/page.tsx` | Client |
| `outreach_sequence_deleted` | An outreach sequence was deleted from the queue | `app/outreach/page.tsx` | Client |
| `coverage_target_set` | User set or updated a GTM revenue/deal target | `app/api/coverage/target/route.ts` | Server |
| `hubspot_connect_started` | User initiated the HubSpot OAuth flow | `app/api/nango/session/route.ts` | Server |
| `hubspot_disconnected` | User disconnected the HubSpot CRM integration | `app/api/hubspot/disconnect/route.ts` | Server |

## Next steps

A dashboard and five insights have been created in PostHog:

- [Analytics basics (wizard) — Dashboard](https://us.posthog.com/project/479229/dashboard/1739994)
- [Activation funnel: Signup → ICP → Import → Outreach](https://us.posthog.com/project/479229/insights/SxeTJKsm)
- [Contact imports over time](https://us.posthog.com/project/479229/insights/aCyiXxRa)
- [Outreach dispatched over time](https://us.posthog.com/project/479229/insights/bnWDP7wQ)
- [Platform setup actions](https://us.posthog.com/project/479229/insights/2IVzd59r)
- [Active users (logins)](https://us.posthog.com/project/479229/insights/vJQaUVTX)

## Verify before merging

- [ ] Run a full production build (`npm run build`) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` to Vercel environment variables (they are in `.env.local` but not yet in Vercel — see the Vercel env deploy blocker in memory).
- [ ] Wire source-map upload (`posthog-cli sourcemap` or equivalent) into CI so production stack traces de-minify in PostHog Error Tracking.
- [ ] Confirm the returning-visitor path also calls `identify` — `PostHogIdentify` in `posthog-provider.tsx` handles this for authenticated sessions, but verify it fires correctly after a page refresh.

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-nextjs-app-router/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
