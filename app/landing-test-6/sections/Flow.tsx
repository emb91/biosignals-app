import { FLOW } from "../data"

export function Flow() {
  return (
    <section className="section" id="how" style={{ paddingTop: 0 }} aria-label="How it works">
      <div className="wrap">
        <div className="section-head center reveal">
          <span className="eyebrow">Agentic by design</span>
          <h2 className="h2" style={{ marginTop: 18 }}>Point us at your market. We take it from there.</h2>
        </div>
        <div className="steps reveal">
          <div className="steps-rail" />
          {FLOW.map((f, i) => (
            <div className="step" key={f.title}>
              <div className="step-node"><span>{i + 1}</span></div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
