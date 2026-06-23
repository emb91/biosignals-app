import "./logo.css"
import { ArcovaLogo } from "@/components/brand/ArcovaLogo"
import { ArcovaMark } from "@/components/brand/ArcovaMark"

/* viewBox 0 0 120 120. A triangle in the logo's proportions, filled with five
   equal-width bars (outline dropped). Gentle mound, softly rounded bottoms,
   rounded fading tops. */
const BASE = 98
const W = 15 // every bar the same width
const RB = 4 // gentle bottom-corner radius
// [centre x, peak y] — gentle mound: centre only a little above its neighbours
const BARS: [number, number][] = [
  [24, 66],
  [42, 44],
  [60, 32],
  [78, 44],
  [96, 66],
]

function barPath(cx: number, peakY: number): string {
  const r = W / 2
  const l = cx - W / 2
  const right = cx + W / 2
  return [
    `M${l} ${BASE - RB}`,
    `L${l} ${peakY + r}`,
    `A${r} ${r} 0 0 1 ${right} ${peakY + r}`,
    `L${right} ${BASE - RB}`,
    `A${RB} ${RB} 0 0 1 ${right - RB} ${BASE}`,
    `L${l + RB} ${BASE}`,
    `A${RB} ${RB} 0 0 1 ${l} ${BASE - RB}`,
    "Z",
  ].join(" ")
}

const paths = (fill: string) => BARS.map(([cx, y], i) => <path key={i} d={barPath(cx, y)} fill={fill} />)

type CurtainOpts = { glow?: boolean; blurTop?: boolean; fill?: string }
function curtain({ glow = true, blurTop = false, fill = "url(#cur-rich)" }: CurtainOpts = {}) {
  return (
    <>
      {glow && <g filter="url(#ll-glow-lg)" opacity={0.4}>{paths(fill)}</g>}
      <g>{paths(fill)}</g>
      {blurTop && <g mask="url(#ll-topmask)" filter="url(#cur-blurtop)">{paths(fill)}</g>}
    </>
  )
}

function Defs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <linearGradient id="cur-rich" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#006c79" />
          <stop offset="32%" stopColor="#00a4b4" />
          <stop offset="62%" stopColor="#2bbfb8" />
          <stop offset="84%" stopColor="#7adfd2" />
          <stop offset="100%" stopColor="#d6f7ef" stopOpacity="0.25" />
        </linearGradient>
        {/* dark version, fading at the top so it dissolves into the bg */}
        <linearGradient id="cur-dark" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#003344" />
          <stop offset="60%" stopColor="#013a4c" />
          <stop offset="100%" stopColor="#003344" stopOpacity="0.2" />
        </linearGradient>
        {/* one gradient washed across all five bars (not per-bar) */}
        <linearGradient id="cur-span" gradientUnits="userSpaceOnUse" x1="20" y1="98" x2="100" y2="28">
          <stop offset="0%" stopColor="#006c79" />
          <stop offset="48%" stopColor="#00a4b4" />
          <stop offset="100%" stopColor="#9fe6db" />
        </linearGradient>
        {/* teal washing through to pale pink (lilac bridge avoids a muddy middle) */}
        <linearGradient id="cur-pink" gradientUnits="userSpaceOnUse" x1="20" y1="98" x2="100" y2="28">
          <stop offset="0%" stopColor="#00a4b4" />
          <stop offset="44%" stopColor="#7fd8cd" />
          <stop offset="76%" stopColor="#d8c6e6" />
          <stop offset="100%" stopColor="#f6cdda" />
        </linearGradient>
        {/* mask that fades a blurred copy in toward the top only */}
        <linearGradient id="ll-topmaskgrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" />
          <stop offset="42%" stopColor="#fff" />
          <stop offset="74%" stopColor="#000" />
        </linearGradient>
        <mask id="ll-topmask"><rect x="0" y="0" width="120" height="120" fill="url(#ll-topmaskgrad)" /></mask>
        <filter id="cur-blurtop" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.4" /></filter>
        <filter id="ll-glow-lg" x="-90%" y="-90%" width="280%" height="280%"><feGaussianBlur stdDeviation="5" /></filter>
      </defs>
    </svg>
  )
}

function Tile({ bg, label, opts }: { bg: string; label: string; opts?: CurtainOpts }) {
  return (
    <div className={`tile ${bg}`}>
      <svg className="glyph" viewBox="0 0 120 120">{curtain(opts)}</svg>
      <span className="tlab">{label}</span>
    </div>
  )
}

function Lock({ bg, fontCls, name, weight, markFill, tight }: { bg: string; fontCls: string; name: string; weight: number; markFill?: string; tight?: boolean }) {
  return (
    <div className={`lock ${bg}${tight ? " tight" : ""}`}>
      <svg className="glyph" width="40" height="40" viewBox="12 16 96 88">{curtain(markFill ? { fill: markFill } : undefined)}</svg>
      <span className={`word ${fontCls}`} style={{ fontWeight: weight }}>arcova</span>
      <span className="llab">{name}</span>
    </div>
  )
}

const FONTS = [
  { cls: "f-poppins", name: "Poppins 400", weight: 400 },
  { cls: "f-quicksand", name: "Quicksand 500", weight: 500 },
  { cls: "f-urbanist", name: "Urbanist 500", weight: 500 },
  { cls: "f-comfortaa", name: "Comfortaa 500", weight: 500 },
]

export default function LogoLab() {
  return (
    <div id="logolab">
      <Defs />
      <div className="wrap">
        <span className="eyebrow">Logo lab</span>
        <h1>Curtain mark</h1>
        <p className="lede">
          Five equal-width bars tracing a gentle triangle, softly rounded bottoms and rounded fading tops. Below:
          the base mark, plus a softer-top variant, one on mint, and a dark version on a teal-to-mint gradient.
        </p>

        <section className="dir">
          <div className="dir-h">
            <span className="dir-tag">&#9733;</span>
            <h2>Shortlist</h2>
          </div>
          <p className="dir-note">The four app icons you liked &mdash; teal and teal-to-pink, on navy and white &mdash; with Quicksand 500 lockups, mark pulled in close.</p>
          <div className="appgrid">
            <div className="appicon navy"><svg className="glyph" viewBox="12 16 96 88">{curtain()}</svg></div>
            <div className="appicon light"><svg className="glyph" viewBox="12 16 96 88">{curtain()}</svg></div>
            <div className="appicon navy"><svg className="glyph" viewBox="12 16 96 88">{curtain({ fill: "url(#cur-pink)" })}</svg></div>
            <div className="appicon light"><svg className="glyph" viewBox="12 16 96 88">{curtain({ fill: "url(#cur-pink)" })}</svg></div>
          </div>
          <div className="locks">
            <Lock bg="light" fontCls="f-quicksand" name="Teal" weight={500} tight />
            <Lock bg="dark" fontCls="f-quicksand" name="Teal" weight={500} tight />
            <Lock bg="light" fontCls="f-quicksand" name="Teal to pink" weight={500} markFill="url(#cur-pink)" tight />
            <Lock bg="dark" fontCls="f-quicksand" name="Teal to pink" weight={500} markFill="url(#cur-pink)" tight />
          </div>
        </section>

        <section className="dir">
          <div className="dir-h">
            <span className="dir-tag">&#10003;</span>
            <h2>Production components</h2>
          </div>
          <p className="dir-note">The shipped &lt;ArcovaLogo&gt; and &lt;ArcovaMark&gt; from <code>components/brand</code> &mdash; the same files the app and site import. Favicon and app icons are generated from these and wired in.</p>
          <div className="locks">
            <div className="lock light"><ArcovaLogo variant="teal-pink" tone="ink" size={34} /></div>
            <div className="lock dark"><ArcovaLogo variant="teal-pink" tone="light" size={34} /></div>
            <div className="lock light" style={{ gap: 18 }}>
              <ArcovaMark variant="teal-pink" size={40} />
              <ArcovaMark variant="teal" size={40} />
              <ArcovaMark variant="navy" size={40} />
            </div>
          </div>
        </section>

        <section className="dir">
          <div className="dir-h">
            <span className="dir-tag">M</span>
            <h2>The mark</h2>
          </div>
          <div className="hero">
            <Tile bg="light" label="Light" />
            <Tile bg="dark" label="Dark" />
          </div>
        </section>

        <section className="dir">
          <div className="dir-h">
            <span className="dir-tag">V</span>
            <h2>Variants</h2>
          </div>
          <div className="vargrid">
            <Tile bg="light" label="Softer top" opts={{ blurTop: true }} />
            <Tile bg="dark" label="Softer top" opts={{ blurTop: true }} />
            <Tile bg="mint" label="On mint" />
            <Tile bg="grad" label="Dark on gradient" opts={{ glow: false, fill: "url(#cur-dark)" }} />
            <Tile bg="dark" label="One gradient (all bars)" opts={{ fill: "url(#cur-span)" }} />
            <Tile bg="light" label="One gradient (all bars)" opts={{ fill: "url(#cur-span)" }} />
            <Tile bg="dark" label="Teal to pink" opts={{ fill: "url(#cur-pink)" }} />
            <Tile bg="light" label="Teal to pink" opts={{ fill: "url(#cur-pink)" }} />
            <Tile bg="dark" label="Pink + softer top" opts={{ fill: "url(#cur-pink)", blurTop: true }} />
            <Tile bg="light" label="Pink + softer top" opts={{ fill: "url(#cur-pink)", blurTop: true }} />
          </div>
        </section>

        <section className="dir">
          <div className="dir-h">
            <span className="dir-tag">I</span>
            <h2>App icon</h2>
          </div>
          <p className="dir-note">On brand navy and on white, squircle-cropped.</p>
          <div className="appgrid">
            <div className="appicon navy"><svg className="glyph" viewBox="12 16 96 88">{curtain()}</svg></div>
            <div className="appicon light"><svg className="glyph" viewBox="12 16 96 88">{curtain()}</svg></div>
            <div className="appicon navy"><svg className="glyph" viewBox="12 16 96 88">{curtain({ fill: "url(#cur-pink)", blurTop: true })}</svg></div>
            <div className="appicon light"><svg className="glyph" viewBox="12 16 96 88">{curtain({ fill: "url(#cur-pink)", blurTop: true })}</svg></div>
            <div className="appicon navy"><svg className="glyph" viewBox="12 16 96 88">{curtain({ fill: "url(#cur-pink)" })}</svg></div>
            <div className="appicon light"><svg className="glyph" viewBox="12 16 96 88">{curtain({ fill: "url(#cur-pink)" })}</svg></div>
          </div>
        </section>

        <section className="dir">
          <div className="dir-h">
            <span className="dir-tag">W</span>
            <h2>Wordmark lockups</h2>
          </div>
          <p className="dir-note">Rounded but finer than before &mdash; Poppins at a lighter weight, plus rounded alternatives.</p>
          <div className="locks">
            {FONTS.map((f) => (
              <Lock key={f.cls} bg="light" fontCls={f.cls} name={f.name} weight={f.weight} />
            ))}
            <Lock bg="dark" fontCls="f-poppins" name="Poppins 400" weight={400} />
            <Lock bg="dark" fontCls="f-quicksand" name="Quicksand 500" weight={500} />
            <Lock bg="light" fontCls="f-poppins" name="Poppins · pink mark" weight={400} markFill="url(#cur-pink)" />
            <Lock bg="dark" fontCls="f-quicksand" name="Quicksand · pink mark" weight={500} markFill="url(#cur-pink)" />
          </div>
        </section>
      </div>
    </div>
  )
}
