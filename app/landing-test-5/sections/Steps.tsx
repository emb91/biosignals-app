import { Eyebrow, Icons } from "../components/primitives"
import { STEPS } from "../data"

export function Steps() {
  return (
    <section className="section" style={{ paddingTop: 0 }} aria-label="Setup in minutes">
      <div className="wrap">
        <div className="section-head reveal">
          <Eyebrow>Setup in minutes</Eyebrow>
          <h2 className="h2" style={{ marginTop: 18 }}>Give it your company name. The agent does the rest.</h2>
          <p className="lead">No spreadsheets. No rules to write. Arcova reads your company, defines who buys from you, and starts working the market for you.</p>
        </div>

        <div className="steps reveal">
          {STEPS.map((s) => (
            <div className="step" key={s.title}>
              <span className="sn">{Icons[s.icon]}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
