"use client"

import { useEffect, useRef, useState } from "react"
import { Eyebrow } from "../components/primitives"
import { BRIEF_STATS, BRIEF_ITEMS } from "../data"

function useCountUp(target: number, active: boolean) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!active) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setN(target); return }
    let cur = 0
    const id = setInterval(() => {
      cur += Math.ceil(target / 26)
      if (cur >= target) { cur = target; clearInterval(id) }
      setN(cur)
    }, 32)
    return () => clearInterval(id)
  }, [target, active])
  return n
}

function Stat({ s, active }: { s: (typeof BRIEF_STATS)[number]; active: boolean }) {
  const n = useCountUp(s.num, active)
  return (
    <div className="brief-stat">
      <span className="num">{n}</span>
      <div className="st">
        <h4>{s.title}</h4>
        <p>{s.body}</p>
      </div>
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
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { setActive(true); io.disconnect() } }),
      { threshold: 0.3 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section className="section dark" aria-label="Every morning">
      <div className="wrap">
        <div className="section-head reveal">
          <Eyebrow onDark>Every morning</Eyebrow>
          <h2 className="h2" style={{ marginTop: 18 }}>Wake up to a day that&rsquo;s already prioritized.</h2>
          <p className="lead">You don&rsquo;t open Arcova to go digging. Each morning it hands your team a ranked to-do list — the signals that landed overnight, the leads already drafted, and exactly where to start.</p>
        </div>

        <div className="brief-layout" ref={ref}>
          <div className="brief-stats reveal">
            {BRIEF_STATS.map((s) => <Stat key={s.title} s={s} active={active} />)}
          </div>

          <div className="brief-card reveal" aria-hidden="true">
            <div className="brief-top">
              <span className="brief-orb" />
              <div>
                <div className="bt-l">Today&rsquo;s briefing</div>
                <div className="bt-g">Good morning — start here</div>
              </div>
              <span className="bt-meta">5 priorities</span>
            </div>
            <div className="brief-list">
              {BRIEF_ITEMS.map((it, i) => (
                <div className="brief-item" key={it.t}>
                  <span className="bn">{i + 1}</span>
                  <div>
                    <div className="bt-t">{it.t}</div>
                    <div className="bt-d">{it.d}</div>
                  </div>
                  <span className="blink">{it.link}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
