# Conference exhibitor sources — canonical registry

Single source of truth for where conference **exhibitor lists** can be pulled, by platform and by
show. Seeds the `conferences` table for the `exhibiting_at_conference` signal. Build plan:
`docs/CONFERENCE_SIGNAL_PLAN.md`. Cracked-endpoint detail + the scaffold live in
`lib/signals/conference/` and the appendices below.

Status: ✅ clean public pull · 🟡 partial (subset server-rendered) · ⚠️ partial/disputed · 🔴 gated / not cracked

_Endpoints curl-verified, no auth, 2026-06-24._

## Platforms (the unit of work — one parser, many shows)

| Platform | Access method | Status | Shows / codes |
|---|---|---|---|
| **Map Your Show** | GET `{code}.mapyourshow.com/8_0/exhibitor/exhibitor-list.cfm?export=pdf` — PDF, **+29 offset font** | ✅ clean | BIO (~1,630), AACR, medtech26, ashg26, idweek2026, ahasessions2026 |
| **Conference Harvester / CadmiumCD** | POST `…/floorplan/v2/ajaxcalls/CreateCompanyList.asp` with `EventID`+`EventClientID` (scraped from index page) | ✅ cracked | SITC (144), SLAS (435) |
| **SPARGO** | GET `events.jspargo.com/{event}/Public/Exhibitors.aspx` — inline `<a class="exhibitorName">` + `data-coid` | ✅ cracked | ASCO (557), ASH |
| **a2z / Personify** | GET `sNN.a2zinc.net/clients/.../Public/EventMap.aspx?shMode=E` — **browser UA required** | ✅ cracked (verified SfN: Bruker/Zeiss/Abcam) | SfN, USCAP, ADA, ACC, ASTRO |
| **Informa Connect** | GET `informaconnect.com/{event}/sponsors/` — server-rendered | ✅ clean | CGT US, TIDES, RNA Leaders, Antibody Eng., BPI West, Biotech Week Boston |
| **Society / self-hosted PDF** | direct PDF on the org site | ✅ clean | ESMO, CPHI |
| **Terrapinn** | GET `terrapinn.com/conference/{event}/sponsors-and-exhibitors.stm` | ⚠️ **partial** — sponsors server-rendered (Lonza, Cytiva, Sanofi, WuXi); full list JS-hydrated | Festival of Biologics, World Vaccine Congress |
| **Small World Labs** | `{event}.smallworldlabs.com/exhibitors` | 🟡 partial (40 of ~320 server-rendered) | ASGCT |
| **Swapcard** | `api.swapcard.com/graphql` | 🔴 not cracked (per-event auth, introspection off) | Festival of Biologics (alt) |
| **DIA / Pittcon / PDA** | member / login | 🔴 gated | DIA, Pittcon (**PDA prohibits list redistribution**) |

**Coverage: ~30+ major US life-science shows pullable across ~6 platform parsers.** That's the thesis
validated — build the parser once, get many shows.

## Cross-cutting notes
- **Fetcher default**: a2z and DCAT 403 a non-browser UA → default to a browser UA + `Accept` header
  (`lib/signals/conference/fetch.ts`). Conference Harvester works with an honest identifying UA.
- **ToS is a per-show field, not optional**: public reachability ≠ permission to resell as a signal.
  Some shows explicitly prohibit redistribution (PDA). Gate ingestion on a `tos_status` column.
- **Field depth**: PDF/EventMap = name + booth (match only); Informa/SPARGO/Harvester JSON/HTML can add
  website/category (match + enrich).
- **Lifecycle**: not a decay curve — conference-date **phase** (`upcoming/live/recent/expired`, hard
  expiry at end + 21d) in `lib/signals/conference/conference-phase.ts`.

---

# Appendix A — full show registry (wide pass)

### Conference registry — WIDE pass (US life-science calendar)

Seed dataset for the `conferences` table (see `CONFERENCE_SIGNAL_PLAN.md`). Goal: a broad registry
of US-relevant life-science shows and whether each one's **exhibitor list** is publicly pullable
without login — the way we proved for BIO (Map Your Show PDF export).

This file is the WIDE workstream output. It deliberately does **not** recheck the shows already in
`conference-exhibitor-sources.md` (BIO, AACR, ESMO, CPHI EU, SITC, SLAS, ASCO, ASH, ASGCT, Festival of
Biologics, World Vaccine Congress, BIO-Europe, BPI, ADLM/AACC, Pittcon, DIA, Cell & Gene Meeting on
the Mesa, SATELLITE) — it adds new shows on top of those.

All statuses from live `curl` (full browser UA + Accept header), no auth. Last verified: 2026-06-24.
`access_status` was confirmed by grepping the fetched bytes for **real company names**, not by an
anchor-count heuristic (which gives nav/footer false positives).

`clean` = list publicly returned (PDF, or server-rendered HTML/JSON with real company names in the raw
markup) · `js` = 200 but the list loads via JavaScript/XHR (names absent from raw HTML) · `gated` =
login / member sign-in / no public list at all.

---

## Summary

- **Shows added this pass: 41** (net-new, not in the prior log).
- **Clean (pullable today): 24** · **JS (endpoint TBD): 8** · **Gated / no public list: 9**.
- **+3 "clean-pending-build"** (AHA, ASM Microbe, ASTRO): platform confirmed, prior-year URL proven
  clean, but the 2026 instance directory isn't populated yet — re-poll the same path nearer the date.

### Most recurring platforms (the high-leverage ones to crack / reuse)

1. **Informa Connect** — `informaconnect.com/{event}/sponsors/` server-renders the full roster as real
   company names. Covers CGT US, TIDES, RNA Leaders, Antibody Engineering & Therapeutics, BPI West,
   Biotech Week Boston (and BPI, already logged). **All clean.** One parser → ~6+ shows.
2. **Map Your Show** — `{code}.mapyourshow.com/8_0/exhibitor/exhibitor-list.cfm?export=pdf` clean PDF
   (subset-font Caesar offset, decodes fine). New this pass: MedTech (`medtech26`), ISPE (`ispeam26`),
   ASHG (`ashg26`), IDWeek (`idweek2026`), AHA (`ahasessions2026`, not built yet). Adds to BIO/AACR.
3. **a2z / Personify (a2zinc.net)** — the plain `Exhibitors.aspx` is a JS shell, but the sibling
   **`EventMap.aspx?shMode=E`** view server-renders the full list. New finding this pass; works on SfN,
   USCAP, ADA, ACC, ASTRO (and the SPARGO/jspargo family shares it). High-leverage "one trick, many
   shows."

Also recurring: **CHI / Cambridge Healthtech** (`/sponsors`/`ExhibitList` clean, `/exhibits` & some
`/current-exhibitors` JS), **Terrapinn `.stm`** (correct path is `sponsors-and-exhibitors.stm`, which
is server-rendered clean — contradicts the prior log's "JS-loaded" note; re-test the others),
**Swapcard**, **GoeShow**, **Small World Labs**.

**Net build implication:** Informa Connect + Map Your Show + a2z `EventMap.aspx` together cover the
large majority of clean shows. Cracking those three parsers (two already proven) is the bulk of the
value. Terrapinn `.stm` is a cheap fourth win if the path correction holds across events.

---

## ✅ Clean — publicly pullable now (24)

| Show | Platform | exhibitor_source_url | Dates | Status | Est. count | Notes |
|---|---|---|---|---|---|---|
| BIO Partnering @ JPM Week | BIO own (bio.org) | https://bpjw.bio.org/participating-companies | Jan 12–15, 2026, SF | clean | hundreds | Real names server-rendered. The de-facto public "JPM week" company list. |
| BIO Investment & Growth Summit (BIGS, ex-BIO CEO) | BIO own (bio.org) | https://bigs.bio.org/presenting-companies-list | Mar 2–3, 2026, Miami | clean | 150+ | Presenting companies + participating investors both clean. Rebranded BIO CEO & Investor. |
| Sachs Biotech in Europe Forum | Own (sachsforum.com, static .html) | https://www.sachsforum.com/26bef-presenters.html | Oct 7–8, 2026, Basel | clean | 30+ | Per-year static pages `{NN}bef-presenters/-exhibitors/-attendees.html`; 2026 presenter page may 404 until posted (use 25bef now). EU venue, US-relevant attendees. |
| Cell & Gene Therapy Mfg & Commercialization US | Informa Connect | https://informaconnect.com/cell-therapy-bioprocessing/sponsors/ | Sep 22–25, 2026, Boston | clean | ~250 | Maps to the "CGTBC" acronym. Catalent, Lonza, Cytiva, Sartorius, Thermo in raw HTML. |
| Phacilitate Advanced Therapies Week | Swapcard | https://phacilitate.app.swapcard.com/event/advanced-therapies-week/exhibitors/RXZlbnRWaWV3XzU1OTU0Nw== | Feb 9–12, 2026, San Diego | clean | 300+ | Swapcard view returns names in raw HTML (Charles River, Cytiva, Lonza, Sartorius). |
| TIDES USA (oligo & peptide) | Informa Connect | https://informaconnect.com/tides/sponsors/ | May 11–14, 2026, Boston | clean | 75+ | Bachem, PolyPeptide, Cytovance, Catalent. |
| RNA Leaders USA | Informa Connect | https://informaconnect.com/rna-leaders-usa/sponsors/ | Sep 23–25, 2026, Boston | clean | 40–60 | Codexis, Unchained Labs, CellScript, 4basebio. |
| Antibody Engineering & Therapeutics | Informa Connect | https://informaconnect.com/antibody-engineering-therapeutics/sponsors/ | Dec 13–16, 2026, San Diego | clean | ~50 | Biointron, Creative Biolabs, GenScript, Twist. |
| BPI West | Informa Connect | https://informaconnect.com/bpi-west/sponsors/ | Spring 2026, San Diego | clean | 150+ | Cytiva, Sartorius, Repligen, Lonza, Catalent. |
| Biotech Week Boston (umbrella) | Informa Connect | https://informaconnect.com/biotech-week-boston/sponsors/ | Sep 22–25, 2026, Boston | clean | 200+ | Andelyn, Avance, Culture Biosciences, Catalent. Co-located umbrella (BPI East etc.). |
| PEGS Boston (Protein & Antibody Eng) | CHI / Cambridge Healthtech | https://www.pegsummit.com/attendees | May 11–15, 2026, Boston | clean (partial) | ~120 | Some real names on /attendees (GenScript, Thermo); sponsor logos on main site. |
| Bioprocessing Summit (Boston) | CHI / Cambridge Healthtech | https://www.bioprocessingsummit.com/sponsors | Aug 10–13, 2026, Boston | clean | ~62 | Use /sponsors (real logos: ATUM, Beckman, Cytiva, Waters, Tosoh, Bio-Rad); /attendee-list is thin. |
| Bio-IT World Conference & Expo | CHI / Cambridge Healthtech | https://www.bio-itworldexpo.com/ExhibitList | May 19–21, 2026, Boston | clean | ~60–100 | ExhibitList renders names server-side (Benchling, ChemAxon, Genedata, Illumina, IDBS). |
| Society for Neuroscience (Neuroscience 2026) | a2z / Personify | https://s19.a2zinc.net/clients/sfn/sfn26/Public/EventMap.aspx?shmode=E | Nov 14–18, 2026, Washington DC | clean | 500+ | Use EventMap.aspx (not the Exhibitors.aspx JS shell). Best single target by count. |
| USCAP Annual Meeting (pathology) | a2z / Personify | https://s36.a2zinc.net/clients/aimusa/uscap2026/Public/EventMap.aspx?shmode=E | Mar 21–26, 2026, San Antonio | clean | 100+ | EventMap.aspx serves real names (Advanced Cell Diagnostics, Biocare Medical, Ibex). |
| ADA Scientific Sessions | a2z / Personify | https://s36.a2zinc.net/clients/AFCo/ada2026/Public/eventmap.aspx?shMode=E | Jun 5–8, 2026, New Orleans | clean | 200+ | EventMap view returns `<a class="exhibitorName">` list (Abbott, Lilly, Novo Nordisk, Dexcom). |
| ACC (American College of Cardiology) | a2z / Personify | https://www.expo.acc.org/ACC26/Public/EventMap.aspx?shMode=E | Mar 28–30, 2026, New Orleans | clean | 300+ | EventMap clean (Alnylam, Abcentra); plain Exhibitors.aspx is a JS shell. |
| AAI / IMMUNOLOGY 2026 | SPARGO → myExpoOnline | https://immunology26.myexpoonline.com/exhibitors | Apr 15–19, 2026, Boston | clean | 200+ | List lives on myexpoonline.com (BioLegend, Cytek, Miltenyi, Olink), not the jspargo landing. |
| SOT / ToxExpo | Small World Labs | https://toxexpo2026.smallworldlabs.com/exhibitors | Mar 22–25, 2026, San Diego | clean | 250+ | Names in raw HTML title attrs; paginated but server-rendered. |
| The MedTech Conference (AdvaMed) | Map Your Show (`medtech26`) | https://medtech26.mapyourshow.com/8_0/exhibitor/exhibitor-list.cfm?export=pdf | Oct 18–21, 2026, Boston | clean (PDF) | 200+ | application/pdf, 67KB; subset-font Caesar +29, decodes to real names. |
| ISPE Annual Meeting & Expo | Map Your Show (`ispeam26`) | https://ispeam26.mapyourshow.com/8_0/exhibitor/exhibitor-list.cfm?export=pdf | Oct 18–21, 2026, Washington DC | clean (PDF) | 250+ | application/pdf, 76KB; Alcami, Arcadis, Amazon, Affiliated Engineers. |
| ASHG Annual Meeting | Map Your Show (`ashg26`) | https://ashg26.mapyourshow.com/8_0/exhibitor/exhibitor-list.cfm?export=pdf | Oct 20–24, 2026, Montréal | clean (PDF) | ~240 | 6-page PDF (10x Genomics, Agilent, Baylor Genetics, Bio-Rad). Canada venue. |
| IDWeek (infectious disease) | Map Your Show (`idweek2026`) | https://idweek2026.mapyourshow.com/8_0/exhibitor/exhibitor-list.cfm?export=pdf | Oct 21–24, 2026, Washington DC | clean (PDF) | ~100 | 4-page real PDF, live now. |
| SCOPE Summit (Clinical Ops) | Society-hosted (Sitecore) | https://www.scopesummit.com/sponsors | Feb 2–5, 2026, Orlando | clean | 300+ | /sponsors is the list (Advarra, Medidata, IQVIA, Suvoda, Veeva); /exhibits is marketing. |

### Additional clean shows (regional / smaller — verified same pass)

| Show | Platform | exhibitor_source_url | Dates | Status | Est. count | Notes |
|---|---|---|---|---|---|---|
| OCT West Coast (Outsourcing in Clinical Trials) | Arena International (own) | https://www.arena-international.com/event/octwestcoast2025/ | Feb 11–12, 2026, Burlingame CA | clean | 40–60 | Regional series, per-city Arena pages, same structure (Advarra, ICON, Novotech). |
| DCAT Week (CDMO/supplier) | Society-hosted (WordPress) | https://dcatweek.org/resources/locator/ | Mar 23–26, 2026, NYC | clean | 660+ | 403 on bare UA → 200 with full browser UA + Accept. Member-locator, not a booth hall. |
| CPHI Americas | Own (cphieventplanner, Next.js SSR) | https://visitor.cphieventplanner.com/event/cphi-americas-2026/exhibitors/RXZlbnRWaWV3XzEyNDUwOTY= | Jun 2–4, 2026, Philadelphia | clean | ~108+ | Server-rendered hydration JSON carries the list (Cambrex, CURIA, Adare, AGC). Not on MYS. |
| Advanced Therapies Congress (Cell & Gene) | Terrapinn `.stm` | https://www.terrapinn.com/congress/advanced-therapies/sponsors-and-exhibitors.stm | Mar 17–18, 2026, London | clean | ~100 | `sponsors-and-exhibitors.stm` is server-rendered (AGC Bio, Miltenyi, eXmoor). London venue. |
| Festival of Biologics USA | Terrapinn `.stm` | https://www.terrapinn.com/conference/festival-of-biologics-usa/sponsors-and-exhibitors.stm | Mar 4–5, 2026, San Diego | clean | ~120 | Server-rendered; distinct from the EU edition. Contradicts prior "JS-loaded" note — re-test others. |
| Lab of the Future Congress USA | Own (WordPress archive) | https://www.lab-of-the-future.com/USA/sponsor_type/exhibitors/ | Mar 2–3, 2026, Boston | clean | 50–100 | Server-rendered archive (Sapio, Scitara, Benchling, Zifo, Formulatrix). |
| WRIB (Workshop on Recent Issues in Bioanalysis) | Own (PHP) | https://www.wrib.org/sponsorship-exhibition.php | Apr 13–17, 2026, Dallas | clean (partial) | ~50 | Logos with alt-text (BioAgilytix, Charles River, Veloxity, Thermo). Smaller workshop. |
| Festival of Genomics & Biodata (Boston) | Front Line Genomics (static SSR) | https://festivalofgenomics.com/boston/meet | Jun 3–4, 2026, Boston | clean (caveat) | 142 orgs | /meet is an attendee/org list (AbbVie, Amgen, Biogen, Twist), not a pure exhibitor directory; 2026 exhibitor-list URL 404 until published. |

---

## 🟡 JS — 200 but list is client-loaded (endpoint TBD) (8)

| Show | Platform | exhibitor_source_url | Dates | Status | Est. count | Notes |
|---|---|---|---|---|---|---|
| LSX World Congress USA | Informa / Salesforce Experience Cloud | https://informaconnect.com/lsx-world-congress-usa/sponsors/ | Sep 23–24, 2026, Boston | js | dozens | Salesforce aura/lightning hydration; only "Loading" placeholders in raw bytes. Needs headless/XHR. |
| INTERPHEX (pharma mfg, NYC) | RX / Reed Exhibitions (api.reedexpo.com) | https://www.interphex.com/en-us/show-info/exhibitor-list.html | Apr 21–23, 2026, NYC | js | 600+ | Body is a JS config blob; data via XHR from api.reedexpo.com. New platform to crack. |
| AAPS PharmSci 360 | GoeShow (s7.goeshow.com) | https://s7.goeshow.com/aaps/pharmsci/2026/exhibitors_sponsors.cfm | Oct 25–28, 2026, New Orleans | js | 150–200 | dataTables + internal AJAX; no names in raw HTML. |
| Drug Discovery Chemistry (CHI) | CHI / Cambridge Healthtech | https://www.drugdiscoverychemistry.com/exhibits | Apr 13–16, 2026, San Diego | js | 40–60 | /exhibits shows sponsor logos only; full list client-side. |
| Molecular Med Tri-Con (CHI) | CHI / Cambridge Healthtech | https://www.triconference.com/current-exhibitors | May 4–5, 2026, San Francisco | js | 80–100 | Sponsor logos in raw HTML; full list via Ajax. |
| AMP Annual Meeting (mol. pathology) | Conference Harvester / CadmiumCD | https://amp26expo.amp.org/expo-floorplan/ | Nov 10–14, 2026, Seattle | js | ~150 | Cadmium interactive floorplan (JS). Homepage shows sponsor tiers clean (Roche, Illumina, Thermo) but not full hall. |
| World Orphan Drug Congress USA | Terrapinn `.stm` | https://www.terrapinn.com/conference/world-orphan-drug-congress-usa/sponsors-and-exhibitors.stm | Jun 9–11, 2026, Boston | js | 80–120 | This one is a JS shell despite the `.stm` path (others server-render — inconsistent within Terrapinn). |
| ASCPT 2026 | CadmiumCD / eventScribe | https://ascpt2026.eventscribe.net/ | Mar 4–6, 2026, Denver | js | small | eventScribe JS app shell; gallery endpoints return empty shells. Small academic society. |

### Clean-pending-build (platform proven, 2026 directory not yet populated — re-poll)

| Show | Platform | exhibitor_source_url | Dates | Status | Notes |
|---|---|---|---|---|---|
| AHA Scientific Sessions | Map Your Show (`ahasessions2026`) | https://ahasessions2026.mapyourshow.com/8_0/exhibitor/exhibitor-list.cfm?export=pdf | Nov 6–9, 2026, Chicago | js (500 now) | PDF export 500s — directory not built yet. MYS pattern will work once populated. |
| ASM Microbe | GoeShow (s3.goeshow.com/asm) | https://s3.goeshow.com/asm/microbe/2026/exhibitor_exhibitor_list.cfm | Jun 4–7, 2026, Washington DC | js (2026 404) | 2024 path proven clean (`.../2024/exhibitor_exhibitor_list.cfm`); re-poll the `_exhibitor_list` path. |
| ASTRO (Radiation Oncology) | SPARGO / a2z (events.jspargo.com) | https://events.jspargo.com/ASTRO26/Public/EventMap.aspx?shMode=E | Sep 26–30, 2026, Boston | js (2026 404) | 2025 EventMap proven clean (Accuray, Adaptiiv, Aktina). a2z EventMap trick; re-check nearer Sept. |

---

## 🔴 Gated / no public exhibitor list (9)

| Show | Platform | URL | Dates | Status | Notes |
|---|---|---|---|---|---|
| J.P. Morgan Healthcare Conference | own/closed | https://www.jpmorgan.com/about-us/events-conferences/health-care-conference | Jan 12–15, 2026, SF | gated | Invite-only; no public exhibitor or presenting list. Use BIO Partnering @ JPM Week instead. |
| Biotech Showcase | Informa + partnering platform | https://informaconnect.com/biotech-showcase/ | Jan 12–14, 2026, SF | gated | Full company list is download-after-registration; marketing page leaks only ~8 names. |
| WuXi Global Forum | own page | https://wxpress.wuxiapptec.com/WuxiGlobalForum.html | Jan 13, 2026, SF | gated | Invite-only single-day; speakers only, no company directory. |
| Endpoints / STAT events | own (editorial) | https://endpoints.studio/events/ | various | gated | Editorial/sponsored; sponsor logos only, no exhibitor or attendee directory. |
| World ADC San Diego | Hanson Wade (WordPress) | https://worldadc-usa.com/whats-on/full-event-guide/ | Oct 12–15, 2026, San Diego | gated | 200 but zero CDMO names in raw bytes; no working public sponsor-list page. |
| PDA conferences | PDA society site | https://pda.org/exhibits-media/exhibit | various (US) | gated | PDA explicitly does NOT publish/sell exhibitor or attendee lists (states 3rd-party offers are fraudulent). |
| American Physiology Summit (APS) | Society (Sitecore) | https://www.physiology.org/.../american-physiology-summit/physiohub | Apr 23–26, 2026, Minneapolis | gated | Prospectus PDF + email only; no public directory. (Experimental Biology dissolved → this Summit.) |
| AGBT General Meeting | Squarespace society site | https://www.agbt.org/about/sponsor-showcase/ | Feb 2026, Marco Island FL | gated | Invite-style; sponsor logos render via JS; no public exhibitor directory. |
| ACTRIMS Forum (MS) | Squarespace society site | https://www.forum.actrims.org/industry-opportunities | Feb 5–7, 2026, San Diego | gated | Appointment-based "Industry Hub"; no exhibit hall / public list. |
| Keystone Symposia | Society (per-meeting donor pages) | https://www.keystonesymposia.org/support-us/exhibitor-information | various | gated | Table-top only; no aggregate exhibitor directory. Low value. |
| Discovery on Target (CHI) | own marketing site | https://www.discoveryontarget.com/sponsor | Sep 28–Oct 1, 2026, Boston | gated | Sponsor-logo marketing page only; no machine-readable list. |
| CASSS (WCBP / Mass Spec / CE Pharm) | own CMS + ondemand.casss.org | https://www.casss.org/wcbp/exhibit-partner | various (US) | gated | Floor-plan PDF is AutoCAD vector (names not extractable); exhibitor data behind login showcase. |

---

## Scope / data-quality flags

- **Non-US venues, US-relevant attendees (in scope per ICP):** ASHG (Montréal), Advanced Therapies
  Congress (London), Sachs Biotech in Europe (Basel), ISCT 2026 (Dublin — clean directory at
  `isctglobal.org/annual-meeting/sponsors-partners/partners`, not tabled above since 2026 is non-US).
- **Partnering/investor meetings have no booth hall** — they expose presenting/participating-company
  lists (BIO Partnering, BIGS, Biotech Showcase). Still company-level GTM signal, but model the field
  as "participating" not "exhibiting."
- **Default curl with a full browser UA + Accept header** — DCAT 403'd on a bare UA and returned the
  full list with a realistic one. Bake this into the fetcher.
- **Terrapinn `.stm` is inconsistent**: `sponsors-and-exhibitors.stm` server-rendered clean on
  Advanced Therapies + Festival of Biologics USA, but JS-only on World Orphan Drug Congress. The prior
  log marked Terrapinn "JS-loaded" — re-test World Vaccine Congress / Festival of Biologics with the
  corrected path.
- **ToS / legal is an OPEN QUESTION** for every row — public reachability ≠ permission to scrape and
  resell as a signal. PDA explicitly prohibits list redistribution. Review per platform before
  productionizing.
- **Field depth:** Map Your Show PDFs = name + booth only (match, not enrich). Informa/a2z/Swapcard
  HTML often carries website + category (match + enrich). a2z `EventMap.aspx` carries booth coords too.


---

# Appendix B — cracked endpoints (technical reference)

### Conference ingestion — DEEP pass (cracked endpoints + scaffold notes)

Reverse-engineering log for the JS-platform exhibitor data endpoints, plus the design notes for
the clean ingestion scaffold under `lib/signals/conference/**`. All endpoint findings below are
**live `curl`-verified, no auth**, on 2026-06-24. Companion to `docs/CONFERENCE_SIGNAL_PLAN.md`
and `docs/conference-exhibitor-sources.md`.

Legend: ✅ cracked (clean public pull, full list) · 🟡 partial (public but only a subset without a
browser session) · 🔴 not cracked (auth/token required).

## Summary

| Platform | Powers | Status | Proof company |
|---|---|---|---|
| **Map Your Show** (reference) | BIO, AACR | ✅ PDF (already proven) | — |
| **Conference Harvester / CadmiumCD** | SITC, SLAS | ✅ **cracked** (JSON) | 10x Genomics (SITC) |
| **SPARGO / a2zinc** | ASCO, ASH | ✅ **cracked** (server-rendered HTML) | AbbVie (ASCO) |
| **Small World Labs** | ASGCT | 🟡 partial (40 of ~320 server-rendered; full list needs widget AJAX) | AGC Biologics |
| **Terrapinn** | World Vaccine Congress, Festival of Biologics | 🔴 not cracked (list is JS-hydrated; no public JSON feed found) | ProteoGenix (featured only) |
| **Swapcard** | Festival of Biologics (alt) | 🔴 not cracked (GraphQL live but auth-token + introspection-disabled) | — |

---

## 1. Conference Harvester / CadmiumCD — ✅ CRACKED (unlocks SITC + SLAS)

The floorplan v2 page (`/floorplan/v2/index.asp?EventKey=...`) drives the exhibitor list via a
**POST** to `ajaxcalls/CreateCompanyList.asp`. The bare call returns an "Oops" 500 because the
request needs `EventID` + `EventClientID` (numeric, per-event) in addition to the `EventKey`.
Those two numbers are embedded in the index page's inline JS — fetch the index page once, scrape
them, then POST.

### Endpoint
- **URL:** `https://www.conferenceharvester.com/floorplan/v2/ajaxcalls/CreateCompanyList.asp`
- **Method:** `POST`
- **Content-Type:** `application/x-www-form-urlencoded; charset=UTF-8`
- **Headers that help:** `X-Requested-With: XMLHttpRequest`, `Referer: .../floorplan/v2/index.asp?EventKey=<key>`, a normal browser `User-Agent`. (Not strictly required — body params are what matter.)
- **Required body params:** `EventID`, `EventClientID`, `EventKey`. Optional but sent by the site:
  `ShowLogos=Yes`, `LogoLocation=1`, `ShowCompanyWithNegativeBalance=1`,
  `OpenBoothPopupLink=ajaxcalls/OpenBoothPopup.asp?`,
  `RentedBoothPopupLink=ajaxcalls/ExhibitorInfoPopup.asp?`,
  `BlockLogosBeforeLogoTaskCompletion=false`.
- **Response:** JSON (served as `text/html`), grouped alphabetically.

### How to get EventID / EventClientID (per event)
Fetch `https://www.conferenceharvester.com/floorplan/v2/index.asp?EventKey=<EventKey>` and grep the
inline `$.ajax` data block for `EventID` and `EventClientID`:
- **SITC** `EventKey=NAKXYFLC` → `EventID=25702`, `EventClientID=272`
- **SLAS** `EventKey=ANXMFLVZ` → `EventID=24981`, `EventClientID=134`

### Response shape
```json
{
  "companyListHeading": [
    { "bucketHeading": "1", "companyList": [
        { "boothID":"824827", "boothClasses":"wlogo  ",
          "boothURL":"ajaxcalls/ExhibitorInfoPopup.asp?BoothID=824827&EventKey=NAKXYFLC",
          "exhibitorKey":"25702DTZGRYHU", "exhibitorName":"10x Genomics",
          "hideClass":"", "boothNumber":"403",
          "exhibitorLogoImage":"<img ... src='https://www.conferenceharvester.com/uploads/.../...png'>" }
    ]},
    { "bucketHeading":"A", "companyList":[ { "exhibitorName":"A2 Biotherapeutics, Inc.", ... } ] }
  ]
}
```

### Field map
| Adapter field | JSON path |
|---|---|
| `name` | `companyListHeading[].companyList[].exhibitorName` |
| `booth` | `...companyList[].boothNumber` |
| `sourceUrl` | `index.asp?EventKey=<key>` (or the per-booth `boothURL` popup) |
| `category` | not in list payload — see `CreateCategoryList.asp` / `ExhibitorInfoPopup.asp` |
| `website` | not in list payload — **enrich** via `ExhibitorInfoPopup.asp` (below) |

### Verified pull (proof)
- **SITC** (`NAKXYFLC`): HTTP 200, **144 exhibitors**. First names: `10x Genomics`,
  `A2 Biotherapeutics, Inc.`, `Agilent Technologies, Inc.`, `Akoya Biosciences Inc.`, `AstraZeneca`, `BD`.
- **SLAS** (`ANXMFLVZ`): HTTP 200, **435 exhibitors**. First names: `100XBIO`, `10x Genomics`,
  `3CRBio`, `ABB Inc.`, `Abcam`.

### Bonus: richer per-exhibitor data — `ExhibitorInfoPopup.asp`
`GET https://www.conferenceharvester.com/floorplan/v2/ajaxcalls/ExhibitorInfoPopup.asp?BoothID=<boothID>&EventKey=<key>`
returns an HTML fragment with **website, LinkedIn, Twitter, booth number** for that exhibitor.
Verified for 10x Genomics (`BoothID=824827`): `http://www.10xgenomics.com`,
`https://www.linkedin.com/company/10xgenomics`. Useful for the enrich path (not just matching) — but
one request per booth, so gate it.

### curl that works
```bash
### 1. get EventID/EventClientID from the index page
curl -s "https://www.conferenceharvester.com/floorplan/v2/index.asp?EventKey=NAKXYFLC" \
  | grep -A4 'CreateCompanyList.asp' | grep -iE 'EventID|EventClientID'

### 2. POST the company list
curl -s "https://www.conferenceharvester.com/floorplan/v2/ajaxcalls/CreateCompanyList.asp" \
  -X POST -H "Content-Type: application/x-www-form-urlencoded; charset=UTF-8" \
  -H "X-Requested-With: XMLHttpRequest" \
  -H "Referer: https://www.conferenceharvester.com/floorplan/v2/index.asp?EventKey=NAKXYFLC" \
  --data-urlencode "EventID=25702" --data-urlencode "EventClientID=272" \
  --data-urlencode "EventKey=NAKXYFLC" --data-urlencode "ShowLogos=Yes" \
  --data-urlencode "ShowCompanyWithNegativeBalance=1"
```

---

## 2. SPARGO / a2zinc — ✅ CRACKED (unlocks ASCO + ASH)

SPARGO events run on the **a2zinc.net** event platform (`libs.a2zinc.net`). The
`Public/Exhibitors.aspx` page **server-renders the full exhibitor list inline** as an HTML table —
no XHR, no JSON endpoint needed. (`e_exhibitordata.aspx` is just the floor-plan data shell; the
human exhibitor list is on `Exhibitors.aspx`.)

### Endpoint
- **URL:** `https://events.jspargo.com/<event>/Public/Exhibitors.aspx` (ASCO 2025: `asco25`)
- **Method:** `GET`, normal browser `User-Agent`. No auth, no special headers.
- **Response:** full HTML (~728 KB for ASCO), exhibitor list is a `<table>` of `<tr>` rows.

### Field map (HTML)
Each exhibitor row:
```html
<td class="companyName"><a class="exhibitorName" href="openURL.aspx?...">AbbVie</a></td>
<td class="boothLabel"><a class="boothLabel aa-mapIt" ... boothid="1016830">33166</a></td>
<!-- the addRemove cell carries data-coid (a2z company id) and data-boothid -->
<td class="addRemoveExpoPlan"><a href="#" data-boothid="1016830" data-coid="50988">…</a></td>
```
| Adapter field | Source |
|---|---|
| `name` | text of `<a class="exhibitorName">` |
| `booth` | text of `<a class="boothLabel">` |
| `sourceUrl` | the `Exhibitors.aspx` page URL |
| `category` | not in the row (would need the per-exhibitor detail page) |
| `website` | not in the row (per-exhibitor detail page) |

### Verified pull (proof)
- **ASCO** (`asco25`): HTTP 200, **557 exhibitors** (`class="exhibitorName"` count). First names:
  `1Cell.Ai`, `AARDEX Group`, `Abbott Molecular`, `AbbVie`, `Accord BioPharma`,
  `Adaptive Biotechnologies Corporation`, `Advarra`. Known biotechs present: AstraZeneca, Bristol,
  Genentech, Illumina, Merck, Novartis, Pfizer, Thermo.

### Parse note
Names are HTML-entity-encoded (`&amp;` → `&`). Extract via
`<a class="exhibitorName" ...>NAME</a>` then decode entities. ASH uses the same a2zinc platform —
substitute its `events.jspargo.com/<event>` slug.

### curl that works
```bash
curl -s -A "Mozilla/5.0" "https://events.jspargo.com/asco25/Public/Exhibitors.aspx" \
  | grep -oE 'class="exhibitorName"[^>]*>[^<]*<' | sed -E 's/.*>([^<]*)<.*/\1/'
```

---

## 3. Small World Labs — 🟢 CRACKED (single-page); 🟡 multi-page pending (ASGCT/ToxExpo)

`https://<event>.smallworldlabs.com/exhibitors` (platform host `*.pcomm.net`) server-renders the
directory in **two templates** (both now parsed — `adapters/smallworldlabs.ts`):
- **LIST** (e.g. ASGCT): `<a class="generic-option-link" href="/co/<slug>">NAME</a>` — name + /co/ profile.
- **CARD** (e.g. SOT/ToxExpo): `<h5 class="generic-option …" title="NAME">` — the card's
  `generic-option-link` points to an **a2z booth map**, not /co/, so the old list-only regex returned
  **zero** here. Re-verified live 2026-06-24: ToxExpo 2026 = 45 companies, fully server-rendered via
  the card path.

### What works today
- `GET https://<event>.smallworldlabs.com/exhibitors`, normal UA, no auth → both templates parsed,
  deduped by name. Single-page events (the common case) are **fully covered**.

### Multi-page (TODO — needs a live large event to capture)
When the directory exceeds one page it adds a "More" button wired to jQuery `jsPaginator`:
`ajaxParams = { module:'organizations_organization_list', method:'paginationHandler', site_page_id:'<id>', template:'generic…' }`.
The exact AJAX endpoint isn't pinned (ASGCT 2026 is now archived/empty, so no live multi-page event
was available to capture the XHR). When a big SWL show is live, capture the paginationHandler request
and wire it server-side (it's a plain POST, replicable like the OASIS recipe — no headless needed).

---

## 4. Terrapinn — 🟢 server-rendered logo wall = the public list (World Vaccine Congress, Festival of Biologics)

Re-verified live 2026-06-24 with a headless network capture: the `.stm` page makes **no per-event
exhibitor XHR at all** (only third-party trackers). The earlier "`#ExhibitorListing` hydrated
client-side / headless candidate" note was wrong — what's server-rendered **is** the public list.
Each entry is a `<div class="col-sm-3 Panel" data-eventId="<eid>">` card grouped under an `<h3>` tier
(`Gold/Silver/Bronze Sponsor`, **`Exhibitor`**), with the company name in the logo's
`title`/`alt` = `"<Name> at <Event> <Year>"`. The `Exhibitor` tier confirms it is the full floor, not
sponsors-only. `adapters/terrapinn.ts` parses this.

### Caveat
The card list only includes exhibitors with an **uploaded logo** (no-logo, text-only entries — if any
— aren't in the static markup). No public XHR feed exists to recover those, so this is the complete
*public* list, not necessarily every registered exhibitor. Acceptable: the omitted tail (if present)
is small and logo-less micro-exhibitors.

---

## 5. Swapcard — 🔴 NOT CRACKED (auth required)

- The real GraphQL endpoint is **`https://api.swapcard.com/graphql`** (the `app.swapcard.com/graphql`
  host 404s). It is live: `{"query":"{__typename}"}` → `{"data":{"__typename":"Query"}}`.
- **Introspection is disabled** (`__schema` → 500 "introspection has been disabled").
- The public/unauthenticated schema does **not expose `event`** (`Cannot query field "event" on type
  "Query"`). Event + exhibitor data requires a **per-event developer API token** issued by the event
  organizer (Swapcard's documented Open API auth model).
- Conclusion: not pullable without credentials. Deprioritize; prefer the same shows via Terrapinn
  once that's cracked, or organizer-issued token if a customer provides one.

---

## Scaffold notes (Job 2)

New files created under `lib/signals/conference/` (NEW only — no shared files edited):
- `adapters/types.ts` — `ConferenceAdapter` interface + `ExhibitorRecord` shape.
- `adapters/mapyourshow.ts` — reference adapter (PDF export, +29 glyph-offset font decode).
- `adapters/conference-harvester.ts` — SITC/SLAS JSON adapter (cracked above).
- `adapters/spargo.ts` — ASCO/ASH HTML-table adapter (cracked above).
- `adapters/smallworldlabs.ts` — ASGCT partial adapter (40 server-rendered names; documents the
  widget-AJAX gap inline).
- `run-conference-monitor.ts` — monitor skeleton cloned from `run-grants-monitor.ts`.
- `migration-draft.sql` — DRAFT migration for `conferences` + `conference_exhibitors_local`
  (NOT applied).
- `conference-name-match.test.ts` — node:test regression stub.

### New catalog entry (do NOT edit the shared files — apply these when productionizing)

Add to `lib/signals/readiness-types.ts` `SignalKey` union:
```ts
  | 'exhibiting_at_conference'
```
(Optionally `| 'presenting_at_conference'` for the later speaker variant.)

Add to `lib/signals/readiness-catalog.ts` `SIGNAL_CATALOG` (and a base-impact entry in the
`grant_award: 50`-style impact map near line 36 — suggest `exhibiting_at_conference: 30`):
```ts
  {
    signalKey: 'exhibiting_at_conference',
    scope: 'company',
    dimensions: ['new_needs', 'new_strategy'],
    decayDays: 120, // see decay note below — really event-date driven
    buyerFunctions: ['business_development', 'commercial', 'marketing', 'partnerships'],
    intentMechanisms: ['commercial_interest', 'strategy_shift'],
    notes: 'Company is exhibiting at a relevant life-science show. Forward-looking: peaks in the weeks before the event, decays after it ends.',
  },
```

**Decay is the one novel bit.** Unlike the other signals (fixed `decayDays` from the event date),
the conference signal's relevance is driven by **days-to-event**, not days-since-observed:
- pre-event ramp: relevance rises as the event approaches (book a meeting *before* the booth);
- event week: peak;
- post-event: drop sharply, then flip to a weaker "exhibited last year" prediction for the next
  cycle.
The catalog's flat `decayDays` is a placeholder. To do this properly, the recompute step needs the
event `start_date`/`end_date` (carried in the signal `metadata` and the `conferences` row) and a
custom decay curve keyed on `event_start - now`. Flagged here rather than wiring it into the shared
scorer in this pass. `decayDays: 120` is a safe interim so the signal ages out if the event-date
logic isn't added.

### Re-poll cadence (event-date driven) — for the eventual delta-sync + cron
From `CONFERENCE_SIGNAL_PLAN.md`: `next_poll_at` computed from days-to-event — >3mo → weekly ·
6–8wk out → 2–3×/wk · event week → daily · post-event → stop. The monitor here dedupes at
`signal_source_events`, so re-polls only emit **net-new** exhibitors.
