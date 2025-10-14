"use client"

import type React from "react"
import { useRef } from "react"
import { motion, useInView } from "framer-motion"

interface AnimatedSectionProps {
  children: React.ReactNode
  className?: string
  delay?: number
  id?: string
}

export function AnimatedSection({ children, className, delay = 0, id }: AnimatedSectionProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: "-100px 0px" })
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768

  return (
    <motion.section
      id={id}
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: isMobile ? 0 : 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: isMobile ? 0 : 30 }}
      transition={{
        duration: 0.8,
        ease: [0.22, 1, 0.36, 1],
        delay: delay,
      }}
    >
      {children}
    </motion.section>
  )
}
