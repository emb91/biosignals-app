"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

// Apollo website visitor tracker (company + US person-level identification).
// Scoped to the public marketing surface only — we deliberately do NOT load it
// inside the authenticated app, so logged-in users and customers are never sent
// to Apollo as "visitors".
const APOLLO_APP_ID = "689866f9353c4d0015f32da8"

// Public, logged-out marketing pages. Anything not listed here (the whole app,
// auth screens, settings, etc.) stays untracked. Match by exact path or prefix.
const MARKETING_PATHS = ["/", "/contact-us", "/privacy", "/terms", "/docs"]

function isMarketingPath(pathname: string): boolean {
  return MARKETING_PATHS.some(
    (p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)),
  )
}

export function ApolloTracker() {
  const pathname = usePathname()

  useEffect(() => {
    if (!pathname || !isMarketingPath(pathname)) return
    // Apollo's loader is idempotent; guard so a client-side nav between
    // marketing pages doesn't inject the tracker script twice.
    if (document.querySelector('script[data-apollo-tracker="true"]')) return

    const nocache = Math.random().toString(36).substring(7)
    const script = document.createElement("script")
    script.src = `https://assets.apollo.io/micro/website-tracker/tracker.iife.js?nocache=${nocache}`
    script.async = true
    script.defer = true
    script.dataset.apolloTracker = "true"
    script.onload = () => {
      ;(window as any).trackingFunctions?.onLoad({ appId: APOLLO_APP_ID })
    }
    document.head.appendChild(script)
  }, [pathname])

  return null
}
