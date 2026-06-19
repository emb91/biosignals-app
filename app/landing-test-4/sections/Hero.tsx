import { Button, PriorityRing } from "../components/primitives"
import { HERO, HERO_ROWS } from "../data"

export function Hero() {
  return (
    <header className="hero" id="top">
      <div className="hero-grid" />
      <div className="hero-glow" />
      <div className="wrap">
        <h1>
          {HERO.headlineLead} <span className="hl">{HERO.headlineAccent}</span>
        </h1>
        <p className="hero-sub">{HERO.sub}</p>
        <div className="hero-cta">
          <Button variant="primary" large href="/signup" withArrow>
            Start for free
          </Button>
        </div>
        <div className="hero-icps" aria-label="Built for life science teams">
          {HERO.builtFor.map((b) => (
            <span className="chip-ls" key={b}>{b}</span>
          ))}
        </div>
      </div>

      {/* Product shot: the Contacts table — airy, one hot row, priority + latest signal */}
      <div className="hero-shot reveal">
        <div className="shot-card">
          <div className="shot-head">
            <div>
              <div className="shot-kick">Leads</div>
              <div className="shot-title">Contacts</div>
            </div>
            <span className="shot-actions">
              Actions
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
          </div>
          <div className="shot-tbl">
            <div className="shot-row shot-hr">
              <span>Name</span>
              <span className="hide-sm">Company</span>
              <span className="cn">Priority</span>
              <span className="hide-sm">Latest signal</span>
              <span className="cn">Action</span>
            </div>
            {HERO_ROWS.map((r, i) => (
              <div className={`shot-row${i === 0 ? " hot" : ""}`} key={r.name}>
                <div className="s-name">
                  {r.name}
                  <small>{r.title}</small>
                </div>
                <div className="s-co hide-sm">{r.co}</div>
                <div className="center">
                  <PriorityRing value={r.priority} />
                </div>
                <div className="s-sig hide-sm">{r.signal}</div>
                <div className="center">
                  <span className={`act ${r.action}`}>{r.actionLabel}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </header>
  )
}
