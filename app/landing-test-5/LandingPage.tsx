"use client"

import { useEffect } from "react"
import "./landing.css"
import { Nav } from "./sections/Nav"
import { Hero } from "./sections/Hero"
import { Strip } from "./sections/Strip"
import { FeatureTabs } from "./sections/FeatureTabs"
import { Steps } from "./sections/Steps"
import { Briefing } from "./sections/Briefing"
import { Compare } from "./sections/Compare"
import { Pricing } from "./sections/Pricing"
import { FinalCta } from "./sections/FinalCta"
import { Footer } from "./sections/Footer"

export default function LandingPage() {
  useEffect(() => {
    const root = document.getElementById("lt5")
    const nav = document.getElementById("lt5-nav")
    if (!root) return

    const onScroll = () => nav?.classList.toggle("scrolled", window.scrollY > 20)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let io: IntersectionObserver | undefined
    if (reduce) {
      root.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"))
    } else {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (!e.isIntersecting) return
            e.target.classList.add("in")
            io?.unobserve(e.target)
          })
        },
        { threshold: 0.14 }
      )
      root.querySelectorAll(".reveal").forEach((el) => io!.observe(el))
    }

    return () => {
      window.removeEventListener("scroll", onScroll)
      io?.disconnect()
    }
  }, [])

  return (
    <div id="lt5">
      <Nav />
      <main>
        <Hero />
        <Strip />
        <FeatureTabs />
        <Steps />
        <Briefing />
        <Compare />
        <Pricing />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}
