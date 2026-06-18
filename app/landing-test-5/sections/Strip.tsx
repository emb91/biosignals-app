import { MARQUEE } from "../data"

export function Strip() {
  // duplicate the list so the marquee can loop seamlessly (-50%)
  const items = [...MARQUEE, ...MARQUEE]
  return (
    <section className="strip" aria-label="Signals Arcova watches for">
      <div className="wrap strip-in">
        <span className="strip-lbl">Signals we watch</span>
        <div className="marquee">
          <div className="marquee-track">
            {items.map((s, i) => (
              <span className="sig-chip" key={i}><span className="sd" />{s}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
