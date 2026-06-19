import { CheckIcon } from "../components/primitives"
import { CRED } from "../data"

export function Credibility() {
  return (
    <section className="cred" aria-label="Why Arcova">
      <div className="wrap">
        <div className="cred-in reveal">
          {CRED.map((c) => (
            <div className="cred-item" key={c.title}>
              <span className="ci">
                <CheckIcon size={15} />
              </span>
              <div>
                <div className="ct">{c.title}</div>
                <div className="cd">{c.body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
