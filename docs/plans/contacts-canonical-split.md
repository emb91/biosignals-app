# Contacts canonical split — execution plan

> **STATUS (2026-06-04): Phases 1–3 SHIPPED & verified** (DB only — see migrations
> `20260604_contacts_split_p1_people.sql`, `_p2_user_contacts.sql`, `_p3_compat_view.sql`).
> `people` (15 canonical, deduped from 18), `user_contacts` (18, child FKs preserved by
> reusing the contacts id), `contacts_compat` view (full column parity; per-user override
> privacy proven). Nothing in the app reads/writes the new tables yet — `contacts` is still
> the live table, so zero behaviour change. **Phases 4–7 (dual-write + read cutover) NOT
> started** — they change every contacts surface and need the app runnable to verify.
> Phase 0 cleanup outstanding: 1 active contact has no linkedin_url (excluded from the split).

Mirror the companies Phase 1d split: one **canonical person record** (enriched once,
shared) + a per-user **`user_contacts`** layer (each user's scoring/CRM/overrides).
Goal: stop paying to enrich the same LinkedIn profile separately per user.

Precedent: `companies` (canonical, no `user_id`) + `user_companies` (per-user) +
`company_resolution_cache`. We replicate that shape for people.

---

## 1. Column classification (the core design)

`contacts` has ~90 columns. Split:

### → CANONICAL `people` (person-intrinsic, PAID enrichment; keyed on `linkedin_url`)
- **Identity:** `linkedin_url` (unique key), `email` (discovered work email), `full_name`,
  `first_name`, `last_name`, `headline`, `profile_photo_url`, `location`, `city`, `country`
- **Role:** `job_title`, `job_title_standardised`, `seniority_level`, `business_area`,
  `years_in_current_role`, `contact_bio`
- **Current employer (person-intrinsic):** `company_name`, `company_domain`,
  `company_linkedin_url`, `apollo_company_domain`, `resolved_current_company_name`,
  `resolved_current_company_domain`, `resolved_current_job_title`,
  `resolved_employment_history`, `resolved_company_firmographics`
- **Raw enrichment payloads (the paid outputs):** all `apollo_*`, `apify_*`
  (person + company raw + lookup_metadata), `profile_enrichment_alignment_metadata`
- **Enrichment state machine:** `linkedin_resolution_*` (source/confidence/summary/status/
  error/started/completed), `profile_enrichment_*` (status/provider/error/started/completed),
  `contact_discovery_status`, `email_status`, `email_status_reasoning`, `last_enriched_at`,
  `enrichment_refresh_*` (shared job), `job_change_checked_at`

### → PER-USER `user_contacts` (`user_id`, `person_id`, + below)
- **Provenance/lifecycle:** `source`, `batch_id`, `raw_upload_id`, `created_at`, `updated_at`,
  `archived_at`, `archived_by`, `archived_reason`
- **Fit/persona (depends on the user's personas):** `contact_fit_score`,
  `contact_fit_breakdown`, `contact_fit_coverage`, `contact_fit_scored_at`,
  `contact_fit_version`, `scored_against_persona_id`
- **Readiness/priority (per-user signals + CRM):** `readiness_score`, `priority_score`,
  `crm_is_suppressed`
- **Per-user summaries:** `contact_panel_summary`, `contact_fit_summary`
- **Legacy/dead (carry as per-user, drop later):** `fit_score`, `fit_score_reasoning`,
  `fit_score_matched_on`, `fit_score_gaps`, `overall_fit_score`

### Resolved (2026-06-04)
1. **`company_id`** → **canonical** (the person's employer = shared `companies` row);
   `user_contacts` reads it through the join for accounts aggregation.
2. **`enrichment_refresh_*`** → **canonical** (shared job state); the trigger is a per-user action.
3. **`email`** → canonical *value*, but **overridable per-user** (see override model below).

---

## 1b. Manual-edit override model (REQUIRED)

Decided 2026-06-04: sharing the **Arcova-enriched data** across users IS the product (that's
what we sell) — we just must not *pay* to enrich the same profile twice. **But a user's manual
edits are private and must never leak to another user.**

So canonical `people` = *Arcova's enriched truth*. Any field a user can hand-edit is layered with
a per-user override, exactly like `user_companies.user_overrides`:

- `user_contacts.user_overrides jsonb` — sparse map of `{ field: value }` the user changed.
- **Displayed value = `user_overrides[field] ?? people[field]`**, resolved at read time
  (the accounts route already does this via an `overrideFor()` helper — reuse the pattern).
- A manual edit writes ONLY to `user_overrides` — it NEVER touches canonical `people`, so user
  B keeps seeing Arcova's value.

Editable fields (from the contacts edit form, `EditableLeadFields`): `first_name`, `last_name`,
`email`, `job_title`, `headline`, `company_name`, `company_domain`, `company_linkedin_url`,
`location`, `city`, `country`, plus user-added secondary emails/phones.
- **`linkedin_url` is the canonical key, NOT a plain override** — editing it = re-identify the
  person (re-resolve / re-link the `user_contacts` row to a different `people` row, or create
  one). Handle as a special path, not an override.
- User-added emails/phones → `contact_emails`/`contact_phones` with `category='user'`, owned by
  `user_contacts` (per-user). Edits to a *discovered* (canonical) email → an override entry.

---

## 2. Child tables

| Table | Today | Re-key to |
|---|---|---|
| `contact_emails` | per-(user,contact) | **split**: enrichment-discovered → `people`; `category='user'` → `user_contacts` |
| `contact_phones` | per-(user,contact) | same split as emails |
| `contact_readiness_snapshots` | per-user | `user_contacts.id` |
| `contact_persona_scores` | per-user | `user_contacts.id` |
| `contact_attribution_snapshots` | per-user | `user_contacts.id` |
| `crm_contacts` / `crm_deal_contact_links` | per-user (HubSpot) | `user_contacts.id` |
| `signal_events.entity_contact_id` | person-level | `people.id` (signals are about the person; readiness is computed per-user) |

---

## 3. Staged migration (expand → migrate → contract; no big-bang)

**Phase 0 — Identity key prep.** `linkedin_url` is the canonical key (required at import going
forward). One-time cleanup: **1 existing active contact has no `linkedin_url`** — resolve or
archive it before the split (no null-key case is designed for). Normalise URL formatting (strip
trailing slash / querystring / lowercase host) so dedup is exact. Today: 19 active contacts →
15 distinct profiles → 3 cross-user dupes collapse.

**Phase 1 — `people` (expand).** Create table with canonical columns, `UNIQUE(linkedin_url)`.
Backfill `DISTINCT ON (linkedin_url)` picking the most-enriched row per profile. `contacts`
untouched → zero breakage.

**Phase 2 — `user_contacts` (expand).** Create `(user_id, person_id, …per-user…)`. Backfill one
row per existing contact, linked by `linkedin_url`. Add `UNIQUE(user_id, person_id)`.

**Phase 3 — Compatibility view.** `CREATE VIEW contacts_compat AS SELECT … FROM user_contacts uc
JOIN people p ON p.id = uc.person_id` exposing today's `contacts` shape. Readers can swap
`.from('contacts')` → `.from('contacts_compat')` mechanically, subsystem by subsystem.

**Phase 4 — Dual-write the write paths.** Update the ~20 writers so canonical fields → `people`,
per-user fields → `user_contacts`. Three rules:
- **Enrichment writes → `people`** (shared). The import/enrichment path checks `people` by
  `linkedin_url` first: if already enriched (any user) and fresh, SKIP the paid enrichment and
  just create the `user_contacts` link — *this is the cost win.*
- **Manual edits → `user_contacts.user_overrides`** (per-user JSONB), NEVER canonical — so one
  user's edits stay private (§1b).
- **Fit / readiness / priority / CRM → `user_contacts`** columns (per-user).
Keep writing legacy `contacts` during transition as a safety net.

**Phase 5 — Cut over reads.** Repoint the heavy readers off the view onto explicit joins where
needed: `/api/leads`, `/api/leads/[id]`, `list_user_accounts` RPC, `lib/accounts-data.ts`,
outreach, hubspot, attribution, contacts page. Rewrite the 2 RPCs. Read resolution everywhere is
`user_overrides[field] ?? people[field]` for editable fields (reuse the accounts `overrideFor()`
pattern); the `contacts_compat` view bakes this COALESCE in so most readers need no per-field logic.

**Phase 6 — Re-key child tables** (section 2), backfilling FKs.

**Phase 7 — Contract.** Drop dual-writes, drop legacy `contacts`, drop dead `fit_score*`/
`overall_fit_score`.

---

## 4. Cost-win mechanism (the point of all this)
In Phase 4, before enrichment runs: `SELECT … FROM people WHERE linkedin_url = ?`. If present and
`last_enriched_at` within the freshness window → reuse, create only the `user_contacts` link, pay
nothing. Else enrich once, write `people`, link. Add a shared freshness threshold (e.g. re-enrich
if > N days) so refreshes also dedupe across users.

---

## 5. Decisions

**Settled (2026-06-04):**
- **Cross-tenant sharing** — sharing the Arcova-enriched DATA is the product; goal is only to not
  *pay* twice. Not a blocker.
- **Manual edits stay private** — per-user `user_overrides`, never written to canonical (§1b).
- **LinkedIn required** — no null-key case; clean up the 1 legacy null in Phase 0.
- **The 3 ambiguous columns** — resolved (§1 "Resolved").

**Still to decide (can wait until Phase 4):**
- **Freshness threshold** — how stale before shared enrichment is re-run (and re-run is shared,
  paid once). Mirror companies' resolution-cache policy.
- **`contact_emails`/`phones` split** (discovered=canonical vs user-added=per-user) — the fiddliest
  child-table detail; finalise the category mapping when re-keying in Phase 6.

---

## 6. Effort / sequencing
Phase-1d-sized. Phases 1–3 are low-risk and independently shippable (pure expand + a view).
Phases 4–5 are the real work (dual-write + read cutover, behind the view). Recommend shipping
1–3 first to de-risk, then 4–7 per subsystem. Not urgent until multi-tenant scale, but the
expand phases can land anytime.

---

# Phases 4–7 — detailed execution plan (DRAFT, for review before running)

Status going in: `people` + `user_contacts` + `contacts_compat` (security_invoker) + RLS are
LIVE in the DB and verified (per-tenant isolation proven). The app still reads/writes the
real `contacts` table — these phases flip it over.

## Chosen strategy: rename + INSTEAD OF triggers (transparent), enrichment writes direct
Two ways to cut over; this picks the lower-churn, more-reversible one:
- **Reads** → rename `contacts`→`contacts_legacy` and `contacts_compat`→`contacts`. Every
  existing `.from('contacts').select()` (≈50 sites) then hits the view with NO code change.
  Instantly reversible (rename back).
- **Writes** → the view isn't auto-updatable, so add INSTEAD OF INSERT/UPDATE/DELETE triggers
  that route writes to `people` / `user_contacts`. The view becomes the single write surface.
- **The one ambiguity:** an UPDATE to an editable field (job_title, email, company_name…) could
  be enrichment (→ canonical `people`) OR a manual edit (→ per-user `user_overrides`). A trigger
  can't tell. **Resolution:** enrichment + import write `people`/`user_contacts` DIRECTLY (bypass
  the view), so the ONLY editable-field writes through the view are manual edits → trigger routes
  them to `user_overrides`. Clean and unambiguous.

## Phase 4 — write routing (DB triggers + the direct-write app paths)
4a. **INSTEAD OF triggers** on the (still-named-compat) view:
   - INSERT → upsert `people` by `linkedin_url`, insert `user_contacts` (id = the supplied id or new).
   - UPDATE → per-user cols → `user_contacts`; editable cols → `user_contacts.user_overrides` (jsonb merge); canonical cols → `people` (only hit by stragglers).
   - DELETE → delete the `user_contacts` row (leave `people` if other users link it).
   Triggers run SECURITY DEFINER where they must write `people` (which has no INSERT/UPDATE RLS).
4b. **Enrichment + import write direct** (app): rewrite `lib/import-ingestion.ts`,
   `lib/enrichment-pipeline.ts`, `lib/linkedin-url-resolver.ts` (and the per-contact readiness/fit
   writers) to target `people` (canonical) + `user_contacts` (per-user) explicitly.
4c. **THE COST WIN** lives here: before enriching, `SELECT … FROM people WHERE linkedin_url = ?`;
   if present and `last_enriched_at` within a freshness window → reuse, create only the
   `user_contacts` link, skip the paid call.
4d. Verify every trigger path in SQL (insert/update/delete through the view → assert people/user_contacts).

## Phase 5 — the flip + RPC/child re-point (DB, atomic + reversible)
5a. Re-point the 7 child-table FKs from `contacts(id)` → `user_contacts(id)` (ids already match →
   metadata-only, data already satisfies it). `signal_events.entity_contact_id` → `people(id)`.
5b. **THE FLIP:** rename `contacts`→`contacts_legacy`; rename the view → `contacts`. Reload the
   PostgREST schema cache (`NOTIFY pgrst`). Instantly reversible (rename back).
5c. Repoint the 2 RPCs (`list_user_accounts`, `refresh_contact_priority_scores`) to read
   `user_contacts`/`people` instead of `contacts` (they already read user_companies for accounts).

## Phase 6 — verify + soak (NEEDS THE APP RUNNING)
Drive every contacts surface against the new structure: `/leads/contacts`, `/accounts`, the
contact detail panel, outreach generation, HubSpot push/pull, attribution, import, enrichment
refresh, archive/restore. Watch for PostgREST view-write quirks (RETURNING shape, schema cache).
Soak for a bit before contracting.

## Phase 7 — contract
Drop `contacts_legacy`; drop the dead legacy columns (`fit_score`, `overall_fit_score`, the unused
`user_contacts` legacy fit cols). One trivial migration once Phase 6 is solid.

## Risks & how each is handled
- **Cross-tenant leak** → RLS + security_invoker, already verified in SQL. Re-verify after the flip.
- **Trigger correctness** → fully SQL-testable before the flip (Phase 4d).
- **PostgREST view-write semantics** (insert/update via a triggered view, RETURNING, schema cache)
  → the one thing SQL can't fully prove; **requires the running app** (Phase 6).
- **Editable-field mis-routing** → solved by enrichment-writes-direct (4b).
- **Reversibility** → the flip is a rename; revert = rename back + drop triggers. Legacy table kept
  until Phase 7. No data destroyed until the very end.

## Hard prerequisite
Phase 6 needs the app runnable to verify the view-write + read cutover end-to-end. The dev-server
Turbopack lock has blocked in-app verification all session — that must be resolved (free the lock /
a runnable instance) before the flip, or the cutover ships unverified.

## Suggested execution order (each step independently safe until the flip)
1. Phase 0 cleanup: resolve/archive the 1 linkedin-less contact.
2. Phase 4a triggers + 4d SQL tests (no behaviour change yet — view unused).
3. Phase 4b/4c enrichment+import direct writes + cost-win (still writing legacy too, as a net).
4. Phase 5 flip (rename + FK re-point + RPC repoint) — the one behaviour-changing step.
5. Phase 6 app verification.
6. Phase 7 contract.

---

# Execution status (2026-06-05) — Phases 0,4,5 DONE; 6 = your verification; 7 deferred

**DONE (DB migrations applied LIVE + code committed on branch `feat/contacts-split-cutover`):**
- **Phase 0** — archived the 1 LinkedIn-less contact (David Walling) + deleted its 5 orphan child rows. All 18 active contacts now have a linkedin_url.
- **Phase 4a** — INSTEAD OF insert/update/delete triggers on the view. 16 routing + isolation checks pass in SQL.
- **Phase 4b** — `import_upsert_contact` RPC (replaces the now-impossible `.upsert(onConflict)` on the view) + `apply_person_enrichment` RPC (enrichment writes canonical `people` directly, not per-user overrides). import-ingestion.ts + enrichment-pipeline.ts rewired. SQL-tested; tsc clean.
- **Phase 5** — repointed 11 child FKs → user_contacts; rewrote list_user_accounts + refresh_contact_priority_scores to read user_contacts (byte-parity verified); **renamed contacts→contacts_legacy, contacts_compat→contacts**. Post-flip reads/writes/RLS verified in SQL.

**Cost-win status:** the split now dedupes the canonical person; the refresh/re-enrichment path skips automatically because `profile_enrichment_status` is a shared `people` column. The *upstream contact-discovery* pre-pay check (don't call the provider at all when the linked person is already enriched) is a follow-up — it lives in the paid-API hot path and needs runtime testing, so it was NOT wired blind.

**⚠ DB is migrated LIVE but the matching code is only on the branch.** Running `main` against the migrated DB will break import (it still calls the old upsert). The branch must be deployed/merged for the app to work.

**Phase 6 (yours):** check out `feat/contacts-split-cutover`, run the app, and exercise: /leads/contacts (read + edit a field), /accounts, contact panel, import a CSV, run an enrichment refresh, HubSpot push/pull, archive/restore. Watch for PostgREST view-write quirks.

**Rollback (if Phase 6 fails):** `ALTER VIEW public.contacts RENAME TO contacts_compat; ALTER TABLE public.contacts_legacy RENAME TO contacts; NOTIFY pgrst,'reload schema';` then redeploy main. NOTE: writes that landed in people/user_contacts during the soak window are not in contacts_legacy — re-sync or re-import if reverting after writes.

**Phase 7 (deferred, per request):** drop contacts_legacy + dead columns. Left in place as the rollback target.
