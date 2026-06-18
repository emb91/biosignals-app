"use client"

import { useEffect, useRef, useState } from "react"
import { Eyebrow, SectionTitle, SparkIcon, Chip } from "../components/primitives"

const NAME = "arcova.bio"
const STEPS = ["Reading the company", "Defining ideal customer profiles", "Mapping the buying team"]

export function HowItWorks() {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [typed, setTyped] = useState("")
  const [typing, setTyping] = useState(true)
  const [status, setStatus] = useState("")
  const [revealed, setRevealed] = useState(-1) // index of last revealed column
  const [done, setDone] = useState(false)

  useEffect(() => {
    const el = stageRef.current
    if (!el) return

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduce) {
      setTyped(NAME)
      setTyping(false)
      setRevealed(2)
      setDone(true)
      return
    }

    const timers: ReturnType<typeof setTimeout>[] = []
    let started = false

    const run = () => {
      if (started) return
      started = true
      let i = 0
      const type = () => {
        if (i <= NAME.length) {
          setTyped(NAME.slice(0, i))
          i++
          timers.push(setTimeout(type, 90))
        } else {
          setTyping(false)
          timers.push(setTimeout(reveal, 600))
        }
      }
      let s = 0
      const reveal = () => {
        if (s < STEPS.length) {
          setStatus(STEPS[s])
          setRevealed(s)
          s++
          timers.push(setTimeout(reveal, 1000))
        } else {
          setStatus("")
          setDone(true)
        }
      }
      type()
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            run()
            io.disconnect()
          }
        })
      },
      { threshold: 0.4 }
    )
    io.observe(el)
    return () => {
      io.disconnect()
      timers.forEach(clearTimeout)
    }
  }, [])

  return (
    <section className="pad-sm" id="how" aria-label="Setup in minutes">
      <div className="wrap">
        <div className="head-block reveal">
          <Eyebrow>Setup in minutes</Eyebrow>
          <SectionTitle>Give it your company name. The agent does the rest.</SectionTitle>
          <p className="section-lead">
            No spreadsheets, no rules to write. Arcova reads your company, defines who buys from you, and starts working the market for you.
          </p>
        </div>

        <div className="agent-stage reveal" ref={stageRef}>
          <div className="agent-input">
            <SparkIcon />
            <span className="typed">{typed}</span>
            {typing && <span className="caret" />}
            <span className="go">Analyze</span>
          </div>

          <div className="agent-status" aria-live="polite">
            {status && (
              <span className="think">
                {status} <i /><i /><i />
              </span>
            )}
          </div>

          <div className="agent-out">
            <div className={`agent-col${revealed >= 0 ? " in" : ""}`}>
              <div className="ct">Your company</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Arcova</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-mute)", marginTop: 5, lineHeight: 1.5 }}>
                GTM intelligence for life science. Sells to commercial and BD teams at tools, CRO, CDMO, biotech and diagnostics companies.
              </div>
            </div>
            <div className={`agent-col${revealed >= 1 ? " in" : ""}`}>
              <div className="ct">Ideal customer profile</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="mini-row"><span className="mini-k">Therapeutic areas</span><Chip teal>Oncology</Chip><Chip teal>Immunology</Chip><Chip teal>Rare disease</Chip></div>
                <div className="mini-row"><span className="mini-k">Modalities</span><Chip>mAb</Chip><Chip>Cell therapy</Chip></div>
                <div className="mini-row"><span className="mini-k">Company size</span><Chip>500&ndash;5,000</Chip></div>
              </div>
            </div>
            <div className={`agent-col${revealed >= 2 ? " in" : ""}`}>
              <div className="ct">Buying team</div>
              <Chip>VP / Head of Sales</Chip>
              <Chip>Business Development</Chip>
              <Chip>Commercial Ops</Chip>
              <Chip>Marketing</Chip>
            </div>
          </div>

          <div className={`agent-foot${done ? " in" : ""}`}>
            Setup complete. <b>Your market is now being watched.</b>
          </div>
        </div>
      </div>
    </section>
  )
}
