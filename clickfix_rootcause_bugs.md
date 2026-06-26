# Clickfix — Root-Cause Diagnoses (open behavior notes)

Diagnosis only. No code changed yet. Captured 2026-06-26 from the four `open`
behavior notes in `.feedback/inbox.jsonl`. Each entry: symptom → root cause
(file:line) → proposed fix.

---

## 1. `/companies` — "Source" recommended on low-fit companies
**Note:** `e0bc71c9-f84b-4ee9-880b-458796bb6b29` — *"we should never be recommending 'source' to a company that is a low fit"*

**Root cause:** `lib/lead-action.ts:396-399`

`getAccountRowAction()` has an early return that fires **before** the company-fit gate:

```ts
// No contacts on file → always source, regardless of CRM / outreach state.
if (typeof account.contact_count === 'number' && account.contact_count === 0) {
  return 'source_contact';
}
```

It short-circuits to `source_contact` purely on `contact_count === 0`, with no
company-fit check, so a low-fit company that happens to have zero contacts is
forced to "Source" and never reaches the canonical three-gate tree
(`getActionFromScores`, `lib/lead-action.ts:350-370`), whose first gate
(`company < HIGH_SCORE → 'deprioritize'`, lines 360-361) would have returned
`deprioritize`. The comment's intent was to override *CRM/outreach* overlays for
empty-contact accounts, but it also wrongly overrides the fit gate.

- "Source" label: `lib/lead-action.ts:277-278` (`LEAD_ACTION_PILL_CLASS.source_contact.label = 'Source'`).
- Render site: `app/companies/CompaniesWorkspace.tsx:1654-1677` (`case 'action'` → `getAccountRowAction(account)`).
- A low-fit company *with* contacts is handled correctly; the bug is specifically the `contact_count === 0` bypass.

**Proposed fix:** gate the early return on company fit; otherwise fall through to
the score path (→ Deprioritise). Does **not** hard-block sourcing (respects
"never block a purchase, warn only").

```ts
if (typeof account.contact_count === 'number' && account.contact_count === 0) {
  const companyFit = score01ForAction(account.company_fit_score ?? null);
  if (companyFit != null && companyFit >= HIGH_SCORE) {
    return 'source_contact';
  }
  // else fall through → score path returns 'deprioritize' for low fit
}
```

One fix point; the Accounts table, sort key (`lead-action.ts:537-539`) and
detail-panel copy all derive from `getAccountRowAction`, so they correct
automatically.

---

## 2. `/icps` — Re-enrich ICP is not working
**Note:** `27fddc7e-ec87-4264-8792-6db684ce6809` — *"re-enrich icps is NOT working"*

**Root cause:** `lib/icp-reenrichment.ts:542`

```ts
// loadLinkedPersonas()
.select('id, name, functions, signals')   // ← personas.signals no longer exists
```

The `personas.signals` column was **dropped** when per-persona signal selection
was torn out (see memory: "Signal selection removed"). The query fails instantly
with Postgres `42703: column "signals" does not exist`.

Failure chain:
1. `runIcpReenrichmentJob` (`lib/icp-reenrichment.ts:833-837`) runs
   `Promise.all([loadIcp, loadSellerProfile, loadLinkedPersonas])`;
   `loadLinkedPersonas` rejects immediately — before any Claude/Apollo/Apify work.
2. Outer `catch` (line 937) → `summarizeError` (line 96):
   `error instanceof Error ? error.message : 'Unknown error'`. A Supabase
   `PostgrestError` is a plain object, **not** an `Error`, so this returns the
   literal `"Unknown error"`.
3. ICP marked `reenrichment_status='failed'`, `reenrichment_last_error='Unknown error'`.

Button/route are wired correctly: `ICPCard` Re-enrich (`app/icps/page.tsx:1383`)
→ `handleReenrich` (`page.tsx:1608`) → `POST /api/icps/[id]/reenrich` →
`claimIcpReenrichment` (succeeds, shows a success toast) → background job dies.

**Evidence (live DB):** two re-enrich attempts on 2026-06-26 both failed in
~0.6s (`reenrichment_last_error="Unknown error"`). Sub-second duration is
impossible for the real pipeline (one historical success took ~2.5 min) — proves
the throw is at the initial DB load. Running the exact select reproduces `42703`.

**Proposed fix:**
- Primary: drop the dead column — `lib/icp-reenrichment.ts:542` →
  `.select('id, name, functions')`. Remove the unused `signals?: string[] | null`
  field from `PersonaRow` (line 43); `signals` is referenced nowhere else.
- Secondary hardening (so future failures self-diagnose instead of "Unknown error"):
  make `summarizeError` (line 96) read `.message` from non-`Error` throws
  (e.g. `PostgrestError`).
- The two ICPs stuck at `failed` clear on the next successful re-enrich (claim
  resets status to `running`). No migration needed.

---

## 3. `/contacts` — huge gap between agent panel and side panel
**Note:** `193c2775-77aa-43e0-ab3b-4101aa98a719` — *"the gap between the agent and the contact side panel is huge … shown correctly in companies … look at the companies code and fix here"*

**Root cause:** `app/contacts/ContactsWorkspace.tsx:4477` & `:4480`

Contacts hardcodes the side-panel offset:

```ts
top: agentRect.top + 64,
height: Math.max(0, agentRect.height - 64),
```

Companies **measures** the real floating chat-bar height with a `ResizeObserver`:

```ts
// app/companies/CompaniesWorkspace.tsx:759-776
const AGENT_BAR_GAP = 8;
const agentBarRef = useRef<HTMLDivElement | null>(null);
const [agentBarHeight, setAgentBarHeight] = useState(56);
// ResizeObserver(measure) on agentBarRef
// :2060  top: agentRect.top + agentBarHeight + AGENT_BAR_GAP,
// :2063  height: Math.max(0, agentRect.height - agentBarHeight - AGENT_BAR_GAP),
```

The bar actually renders shorter than 64px (root font is 12px → rem padding
renders 0.75×, bar ≈ 40px), so the fixed 64 pushes the panel ~24px below where
the bar ends → the visible gap. The contacts chat-bar div (`:4412`) has **no ref**;
the two `<aside>` and chat-bar className strings are otherwise identical to
companies — the only divergence is measured vs. hardcoded.

**Proposed fix:** port the companies mechanism into `ContactsWorkspace`:
1. Add `const AGENT_BAR_GAP = 8`, `agentBarRef`, `agentBarHeight` state, and the
   `ResizeObserver` effect (mirror companies `:759-776`).
2. Attach `ref={agentBarRef}` to the contacts chat-bar div (`:4412`).
3. Replace `+64`/`-64` (`:4477`/`:4480`) with `+ agentBarHeight + AGENT_BAR_GAP` /
   `- agentBarHeight - AGENT_BAR_GAP`.

Pure JS-offset fix; no Tailwind/rem class change needed.

---

## 4. `/contacts` — "Enrichment done" footer stuck at the bottom
**Note:** `7d854806-96a3-42e6-a1a3-988b545ea4c5` — *"this enrichment done footer is always stuck at the bottom … should be shown when we scroll right down to the bottom … same issue shown in /companies side panel footer"*

**Root cause:** `app/contacts/ContactsWorkspace.tsx:6080-6086`

The enrichment footer is a flex sibling **after** the `flex-1 overflow-auto` body
inside the `flex flex-col` drawer, so the body grows to fill free height and
shoves the footer hard against the bottom. No `sticky`/`absolute`/`fixed`,
no `mt-auto` — pure flex-grow-sibling pinning.

- Drawer (flex column): `:4451-4458` — `aside.contacts-leads-drawer flex min-h-0 flex-col overflow-hidden`
- Body (scrollable, grows): `:4600-4604` — `min-h-0 flex-1 overflow-auto …` (closes `:6078`)
- Footer (PINNED): `:6080` — sibling right after the body; the `selectedPreview !== 'contact'`
  branch (`:6087-6183`) renders "Last updated" / "Enrichment done" /
  "You can refresh this enrichment…" + Refresh.

The same enrichment copy **already exists in-flow** in the Details tab's Data-source
card (`:5274-5360`) and scrolls correctly — so the copy is duplicated: in-flow on
Details, pinned in the footer on other previews.

Companies is the correct shape: its enrichment copy is in-flow in the body
(`CompaniesWorkspace.tsx:2634-2641`); its pinned footer (`:3121-3122`) holds only
the slim Edit/Archive action bar (intended).

**Proposed fix:** move the contacts enrichment block (`:6087-6183`) out of the
pinned footer into the scrollable body (before `:6078`), leaving the footer as a
slim Edit/Archive bar — mirroring companies. Scroll-safe: only relocates DOM nodes
into the existing `flex-1 overflow-auto` container; no `MutationObserver` added
(respects the bottom-fade-mask scroll-freeze constraint); do **not** add
`position: sticky`.
- Watch for duplication with the in-flow Details-tab card (`:5274-5360`) on the
  same view during implementation.
- Companies' enrichment copy is already in-flow; only Edit/Archive is pinned there
  (intended). If the Edit/Archive bar should also scroll, the same relocation
  applies to `CompaniesWorkspace.tsx:3121-3122`, but that's beyond the reported bug.

---

## Notes
- All four are confirmed root causes with file:line citations; none implemented yet.
- Items 1 & 2 are small logic/query fixes; items 3 & 4 are layout fixes that port
  the already-correct `/companies` behavior into `/contacts`.
- Inbox ids left as `open` — not marked done, since nothing was fixed.
