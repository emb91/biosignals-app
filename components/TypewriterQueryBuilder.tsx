"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"

interface TypewriterQueryBuilderProps {
  onQuerySetChange?: (querySet: number) => void
}

export function CompanyTypewriter() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [currentText, setCurrentText] = useState('')
  
  const companyTypes = [
    "CROs",
    "CDMOs", 
    "Biotechs",
    "Pharma",
    "Life Science Tools Companies",
    "IVD companies",
    "Medtechs",
    "Clinical labs",
    "CSOs",
  ]

  useEffect(() => {
    const currentType = companyTypes[currentIndex]
    let charIndex = 0

    const typeInterval = setInterval(() => {
      if (charIndex <= currentType.length) {
        setCurrentText(currentType.substring(0, charIndex))
        charIndex++
      } else {
        clearInterval(typeInterval)
        setTimeout(() => {
          setCurrentIndex((prev) => (prev + 1) % companyTypes.length)
        }, 1500) // Wait 1.5 seconds before next word
      }
    }, 80) // Faster typing speed

    return () => clearInterval(typeInterval)
  }, [currentIndex])

  return (
    <span className="inline-block min-w-[250px] md:min-w-[300px] text-center">
      {currentText}
      <span className="animate-pulse text-arcova-teal">|</span>
    </span>
  )
}

export function TypewriterQueryBuilder({ onQuerySetChange }: TypewriterQueryBuilderProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [currentQuerySet, setCurrentQuerySet] = useState(0)
  const [typedTexts, setTypedTexts] = useState<string[]>(['', '', '', ''])
  
  const querySets = [
    [
      { text: "have raised Series A in the last 6 months", color: "blue" },
      { text: "are focussed on CAR-T cell therapies", color: "green" },
      { text: "with at least 20 employees", color: "purple" },
      { text: "located in New York", color: "orange" }
    ],
    [
      { text: "started Phase I recruitment last month", color: "green" },
      { text: "raised Series B in the last 6 months", color: "blue" },
      { text: "over 50 employees", color: "purple" },
      { text: "located in United States", color: "orange" }
    ]
  ]
  
  const querySteps = querySets[currentQuerySet]

  // Animation effect - commented out for static view
  /*useEffect(() => {
    if (currentStep >= querySteps.length) {
      // Wait 8 seconds (2.5s for search animation + 5.5s pause after results) then switch to next query set
      const switchTimer = setTimeout(() => {
        const newQuerySet = (currentQuerySet + 1) % querySets.length
        setCurrentQuerySet(newQuerySet)
        onQuerySetChange?.(newQuerySet)
        setCurrentStep(0)
        setTypedTexts(['', '', '', ''])
      }, 8000)
      return () => clearTimeout(switchTimer)
    }

    const currentQuery = querySteps[currentStep]
    const targetText = currentQuery.text
    let currentIndex = 0

    const typeInterval = setInterval(() => {
      if (currentIndex <= targetText.length) {
        setTypedTexts(prev => {
          const newTexts = [...prev]
          newTexts[currentStep] = targetText.substring(0, currentIndex)
          return newTexts
        })
        currentIndex++
      } else {
        clearInterval(typeInterval)
        setTimeout(() => {
          setCurrentStep(prev => prev + 1)
        }, 200)
      }
    }, 30)

    return () => clearInterval(typeInterval)
  }, [currentStep, currentQuerySet, querySteps.length, querySets.length])*/
  
  // Set static content for Series B view
  useEffect(() => {
    const seriesBQueries = querySets[1]
    setTypedTexts(seriesBQueries.map(q => q.text))
    setCurrentQuerySet(1) // Set to Series B
    onQuerySetChange?.(1) // Update parent component
  }, [])

  const getColorClasses = (color: string) => {
    const colorMap = {
      blue: {
        text: "text-blue-600",
        bg: "hover:bg-blue-50",
        border: "border-blue-400"
      },
      green: {
        text: "text-emerald-500",
        bg: "hover:bg-green-50",
        border: "border-green-400"
      },
      purple: {
        text: "text-purple-500",
        bg: "hover:bg-purple-50",
        border: "border-purple-400"
      },
      orange: {
        text: "text-orange-500",
        bg: "hover:bg-orange-50",
        border: "border-orange-400"
      }
    }
    return colorMap[color as keyof typeof colorMap] || colorMap.blue
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="space-y-1 min-h-[12rem]"
    >
      {querySteps.map((step, index) => {
        const colors = getColorClasses(step.color)
        const isActive = index <= currentStep
        const isTyping = index === currentStep
        
        return (
          <motion.div
            key={index}
            className="flex items-center gap-2 text-base relative min-h-[1.9rem] !opacity-100"
          >
            <div className="relative group">
              <div className={`${colors.text} font-medium transition-all w-[376px] min-h-[1.5rem] flex items-center cursor-text relative !opacity-100`}>
                <span className="relative !opacity-100">
                  <span className={index === 3 ? 'opacity-100' : ''}>
                    {typedTexts[index]}
                  </span>
                  {index === 3 && (
                    <span className="animate-pulse ml-0.5">|</span>
                  )}
                  <motion.span
                    className={`absolute bottom-0 left-0 h-0.5 border-b-2 border-opacity-40 ${
                      step.color === 'green' ? 'border-emerald-600' :
                      step.color === 'blue' ? 'border-blue-600' :
                      step.color === 'purple' ? 'border-purple-600' :
                      'border-orange-600'
                    }`}
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 0.1 }}
                  />
                </span>
              </div>

            </div>
          </motion.div>
        )
      })}
    </motion.div>
  )
}
