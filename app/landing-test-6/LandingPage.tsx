"use client"

import { useEffect } from "react"
import "./landing.css"
import "./landing-signals.css"
import "./landing-pricing7.css"
import { ACT_STEPS } from "./data"
import { Nav } from "./sections/Nav"
import { Hero } from "./sections/Hero"
import { BuiltFor } from "./sections/BuiltFor"
import { Caps } from "./sections/Caps"
import { Bento } from "./sections/Bento"
import { Signals } from "./sections/Signals"
import { HowItWorks } from "./sections/HowItWorks"
import { Pricing } from "./sections/Pricing"
import { Comparison } from "./sections/Comparison"
import { FinalCta } from "./sections/FinalCta"
import { Footer } from "./sections/Footer"

export default function LandingPage() {
  useEffect(() => {
    const root = document.getElementById("lt6")
    const nav = document.getElementById("lt6-nav")
    if (!root) return

    const cleanups: Array<() => void> = []
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    // nav scrolled state
    const onScroll = () => nav?.classList.toggle("scrolled", window.scrollY > 20)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    cleanups.push(() => window.removeEventListener("scroll", onScroll))

    // reveal on view
    if (reduce) {
      root.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"))
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (!e.isIntersecting) return
            e.target.classList.add("in")
            io.unobserve(e.target)
          })
        },
        { threshold: 0.14 }
      )
      root.querySelectorAll(".reveal").forEach((el) => io.observe(el))
      cleanups.push(() => io.disconnect())
    }

    // live date / time / greeting in the hero mockup
    const now = new Date()
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    const dateEl = document.getElementById("tdy-date")
    if (dateEl) dateEl.textContent = `Daily briefing · ${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]}`
    const timeEl = document.getElementById("ag-time")
    if (timeEl) {
      const h = now.getHours()
      const m = now.getMinutes()
      timeEl.textContent = `${h < 10 ? "0" + h : h}:${m < 10 ? "0" + m : m} local`
    }
    const greetEl = document.getElementById("tdy-greet")
    if (greetEl) {
      const hr = now.getHours()
      greetEl.textContent = hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening"
    }

    // priority-score count-up
    const scoreEl = document.getElementById("pscore-n")
    if (scoreEl) {
      const target = parseInt(scoreEl.textContent || "0", 10) || 0
      if (reduce) {
        scoreEl.textContent = String(target)
      } else {
        let done = false
        const run = () => {
          if (done) return
          done = true
          let start: number | null = null
          const dur = 1200
          const tick = (ts: number) => {
            if (start === null) start = ts
            const p = Math.min((ts - start) / dur, 1)
            const eased = 1 - Math.pow(1 - p, 3)
            scoreEl.textContent = String(Math.round(eased * target))
            if (p < 1) requestAnimationFrame(tick)
          }
          scoreEl.textContent = "0"
          requestAnimationFrame(tick)
        }
        const sio = new IntersectionObserver(
          (entries) => {
            entries.forEach((e) => {
              if (e.isIntersecting) {
                run()
                sio.disconnect()
              }
            })
          },
          { threshold: 0.5 }
        )
        sio.observe(scoreEl)
        cleanups.push(() => sio.disconnect())
      }
    }

    // animated outreach sequence in the bento "Engagement" tile
    const box = document.getElementById("seqbox")
    if (box) {
      const elChan = document.getElementById("seq-chan")
      const elSubj = document.getElementById("seq-subject")
      const elBody = document.getElementById("seq-body")
      const dots = Array.from(document.querySelectorAll<HTMLElement>("#seq-dots i"))
      let i = 0
      let timer: ReturnType<typeof setInterval> | null = null
      const render = (n: number) => {
        const s = ACT_STEPS[n]
        if (elChan) elChan.textContent = s.chan
        if (elSubj) elSubj.textContent = s.subject
        if (elBody) elBody.textContent = s.body
        dots.forEach((d, k) => d.classList.toggle("on", k === n))
        box.classList.remove("swap")
        void box.offsetWidth
        box.classList.add("swap")
      }
      const advance = () => {
        i = (i + 1) % ACT_STEPS.length
        render(i)
      }
      const start = () => {
        if (timer || reduce) return
        timer = setInterval(advance, 3000)
      }
      const stop = () => {
        if (timer) {
          clearInterval(timer)
          timer = null
        }
      }
      const bio = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => (e.isIntersecting ? start() : stop()))
        },
        { threshold: 0.4 }
      )
      bio.observe(box)
      box.addEventListener("mouseenter", stop)
      box.addEventListener("mouseleave", start)
      cleanups.push(() => {
        stop()
        bio.disconnect()
        box.removeEventListener("mouseenter", stop)
        box.removeEventListener("mouseleave", start)
      })
    }

    return () => cleanups.forEach((fn) => fn())
  }, [])

  return (
    <div id="lt6">
      <Nav />
      <main>
        <Hero />
        <BuiltFor />
        <Caps />
        <Bento />
        <Signals />
        <HowItWorks />
        <Pricing />
        <Comparison />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}
