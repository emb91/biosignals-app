"use client"

import { useState } from "react"
import "./logo.css"

/* Shared gradient + glow defs */
function Defs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        {/* teal-to-pink wash along strokes / fills */}
        <linearGradient id="lt7stroke" gradientUnits="userSpaceOnUse" x1="26" y1="94" x2="94" y2="26">
          <stop offset="0" stopColor="#00a4b4" />
          <stop offset="0.44" stopColor="#46cabf" />
          <stop offset="0.74" stopColor="#b9acd9" />
          <stop offset="1" stopColor="#f3a9c2" />
        </linearGradient>
        {/* centre dot / orb */}
        <radialGradient id="lt7orb" cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#f1fbf8" />
          <stop offset="22%" stopColor="#9fe1d3" />
          <stop offset="60%" stopColor="#00a4b4" />
          <stop offset="100%" stopColor="#00788a" />
        </radialGradient>
        {/* pink sphere */}
        <radialGradient id="lt7orbPink" cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#fdeef4" />
          <stop offset="24%" stopColor="#f3c6d8" />
          <stop offset="62%" stopColor="#e58fb0" />
          <stop offset="100%" stopColor="#c96a8f" />
        </radialGradient>
        {/* soft Live orb (teal core, pink rim) */}
        <radialGradient id="lt7live" cx="38%" cy="34%" r="72%">
          <stop offset="0%" stopColor="#f1fbf8" />
          <stop offset="24%" stopColor="#7fd8cd" />
          <stop offset="62%" stopColor="#00a4b4" />
          <stop offset="100%" stopColor="#d98fb1" />
        </radialGradient>
        {/* production curtain gradient (for the comparison row) */}
        <linearGradient id="cur-pink" gradientUnits="userSpaceOnUse" x1="20" y1="98" x2="100" y2="28">
          <stop offset="0" stopColor="#00a4b4" />
          <stop offset="0.44" stopColor="#7fd8cd" />
          <stop offset="0.76" stopColor="#d8c6e6" />
          <stop offset="1" stopColor="#f6cdda" />
        </linearGradient>
        <filter id="lt7glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3.4" />
        </filter>
        <filter id="lt7glowLg" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
    </svg>
  )
}

/* a glowing dot */
function orb(cx: number, cy: number, r: number, glow = true, grad = "lt7orb") {
  return (
    <g key={`${cx}-${cy}-${r}`}>
      {glow && <circle cx={cx} cy={cy} r={r * 1.5} fill="#00a4b4" opacity={0.22} filter="url(#lt7glow)" />}
      <circle cx={cx} cy={cy} r={r} fill={`url(#${grad})`} />
      <circle cx={cx - r * 0.34} cy={cy - r * 0.4} r={Math.max(1.2, r * 0.24)} fill="#fff" opacity={0.9} />
    </g>
  )
}

const S = { fill: "none", stroke: "url(#lt7stroke)", strokeLinecap: "round" as const }

type Icon = { id: string; name: string; render: () => React.ReactNode }

const ICONS: Icon[] = [
  {
    id: "C9",
    name: "Three orbs, diagonal (no ring)",
    render: () => (
      <>
        {orb(42, 78, 13, true, "lt7orb")}
        {orb(60, 60, 10, false, "lt7live")}
        {orb(78, 42, 7, false, "lt7orbPink")}
      </>
    ),
  },
  {
    id: "C12",
    name: "Three orbs — larger, more spread",
    render: () => (
      <>
        {orb(34, 86, 16, true, "lt7orb")}
        {orb(60, 60, 12.5, false, "lt7live")}
        {orb(86, 34, 9, false, "lt7orbPink")}
      </>
    ),
  },
  {
    id: "C10",
    name: "Ring + smaller orb at 4 o'clock",
    render: () => (
      <>
        <circle cx="60" cy="60" r="34" fill="none" stroke="url(#lt7stroke)" strokeWidth={11} opacity={0.45} filter="url(#lt7glow)" />
        <circle cx="60" cy="60" r="34" {...S} strokeWidth={9} />
        {orb(60, 60, 14, false)}
        {orb(84, 84, 8, false, "lt7orbPink")}
      </>
    ),
  },
  {
    id: "C11",
    name: "Reference — line into orb, gap 12 to 2",
    render: () => (
      <>
        <path d="M89.44 43 A34 34 0 1 1 60 26" {...S} strokeWidth={9} />
        <line x1="60" y1="26" x2="60" y2="60" {...S} strokeWidth={9} />
        {orb(60, 60, 13.5, false)}
      </>
    ),
  },
  {
    id: "C7",
    name: "Orbit (ring + 2 orbs)",
    render: () => (
      <>
        <circle cx="60" cy="60" r="34" fill="none" stroke="url(#lt7stroke)" strokeWidth={11} opacity={0.45} filter="url(#lt7glow)" />
        <circle cx="60" cy="60" r="34" {...S} strokeWidth={9} />
        {orb(60, 60, 14, false)}
        {orb(84, 36, 10.5)}
      </>
    ),
  },
  {
    id: "C5",
    name: "Live orb (glowing)",
    render: () => (
      <>
        <circle cx="60" cy="60" r="48" fill="#2fd0c6" opacity={0.4} filter="url(#lt7glowLg)" />
        <circle cx="60" cy="60" r="40" fill="#00a4b4" opacity={0.3} filter="url(#lt7glow)" />
        <circle cx="60" cy="60" r="36" fill="url(#lt7live)" />
        <circle cx="46" cy="44" r="9" fill="#fff" opacity={0.85} />
      </>
    ),
  },
  {
    id: "C6",
    name: "Eclipse — ring + offset point",
    render: () => (
      <>
        <circle cx="60" cy="60" r="34" {...S} strokeWidth={6} />
        {orb(60, 60, 16)}
        <circle cx="60" cy="60" r="34" fill="none" stroke="url(#lt7stroke)" strokeWidth={6} strokeDasharray="40 200" strokeLinecap="round" transform="rotate(-35 60 60)" />
      </>
    ),
  },
]

// the current production mark, for the comparison row + selector
const CURTAIN_BARS = [
  "M16.5 94L16.5 73.5A7.5 7.5 0 0 1 31.5 73.5L31.5 94A4 4 0 0 1 27.5 98L20.5 98A4 4 0 0 1 16.5 94Z",
  "M34.5 94L34.5 51.5A7.5 7.5 0 0 1 49.5 51.5L49.5 94A4 4 0 0 1 45.5 98L38.5 98A4 4 0 0 1 34.5 94Z",
  "M52.5 94L52.5 39.5A7.5 7.5 0 0 1 67.5 39.5L67.5 94A4 4 0 0 1 63.5 98L56.5 98A4 4 0 0 1 52.5 94Z",
  "M70.5 94L70.5 51.5A7.5 7.5 0 0 1 85.5 51.5L85.5 94A4 4 0 0 1 81.5 98L74.5 98A4 4 0 0 1 70.5 94Z",
  "M88.5 94L88.5 73.5A7.5 7.5 0 0 1 103.5 73.5L103.5 94A4 4 0 0 1 99.5 98L92.5 98A4 4 0 0 1 88.5 94Z",
]
const CURTAIN: Icon = {
  id: "Curtain",
  name: "Current — curtain (production)",
  render: () => (
    <g transform="translate(0 -5)" fill="url(#cur-pink)">
      {CURTAIN_BARS.map((d) => <path key={d} d={d} />)}
    </g>
  ),
}
const ALL: Icon[] = [...ICONS, CURTAIN]

// The side-nav trial is narrowed to the finalists; the Scope section still shows everything.
const SHORTLIST: Icon[] = [...ICONS.filter((i) => i.id === "C5" || i.id === "C6"), CURTAIN]

// Brand feedback, graded on three axes from logo research:
//  • small-size survivability (the 16-32px favicon test)
//  • gradient reproduction + single-color/B&W fallback
//  • distinctiveness (dots/circles are the #1 overused tech cliche — the "generic mark" problem)
type Feedback = { verdict: string; pros: string[]; cons: string[] }
const FEEDBACK: Record<string, Feedback> = {
  C5: {
    verdict: "Safest legibility, weakest identity — a placeholder, not a brand.",
    pros: [
      "Maximum simplicity = best 16px survivability; easiest to reproduce anywhere.",
      "The glow gives a \"live signal / pulse\" feel.",
    ],
    cons: [
      "A solid circle is the most generic mark possible — zero distinctiveness.",
      "The glow dies on flatten / single-color, leaving a plain dot.",
      "Says nothing about what the product does.",
    ],
  },
  C6: {
    verdict: "Pretty but off-concept — distinctiveness without meaning.",
    pros: [
      "The offset crescent is elegant and more ownable than plain orbs.",
      "Single clear focal point.",
    ],
    cons: [
      "Eclipse / phase metaphor doesn't connect to signals or market-watching.",
      "Dashed offset arc is fiddly small and in single-color.",
      "Can read as a generic moon / finance mark.",
    ],
  },
  Curtain: {
    verdict: "Strongest small-size legibility of the set and the most on-concept silhouette — bars read as signal/data. Its risk is the opposite of the orbs': not too generic, but a touch expected for an analytics product.",
    pros: [
      "Bars read as signal strength / data — on-concept, and an ownable silhouette.",
      "Simple bar shapes stay legible down to favicon size.",
      "Carries the full gradient across the five bars.",
    ],
    cons: [
      "Bar / equalizer shape is common-ish (audio, analytics).",
      "Symmetric rise-and-fall can read decorative rather than meaningful.",
      "Still needs a solid fallback for single-color use.",
    ],
  },
}

const NAV = [
  { label: "Today", active: true },
  { label: "Accounts", active: false },
  { label: "Leads", active: false },
  { label: "Coverage", active: false },
  { label: "Data", active: false },
  { label: "Outreach", active: false },
]

function Card({ ic }: { ic: Icon }) {
  return (
    <div className="card">
      <div className="card-h">
        <span className="cnum">{ic.id}</span>
        <span className="cname">{ic.name}</span>
      </div>
      <div className="tiles">
        <div className="tile wash"><svg viewBox="0 0 120 120">{ic.render()}</svg></div>
        <div className="tile navy app"><svg viewBox="0 0 120 120">{ic.render()}</svg></div>
        <div className="tile light app"><svg viewBox="0 0 120 120">{ic.render()}</svg></div>
      </div>
    </div>
  )
}

function Lock({ bg, ic }: { bg: string; ic: Icon }) {
  return (
    <div className={`lock ${bg}`}>
      <span className="badge"><svg viewBox="0 0 120 120">{ic.render()}</svg></span>
      <span className="word">arcova</span>
    </div>
  )
}

export default function LogoTest7() {
  const [sel, setSel] = useState(SHORTLIST.length - 1)
  return (
    <div id="lt7">
      <Defs />
      <div className="wrap">
        <span className="eyebrow">Logo test 7</span>
        <h1>Circle / scope mark</h1>
        <p className="lede">
          The look you locked in &mdash; navy squircle, teal-to-pink gradient, Quicksand wordmark &mdash; applied to a
          circle icon instead of the bars. These lean &ldquo;radar / scope&rdquo; (a ring, a centre point, a contact
          blip) so they keep the circle you like but read as watching a market, not a bullseye.
        </p>

        <section className="dir">
          <div className="dir-h"><span className="dir-tag">○</span><h2>Scope / radar takes</h2></div>
          <p className="dir-note">Each shown on the brand wash, on the navy squircle (app icon), and on white.</p>
          <div className="grid">
            {ICONS.map((ic) => <Card key={ic.id} ic={ic} />)}
          </div>
        </section>

        <section className="dir">
          <div className="dir-h"><span className="dir-tag">W</span><h2>Wordmark lockups</h2></div>
          <p className="dir-note">Each variant beside &ldquo;arcova&rdquo; &mdash; light and navy, one variant per row.</p>
          <div className="lockrows">
            {ALL.map((ic) => (
              <div className="lockrow" key={ic.id}>
                <Lock bg="light" ic={ic} />
                <Lock bg="navy" ic={ic} />
              </div>
            ))}
          </div>
        </section>

        <section className="dir">
          <div className="dir-h"><span className="dir-tag">N</span><h2>In the side nav</h2></div>
          <p className="dir-note">Pick a mark to preview it in the app side nav &mdash; expanded and collapsed.</p>
          <div className="picker">
            {SHORTLIST.map((ic, i) => (
              <button key={ic.id} type="button" className={`pbtn${i === sel ? " on" : ""}`} onClick={() => setSel(i)} title={ic.name}>
                <span className="pbtn-swatch"><svg viewBox="0 0 120 120">{ic.render()}</svg></span>
                <span className="pbtn-id">{ic.id}</span>
              </button>
            ))}
          </div>
          <div className="navstage">
            <div className="navmock">
              <div className="navside">
                <div className="navhead">
                  <span className="navbadge"><svg viewBox="0 0 120 120">{SHORTLIST[sel].render()}</svg></span>
                  <span className="navword">arcova</span>
                </div>
                <div className="navitems">
                  {NAV.map((n) => (
                    <div className={`navitem${n.active ? " active" : ""}`} key={n.label}>
                      <span className="navico" />
                      <span>{n.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="navrail">
                <span className="navbadge"><svg viewBox="0 0 120 120">{SHORTLIST[sel].render()}</svg></span>
                <div className="railitems">
                  {NAV.map((n) => <span className={`railico${n.active ? " active" : ""}`} key={n.label} />)}
                </div>
              </div>
            </div>
            <div className="fbpanel">
              <div className="fbhead">
                <span className="fbbadge"><svg viewBox="0 0 120 120">{SHORTLIST[sel].render()}</svg></span>
                <div>
                  <span className="fbid">{SHORTLIST[sel].id}</span>
                  <span className="fbname">{SHORTLIST[sel].name}</span>
                </div>
              </div>
              <p className="fbverdict">{FEEDBACK[SHORTLIST[sel].id].verdict}</p>
              <div className="fbcols">
                <div className="fbcol">
                  <span className="fblabel pro">Pros</span>
                  <ul>{FEEDBACK[SHORTLIST[sel].id].pros.map((p) => <li key={p}>{p}</li>)}</ul>
                </div>
                <div className="fbcol">
                  <span className="fblabel con">Cons</span>
                  <ul>{FEEDBACK[SHORTLIST[sel].id].cons.map((c) => <li key={c}>{c}</li>)}</ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="dir">
          <div className="dir-h"><span className="dir-tag">f</span><h2>At favicon size</h2></div>
          <p className="dir-note">True 48 / 32 / 16px &mdash; the real test. The browser tab on the right shows the mark where it actually lives: beside the title.</p>
          <div className="favgrid">
            {SHORTLIST.map((ic) => (
              <div className="favrow" key={ic.id}>
                <span className="favid">{ic.id}</span>
                <div className="favsizes">
                  {[48, 32, 16].map((px) => (
                    <span className="favnavy" style={{ width: px, height: px }} key={px}>
                      <svg viewBox="0 0 120 120">{ic.render()}</svg>
                    </span>
                  ))}
                </div>
                <div className="favtab">
                  <span className="favtabico"><svg viewBox="0 0 120 120">{ic.render()}</svg></span>
                  <span className="favtabword">arcova &mdash; Today</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
