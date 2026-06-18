import { Eyebrow, SectionTitle } from "../components/primitives"
import { DIFF } from "../data"

export function Differentiation() {
  return (
    <section className="pad" aria-label="What makes Arcova different">
      <div className="wrap">
        <div className="head-block reveal">
          <Eyebrow>Why it&rsquo;s different</Eyebrow>
          <SectionTitle>Not a data list. Not a bolt-on.</SectionTitle>
          <p className="section-lead">
            Generic data tools don&rsquo;t understand life science. Bolt-on AI just summarizes. Arcova was built agent-first to decide who to call and what to say.
          </p>
        </div>

        <div className="diff-grid">
          {DIFF.map((d) => (
            <div className="diff reveal" key={d.head}>
              <div className="dh">{d.head}</div>
              <p>{d.body}</p>
              <div className="compare">
                <div className="col them">
                  <div className="cl">The old way</div>
                  {d.them}
                </div>
                <div className="col us">
                  <div className="cl">Arcova</div>
                  {d.us}
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="diff-line reveal">
          Bolt-on AI summarizes. <span className="hl">Arcova decides.</span>
        </p>
      </div>
    </section>
  )
}
