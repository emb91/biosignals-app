"use client"

/**
 * LEGACY / FROZEN — do NOT use this as a reference or starting point for new
 * landing pages. Its embedded structure is the old layout we are deliberately
 * moving away from; building new pages from it is exactly what we don't want.
 * Build new landing pages fresh from the brand guidelines + Mobbin (see the
 * landing-test-5 direction). Reuse brand tokens only, never this section layout.
 *
 * Landing page variant 3 — self-contained. Its DOM is rendered via
 * dangerouslySetInnerHTML; its stylesheet lives in ./landing.css (scoped under
 * #lp3-root), and its interactions are in the useEffect below. View at
 * /landing-test-3.
 */

import { useEffect } from "react"
import "./landing.css"

const LANDING_HTML = `

<!-- ===================== NAV ===================== -->
<nav class="nav" id="nav">
  <div class="wrap nav-in">
    <a href="#top"><img class="nav-logo" src="/arcova-logo.png" alt="Arcova" /></a>
    <div class="nav-right">
      <a class="nav-link" href="#how">How it works</a>
      <a class="nav-link" href="#pricing">Pricing</a>
      <a class="btn btn-dark" href="/signup" data-cta>Start for free</a>
    </div>
  </div>
</nav>

<!-- ===================== HERO ===================== -->
<header class="hero" id="top">
  <div class="hero-grid"></div>
  <div class="hero-glow"></div>
  <div class="wrap">
    <h1>Revenue intelligence for <span class="hl grad" id="hlword">life science</span>.</h1>
    <p class="hero-sub">Arcova watches your life science market for buying signals, ranks who to reach out to, and drafts the outreach. You just hit send.</p>
    <div class="hero-cta" id="heroCta">
      <a class="btn btn-primary btn-lg" href="/signup" data-cta>Start for free <svg class="arr" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
    </div>
    <div class="hero-icps" aria-label="Built for life science teams">
      <span class="chip-ls">CROs</span><span class="chip-ls">CDMOs</span><span class="chip-ls">Biotech</span><span class="chip-ls">Medtech</span><span class="chip-ls">Diagnostics</span><span class="chip-ls">Life science tools</span>
    </div>
  </div>

  <!-- Product shot: the real Contacts table, airy and uncluttered -->
  <div class="hero-shot reveal">
    <div class="shot-card" id="heroApp">
      <div class="shot-head">
        <div>
          <div class="shot-kick">Leads</div>
          <div class="shot-title">Contacts</div>
        </div>
        <span class="shot-actions">Actions <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 9l6 6 6-6"/></svg></span>
      </div>
      <div class="shot-body">
        <div class="shot-tbl">
          <div class="shot-row shot-hr"><span>Name</span><span class="hide-sm">Company</span><span class="cn">Priority</span><span class="hide-sm">Latest signal</span><span class="cn">Action</span></div>
          <div class="shot-row hot" data-sel>
            <div class="s-name">Elena Fischer<small>VP, Clinical Operations</small></div>
            <div class="s-co hide-sm">Kronos Biologics</div>
            <div class="center"><span class="ring" data-v="94"></span></div>
            <div class="s-sig hide-sm">Series B closed</div>
            <div class="center"><span class="act send">Send outreach</span></div>
          </div>
          <div class="shot-row">
            <div class="s-name">Marcus Webb<small>Head of Commercial</small></div>
            <div class="s-co hide-sm">Helix Diagnostics</div>
            <div class="center"><span class="ring" data-v="88"></span></div>
            <div class="s-sig hide-sm">New VP hired</div>
            <div class="center"><span class="act send">Send outreach</span></div>
          </div>
          <div class="shot-row">
            <div class="s-name">Priya Nair<small>Director, Business Development</small></div>
            <div class="s-co hide-sm">Lumen Genomics</div>
            <div class="center"><span class="ring" data-v="76"></span></div>
            <div class="s-sig hide-sm">Phase II complete</div>
            <div class="center"><span class="act monitor">Monitor</span></div>
          </div>
          <div class="shot-row">
            <div class="s-name">James Okafor<small>Chief Scientific Officer</small></div>
            <div class="s-co hide-sm">Veritas CDx</div>
            <div class="center"><span class="ring" data-v="61"></span></div>
            <div class="s-sig hide-sm">Site expansion</div>
            <div class="center"><span class="act monitor">Monitor</span></div>
          </div>
          <div class="shot-row">
            <div class="s-name">Sofia Alvarez<small>Commercial Lead</small></div>
            <div class="s-co hide-sm">Orbital Therapeutics</div>
            <div class="center"><span class="ring" data-v="44"></span></div>
            <div class="s-sig hide-sm">No recent signal</div>
            <div class="center"><span class="act source">Source</span></div>
          </div>
          <div class="shot-row">
            <div class="s-name">Daniel Roth<small>BD Manager</small></div>
            <div class="s-co hide-sm">Cascade Bioworks</div>
            <div class="center"><span class="ring" data-v="22"></span></div>
            <div class="s-sig hide-sm">Quiet</div>
            <div class="center"><span class="act">Deprioritise</span></div>
          </div>
        </div>

        <!-- slide-in contact detail panel: Signals tab -->
        <aside class="shot-panel" id="shotPanel" aria-hidden="true">
          <div class="sp-top">
            <div>
              <div class="sp-kick">Signals</div>
              <div class="sp-name">Elena Fischer</div>
            </div>
            <div class="sp-av">EF</div>
          </div>
          <div class="sp-tabs"><span class="t">Contact</span><span class="t">Fit</span><span class="t">Priority</span><span class="t">CRM</span><span class="t on">Signals</span><span class="t">Outreach</span></div>
          <div class="sp-scroll">
            <div class="sp-seclabel">Account signals</div>
            <div class="sp-sig" style="--bar:#00a4b4">
              <div class="sp-sig-h"><b>Funding round</b><span>2h ago</span></div>
              <p>Kronos Biologics closed a $52M Series B to expand bioreactor capacity ahead of Phase III.</p>
              <a class="sp-src">Source <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M7 17L17 7M9 7h8v8"/></svg></a>
            </div>
            <div class="sp-sig" style="--bar:#8b5cf6">
              <div class="sp-sig-h"><b>Leadership hire</b><span>1w ago</span></div>
              <p>New VP of Manufacturing joined from a leading CDMO to scale the operations team.</p>
              <a class="sp-src">Source <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M7 17L17 7M9 7h8v8"/></svg></a>
            </div>
            <div class="sp-sig" style="--bar:#e0922f">
              <div class="sp-sig-h"><b>Publication</b><span>2w ago</span></div>
              <p>New data on scalable perfusion processes for next-generation biologics manufacturing.</p>
              <a class="sp-src">Source <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M7 17L17 7M9 7h8v8"/></svg></a>
            </div>
          </div>
          <div class="sp-enrich"><span class="sp-tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></span><span><b>Enrichment done</b><small>Finished 2 hours ago</small></span></div>
        </aside>
      </div>
      <div class="shot-cursor" id="shotCursor" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M5 3l14 8.5-6 1.3 3.2 6.2-2.6 1.3-3.2-6.4L7 18z" fill="#0d3547" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>
      </div>
    </div>
  </div>
</header>

<!-- ===================== VALUE PROPS ===================== -->
<section class="pad">
  <div class="wrap">
    <div class="vp-head reveal">
      <p class="eyebrow">What you get</p>
      <h2 class="section-title">Less hunting. More closing.</h2>
    </div>

    <div class="vp-grid">
      <!-- 1 timing -->
      <div class="vp reveal">
        <div>
          <h3>Reach out at the right moment.</h3>
          <p>Funding rounds, new hires and clinical milestones, flagged the second they happen.</p>
        </div>
        <div class="vp-media surface-glow">
          <div class="surface">
            <div class="brief-head"><span class="l">Signals</span><span style="font-size:11px;color:var(--ink-faint)">2h ago</span></div>
            <div style="padding:16px 18px;display:flex;align-items:center;gap:12px">
              <div style="flex:1;min-width:0">
                <div style="font-size:14px;font-weight:700">Kronos Biologics</div>
                <div style="font-size:13px;font-weight:600;color:var(--ink-soft);margin-top:3px">Series B closed</div>
              </div>
              <span class="badge buyin">Funding</span>
              <span class="act send">Send outreach</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 2 outreach -->
      <div class="vp reverse reveal">
        <div>
          <h3>From signal to sent in two clicks.</h3>
          <p>Arcova drafts your entire outreach sequence, following a gold standard GTM playbook.</p>
        </div>
        <div class="vp-media surface-glow">
          <div class="surface" style="padding:18px">
            <div style="font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--teal-deep);margin-bottom:12px">Outreach drafted</div>
            <div style="border:1px solid var(--line);border-radius:11px;padding:14px;font-size:13px;line-height:1.55;color:var(--ink-soft)">Congrats on closing the Series B. As you scale capacity ahead of Phase III, teams like yours usually start scoping&#8230;</div>
            <div style="display:flex;gap:10px;margin-top:14px">
              <span class="btn btn-primary" style="padding:9px 18px;font-size:13px">Approve &amp; send</span>
              <span class="btn btn-ghost" style="padding:9px 18px;font-size:13px">Edit</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 3 domain -->
      <div class="vp reveal">
        <div>
          <h3>Built for life science.</h3>
          <p>It speaks clinical stages, modalities and milestones out of the box.</p>
        </div>
        <div class="vp-media surface-glow">
          <div class="surface" style="padding:22px;display:flex;flex-wrap:wrap;gap:9px;align-content:flex-start">
            <span class="chip teal">Phase II to III</span>
            <span class="chip">CDMO capacity</span>
            <span class="chip teal">IND filing</span>
            <span class="chip">New CSO</span>
            <span class="chip teal">510(k) clearance</span>
            <span class="chip">Series B</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ===================== AGENT SETUP ===================== -->
<section class="pad-sm" id="how">
  <div class="wrap">
    <div class="vp-head reveal" style="max-width:680px">
      <p class="eyebrow">Setup in minutes</p>
      <h2 class="section-title">Give it your company name. The agent does the rest.</h2>
      <p class="section-lead">No spreadsheets, no rules to write. Arcova reads your company, defines who buys from you, and starts working the market for you.</p>
    </div>

    <div class="agent-stage reveal">
      <div class="agent-input">
        <svg class="spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/></svg>
        <span class="typed" id="agentTyped"></span><span class="caret" id="agentCaret"></span>
        <span class="go">Analyse</span>
      </div>
      <div class="agent-status" id="agentStatus"></div>
      <div class="agent-out" id="agentOut">
        <div class="agent-col" data-step="0">
          <div class="ct">Your company</div>
          <div style="font-size:14px;font-weight:700">Arcova</div>
          <div style="font-size:12.5px;color:var(--ink-mute);margin-top:5px;line-height:1.5">GTM intelligence for life science. Sells to commercial and BD teams at tools, CRO, CDMO, biotech and diagnostics companies.</div>
        </div>
        <div class="agent-col" data-step="1">
          <div class="ct">Ideal customer profile</div>
          <div class="icp-mini">
            <div class="icp-row"><span class="icp-k">Looks like</span><span class="chip">Revvity</span><span class="chip">Enzene</span><span class="chip">PhenoVista</span></div>
            <div class="icp-row"><span class="icp-k">Therapeutic areas</span><span class="chip teal">Oncology</span><span class="chip teal">Immunology</span><span class="chip teal">Rare disease</span></div>
            <div class="icp-row"><span class="icp-k">Modalities</span><span class="chip">mAb</span><span class="chip">Cell therapy</span><span class="chip">Diagnostics</span></div>
            <div class="icp-row"><span class="icp-k">Company size</span><span class="chip">500&#8211;5,000</span></div>
          </div>
        </div>
        <div class="agent-col" data-step="2">
          <div class="ct">Buying team</div>
          <span class="chip">VP / Head of Sales</span><span class="chip">Business Development</span><span class="chip">Commercial Ops</span><span class="chip">Marketing</span>
        </div>
      </div>
      <div class="agent-foot" id="agentFoot" style="opacity:0;transition:opacity .5s">Setup complete. <b>Your market is now being watched.</b></div>
    </div>
  </div>
</section>

<!-- ===================== DARK BAND ===================== -->
<section class="dark pad">
  <div class="wrap">
    <div class="reveal" style="max-width:680px">
      <p class="eyebrow on-dark">Every morning</p>
      <h2 class="section-title">Wake up to your day, already prioritised.</h2>
      <p class="section-lead">You don't open Arcova to go digging. Each morning it hands your team a ranked to-do list: the signals that landed overnight, the leads already drafted, and exactly where to start.</p>
    </div>
    <div class="score-grid">
      <div class="score-card reveal" style="--cc:rgba(0,164,180,.5)">
        <span class="lab">Overnight</span>
        <div class="big" data-count="12">0</div>
        <h4>New buying signals</h4>
        <p>Funding, leadership hires and clinical milestones across your market while you slept.</p>
      </div>
      <div class="score-card reveal" style="--cc:rgba(140,217,201,.5)">
        <span class="lab">Ready to work</span>
        <div class="big" data-count="8">0</div>
        <h4>Leads with outreach drafted</h4>
        <p>High-fit contacts, sequenced and waiting for your approval.</p>
      </div>
      <div class="score-card reveal" style="--cc:rgba(0,164,180,.38)">
        <span class="lab">Today</span>
        <div class="big" data-count="5">0</div>
        <h4>On your priority list</h4>
        <p>Ranked, so your reps start with the best account, not the loudest.</p>
      </div>
    </div>
  </div>
</section>

<!-- ===================== CRM SECTION ===================== -->
<section class="pad">
  <div class="wrap crm">
    <div class="reveal">
      <p class="eyebrow">Works where you work</p>
      <h2 class="section-title" style="font-size:clamp(1.8rem,1.2rem+2vw,2.6rem)">The intelligence lives where your team already works.</h2>
      <p style="margin-top:18px;font-size:1.08rem;line-height:1.6;color:var(--ink-soft);max-width:46ch;text-wrap:pretty">Your reps work best inside Arcova, but every score, signal and enriched contact also flows back to your CRM and outreach tools automatically. Nothing to re-key, nothing to keep in sync by hand.</p>
      <div class="crm-checks">
        <div class="crm-check"><span class="ck"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></span>Fit score written to your CRM field</div>
        <div class="crm-check"><span class="ck"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></span>Readiness updated on every new signal</div>
        <div class="crm-check"><span class="ck"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></span>Contact enrichment synced both ways</div>
        <div class="crm-check"><span class="ck"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg></span>Priority rank &amp; latest signal on the record</div>
      </div>
    </div>
    <div class="crm-panelwrap reveal">
      <div class="surface-glow" style="position:relative">
        <div class="app-frame" style="width:320px;grid-template-columns:1fr">
          <aside class="app-panel" style="border-left:none">
            <div class="panel-top">
              <div>
                <div class="panel-kick">Contact · synced</div>
                <div class="panel-name">Sarah Chen</div>
              </div>
              <div class="panel-av">SC</div>
            </div>
            <div class="panel-tabs"><span class="t">Contact</span><span class="t">Fit</span><span class="t">Priority</span><span class="t on">CRM</span><span class="t">Signals</span></div>
            <div class="panel-card">
              <div class="ch">Arcova → CRM</div>
              <div class="kv">
                <span class="k">Fit score</span><span class="v" style="color:var(--teal-deep)">94 · High fit</span>
                <span class="k">Readiness</span><span class="v" style="color:var(--teal-deep)">88 · Buying window</span>
                <span class="k">Priority rank</span><span class="v">#1 this week</span>
                <span class="k">Last signal</span><span class="v">Series B · 2h ago</span>
              </div>
            </div>
            <div class="panel-card">
              <div class="ch">Enrichment <span style="color:var(--teal-deep);font-weight:600;font-size:10px">SYNCED</span></div>
              <div class="kv">
                <span class="k">Verified email</span><span class="v link">s.chen@helixdx.com</span>
                <span class="k">Pushed to</span><span class="v">CRM · Outreach</span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- ===================== PRICING ===================== -->
<section class="pad-sm" id="pricing">
  <div class="wrap">
    <div class="price-head reveal">
      <div>
        <p class="eyebrow">Pricing</p>
        <h2 class="section-title" style="font-size:clamp(1.8rem,1.2rem+2vw,2.6rem)">One workspace. Your whole revenue team.</h2>
        <p class="price-intro">Every plan includes market mapping, fit and readiness scoring, life-science signals, and unrestricted exports. Paid plans include unlimited users.</p>
      </div>
      <div class="toggle" id="billToggle">
        <button class="on" data-bill="monthly">Monthly</button>
        <button data-bill="annual">Annual <span class="save">2 months free</span></button>
      </div>
    </div>

    <div class="price-grid reveal" id="priceGrid">
      <div class="tier">
        <div class="tname">Free</div>
        <div class="tnote">Map your market and prove the workflow</div>
        <div class="tprice"><span class="amt">$0</span></div>
        <div class="tbilled">Free every month</div>
        <ul>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span><b>100 credits</b> each month</span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span><b>1 workspace user</b></span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span><b>100</b> active leads monitored</span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span><b>Monthly</b> signal monitoring</span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span><b>500</b> imported records triaged / mo</span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span><b>60</b> lead enrichment credits / mo</span></li>
        </ul>
        <div class="tbtn"><a class="btn btn-soft" href="/signup">Start for free</a></div>
      </div>

      <div class="tier feat">
        <div class="ribbon">Most popular</div>
        <div class="tname">Starter</div>
        <div class="tnote">Build a repeatable outbound motion</div>
        <div class="tprice"><span class="amt" data-m="$149" data-a="$1,490">$149</span><span class="per" data-m="/workspace/mo" data-a="/workspace/yr">/workspace/mo</span></div>
        <div class="tbilled" data-m="Billed monthly" data-a="2 months free · billed annually">Billed monthly</div>
        <div class="credit-grant" data-m="2,000 credits each month" data-a="24,000 credits upfront">2,000 credits each month</div>
        <ul>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span><b>Unlimited users</b></span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span><b>5,000</b> active leads monitored</span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span><b>Monthly</b> signal monitoring</span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span><b>10,000</b> imported records triaged / mo</span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span><b>1,200</b> lead enrichment credits / mo</span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span>Extra credits: <b>$100 / 1,000</b></span></li>
        </ul>
        <div class="tbtn"><a class="btn btn-primary" href="/signup">Start for free</a></div>
      </div>

      <div class="tier">
        <div class="tname">Growth</div>
        <div class="tnote">Run an always-on revenue engine</div>
        <div class="tprice"><span class="amt" data-m="$799" data-a="$7,990">$799</span><span class="per" data-m="/workspace/mo" data-a="/workspace/yr">/workspace/mo</span></div>
        <div class="tbilled" data-m="Billed monthly" data-a="2 months free · billed annually">Billed monthly</div>
        <div class="credit-grant" data-m="8,000 credits each month" data-a="96,000 credits upfront">8,000 credits each month</div>
        <ul>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span><b>Unlimited users</b></span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span><b>10,000</b> active leads monitored</span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span><b>Weekly</b> signal monitoring</span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span><b>50,000</b> imported records triaged / mo</span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span><b>5,600</b> lead enrichment credits / mo</span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg><span>Extra credits: <b>$70 / 1,000</b></span></li>
        </ul>
        <div class="tbtn"><a class="btn btn-soft" href="/signup">Start for free</a></div>
      </div>
    </div>

    <div class="comparison reveal">
      <div class="comparison-head">
        <div>
          <p class="eyebrow">Full comparison</p>
          <h3>Everything included, row by row.</h3>
        </div>
        <a class="credit-link" href="/docs/credits">How Arcova credits work <span>→</span></a>
      </div>
      <div class="comparison-scroll">
        <table>
          <thead>
            <tr><th>Plan allowance</th><th>Free</th><th>Starter</th><th>Growth</th></tr>
          </thead>
          <tbody>
            <tr><td>Workspace price</td><td>$0</td><td>$149 / month</td><td>$799 / month</td></tr>
            <tr><td>Annual price</td><td>—</td><td>$1,490</td><td>$7,990</td></tr>
            <tr><td>Workspace users</td><td>1</td><td>Unlimited</td><td>Unlimited</td></tr>
            <tr><td>Subscription credits</td><td>100 / month</td><td>2,000 / month</td><td>8,000 / month</td></tr>
            <tr><td>Annual credits</td><td>—</td><td>24,000 upfront</td><td>96,000 upfront</td></tr>
            <tr><td>Active leads monitored</td><td>100</td><td>5,000</td><td>10,000</td></tr>
            <tr><td>Monitoring cadence</td><td>Monthly</td><td>Monthly</td><td>Weekly</td></tr>
            <tr><td>Imported records triaged</td><td>500 / month</td><td>10,000 / month</td><td>50,000 / month</td></tr>
            <tr><td>Lead enrichment credits</td><td>60 / month</td><td>1,200 / month</td><td>5,600 / month</td></tr>
            <tr><td>Shared enrichment actions</td><td>Imports, company-only, net-new</td><td>Imports, company-only, net-new</td><td>Imports, company-only, net-new</td></tr>
            <tr><td>Extra lead enrichment</td><td>Upgrade for more actions</td><td>Use purchased credits</td><td>Use purchased credits</td></tr>
            <tr><td>Sequences generated</td><td>1 / month</td><td>66 / month</td><td>214 / month</td></tr>
            <tr><td>Phone reveals</td><td>1 / month</td><td>3 / month</td><td>12 / month</td></tr>
            <tr><td>Email-finder requests</td><td>1 / month</td><td>25 / month</td><td>60 / month</td></tr>
            <tr><td>Exports</td><td>Unlimited</td><td>Unlimited</td><td>Unlimited</td></tr>
            <tr><td>Additional 1,000 credits</td><td>Not available</td><td>$100</td><td>$70</td></tr>
          </tbody>
        </table>
      </div>
      <p class="comparison-note">Credits are used for deliberate actions such as enrichment, verified contact discovery, phone reveals, and sequence generation. Scheduled monitoring does not use credits.</p>
    </div>
  </div>
</section>

<!-- ===================== FINAL CTA ===================== -->
<section class="final">
  <div class="wrap">
    <div class="final-card reveal">
      <div class="spots"></div>
      <div class="inner">
        <p class="eyebrow on-dark">Ready to start</p>
        <h2>Your market, ranked and ready every morning.</h2>
        <p>Set up once. Arcova does the rest.</p>
        <div class="hero-cta">
          <a class="btn btn-primary btn-lg" href="/signup" data-cta>Start for free <svg class="arr" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
        </div>
        <div class="fine">Free to start · No credit card · Find your first leads in minutes</div>
      </div>
    </div>
  </div>
</section>

<!-- ===================== FOOTER ===================== -->
<footer class="foot">
  <div class="wrap foot-in">
    <img src="/arcova-logo.png" alt="Arcova" />
    <div class="links">
      <a href="#how">How it works</a>
      <a href="#pricing">Pricing</a>
      <a href="/signup" data-cta>Start for free</a>
    </div>
    <div class="cr">© 2026 Arcova · GTM intelligence for life science</div>
  </div>
</footer>

<!-- ===================== TWEAKS ===================== -->
<div id="tweaks">
  <div class="th"><b>Tweaks</b><button id="twClose">✕</button></div>
  <div class="trow">
    <div class="tlab">Accent</div>
    <div class="swatches" id="twAccent">
      <button data-c="#00a4b4" style="background:#00a4b4" class="on"></button>
      <button data-c="#0d3547" style="background:#0d3547"></button>
      <button data-c="#1f8a7a" style="background:#1f8a7a"></button>
    </div>
  </div>
  <div class="trow">
    <div class="tlab">Accent word</div>
    <div class="seg" id="twHl">
      <button data-h="grad" class="on">Gradient</button>
      <button data-h="solid">Solid</button>
      <button data-h="off">Off</button>
    </div>
  </div>
  <div class="trow">
    <div class="tlab">Headline</div>
    <div class="seg" id="twWord">
      <button data-w="when" class="on">Who &amp; when</button>
      <button data-w="ranked">Ranked daily</button>
    </div>
  </div>
  <div class="trow">
    <div class="tlab">Hero CTAs</div>
    <div class="seg" id="twCta">
      <button data-cta-mode="single" class="on">Start free</button>
      <button data-cta-mode="dual">+ Book call</button>
    </div>
  </div>
</div>

`

export default function LandingTest3() {
  useEffect(() => {
    const root = document.getElementById("lp3-root")
    if (!root) return

    const timeouts: ReturnType<typeof setTimeout>[] = []
    const intervals: ReturnType<typeof setInterval>[] = []
    const observers: IntersectionObserver[] = []
    const later = (fn: () => void, ms: number) => { const id = setTimeout(fn, ms); timeouts.push(id); return id }

    /* ---------- nav scroll ---------- */
    const nav = root.querySelector<HTMLElement>("#nav")
    const onScroll = () => nav && nav.classList.toggle("scrolled", window.scrollY > 20)
    window.addEventListener("scroll", onScroll, { passive: true })
    onScroll()

    /* ---------- priority rings ---------- */
    function drawRing(el: Element) {
      const v = +(el as HTMLElement).dataset.v!, r = 13, c = 2 * Math.PI * r
      const col = v >= 60 ? "#00a4b4" : v >= 40 ? "#e0922f" : "rgba(13,53,71,.32)"
      el.innerHTML = `<svg width="30" height="30" viewBox="0 0 32 32"><circle cx="16" cy="16" r="${r}" fill="none" stroke="rgba(13,53,71,.09)" stroke-width="3"/><circle cx="16" cy="16" r="${r}" fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - v / 100)}"/></svg><span class="num">${v}</span>`
    }
    root.querySelectorAll(".ring").forEach(drawRing)

    /* ---------- hero: animated row click -> panel reveal ---------- */
    {
      const card = root.querySelector<HTMLElement>("#heroApp")
      if (card) {
        const cursor = root.querySelector<HTMLElement>("#shotCursor")!
        const row = card.querySelector<HTMLElement>("[data-sel]")!
        const panel = root.querySelector<HTMLElement>("#shotPanel")!
        const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches
        let played = false
        const open = () => { card.classList.add("open"); row.classList.add("sel"); panel.setAttribute("aria-hidden", "false") }
        const play = () => {
          if (played) return; played = true
          if (reduce) { open(); return }
          const cr = card.getBoundingClientRect()
          const rr = row.getBoundingClientRect()
          const x = cr.width * 0.30, y = (rr.top - cr.top) + rr.height / 2
          cursor.style.opacity = "1"
          cursor.style.transform = `translate(${x}px, ${y}px)`
          later(() => { cursor.classList.add("click"); row.classList.add("sel") }, 1000)
          later(() => { cursor.classList.remove("click"); open() }, 1350)
          later(() => { cursor.style.opacity = "0" }, 2300)
        }
        const ob = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { later(play, 650); ob.disconnect() } }), { threshold: .45 })
        ob.observe(card); observers.push(ob)
      }
    }

    /* ---------- reveal on scroll ---------- */
    function countUp(el: Element) {
      const target = +(el as HTMLElement).dataset.count!; let n = 0
      const t = setInterval(() => { n += Math.ceil(target / 28); if (n >= target) { n = target; clearInterval(t) } el.textContent = String(n) }, 30)
      intervals.push(t)
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return
        e.target.classList.add("in")
        e.target.querySelectorAll("[data-count]").forEach(countUp)
        e.target.querySelectorAll<HTMLElement>(".bar i").forEach((b) => { b.style.width = b.dataset.w + "%" })
        io.unobserve(e.target)
      })
    }, { threshold: .18 })
    root.querySelectorAll(".reveal").forEach((el) => io.observe(el))
    observers.push(io)

    /* ---------- pricing toggle ---------- */
    const billToggle = root.querySelector<HTMLElement>("#billToggle")
    const onBill = (ev: Event) => {
      const b = (ev.target as HTMLElement).closest("button"); if (!b || !billToggle) return
      const annual = b.dataset.bill === "annual"
      billToggle.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b))
      root.querySelectorAll<HTMLElement>("#priceGrid [data-m][data-a]").forEach((x) => {
        x.textContent = annual ? x.dataset.a! : x.dataset.m!
      })
    }
    billToggle?.addEventListener("click", onBill)

    /* ---------- agent setup animation ---------- */
    {
      const typedEl = root.querySelector<HTMLElement>("#agentTyped")
      const caret = root.querySelector<HTMLElement>("#agentCaret")
      const status = root.querySelector<HTMLElement>("#agentStatus")
      const cols = [...root.querySelectorAll<HTMLElement>(".agent-col")]
      const foot = root.querySelector<HTMLElement>("#agentFoot")
      const stage = root.querySelector<HTMLElement>(".agent-stage")
      if (typedEl && caret && status && foot && stage) {
        const name = "arcova.bio"
        let started = false
        const start = () => {
          if (started) return; started = true
          let i = 0
          const type = () => {
            if (i <= name.length) { typedEl.textContent = name.slice(0, i); i++; later(type, 90) }
            else { caret.style.display = "none"; think() }
          }
          const think = () => {
            status.innerHTML = '<span class="think">Reading the company <i></i><i></i><i></i></span>'
            const steps = ["Analysing arcova.bio…", "Defining ideal customer profiles…", "Mapping the buying team…"]
            let s = 0
            const reveal = () => {
              if (s < cols.length) {
                status.innerHTML = '<span class="think">' + steps[s] + " <i></i><i></i><i></i></span>"
                cols[s].classList.add("in"); s++; later(reveal, 1000)
              } else { status.textContent = ""; foot.style.opacity = "1" }
            }
            later(reveal, 700)
          }
          type()
        }
        const ob = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { start(); ob.disconnect() } }), { threshold: .4 })
        ob.observe(stage); observers.push(ob)
      }
    }

    /* ---------- tweaks ---------- */
    const onMessage = (e: MessageEvent) => {
      const panel = root.querySelector<HTMLElement>("#tweaks"); if (!panel) return
      if (e.data === "tweaks:show") panel.classList.add("show")
      if (e.data === "tweaks:hide") panel.classList.remove("show")
    }
    window.addEventListener("message", onMessage)
    {
      const panel = root.querySelector<HTMLElement>("#tweaks")
      const rootStyle = document.getElementById("lp3-root")!.style
      if (panel) {
        if (new URLSearchParams(location.search).has("tweaks")) panel.classList.add("show")
        const closeBtn = root.querySelector<HTMLElement>("#twClose")
        if (closeBtn) closeBtn.onclick = () => { panel.classList.remove("show"); parent.postMessage("tweaks:closed", "*") }
        const seg = (id: string, fn: (b: HTMLElement) => void) => {
          const g = root.querySelector<HTMLElement>("#" + id); if (!g) return
          g.addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest("button"); if (!b) return; g.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); fn(b) })
        }
        const accent = root.querySelector<HTMLElement>("#twAccent")
        accent?.addEventListener("click", (e) => {
          const b = (e.target as HTMLElement).closest("button"); if (!b) return
          accent.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b))
          rootStyle.setProperty("--accent", b.dataset.c!)
          rootStyle.setProperty("--accent-soft", "color-mix(in oklab, " + b.dataset.c + " 55%, white)")
        })
        seg("twHl", (b) => { root.querySelectorAll(".hl").forEach((x) => { x.classList.toggle("nohl", b.dataset.h === "off"); x.classList.toggle("grad", b.dataset.h === "grad") }) })
        seg("twWord", (b) => {
          const grad = root.querySelector<HTMLElement>("#twHl button.on")?.dataset.h === "grad"
          const cls = "hl" + (grad ? " grad" : "")
          const h1 = root.querySelector<HTMLElement>(".hero h1")
          if (h1) h1.innerHTML = b.dataset.w === "ranked"
            ? 'Your life science market, <span class="' + cls + '" id="hlword">ranked</span> every morning.'
            : 'Revenue intelligence for <span class="' + cls + '" id="hlword">life science</span>.'
        })
        seg("twCta", (b) => {
          const dual = b.dataset.ctaMode === "dual"
          const cta = root.querySelector<HTMLElement>("#heroCta"); if (!cta) return
          if (dual && !cta.querySelector(".btn-ghost")) {
            const a = document.createElement("a"); a.className = "btn btn-ghost btn-lg"; a.href = "#"; a.textContent = "Book a call"; cta.appendChild(a)
          } else if (!dual && cta.querySelector(".btn-ghost")) { cta.querySelector(".btn-ghost")!.remove() }
        })
      }
    }

    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("message", onMessage)
      billToggle?.removeEventListener("click", onBill)
      observers.forEach((o) => o.disconnect())
      timeouts.forEach((t) => clearTimeout(t))
      intervals.forEach((t) => clearInterval(t))
    }
  }, [])

  return <div id="lp3-root" dangerouslySetInnerHTML={{ __html: LANDING_HTML }} />
}
