"use client"

import type React from "react"
import { usePathname } from "next/navigation"
import { Navigation } from "@/components/navigation"
import { ScrollToTop } from "@/components/scroll-to-top"
import { SiteFooter } from "@/components/site-footer"

// Routes that are part of the authenticated app (no header/footer)
const APP_ROUTES = ['/dashboard', '/companies', '/my-profile', '/results', '/signals', '/upload', '/contacts']

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  
  // Check if current path is an app route (authenticated area)
  const isAppRoute = APP_ROUTES.some(route => pathname?.startsWith(route))

  // For app routes, render children directly without header/footer
  if (isAppRoute) {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />
      <main className="flex-grow">{children}</main>
      <SiteFooter />
      <ScrollToTop />
    </div>
  )
}
