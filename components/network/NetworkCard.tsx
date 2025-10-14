"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronUp, ChevronDown } from "lucide-react"

interface NetworkCardProps {
  title: string
  content: string
  icon: React.ReactNode
  delay: number
  microInsight: string
  bulletPoints: string[]
  isExpandable?: boolean
}

export const NetworkCard = ({
  title,
  content,
  icon,
  delay,
  microInsight,
  bulletPoints,
  isExpandable = false,
}: NetworkCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <motion.div
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#d4f2de]/30 via-transparent to-[#d4f2de]/50 p-4 md:p-6 hover:shadow-lg transition-all duration-300 group flex flex-col"
      style={{ minHeight: isExpandable ? (isExpanded ? '400px' : '300px') : '250px' }}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.7, delay }}
    >
      <div className="absolute top-0 left-0 w-full h-1 bg-arcova-teal/40" />
      <div className="flex-1">
        <div className="text-center">
          <div className="flex items-center justify-center mb-2">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-arcova-teal/10 flex items-center justify-center text-arcova-teal">
              {icon}
            </div>
          </div>
          <h3 className="text-lg md:text-xl font-bold text-arcova-darkblue mb-3">{title}</h3>
          <p className="text-xs md:text-sm font-medium text-arcova-blue italic mb-4">{microInsight}</p>
          <div>
            <ul className="space-y-1.5 md:space-y-2 inline-block text-left">
              {bulletPoints.map((point, index) => (
                <li key={index} className="flex items-start gap-2 text-sm text-gray-600">
                  <div className="w-1.5 h-1.5 rounded-full bg-arcova-teal mt-1.5"></div>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {isExpandable && (
          <div className="relative overflow-hidden" style={{ height: isExpanded ? 'auto' : '0' }}>
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="text-center mt-4 text-sm text-gray-600"
                >
                  {content}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
      <div className="flex justify-center mt-2">
        {isExpandable ? (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-arcova-teal/10 flex items-center justify-center text-arcova-teal transition-transform duration-300 hover:bg-arcova-teal/20"
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        ) : (
          <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-arcova-teal/10 flex items-center justify-center">
            {icon}
          </div>
        )}
      </div>
    </motion.div>
  )
} 