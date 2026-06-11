"use client"

import type React from "react"
import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { AppAmbientBackground } from "@/components/AppAmbientBackground"
import { Navigation } from "@/components/navigation"
import { ScrollToTop } from "@/components/scroll-to-top"
import { SiteFooter } from "@/components/site-footer"
import { useAuth } from "@/context/AuthContext"
import { useSetupState, getNextSetupPath } from "@/lib/use-setup-state"
import { Toaster } from "sonner"
import { ROUTES } from "@/lib/routes"
import { useViewportHeight } from "@/lib/use-viewport-height"

// Routes that are part of the authenticated app (no header/footer)
const APP_ROUTES = [
  ROUTES.accounts,
  ROUTES.contacts,
  ROUTES.leads.accounts,
  ROUTES.leads.contacts,
  ROUTES.data,
  ROUTES.coverage,
  ROUTES.today,
  ROUTES.gtmBase,
  ROUTES.import,
  ROUTES.signals,
  ROUTES.outreach,
  ROUTES.log,
  ROUTES.settings,
  ROUTES.setup.company,
  ROUTES.setup.profile,
  ROUTES.setup.icps,
  '/admin',
  '/arcova-setup',
  '/find-more-leads',
]

// Routes that are part of the setup flow — the guard does NOT redirect away from these.
// Settings is allowed so users can manage account preferences without leaving onboarding.
// Include `/icps` (not just `/icps/new`): the ICP list is setup-shaped; omitting it made `/icps`
// a "generic app" route so SetupGuard could bounce Signals → `/arcova-setup` → Today during
// brief stale setup reads or Supabase retries.
const SETUP_ROUTES = ['/arcova-setup', ROUTES.setup.company, ROUTES.setup.profile, ROUTES.setup.icps, ROUTES.setup.newIcp, '/contacts/new', ROUTES.settings]

function matchesRoutePrefix(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function SetupGuard({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const { loading: setupLoading, setupComplete, step1Complete, step2Complete } = useSetupState()
  const pathname = usePathname() ?? ''
  const router = useRouter()

  const isAppRoute = APP_ROUTES.some((route) => matchesRoutePrefix(pathname, route))
  const isSetupRoute = SETUP_ROUTES.some((route) => matchesRoutePrefix(pathname, route))
  const isNonSetupAppRoute = isAppRoute && !isSetupRoute

  // Compute the next step path from primitive values (avoids object-ref churn)
  const nextSetupPath: string | null = setupComplete
    ? null
    : getNextSetupPath({ step1Complete, step2Complete })

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
    return <div className="min-h-dvh bg-transparent" />
  }

  // Redirect is about to fire (effect hasn't run yet this tick) — keep the blank.
  const redirectImminent =
    !!user && isNonSetupAppRoute && !setupComplete && !!nextSetupPath && !matchesRoutePrefix(pathname, nextSetupPath)
  if (redirectImminent) {
    return <div className="min-h-dvh bg-transparent" />
  }

  return <>{children}</>
}

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const appViewportH = useViewportHeight()

  // Check if current path is an app route (authenticated area)
  const isAppRoute = APP_ROUTES.some((route) => pathname ? matchesRoutePrefix(pathname, route) : false)

  // For app routes, render children directly without header/footer
  if (isAppRoute) {
    return (
      <>
        <AppAmbientBackground />
        <Toaster position="top-center" richColors />
        <div
          className="arcova-app-root font-jakarta"
          style={
            appViewportH
              ? ({ '--arcova-viewport-height': `${appViewportH}px` } as React.CSSProperties)
              : undefined
          }
        >
          <SetupGuard>{children}</SetupGuard>
        </div>
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
