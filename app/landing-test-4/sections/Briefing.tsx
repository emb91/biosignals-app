"use client"

import { useEffect, useRef, useState } from "react"
import { Eyebrow, SectionTitle } from "../components/primitives"
import { BRIEFING } from "../data"

function useCountUp(target: number, active: boolean) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!active) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(target)
      return
    }
    let cur = 0
    const id = setInterval(() => {
      cur += Math.ceil(target / 28)
      if (cur >= target) {
        cur = target
        clearInterval(id)
      }
      setN(cur)
    }, 30)
    return () => clearInterval(id)
  }, [target, active])
  return n
}

function ScoreCard({ card, active }: { card: (typeof BRIEFING)[number]; active: boolean }) {
  const n = useCountUp(card.count, active)
  return (
    <div className="score-card reveal" style={{ ["--cc" as string]: card.cc } as React.CSSProperties}>
      <span className="lab">{card.lab}</span>
      <div className="big">{n}</div>
      <h4>{card.title}</h4>
      <p>{card.body}</p>
    </div>
  )
}

export function Briefing() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setActive(true)
            io.disconnect()
          }
        })
      },
      { threshold: 0.3 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section className="dark pad" aria-label="Every morning">
      <div className="wrap">
        <div className="head-block reveal">
          <Eyebrow onDark>Every morning</Eyebrow>
          <SectionTitle>Wake up to your day, already prioritized.</SectionTitle>
          <p className="section-lead">
            You don&rsquo;t open Arcova to go digging. Each morning it hands your team a ranked to-do list: the signals that landed overnight, the leads already drafted, and exactly where to start.
          </p>
        </div>
        <div className="score-grid" ref={ref}>
          {BRIEFING.map((c) => (
            <ScoreCard key={c.lab} card={c} active={active} />
          ))}
        </div>
      </div>
    </section>
  )
}
