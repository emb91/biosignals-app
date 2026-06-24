# Conference signal — Phase 3: Social-intent (CONTACT-level)

Detects **people self-declaring conference attendance on social** — "presenting at #ASCO26",
"come see us at booth 1203, #SITC25", "excited for #JPM26 next week". This is a **contact-level**
signal that **complements** the already-shipped company-level exhibitor signal
(`exhibiting_at_conference`). Where the exhibitor signal says *"this company has a booth"*, this one
says *"this specific person is going"* — a warmer, more actionable datum for a 1:1 reach-out.

- Company-level (Phase 1/2, shipped): `lib/signals/conference/run-conference-monitor.ts`,
  catalog key `exhibiting_at_conference`, scope `company`.
- This doc (Phase 3): contact-level `attending_conference`, scope `contact`.
- Scaffold (NEW files, no monitor wiring yet): `lib/signals/conference/social/{types.ts,apify-source.ts}`.
- Reused phase model: `lib/signals/conference/conference-phase.ts` (unchanged).

## Scope refinements (Emma)

- **LinkedIn only — drop X/Twitter.** X is paid (no free hashtag-search source since the 2023 API
  lockdown) and the evaluation found it resolves to a *person* adequately but to a *company* poorly —
  so it's both more expensive and lower-quality for the company+contact resolution we need. Out of
  scope; revisit only if a genuinely **free** X source appears. The X actor recs below are kept as
  reference only, not part of the build.
- **Cost = posts, not runs.** The actor is priced per result, so batching runs together saves nothing.
  The cost levers are **fewer posts** — per-conference post caps, in-window-only, and tight hashtag
  queries — never bigger batches.
- **Load-spreading is automatic.** With a single platform and per-conference, in-window jobs, scrapes
  spread across the calendar on their own (BIO in June, SfN in November). No separate "stagger across
  days" mechanism is needed — the event-date window *is* the spreader.

---

## 1. Recommended Apify actors

Evaluated 2026-06-24 via the Apify MCP `search-actors`. Criteria: hashtag/keyword **search**
input, **author** fields (name, headline/title, company, profile URL), reliability/usage, cost.

### LinkedIn — primary: `harvestapi/linkedin-post-search` (id `buIWk2uOUzTmcLsuB`)

| Dimension | Detail |
|---|---|
| **Input** | `searchQueries: string[]` (literal LinkedIn search-bar string → a hashtag like `#ASCO26` is a direct query), plus `postedLimit`/`postedLimitDate` (window scoping), `sortBy`, `profileScraperMode` |
| **Output** | Posts come back **with the author block**: name, headline, profile URL, and current company — exactly the resolution input, no second profile call needed |
| **Reliability** | ~3,900 monthly users, **99.7% success**, 4.94★. No cookies / no account |
| **Cost** | **$0.002/post** (FREE/BRONZE) → $0.0015 (GOLD+); $0.001 per 0-result query |
| **Why** | Same `harvestapi` vendor we already run in `lib/apify.ts` (profile + company actors) — proven and consistent with our cost tracking. Author employer data is structured, which makes person→company resolution far stronger than on X |

Why not the alternatives considered: `harvestapi/linkedin-profile-posts` and `…/linkedin-company-posts`
scrape a **known** profile/company's feed — they need the target up front, so they can't *discover*
who's posting about a hashtag. `easyapi/twitter-top-hashtags-scraper` and the various "trends"
actors return aggregate hashtag *rankings*, not the underlying posts/authors. Only `…-post-search`
does hashtag→posts→authors in one call.

### X / Twitter — secondary: `khadinakbar/x-tweet-scraper` (id `rmq9TEULqx95AyQTX`)

| Dimension | Detail |
|---|---|
| **Input** | native `hashtags: string[]` + `mentioning`, `startDate`/`endDate`, `sort`, `onlyVerified` — no advanced query string required |
| **Output** | tweet text + engagement + author info + media |
| **Reliability** | 98.6% success; no login required by default |
| **Cost** | **$0.003/tweet**. Cheaper sibling `seemuapps/x-tweet-scraper` (id `eGmQvYzZpTLaeouyj`) at **$0.001/tweet** is a fine cost-down swap if author depth suffices |
| **Caveat** | X structures employer poorly — `company` is usually only inferable from bio text. X posts resolve to a **person** more reliably than to a **company**; treat as lower-confidence |

**Recommendation:** ship **LinkedIn first** (best author/employer data, vendor we already use). Add
**X** as an opt-in second network where reach matters more than employer precision.

### ToS / rate-limit reality (honest)

- **LinkedIn aggressively rate-limits** and its User Agreement prohibits scraping. The no-cookies
  actor shifts that exposure onto Apify infra but does **not** make it ToS-clean — runs can degrade
  or return empty without notice. This is a **per-conference ToS gate**, identical to the exhibitor
  sources (`docs/conference-sources.md`: "ToS is a per-show field, not optional"). A green run is not
  a durable contract.
- **X** is comparatively tolerant of public search but still rate-limits; the login-free path is the
  most fragile part of any X actor.
- Both target **public self-declarations** — the author chose to post "I'll be at #ASCO26" — which is
  the most defensible category of social signal. Still: reachable ≠ permitted to resell. Gate on the
  same per-conference `tos_status` the exhibitor pipeline uses before turning a show on.

---

## 2. Signal design

### Input — per-conference social tags

Each active conference needs a small set of hashtags/initials to search. These live on the
`conferences` row as a new column:

```sql
-- migration (DRAFT — not applied in this pass)
ALTER TABLE conferences ADD COLUMN social_tags text[] NOT NULL DEFAULT '{}';
-- e.g. ASCO 2026 → ARRAY['#ASCO26', '#ASCO2026', 'ASCO 2026']
```

Tags are show-specific and year-specific (`#ASCO26` ≠ `#ASCO25`). Seed them in the wide registry
alongside `start_date`/`end_date`. Pass them to the adapter as `ConferenceForSocialScrape.socialTags`
(see `social/types.ts`).

### Pipeline

```
for each conference in an active pre-event/live window:
  1. SCRAPE   Apify actor (LinkedIn and/or X) with the conference's social_tags
                → SocialPostRecord[]  (post text + normalized author block + matchedTags)
  2. FILTER   keep only posts that ASSERT attendance (text heuristic, §precision)
                → drop spectator chatter, news, vendor ads about the show
  3. RESOLVE  author → canonical PERSON (people) + company
                — strongest identifier first: profileUrl > (name + company) > name
                — reuse the existing person/company resolution + the fail-closed
                  admission guard (resolver-provenance-admission), matchType
                  'verified_social_attendee', acceptedSourceFields ['author_name']
  4. SCOPE    only emit if the resolved person is one of the user's owned contacts
                (assertUserOwnsSignalEntity, requireContactCompanyMatch) — same
                ownership gate the legacy mirror uses
  5. EMIT     CONTACT-level `attending_conference` via ingestSignalSourceEvent +
                normalizeSignalSourceEvent (entityScope 'contact', contactId set),
                with the conference-date PHASE in metadata driving the angle
  6. RECOMPUTE recomputeContactReadiness + recomputeAccountReadiness for the
                contact's company (mirrors readiness-signal-events.ts)
```

Resolution + admission is the trust boundary. A social author is a **weaker** identifier than an
exhibitor company name, so the admission guard is **fail-closed**: ambiguous matches are dropped, not
guessed. For medium-confidence name matches, an optional LLM screener (mirroring
`sec-form-d-screener.ts`) can upgrade — but default-deny without it.

### Lifecycle — reuse the conference-date phase (unchanged)

Same `conferencePhase(start, end, now)` as the company signal:

| Phase | When | Contact-level angle |
|---|---|---|
| `upcoming` | before start | "saw you're heading to ASCO — worth grabbing 15 min while you're there?" |
| `live` | during | "noticed you're at ASCO today — around for a quick coffee?" |
| `recent` | 0–21d after end | "hope ASCO went well last week — …" |
| `expired` | >21d after end | dead — suppress (hard expiry, enforced in the monitor) |

Phase is computed on read from the two dates carried in metadata. **Do not store it.** Posts found
for an already-`expired` conference are skipped before emit.

### Precision / noise handling

The hard part. A hashtag match is **not** an attendance assertion. Three layers:

1. **Assertion filter (cheap, no LLM).** Require a first-person attendance cue in the post text:
   - positive cues: `presenting`, `speaking`, `i'll be at`, `we'll be at`, `see you at`,
     `come by booth`, `stop by booth`, `our booth`, `join us at`, `attending`, `heading to`,
     `excited for … <tag>`, `find me at`.
   - negative cues (down-weight / drop): `couldn't make it`, `wish i was at`, `watch the livestream`,
     `recap of`, `last year at`, `read about … at <tag>` (news/observer voice), pure retweets/reposts.
   - Result is an `AttendanceAssertion { asserts, confidence, cue }` (see `types.ts`).
2. **Confidence scoring.** Combine: assertion cue strength × author-resolution strength (profileUrl
   match = high; name-only = low) × network (LinkedIn > X for employer certainty). **Gate emission at
   `confidence >= 0.6`.** Medium band (0.4–0.6) is where the optional LLM screener earns its keep.
3. **Dedupe per (person, conference).** One signal per person per show regardless of how many posts
   they make. Dedupe key:
   `conference-social:{conference_id}:{contact_id}:attending_conference` — checked against
   `signal_source_events` exactly like the exhibitor monitor's
   `fetchExistingSourceEventIds` (so re-scrapes emit only net-new attendees). Keep the highest-
   confidence post as the evidence (`postUrl` → `evidence_url`).

### Cadence — reuse `monitorDueForUser`, runner `conference-social`

- **Per-user surfacing** is plan-tiered exactly like every other signal: call
  `monitorDueForUser(admin, { userId, runner: 'conference-social' })` →
  growth weekly / starter+free monthly (`lib/signals/monitor-cadence.ts`). No new cadence code.
- **Shared scrape gating:** only scrape conferences in an **active pre-event/live window** —
  `conferencePhase(start, end, now) !== 'expired'` AND within a sensible pre-event lead (e.g. start a
  show's social scraping ~6 weeks out; the signal is most actionable in the `upcoming`/`live` phases).
  Skip `recent`+`expired` shows entirely (post-event self-declarations have little forward value and
  burn budget). Like the exhibitor delta, the social scrape is **shared across users** and deduped at
  `signal_source_events`, so attribution stays per-user/plan-tiered while the scrape runs once.

### Cost guardrail

Social scraping is **paid Apify** (unlike the cheap HTTP/PDF exhibitor pulls), so it needs a real
gate:

- **Window gate (primary):** only in-window conferences are scraped (above). An `expired`/`recent`
  show is never queried → zero spend on dead shows.
- **Per-conference cap:** `DEFAULT_MAX_POSTS_PER_CONFERENCE = 200` (`apify-source.ts`) caps
  `maxPosts`/`maxTweetsPerQuery` so one viral hashtag can't run up unbounded cost. At $0.002/post a
  capped LinkedIn run is ≤ ~$0.40/conference/scrape.
- **`postedLimit` scoping:** scrape only recent posts (`postedLimit: 'month'`/`'week'`), not history,
  so each run pays for net-new chatter only.
- **Cost tracking:** when productionized, route through `runApifyActor` (`lib/apify.ts`) so spend
  lands in `apify_run_usage`, and/or `recordProviderUsage({ provider: 'apify', … })`
  (`lib/provider-usage.ts`) so it shows on `/admin/llm-usage`'s "Data & enrichment cost". **Do not
  hand-roll a fetch** — that bypasses cost tracking. (The stub deliberately does not, and says so.)

---

## 3. SignalKey + catalog entry to add

**Do NOT edit the shared readiness files in this pass.** Apply these when productionizing.

Add to `lib/signals/readiness-types.ts` `SignalKey` union:

```ts
  | 'attending_conference'
```

Add to `lib/signals/readiness-catalog.ts` `READINESS_SIGNAL_CATALOG` (next to the existing
`exhibiting_at_conference` entry). Note `scope: 'contact'` — this is the contact-level sibling:

```ts
  {
    signalKey: 'attending_conference',
    scope: 'contact',
    dimensions: ['new_needs', 'new_strategy'],
    // Phase-based lifecycle (upcoming/live/recent) with hard expiry 21d post-event,
    // enforced in the monitor via conference-phase.ts. decayDays is the scoring
    // backstop so an emitted signal fades over ~the same window.
    decayDays: 30,
    buyerFunctions: ['business_development', 'commercial', 'partnerships'],
    intentMechanisms: ['commercial_interest'],
    notes: 'A specific person is self-declaring attendance at a relevant conference on social — a warm, 1:1-actionable in-market signal; phase drives the outreach angle.',
  },
```

Optionally add a base-impact override in the `SIGNAL_IMPACT_OVERRIDES` map (where
`grant_award: 50` lives) — suggest `attending_conference: 34`, slightly above the company-level
`exhibiting_at_conference` because a named attendee is more actionable than a company booth, but kept
modest because the source identifier (a social post) is softer than a verified exhibitor list.

---

## 4. Scaffold delivered (NEW files only)

- `lib/signals/conference/social/types.ts` — `SocialPostRecord`, `SocialPostAuthor`,
  `ConferenceForSocialScrape`, `AttendanceAssertion`, `SocialPostSource` interface.
- `lib/signals/conference/social/apify-source.ts` — chosen actors + input/output mapping
  (`buildLinkedInInput`/`buildXInput`), per-conference cost cap, and stub `SocialPostSource`
  implementations that `throw` with a clear productionize TODO (no real fetch → no untracked spend).

No monitor wiring, no migration applied, no shared file edited, no deps added.
```

(Companion docs: `docs/CONFERENCE_SIGNAL_PLAN.md`, `docs/conference-sources.md`.)
