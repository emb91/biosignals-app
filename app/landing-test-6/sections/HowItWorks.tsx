import { STEPS } from "../data"

export function HowItWorks() {
  return (
    <section className="section how-section" id="how" aria-label="How it works">
      <div className="wrap">
        <div className="how-panel reveal">
          <div className="section-head center">
            <span className="eyebrow">Always-on research</span>
            <h2 className="h2" style={{ marginTop: 18 }}>
              Your market, kept <span className="grad">current.</span>
            </h2>
          </div>
          <div className="steps">
            <div className="steps-rail" />
            {STEPS.map((step) => (
              <div className="step" key={step.n}>
                <div className="step-node"><span>{step.n}</span></div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
