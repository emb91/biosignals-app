import { Eyebrow, Button } from "../components/primitives"

export function FinalCta() {
  return (
    <section className="final" aria-label="Get started">
      <div className="wrap">
        <div className="final-card reveal">
          <div className="spots" />
          <div className="inner">
            <Eyebrow onDark>Ready to start</Eyebrow>
            <h2>Your market, ranked and ready every morning.</h2>
            <p>Set up once. Arcova does the rest.</p>
            <div className="hero-cta">
              <Button variant="primary" large href="/signup" withArrow>
                Start for free
              </Button>
            </div>
            <div className="fine">Free to start · No credit card · Find your first leads in minutes</div>
          </div>
        </div>
      </div>
    </section>
  )
}
