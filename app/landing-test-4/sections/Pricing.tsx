"use client"

import { Fragment, useState } from "react"
import { Eyebrow, CheckIcon, Button } from "../components/primitives"
import { TIERS } from "../data"

/** Render a feature string, turning **bold** spans into <b>. */
function Feature({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>
      )}
    </span>
  )
}

export function Pricing() {
  const [annual, setAnnual] = useState(false)

  return (
    <section className="pad-sm" id="pricing" aria-label="Pricing">
      <div className="wrap">
        <div className="price-head reveal">
          <div>
            <Eyebrow>Pricing</Eyebrow>
            <h2 className="section-title" style={{ fontSize: "clamp(1.8rem,1.2rem+2vw,2.6rem)" }}>
              Start free. Scale as you grow.
            </h2>
          </div>
          <div className="toggle" role="group" aria-label="Billing period">
            <button type="button" className={annual ? "" : "on"} aria-pressed={!annual} onClick={() => setAnnual(false)}>
              Monthly
            </button>
            <button type="button" className={annual ? "on" : ""} aria-pressed={annual} onClick={() => setAnnual(true)}>
              Annual <span className="save">2 months free</span>
            </button>
          </div>
        </div>

        <div className="price-grid reveal">
          {TIERS.map((t) => {
            const amount = annual && t.annual ? t.annual : t.monthly
            return (
              <div className={`tier${t.featured ? " feat" : ""}`} key={t.name}>
                {t.ribbon && <div className="ribbon">{t.ribbon}</div>}
                <div className="tname">{t.name}</div>
                <div className="tnote">{t.note}</div>
                <div className="tprice">
                  <span className="amt">{amount}</span>
                  {t.per && <span className="per">{annual ? "/workspace/yr" : t.per}</span>}
                </div>
                <div className="tbilled">{t.billedNote ? (annual ? `${t.billedNote} · billed annually` : t.billedNote) : ""}</div>
                <ul>
                  {t.features.map((f) => (
                    <li key={f}>
                      <CheckIcon size={14} />
                      <Feature text={f} />
                    </li>
                  ))}
                </ul>
                <div className="tbtn">
                  <Button variant={t.ctaVariant} href={t.name === "Enterprise" ? "/contact-us" : "/signup"}>
                    {t.cta}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>

        <p className="price-note reveal">Free to start · No credit card · Cancel anytime</p>
      </div>
    </section>
  )
}
