import { ActSequence } from "./ActSequence"

const DIMS = [
  { k: "Therapeutic area", v: "Oncology · Rare disease · Immunology" },
  { k: "Modality", v: "mAb · Cell & gene · ADC · siRNA" },
  { k: "Products & tech", v: "NGS platforms · CDMO capacity · assays" },
  { k: "Services", v: "Discovery · preclinical · clinical ops" },
]

const SIGNALS = [
  { co: "Aravelle Bio", sig: "Series B closed · scaling Phase III capacity", v: 94, l: "Ready" },
  { co: "Helix Tx", sig: "New VP Commercial · building the team", v: 88, l: "Warm" },
]

const WATCH = [
  { src: "Funding rounds", cnt: "+6" },
  { src: "Clinical milestones", cnt: "+11" },
  { src: "New hires", cnt: "+8" },
]

export function Bento() {
  return (
    <section className="section" id="why" aria-label="What you get" style={{ paddingTop: 0 }}>
      <div className="wrap">
        <div className="section-head reveal">
          <span className="eyebrow">One engine</span>
          <h2 className="h2" style={{ marginTop: 18 }}>Everything your revenue team needs to act first.</h2>
          <p className="lead">From the accounts worth your time to the message that opens the door, Arcova runs the whole motion and keeps it fresh.</p>
        </div>

        <div className="bento">
          {/* Target */}
          <div className="cell half reveal">
            <span className="ck">1 · Target</span>
            <h3>Deeper than firmographics.</h3>
            <p>Generic tools stop at industry and headcount. Arcova profiles every account on what actually signals fit.</p>
            <div className="media">
              {DIMS.map((d) => (
                <div className="dimrow" key={d.k}>
                  <span className="dim-k">{d.k}</span>
                  <span className="dim-v">{d.v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Surface */}
          <div className="cell half reveal">
            <span className="ck">2 · Surface</span>
            <h3>Reach out at the right moment.</h3>
            <p>Funding rounds, new hires and clinical milestones, scored for readiness the day they surface.</p>
            <div className="media">
              {SIGNALS.map((s) => (
                <div className="signalcard" key={s.co}>
                  <span className="bar" />
                  <div>
                    <div className="sc-co">{s.co}</div>
                    <div className="sc-sig">{s.sig}</div>
                  </div>
                  <div className="sc-score"><div className="v">{s.v}</div><div className="l">{s.l}</div></div>
                </div>
              ))}
            </div>
          </div>

          {/* Act */}
          <div className="cell half reveal">
            <span className="ck">3 · Act</span>
            <h3>From signal to sent in two clicks.</h3>
            <p>Arcova drafts a full multi-touch sequence in your voice, ready to export to a campaign. You just review and send.</p>
            <div className="media">
              <ActSequence />
            </div>
          </div>

          {/* Sustain (dark) */}
          <div className="cell half dark reveal">
            <span className="ck">4 · Sustain</span>
            <h3>Works while you sleep.</h3>
            <p>Your market is watched continuously, never a one-time pull that goes stale.</p>
            <div className="watch">
              <div className="watch-top">
                <span className="watch-live"><span className="wd" />Live</span>
                <span className="watch-time">Last swept 04:12</span>
              </div>
              <div className="watch-rows">
                {WATCH.map((w) => (
                  <div className="watch-row" key={w.src}>
                    <span className="watch-src"><span className="ws" />{w.src}</span>
                    <span className="watch-cnt">{w.cnt}</span>
                  </div>
                ))}
              </div>
              <div className="watch-bar"><i /></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
