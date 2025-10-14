"use client"

import { useEffect } from "react"

interface ConfettiProps {
  isActive: boolean
}

export const Confetti = ({ isActive }: ConfettiProps) => {
  useEffect(() => {
    if (!isActive) return

    const createConfetti = () => {
      const confettiCount = 150
      const colors = ["#00A4B4", "#006680", "#8CD9C9", "#E8D6A0", "#003344"]

      for (let i = 0; i < confettiCount; i++) {
        const confetti = document.createElement("div")
        confetti.className = "confetti"
        confetti.style.setProperty("--confetti-x", Math.random() * 100 + "vw")
        confetti.style.setProperty("--confetti-y", Math.random() * 100 + "vh")
        confetti.style.setProperty("--confetti-size", Math.random() * 10 + 5 + "px")
        confetti.style.setProperty("--confetti-rotation", Math.random() * 360 + "deg")
        confetti.style.setProperty("--confetti-color", colors[Math.floor(Math.random() * colors.length)])
        confetti.style.setProperty("--confetti-speed", Math.random() * 3 + 2 + "s")

        document.body.appendChild(confetti)

        setTimeout(() => {
          confetti.remove()
        }, 5000)
      }
    }

    createConfetti()
  }, [isActive])

  return null
} 