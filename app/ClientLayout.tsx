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
  
  // Only show navigation on landing page
  const isAppPage = pathname.startsWith('/dashboard') || 
                    pathname.startsWith('/about') || 
                    pathname.startsWith('/icp') || 
                    pathname.startsWith('/upload') || 
                    pathname.startsWith('/results') || 
                    pathname.startsWith('/settings')

  return (
    <div className="min-h-screen flex flex-col">
      {!isAppPage && <Navigation />}
      <main className="flex-grow">{children}</main>
      {!isAppPage && <SiteFooter />}
      <ScrollToTop />
    </div>
  )
}
