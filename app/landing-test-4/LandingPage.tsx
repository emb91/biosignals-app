"use client"

import { useEffect } from "react"
import "./landing.css"
import { Nav } from "./sections/Nav"
import { Hero } from "./sections/Hero"
import { Credibility } from "./sections/Credibility"
import { Moments } from "./sections/Moments"
import { HowItWorks } from "./sections/HowItWorks"
import { Briefing } from "./sections/Briefing"
import { CrmSync } from "./sections/CrmSync"
import { Differentiation } from "./sections/Differentiation"
import { Pricing } from "./sections/Pricing"
import { FinalCta } from "./sections/FinalCta"
import { Footer } from "./sections/Footer"

export default function LandingPage() {
  useEffect(() => {
    const root = document.getElementById("lt4")
    const nav = document.getElementById("lt4-nav")
    if (!root) return

    // Nav: transparent → glass on scroll
    const onScroll = () => nav?.classList.toggle("scrolled", window.scrollY > 20)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })

    // Reveal-on-scroll for [.reveal] elements
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
        { threshold: 0.16 }
      )
      root.querySelectorAll(".reveal").forEach((el) => io!.observe(el))
    }

    return () => {
      window.removeEventListener("scroll", onScroll)
      io?.disconnect()
    }
  }, [])

  return (
    <div id="lt4">
      <Nav />
      <main>
        <Hero />
        <Credibility />
        <Moments />
        <HowItWorks />
        <Briefing />
        <CrmSync />
        <Differentiation />
        <Pricing />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}
