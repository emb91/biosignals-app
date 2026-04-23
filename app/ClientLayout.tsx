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
const APP_ROUTES = ['/dashboard', '/companies', '/contact', '/contacts', '/find-more-leads', '/import', '/arcova-setup', '/my-profile', '/personas', '/results', '/signals', '/upload']

// Routes that are part of the setup flow — the guard does NOT redirect away from these
const SETUP_ROUTES = ['/arcova-setup']

// App routes that are NOT setup pages — the guard redirects to setup from here if needed
const NON_SETUP_APP_ROUTES = APP_ROUTES.filter(
  (r) => !SETUP_ROUTES.some((s) => r.startsWith(s))
)

function SetupGuard({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const { loading: setupLoading, setupComplete, step1Complete, step2Complete, step3Complete } = useSetupState()
  const pathname = usePathname() ?? ''
  const router = useRouter()

  const isNonSetupAppRoute = NON_SETUP_APP_ROUTES.some((r) => pathname.startsWith(r))

  // Compute the next step path from primitive values (avoids object-ref churn)
  const nextSetupPath: string | null = setupComplete ? null : '/arcova-setup'

  useEffect(() => {
    // Wait for both auth and setup state to resolve
    if (authLoading || setupLoading) return
    // Only apply the guard when the user is logged in and on a non-setup app route
    if (!user || !isNonSetupAppRoute) return
    // If setup is already complete, no redirect needed
    if (setupComplete) return
    // If we're already on the right step, don't redirect
    if (!nextSetupPath || pathname === nextSetupPath) return

    router.replace(nextSetupPath)
  }, [authLoading, setupLoading, setupComplete, nextSetupPath, user, isNonSetupAppRoute, pathname, router])

  // Still waiting for auth or setup state — render nothing to avoid a flash of the
  // wrong page before the redirect fires.
  if (authLoading || setupLoading) {
    return <div className="min-h-screen bg-gray-50" />
  }

  // Redirect is about to fire (effect hasn't run yet this tick) — keep the blank.
  const redirectImminent =
    !!user && isNonSetupAppRoute && !setupComplete && !!nextSetupPath && pathname !== nextSetupPath
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
  const isAppRoute = APP_ROUTES.some(route => pathname?.startsWith(route))

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
