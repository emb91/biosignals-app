"use client"

import { useEffect } from "react"
import "./landing.css"
import { Nav } from "./sections/Nav"
import { Hero } from "./sections/Hero"
import { Impact } from "./sections/Impact"
import { Bento } from "./sections/Bento"
import { Flow } from "./sections/Flow"
import { Statement } from "./sections/Statement"
import { Pricing } from "./sections/Pricing"
import { FinalCta } from "./sections/FinalCta"
import { Footer } from "./sections/Footer"

export default function LandingPage() {
  useEffect(() => {
    const root = document.getElementById("lt6")
    const nav = document.getElementById("lt6-nav")
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
    <div id="lt6">
      <Nav />
      <main>
        <Hero />
        <Impact />
        <Bento />
        <Flow />
        <Statement />
        <Pricing />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}
