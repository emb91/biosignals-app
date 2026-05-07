"use client"

import type React from "react"
import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Navigation } from "@/components/navigation"
import { ScrollToTop } from "@/components/scroll-to-top"
import { SiteFooter } from "@/components/site-footer"
import { useAuth } from "@/context/AuthContext"
import { useSetupState, getNextSetupPath } from "@/lib/use-setup-state"
import { Toaster } from "sonner"

// Routes that are part of the authenticated app (no header/footer)
const APP_ROUTES = ['/accounts', '/arcova-setup', '/company-criteria', '/contacts', '/dashboard', '/find-more-leads', '/health', '/import', '/my-profile', '/personas', '/pipeline', '/results', '/signals', '/upload']

// Routes that are part of the setup flow — the guard does NOT redirect away from these
const SETUP_ROUTES = ['/arcova-setup', '/my-profile', '/company-criteria/new', '/contacts/new', '/personas/new']

function matchesRoutePrefix(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function SetupGuard({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const { loading: setupLoading, setupComplete, step1Complete, step2Complete, step3Complete } = useSetupState()
  const pathname = usePathname() ?? ''
  const router = useRouter()

  const isAppRoute = APP_ROUTES.some((route) => matchesRoutePrefix(pathname, route))
  const isSetupRoute = SETUP_ROUTES.some((route) => matchesRoutePrefix(pathname, route))
  const isNonSetupAppRoute = isAppRoute && !isSetupRoute

  // Compute the next step path from primitive values (avoids object-ref churn)
  const nextSetupPath: string | null = setupComplete
    ? null
    : getNextSetupPath({ step1Complete, step2Complete, step3Complete, setupComplete })

  useEffect(() => {
    // Wait for both auth and setup state to resolve
    if (authLoading || setupLoading) return
    // Only apply the guard when the user is logged in and on a non-setup app route
    if (!user || !isNonSetupAppRoute) return
    // If setup is already complete, no redirect needed
    if (setupComplete) return
    // If we're already on the right step, don't redirect
    if (!nextSetupPath || matchesRoutePrefix(pathname, nextSetupPath)) return

    router.replace(nextSetupPath)
  }, [authLoading, setupLoading, setupComplete, nextSetupPath, user, isNonSetupAppRoute, pathname, router])

  // Still waiting for auth or setup state — render nothing to avoid a flash of the
  // wrong page before the redirect fires.
  if (authLoading || setupLoading) {
    return <div className="min-h-screen bg-gray-50" />
  }

  // Redirect is about to fire (effect hasn't run yet this tick) — keep the blank.
  const redirectImminent =
    !!user && isNonSetupAppRoute && !setupComplete && !!nextSetupPath && !matchesRoutePrefix(pathname, nextSetupPath)
  if (redirectImminent) {
    return <div className="min-h-screen bg-gray-50" />
  }

  return <>{children}</>
}

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  // Check if current path is an app route (authenticated area)
  const isAppRoute = APP_ROUTES.some((route) => pathname ? matchesRoutePrefix(pathname, route) : false)

  // For app routes, render children directly without header/footer
  if (isAppRoute) {
    return (
      <>
        <Toaster position="top-center" richColors />
        <SetupGuard>{children}</SetupGuard>
      </>
    )
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
