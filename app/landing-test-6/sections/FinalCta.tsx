export function FinalCta() {
  return (
    <section className="cta-section" aria-label="Get started">
      <div className="wrap">
        <div className="cta-card reveal">
          <div className="inner">
            <span className="cta-eyebrow">Verify on your own data</span>
            <h2>
              See your accounts, <span className="hl">scored.</span>
            </h2>
            <p className="cta-sub">Try it free on 100 accounts. Get them enriched, scored and prioritised today.</p>
            <div className="acts">
              <form className="hero-form cta-form" action="/signup" method="get">
                <span className="hero-form-ic" aria-hidden="true"><span className="hero-form-live" /></span>
                <input className="hero-input" type="text" name="domain" placeholder="Enter your company to map your market" aria-label="Company domain" />
                <button type="submit" className="hero-go" aria-label="Map your market">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 2L11 13" />
                    <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                  </svg>
                </button>
              </form>
              <p className="cta-note">Free to start · No credit card · Set up in under 5 minutes</p>
              <a className="cta-demo" href="/contact-us">
                or Book a demo
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
