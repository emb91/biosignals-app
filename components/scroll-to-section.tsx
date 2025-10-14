"use client"

import { useEffect } from "react"

export function useScrollToSection() {
  useEffect(() => {
    // Add smooth scrolling behavior to all anchor links
    const handleAnchorClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const anchor = target.closest('a[href^="#"]')

      if (anchor) {
        e.preventDefault()
        const targetId = anchor.getAttribute("href")?.substring(1)

        if (targetId) {
          const targetElement = document.getElementById(targetId)
          if (targetElement) {
            const headerOffset = 80
            const elementPosition = targetElement.getBoundingClientRect().top
            const offsetPosition = elementPosition + window.pageYOffset - headerOffset

            window.scrollTo({
              top: offsetPosition,
              behavior: "smooth",
            })
          }
        }
      }
    }

    document.addEventListener("click", handleAnchorClick)

    return () => {
      document.removeEventListener("click", handleAnchorClick)
    }
  }, [])

  return null
}
