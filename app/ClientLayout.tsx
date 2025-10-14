"use client"

import type React from "react"
import { usePathname } from "next/navigation"
import { Navigation } from "@/components/navigation"
import { ScrollToTop } from "@/components/scroll-to-top"
import { SiteFooter } from "@/components/site-footer"

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />
      <main className="flex-grow">{children}</main>
      <SiteFooter />
      <ScrollToTop />
    </div>
  )
}
