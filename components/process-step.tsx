"use client"

import { useRef } from "react"
import { motion, useInView } from "framer-motion"

interface ProcessStepProps {
  number?: string
  title: string
  subtitle: string | React.ReactNode
  description: string
  delay: number
  color: string
  gradient?: string
}

export function ProcessStep({
  title,
  subtitle,
  description,
  delay,
  color,
}: ProcessStepProps) {
  return (
    <motion.div
      className="relative overflow-hidden rounded-2xl bg-white px-4 py-4 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.1)] md:hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.2)] transition-all duration-300 group flex flex-col min-h-[200px]"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.7, delay }}
      animate={{
        opacity: typeof window !== 'undefined' && window.innerWidth < 768 ? 1 : undefined,
        y: typeof window !== 'undefined' && window.innerWidth < 768 ? 0 : undefined
      }}
    >
      <div className="flex flex-col h-full text-center">
        {/* Main content */}
        <div className="flex-1">
          <h3 className="text-xl font-bold text-arcova-darkblue mb-4 whitespace-pre-wrap text-center px-0 md:px-0">{title}</h3>
          <p className="text-gray-600 text-sm leading-relaxed text-center px-4">{description}</p>
        </div>
        
        {/* Footer area with fixed height */}
        <div className="h-[60px] pt-4 text-center">
          {subtitle && (
            <p className="text-sm font-medium text-arcova-teal italic text-center">{subtitle}</p>
          )}
        </div>
      </div>
    </motion.div>
  )
}
