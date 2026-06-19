import { Button, Eyebrow } from "../components/primitives"
import { HERO, FEED } from "../data"

export function Hero() {
  return (
    <header className="hero" id="top">
      <div className="hero-grid" />
      <div className="hero-glow" />
      <div className="wrap hero-in">
        <div className="hero-copy">
          <Eyebrow>AI-native revenue engine</Eyebrow>
          <h1 className="display">{HERO.headline}</h1>
          <p className="lead">{HERO.sub}</p>
          <div className="hero-cta">
            <Button variant="primary" large href="/signup" withArrow>Start for free</Button>
            <Button variant="ghost" large href="/contact-us">Book a demo</Button>
          </div>
          <div className="hero-trust">
            <span className="lbl">Built for</span>
            {HERO.industries.map((ind, i) => (
              <span key={ind} style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
                {i > 0 && <span className="dot" />}
                <span className="ind">{ind}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Live market — a feed of buying signals, ranked */}
        <div className="feed" aria-hidden="true">
          <div className="feed-float">
            <span className="fi">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
            </span>
            <div>
              <div className="ft">Drafted &amp; ready</div>
              <div className="fv">8 leads today</div>
            </div>
          </div>
          {FEED.map((f) => (
            <div className={`feed-card ${f.barClass}`} key={f.co}>
              <span className="bar" />
              <div>
                <div className="feed-co">{f.co}</div>
                <div className="feed-meta">
                  <span className={`feed-tag ${f.tagClass}`}>{f.tag}</span>
                  {f.meta}
                </div>
                <div className="feed-sig">{f.sig}</div>
              </div>
              <div className="feed-right">
                <span className="pri"><span className="pdot" />{f.priority}</span>
                <span className={`feed-act ${f.actionClass}`}>{f.action}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </header>
  )
}
