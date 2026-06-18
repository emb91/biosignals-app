import { ArrowIcon } from "../components/primitives"

function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

export function FinalCta() {
  return (
    <section className="cta-section" aria-label="Get started">
      <div className="wrap">
        <div className="cta-card reveal">
          <div className="inner">
            <span className="cta-eyebrow">Ready to start</span>
            <h2>Your market, ranked and ready <span className="hl">every morning.</span></h2>
            <p className="cta-sub">Point Arcova at your market and wake up to a ranked board, with the outreach already drafted. Free to start, no credit card.</p>
            <div className="acts">
              <a className="btn btn-white btn-lg" href="/signup">Start for free <ArrowIcon /></a>
              <a className="cta-demo" href="/contact-us">Book a demo<Chevron /></a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
