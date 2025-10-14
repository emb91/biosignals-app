"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronUp, ChevronDown } from "lucide-react"

interface HorizontalFeatureCardProps {
  title: string
  content: string
  icon: React.ReactNode
  delay: number
  microInsight: string
  bulletPoints: string[]
}

export const HorizontalFeatureCard = ({
  title,
  content,
  icon,
  delay,
  microInsight,
  bulletPoints,
}: HorizontalFeatureCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <motion.div
      className="relative overflow-hidden rounded-2xl bg-white p-6 md:p-8 shadow-lg ring-1 ring-gray-900/5 transition-all duration-300 group h-full hover:shadow-xl"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.7, delay }}
    >
      {/* Header with icon and title */}
      <div className="flex items-start gap-4 mb-8">
        <div className="text-arcova-teal">
          {icon}
        </div>
        <div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
          <p className="text-sm text-arcova-teal">{microInsight}</p>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1">
        {/* Desktop view - always visible */}
        <div className="hidden md:block space-y-6">
          <ul className="grid grid-cols-2 gap-4">
            {bulletPoints.map((point, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-gray-600">
                <div className="w-1.5 h-1.5 rounded-full bg-arcova-teal mt-1.5"></div>
                <span>{point}</span>
              </li>
            ))}
          </ul>
          <div className="text-sm text-gray-600 border-t border-gray-100 pt-4 mt-6">
            {content}
          </div>
        </div>

        {/* Mobile view - expandable */}
        <div className="md:hidden">
          <ul className="space-y-2 mb-3">
            {bulletPoints.map((point, index) => (
              <li key={index} className="flex items-start gap-2 text-sm text-gray-600">
                <div className="w-1.5 h-1.5 rounded-full bg-arcova-teal mt-1.5"></div>
                <span>{point}</span>
              </li>
            ))}
          </ul>
          <div className="relative overflow-hidden" style={{ height: isExpanded ? 'auto' : '0' }}>
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="mt-3 text-sm text-gray-600 border-t border-gray-100 pt-4"
                >
                  {content}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-7 h-7 rounded-full bg-gray-50 flex items-center justify-center text-gray-600 transition-transform duration-300 hover:bg-gray-100 mx-auto mt-4"
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </motion.div>
  )
} 