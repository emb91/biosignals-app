import { Eyebrow, SectionTitle, Chip, Button } from "../components/primitives"
import { MOMENTS } from "../data"

function Media({ kind }: { kind: "icp" | "signal" | "draft" | "crm" }) {
  if (kind === "icp") {
    return (
      <div className="mini">
        <div className="mini-row"><span className="mini-k">Looks like</span><Chip>Revvity</Chip><Chip>Enzene</Chip><Chip>PhenoVista</Chip></div>
        <div className="mini-row"><span className="mini-k">Therapeutic areas</span><Chip teal>Oncology</Chip><Chip teal>Immunology</Chip><Chip teal>Rare disease</Chip></div>
        <div className="mini-row"><span className="mini-k">Modalities</span><Chip>mAb</Chip><Chip>Cell therapy</Chip></div>
      </div>
    )
  }
  if (kind === "signal") {
    return (
      <div className="mini mini-signal">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ms-co">Kronos Biologics</div>
          <div className="ms-sig">Series B closed</div>
        </div>
        <span className="badge funding">Funding</span>
        <span className="act send">Send</span>
      </div>
    )
  }
  if (kind === "draft") {
    return (
      <div className="mini">
        <div className="mini-draft">Congrats on closing the Series B. As you scale capacity ahead of Phase III, teams like yours usually start scoping&hellip;</div>
        <div className="mini-actions">
          <Button variant="primary">Approve &amp; send</Button>
          <Button variant="ghost">Edit</Button>
        </div>
      </div>
    )
  }
  return (
    <div className="mini">
      <div className="kv2">
        <span className="k">Fit score</span><span className="v teal">94 · High fit</span>
        <span className="k">Readiness</span><span className="v teal">88 · Buying window</span>
        <span className="k">Priority rank</span><span className="v">#1 this week</span>
        <span className="k">Synced to</span><span className="v">CRM · Outreach</span>
      </div>
    </div>
  )
}

export function Moments() {
  return (
    <section className="pad" aria-label="The four moments">
      <div className="wrap">
        <div className="head-block reveal">
          <Eyebrow>How it works</Eyebrow>
          <SectionTitle>Four moments, one engine.</SectionTitle>
          <p className="section-lead">
            Arcova runs the full revenue motion for life science — target the right accounts, surface the moment they&rsquo;re ready, act on it, and keep the whole thing fresh.
          </p>
        </div>

        <div className="moments-grid">
          {MOMENTS.map((m) => (
            <div className="moment reveal" key={m.step}>
              <div className="m-step"><span className="dot" />{m.step}</div>
              <h3>{m.title}</h3>
              <p>{m.body}</p>
              <div className="m-media"><Media kind={m.media} /></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
