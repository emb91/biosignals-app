# Conference signal — Phase 2: Presenters / Speakers (`presenting_at_conference`)

A new **contact-level (+ company-level)** signal that fires when a person in the user's book is a
named **speaker, presenter, poster author, chair, or moderator** at a relevant life-science
conference. Distinct from the already-built `exhibiting_at_conference` (company-only, from exhibitor
floor plans). The actionable difference: an exhibitor signal says *"this company has a booth"*; a
presenter signal says *"**this specific person** is on stage at X on Tuesday"* — a far warmer,
contact-scoped outreach trigger ("good luck with your talk at X" / "how did the session go").

Design mirrors the established pattern exactly: external source → shared mirror with
resolver-at-ingest → per-user monitor reads the mirror → emits via `signal_source_events` (deduped)
→ recompute. Reuses `conference-phase.ts` verbatim, reuses `monitorDueForUser` for plan cadence, and
reuses the publications-monitor's person/affiliation matching as the contact-resolution precedent.

Companion docs: `CONFERENCE_SIGNAL_PLAN.md` (Phase 1 exhibitor build), `conference-sources.md`
(platform landscape). Scaffold: `lib/signals/conference/presenters/**` (NEW files only).

> **Status of this doc:** design + thin scaffold only. No pipeline wired, no shared files edited, no
> migration applied, nothing committed. All curl proofs below are live, no-auth, 2026-06-24.

## Scope refinements (Emma)

1. **Forget emails.** Do NOT pursue email capture (journal-supplement corresponding-author emails etc.).
   The signal needs **who + which session + which company + when** only — name + affiliation + session +
   role. Contact resolution maps the named presenter to an existing person in the user's book; we don't
   need to harvest a new email. Drops the riskiest/most-fiddly piece and keeps it contact-matching, not
   contact-acquisition. (The `abstract_url` is kept as evidence, not for scraping emails.)

2. **Build against LAST YEAR's published programs.** Next-year agendas publish late, so build and
   validate every parser against the **most recent published program** (often last year's). The
   eventScribe / abstract URL pattern is stable per society — the org swaps next year's program in at the
   same path when it's ready — so a parser proven on `…2025` lights up automatically for `…2026` once the
   registry row points at the current slug. Practical upshot: the registry stores the URL *pattern* per
   society; the sync re-polls it and starts returning the new year's presenters when the org republishes.

---

## 1. Acquisition — where presenter/speaker/session data is publicly pullable

The Phase 1 exhibitor work proved "one parser, many shows" on the **exhibitor** surface. The same
platforms host a separate **agenda / advance-program** surface (sessions + named speakers), and the
advance program publishes **weeks before the event** — which is exactly the `upcoming` phase we want.

Status legend (same as `conference-sources.md`): ✅ clean public pull · 🟡 partial · 🔴 gated/JS.

| Platform | Agenda/speaker access method | Names | Affiliations | Session titles | Emails | Status |
|---|---|---|---|---|---|---|
| **CadmiumCD / eventScribe** | `GET {event}.eventscribe.net/agenda.asp?pfp=FullSchedule&all=1` — server-rendered full schedule; per-presenter detail `GET /ajaxcalls/presenterInfo.asp?HPRID={id}` | ✅ | ✅ | ✅ | 🔴 (not in agenda) | ✅ **cracked** |
| **ACR-style society WordPress abstract archive** | `GET acrabstracts.org/abstract/{slug}/` — `authors-and-affiliation` block, `<sup>`-keyed institutions | ✅ | ✅ | ✅ (abstract title) | 🔴 | ✅ **cracked** |
| **AACR / abstractsonline (OASIS)** | `abstractsonline.com/pp8/#!/{eventId}` itinerary planner | ✅ | ✅ | ✅ | 🔴 | 🔴 JS/REST (OASIS API path is per-event, not curl-trivial) |
| **SPARGO / a2zinc session planner** | sibling of the cracked `Exhibitors.aspx` — `Public/SessionsList.aspx` / itinerary planner on the same `events.jspargo.com/{event}` host | likely ✅ | partial | ✅ | 🔴 | 🟡 (not yet curl-verified for presenters; same host family as the cracked exhibitor path) |
| **Society self-hosted advance-program PDF** | direct PDF on the org site (same shape as the ESMO/CPHI exhibitor PDFs) | ✅ | ✅ | ✅ | 🔴 | ✅ clean where published (per-show) |
| **Abstract supplement (journal)** | published abstract supplement (e.g. *Journal of Clinical Oncology*, *Cancer Research*) — DOI/PDF | ✅ | ✅ | ✅ | 🟡 corresponding-author email sometimes printed | ✅ clean (per-journal; this is the **email-capture** surface — see §3) |
| **Swapcard / Terrapinn** | same as Phase 1 — per-event auth / JS-hydrated | — | — | — | — | 🔴 not cracked |

### Verified source #1 — CadmiumCD / eventScribe (the high-leverage one)

eventScribe is the agenda/itinerary-planner half of CadmiumCD (the **same vendor** behind Conference
Harvester, which Phase 1 already cracked for SITC + SLAS exhibitors). The full schedule is
**server-rendered** — no headless browser needed.

**Proof (ASCPT 2026, `ascpt2026.eventscribe.net`, curl 2026-06-24):**

```
GET https://ascpt2026.eventscribe.net/agenda.asp?pfp=FullSchedule&all=1
  → HTTP 200, 211 KB text/html
  → 145 distinct named presenters (presenterInfo.asp?HPRID=… links)
  → 79 PresentationIDs, 108 "Chair", 7 "Moderator", 178 "Speaker" markers
```

Each speaker renders inline as name + credential + **affiliation** + **role**:

```html
Chair: <a class="loadbyurl popup-link"
   data-url="/ajaxcalls/presenterInfo.asp?HPRID=830451">Sandra A.G Visser, PhD (she/her/hers)</a>
   &ndash; Quantivis LLC, ASCPT President
```

Real extracted rows (name — affiliation):
- `Sarah Kim, PhD — University of Florida`
- `Dan M. Roden, MD — Vanderbilt University Medical Center`
- `Brian W. Corrigan, PhD — Metrum RG`
- `Veronique Michaud, PhD — GalenusRx`
- `Gwenn S. Smith, PhD — Johns Hopkins School of Medicine`

Per-presenter detail (`/ajaxcalls/presenterInfo.asp?HPRID=830451` → HTTP 200, 40 KB) carries the
presenter bio + their session list — a per-person enrich path (gate it, one request per presenter).

**Honesty caveat:** the eventScribe **subdomain slug is per-event and must be discovered**, not
guessed. `ascpt2026` works; `sitc2025`/`aacr2025`/`sitc2024` returned the 714-byte 404 shell (those
societies use different eventScribe slugs or host their agenda elsewhere). So the registry needs a
discovered `agenda_source_url` per show, exactly like Phase 1 needed a discovered
`exhibitor_source_url`. The platform parser is reusable; the per-event slug is data.

### Verified source #2 — ACR-style society WordPress abstract archive

Society-hosted abstract archives (ACR = American College of Rheumatology, `acrabstracts.org`, a
WordPress site) publish every abstract as a clean public page with named authors + affiliations.

**Proof (`acrabstracts.org`, curl 2026-06-24):**

```
GET https://acrabstracts.org/meetings/2026-prsym/   → HTTP 200, 120 KB (links to every abstract)
GET https://acrabstracts.org/abstract/{slug}/        → HTTP 200, 131 KB
  → <div class="authors-and-affiliation">Bona Paek …</div>
  → <sup>-keyed institutions: "University", "Department of …", "Division of …"
```

Author names + numbered affiliations + abstract (session) title are all in the raw HTML — the same
`name + affiliation` shape the publications-monitor already consumes from PubMed. This generalizes to
the many societies that run an OpenConf/WordPress abstract archive.

### Honest gaps
- **Emails are not in agendas.** eventScribe/ACR/abstractsonline never print attendee emails. The
  only ethical contact-level email surface is the **published corresponding-author email** in a
  journal abstract supplement (see §3) — and even then it's the *paper's* corresponding author, which
  may not be the conference speaker. Treat email capture as opt-in / low-yield, never the primary join.
- **abstractsonline (OASIS)** is the big AACR/ASCO/AHA itinerary platform; its data is behind a
  per-event REST path we did not crack with bare curl (the `pp8` shell is JS). Headless render or the
  journal abstract supplement is the fallback for those societies.
- **SPARGO session planner** is the same host family as the cracked exhibitor path and very likely
  server-renders sessions too, but I did not curl-verify a presenter list this pass — flagged 🟡,
  not claimed.

---

## 2. Schema — `conference_appearances_local` (sibling mirror to `conference_exhibitors_local`)

A NEW mirror table, modeled on `conference_exhibitors_local`, that carries presenter/session fields
**and** resolver-at-ingest provenance for **BOTH** a canonical company **AND** a canonical person.
Keeping it a separate table (rather than an `appearance_type` column on the exhibitor mirror) is the
clean choice: the row shape is genuinely different (person fields, session fields, two resolver
arrays), the unique key is different, and the Phase 1 exhibitor table + its monitor stay untouched.

Draft DDL lives at `lib/signals/conference/presenters/migration-draft.sql` (NOT applied). Shape:

```sql
create table conference_appearances_local (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references conferences (id) on delete cascade,

  -- person / role
  speaker_name_raw     text not null,
  speaker_name_normalized text,        -- lowercased "last f" token for person matching
  speaker_title        text,           -- "Chief Medical Officer" / "PhD" credential line
  appearance_type      text not null,  -- 'speaker' | 'poster' | 'chair' | 'moderator' | 'presenter'
  session_title        text,
  affiliation_raw      text,           -- "University of Florida" / "Metrum RG" as printed
  abstract_url         text,

  -- provenance (matches the exhibitor mirror shape)
  source text not null,
  source_url text,
  fetched_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  -- resolver-at-ingest: canonical COMPANY (from affiliation_raw)
  mentioned_company_ids uuid[],
  mentioned_company_matches jsonb,

  -- resolver-at-ingest: canonical PERSON (from speaker_name + affiliation)
  mentioned_contact_ids uuid[],        -- canonical people.id matches
  mentioned_contact_matches jsonb,     -- [{ source_field, source_text, person_id, company_id,
                                        --    resolved_by, confidence, verified, verification_reason }]

  unique (conference_id, speaker_name_normalized, session_title)
);
```

Indexes: GIN on `mentioned_company_ids`, GIN on `mentioned_contact_ids`, trigram on
`speaker_name_normalized`, btree on `conference_id`. Plus a `conference_appearance_sync_runs` run-log
table mirroring `conference_exhibitor_sync_runs`. RLS enabled (admin-written, like the exhibitor
mirror). The `conferences` registry row gains an `agenda_source_url` column (the presenter analog of
`exhibitor_source_url`) — that ALTER is in the draft too, but the registry seed/wide pass owns it.

Field mapping from the retired `company_conference_appearances` (which captured the right SCOPE):
`appearance_type`, `speaker_name`, `speaker_title`, `session_title`, `matched_contact_id`,
`abstract_url` → all rebuilt above, now in the clean shared-mirror pattern (resolver-at-ingest +
`mentioned_*` arrays instead of a single `matched_contact_id`, and shared across users instead of
per-user LLM web-search rows).

---

## 3. Entity resolution — speaker → canonical person + company

Resolution happens **once at sync** (in `sync-conference-appearances-delta.ts`, NOT built this pass),
identical in spirit to the exhibitor delta. Two resolvers run per appearance row:

**Company (from `affiliation_raw`)** — reuse `buildCompanyMentionMatches` +
`verifiedMentionCompanyIds` verbatim (the exact helpers the exhibitor delta uses). `Quantivis LLC`,
`Metrum RG`, `University of Florida` go straight through the existing company resolver.

**Person (from `speaker_name` + affiliation)** — reuse the **publications-monitor precedent**, which
already resolves people from author names cross-checked against company affiliations:
- `authorQueryToken(fullName)` → the `"Last F"` token (already exported logic to mirror).
- The disambiguation guard is the key reuse: a bare `"Visser S"` token matches thousands of people,
  so admission requires the **affiliation to also match the person's company** — exactly
  `companyInAffiliations(companyName, aliases, [affiliation_raw])` from the publications monitor. A
  speaker is admitted as a canonical `people` row only when (a) the `"Last F"` token matches a
  person at one of the user's tracked companies **and** (b) that person's company name appears in the
  appearance's `affiliation_raw`. This is the same two-factor `verified_pubmed_author_affiliation`
  admission, re-skinned as `verified_conference_speaker`.
- The monitor then reads `mentioned_contact_ids` overlap against the user's contacts (scoped by
  `user_id`, per the contacts-per-user rule), never re-resolving.

**Published corresponding-author emails (contact-level enrichment without Apollo):** when the source
is an **abstract supplement** that prints the corresponding-author email, capture it into
`mentioned_contact_matches[*].published_email` as *provenance only* (source = the public abstract).
It is NOT auto-written to `people.email` or used to enrich silently — it's surfaced as evidence on the
signal card and gated behind the same ethics posture as the rest of the pipeline (US/CCPA; the email
was published by the author themselves in a public scientific abstract). Most agenda sources carry no
email at all, so this is a bonus path on the journal-supplement surface only, never the primary join.

---

## 4. Signal — `presenting_at_conference`

Contact-scoped primary (a person is on stage), with a company-scoped companion emission (their
employer is on the program) so it shows on both the contact card and the account.

**Where the SignalKey + catalog entry go (DO NOT edit these shared files — another agent owns them;
specify only):**

`lib/signals/readiness-types.ts` — extend the `SignalKey` union:
```ts
  | 'presenting_at_conference'
```

`lib/signals/readiness-catalog.ts` — new `SIGNAL_CATALOG` entry:
```ts
  {
    signalKey: 'presenting_at_conference',
    scope: 'contact',                 // contact-primary; monitor also emits a company companion
    dimensions: ['new_needs', 'new_strategy'],
    decayDays: 30,                    // phase-based lifecycle; decayDays is the scoring backstop
    buyerFunctions: ['research_and_development', 'clinical_operations', 'medical_affairs', 'commercial'],
    intentMechanisms: ['commercial_interest', 'strategy_shift'],
    notes: 'A tracked person is a named speaker/poster author/chair at a relevant conference — a warm, person-level outreach trigger; phase drives the angle.',
  },
```
(buyerFunctions skew to scientific/medical functions vs the exhibitor signal's BD/commercial skew,
because a speaker is usually an R&D/clinical/medical-affairs voice, not a booth-runner.)

**Phase → outreach angle** (reuse `conference-phase.ts` verbatim, computed on read):

| Phase | When | Person-level angle |
|---|---|---|
| `upcoming` | before start | "saw you're presenting at X on the {session} — good luck / want to grab 15 min while you're there?" |
| `live` | during | "know you're presenting at X today" |
| `recent` | 0–21d after end | "how did your {session} talk at X go?" |
| `expired` | >21d after end | suppress (hard expiry) |

Advance programs publish **pre-event**, so the dominant phase at detection is `upcoming` — the ideal
window. That is the whole point of sourcing the agenda rather than waiting for post-event coverage.

---

## 5. Monitor + cadence

`run-conference-presenters-monitor.ts` (NOT built this pass — skeleton would clone
`run-conference-monitor.ts`):

1. Load the user's active contacts (scoped by `user_id`) and their companies.
2. For each non-`expired` conference, pull `conference_appearances_local` rows whose
   `mentioned_contact_ids` overlap the user's contacts (`.overlaps('mentioned_contact_ids', ids)`).
3. Apply a fail-closed admission guard — a **contact** analog of `companyMentionAdmission`
   (`matchType: 'verified_conference_speaker'`, `acceptedSourceFields: ['speaker_name','affiliation']`).
4. Dedupe via `signal_source_events` on
   `source_event_id = conference_presenter:{conferenceId}:{contactId}:presenting_at_conference`.
5. `ingestSignalSourceEvent` + `normalizeSignalSourceEvent` with `entityScope: 'contact'`,
   `signalKeys: ['presenting_at_conference']`, then `recomputeContactReadiness` (and
   `recomputeAccountReadiness` + `generateAccountReason` for the company companion) — exactly as the
   publications monitor does for its contact path.
6. Carry `conference_phase`, `session_title`, `appearance_type`, `affiliation_raw` in metadata.

**Cadence (no new cadence code):** the per-user surfacing rides `monitorDueForUser(admin, { userId,
runner: 'conference-presenters' })` — growth weekly / starter+free monthly, identical to every other
signal monitor. **Source polling** (shared mirror refresh, in the delta sync) reuses the Phase 1
event-date `next_poll_at` schedule (>3mo weekly · 6–8wk out 2–3×/wk · event week daily · post-event
stop). Pulls are cheap HTTP/PDF (no Apollo), so the cost guardrail stays downstream on enrichment.

---

## 6. Open questions / risks

- **ToS / legal (per-show, the big one).** Public reachability ≠ permission to resell as a signal,
  and **presenter data is more sensitive than booth lists** — it's named individuals, not companies.
  Gate ingestion on the existing `conferences.tos_status` column, per show. Some societies' program
  terms restrict reuse of speaker data; review before productionizing.
- **Email-capture ethics.** Only ever from a *published* corresponding-author email in a public
  abstract, stored as provenance, never silently written to `people.email`, never used to bypass the
  enrichment posture. US/CCPA framing (per the market-is-US memo). When in doubt, drop the email and
  keep the name+affiliation match.
- **Name disambiguation.** `"Last F"` tokens collide heavily ("Wang Y", "Chen J"). The publications
  monitor's two-factor guard (token **+** affiliation-must-match-company) is mandatory here too;
  without the affiliation cross-check, presenter matching false-positives badly. Medium confidence by
  default; never admit a speaker on name alone.
- **Affiliation drift.** A speaker's printed affiliation may be their academic appointment, not the
  company we track them at (KOLs sit on advisory boards). The company resolver handles the affiliation
  string honestly; if it resolves to a *different* company than the contact's employer, emit the
  company signal for the affiliation company but only emit the **contact** signal when the affiliation
  matches the contact's own company (the §3 guard).
- **Advance-program timing (a positive).** Programs publish pre-event → detection lands in the
  `upcoming` phase → the warmest possible outreach window. Re-poll near the date for late additions.
- **eventScribe slug discovery.** The per-event subdomain is data, not a constant; the registry's
  wide pass must capture `agenda_source_url` per show (the presenter analog of `exhibitor_source_url`).

---

## Scaffold delivered (NEW files only)

- `lib/signals/conference/presenters/types.ts` — the appearance record + a `PresenterSourceAdapter`
  interface (the presenter analog of the exhibitor `ConferenceAdapter`).
- `lib/signals/conference/presenters/eventscribe-adapter.ts` — ONE stub source adapter
  (CadmiumCD/eventScribe), documenting the cracked `agenda.asp` endpoint, with a clear TODO for the
  HTML parse. Not wired into any registry.
- `lib/signals/conference/presenters/migration-draft.sql` — DRAFT migration for
  `conference_appearances_local` + `conference_appearance_sync_runs` + the `conferences.agenda_source_url`
  ALTER. **NOT applied.**

No monitor wired, no shared files edited, no migration run, no commit.
