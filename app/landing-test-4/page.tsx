/**
 * LEGACY / FROZEN — do NOT use this as a reference or starting point for new
 * landing pages. Variant 4 mirrors the old Landing Page.html section structure
 * we are deliberately moving away from. Build new landing pages fresh from the
 * brand guidelines + Mobbin (see the landing-test-5 direction); reuse brand
 * tokens only, never this section layout.
 */
import type { Metadata } from "next"
import LandingPage from "./LandingPage"

export const metadata: Metadata = {
  title: "Arcova | Revenue engine for life science",
  description:
    "Arcova is a revenue engine for life science teams. It tracks account signals, ranks fit and timing, and supports outreach from one workspace.",
  alternates: { canonical: "/landing-test-4" },
  openGraph: {
    type: "website",
    url: "/landing-test-4",
    siteName: "Arcova",
    title: "Arcova | Revenue engine for life science",
    description:
      "Revenue intelligence for life science teams, with account signals, fit scoring, and outreach workflow in one place.",
    images: [{ url: "/images/network-og.png", width: 1200, height: 630, alt: "Arcova — GTM intelligence for life science" }],
  },
}

export default function Page() {
  return <LandingPage />
}
