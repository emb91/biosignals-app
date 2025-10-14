"use client"

import * as React from "react"
import { useEffect, useState, useRef } from "react"
import { testimonials, type Testimonial, serviceTypes } from "../data/reviews"
import { motion, AnimatePresence } from "framer-motion"

const DISPLAY_TIME = 7000
const FADE_DURATION = 0.5
const RIPPLE_STAGGER = 0.12

function getVisibleTestimonials(start: number, count: number) {
  const result: Testimonial[] = []
  const seen = new Set()
  let idx = start
  for (let i = 0; i < count; i++) {
    while (seen.has(idx)) idx = (idx + 1) % testimonials.length
    result.push(testimonials[idx])
    seen.add(idx)
    idx = (idx + 1) % testimonials.length
  }
  return result
}

function ServiceTypePill({ type }: { type: keyof typeof serviceTypes }) {
  const serviceType = serviceTypes[type]
  const Icon = serviceType.icon
  
  // Darker variants of each color
  const darkColorMap = {
    strategy: "#d13d74", // darker pink
    content: "#cc7845", // even darker orange
    diligence: "#6c5e9e", // darker purple
    academic: "#007a87", // darker teal
    report: "#184c60" // darker blue
  }

  return (
    <span 
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium" 
      style={{ 
        backgroundColor: `${serviceType.lightColor}cc`,
      }}
    >
      <Icon className="w-3 h-3" style={{ color: darkColorMap[type] }} />
      <span style={{ color: darkColorMap[type] }}>{serviceType.name}</span>
    </span>
  )
}

type Phase = "visible" | "transitioning" | "incoming"

export function TestimonialCarousel() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isMobile, setIsMobile] = useState(false)
  const [batch, setBatch] = useState<Testimonial[]>(() => getVisibleTestimonials(0, 6))
  const [phase, setPhase] = useState<Phase>("visible")
  const [prevBatch, setPrevBatch] = useState<Testimonial[] | null>(null)
  const [isPaused, setIsPaused] = useState(false)

  // For clean timeouts
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const watchdogRef = useRef<NodeJS.Timeout | null>(null)

  // Responsive: Check viewport size on mount and window resize
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640)
    checkMobile()
    window.addEventListener("resize", checkMobile)
    return () => window.removeEventListener("resize", checkMobile)
  }, [])

  // Main phase and animation logic
  useEffect(() => {
    const cleanup = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }

    if (isPaused) {
      cleanup()
      return
    }

    if (phase === "visible") {
      timerRef.current = setTimeout(() => {
        setPrevBatch(batch)
        setPhase("transitioning")
      }, DISPLAY_TIME)
    }

    if (phase === "transitioning") {
      const cardCount = isMobile ? 3 : 6
      const increment = isMobile ? 3 : 6
      timerRef.current = setTimeout(() => {
        const nextBatch = getVisibleTestimonials((currentIndex + increment) % testimonials.length, cardCount)
        setBatch(nextBatch)
        setCurrentIndex((ci) => (ci + increment) % testimonials.length)
        setPhase("incoming")
      }, (FADE_DURATION + RIPPLE_STAGGER * (cardCount - 1)) * 1000)
    }

    if (phase === "incoming") {
      timerRef.current = setTimeout(() => setPhase("visible"), 30)
    }

    return cleanup
  }, [phase, batch, currentIndex, isMobile, isPaused])

  // WATCHDOG: Reset to visible if stuck in incoming phase for >1s
  useEffect(() => {
    const cleanup = () => {
      if (watchdogRef.current) clearTimeout(watchdogRef.current)
    }

    if (phase === "incoming") {
      watchdogRef.current = setTimeout(() => setPhase("visible"), 1000)
    } else {
      cleanup()
    }

    return cleanup
  }, [phase])

  // Animation variants
  const getCardVariants = (i: number) => ({
    initial: { opacity: 0, y: 40 },
    animate: {
      opacity: 1,
      y: 0,
      transition: {
        opacity: { duration: FADE_DURATION, delay: i * RIPPLE_STAGGER },
        y: { duration: FADE_DURATION, delay: i * RIPPLE_STAGGER }
      }
    },
    exit: {
      opacity: 0,
      y: -40,
      transition: {
        opacity: { duration: FADE_DURATION, delay: i * RIPPLE_STAGGER },
        y: { duration: FADE_DURATION, delay: i * RIPPLE_STAGGER }
      }
    }
  })

  // Defensive: always try to render the correct batch
  let toRender: Testimonial[] = []
  const cardCount = isMobile ? 3 : 6
  if (phase === "visible") toRender = batch
  else if (phase === "transitioning") toRender = prevBatch && prevBatch.length ? prevBatch : batch
  // phase "incoming": render nothing for a tick

  return (
    <div
      className="mx-auto max-w-7xl px-6 lg:px-8 min-h-[600px] lg:min-h-[625px]"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="columns-1 gap-8 sm:columns-2 lg:columns-3">
        <AnimatePresence mode="wait">
          {phase !== "incoming" && toRender.slice(0, cardCount).map((testimonial, i) => (
            <motion.figure
              key={testimonial.quote + phase + i}
              variants={getCardVariants(i)}
              initial="initial"
              animate="animate"
              exit="exit"
              className="break-inside-avoid rounded-2xl bg-white p-6 shadow-lg ring-1 ring-gray-900/5 mb-8 last:mb-0"
            >
              <blockquote className="text-gray-900">
                {Array.isArray(testimonial.quote) ? (
                  testimonial.quote.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))
                ) : (
                  <p>"{testimonial.quote}"</p>
                )}
              </blockquote>
              <figcaption className="mt-6 flex flex-col gap-y-4">
                <div className="flex items-center gap-x-4">
                  <div>
                    {testimonial.author.title && (
                      <div className="text-gray-600 font-bold">{testimonial.author.title}</div>
                    )}
                    {testimonial.author.company && (
                      <div className="text-gray-500 text-sm">{testimonial.author.company}</div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ServiceTypePill type={testimonial.serviceType} />
                </div>
              </figcaption>
            </motion.figure>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
