import { Eyebrow, CheckIcon, MinusIcon, Mark } from "../components/primitives"
import { COMPARE, type CompareVal } from "../data"

function Cell({ v, label, highlight = false }: { v: CompareVal; label: string; highlight?: boolean }) {
  const map = {
    yes: { cls: "yes", icon: <CheckIcon />, aria: "Yes" },
    partial: { cls: "partial", icon: <MinusIcon />, aria: "Partial" },
    no: { cls: "no", icon: <MinusIcon />, aria: "No" },
  }[v]
  return (
    <div className={`cc cell${highlight ? " us-col" : ""}`} data-label={label} role="cell">
      <span className={`ic ${map.cls}`} role="img" aria-label={map.aria}>{map.icon}</span>
    </div>
  )
}

export function Compare() {
  return (
    <section className="section" id="why" aria-label="Why Arcova is different">
      <div className="wrap">
        <div className="section-head reveal">
          <Eyebrow>Why Arcova</Eyebrow>
          <h2 className="h2" style={{ marginTop: 18 }}>Not a data list. Not a bolt-on.</h2>
          <p className="lead">Generic data tools don&rsquo;t understand life science. Bolt-on AI just summarizes. Arcova was built agent-first to decide who to call and what to say.</p>
        </div>

        <div className="compare reveal" role="table" aria-label="Arcova compared with generic data tools and bolt-on AI">
          <div className="compare-row compare-head" role="row">
            <div className="cc" role="columnheader" />
            <div className="cc us" role="columnheader">
              <span className="cap"><Mark size={18} className="mk" />Arcova</span>
            </div>
            <div className="cc" role="columnheader"><span className="cap">Generic data tools</span></div>
            <div className="cc" role="columnheader"><span className="cap">Bolt-on AI</span></div>
          </div>

          {COMPARE.map((r) => (
            <div className="compare-row" role="row" key={r.feat}>
              <div className="cc feat-cell" role="cell">
                <div className="feat">{r.feat}<small>{r.sub}</small></div>
              </div>
              <Cell v={r.arcova} label="Arcova" highlight />
              <Cell v={r.generic} label="Generic data tools" />
              <Cell v={r.bolton} label="Bolt-on AI" />
            </div>
          ))}
        </div>

        <p className="compare-foot reveal">Bolt-on AI summarizes. <span className="hl">Arcova decides.</span></p>
      </div>
    </section>
  )
}
