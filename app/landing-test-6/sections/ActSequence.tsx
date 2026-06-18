"use client"

import { useEffect, useRef, useState } from "react"
import { ACT_STEPS } from "../data"

export function ActSequence() {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [idx, setIdx] = useState(0)
  const inView = useRef(false)
  const hovered = useRef(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  // re-trigger the swap animation whenever the step changes
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    box.classList.remove("swap")
    void box.offsetWidth
    box.classList.add("swap")
  }, [idx])

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    const start = () => {
      if (timer.current || reduce || !inView.current || hovered.current) return
      timer.current = setInterval(() => setIdx((i) => (i + 1) % ACT_STEPS.length), 3000)
    }
    const stop = () => {
      if (timer.current) { clearInterval(timer.current); timer.current = null }
    }

    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { inView.current = e.isIntersecting; if (e.isIntersecting) start(); else stop() }),
      { threshold: 0.4 }
    )
    io.observe(box)

    const onEnter = () => { hovered.current = true; stop() }
    const onLeave = () => { hovered.current = false; start() }
    box.addEventListener("mouseenter", onEnter)
    box.addEventListener("mouseleave", onLeave)

    return () => { io.disconnect(); box.removeEventListener("mouseenter", onEnter); box.removeEventListener("mouseleave", onLeave); stop() }
  }, [])

  const s = ACT_STEPS[idx]

  return (
    <div className="draftbox" ref={boxRef}>
      <div className="db-head">
        <span className="db-seq">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
          Outreach sequence
        </span>
        <span className="db-step"><b>{idx + 1}</b> / {ACT_STEPS.length}</span>
      </div>
      <div className="db-dots">
        {ACT_STEPS.map((_, i) => <i key={i} className={i === idx ? "on" : ""} />)}
      </div>
      <div className="db-anim">
        <div className="db-meta"><span className="db-chan">{s.chan}</span></div>
        <div className="db-subject">{s.subject}</div>
        <div className="db-body">{s.body}</div>
      </div>
    </div>
  )
}
