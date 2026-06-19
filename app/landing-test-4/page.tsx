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
  title: "Arcova · Know who to call, and exactly when",
  description:
    "Arcova is the AI-native revenue engine for life science. It watches your market for buying signals — funding, new hires, clinical milestones — ranks who's ready, and drafts the outreach. You just hit send.",
  alternates: { canonical: "/landing-test-4" },
  openGraph: {
    type: "website",
    url: "/landing-test-4",
    siteName: "Arcova",
    title: "Arcova · Know who to call, and exactly when",
    description:
      "The AI-native revenue engine for life science. Watches your market for buying signals, ranks who's ready, and drafts the outreach.",
    images: [{ url: "/images/network-og.png", width: 1200, height: 630, alt: "Arcova — GTM intelligence for life science" }],
  },
}

export default function Page() {
  return <LandingPage />
}
