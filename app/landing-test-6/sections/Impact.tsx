import { Icons } from "../components/primitives"
import { CAPS } from "../data"

export function Impact() {
  return (
    <section className="section caps-section" aria-label="What Arcova does" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="caps reveal">
          {CAPS.map((c) => (
            <div className="cap" key={c.title}>
              <span className="cap-i">{Icons[c.icon]}</span>
              <div className="cap-tx">
                <b>{c.title}</b>
                <span>{c.body}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
