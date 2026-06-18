import type { Metadata } from "next"
import LandingPage from "./LandingPage"

export const metadata: Metadata = {
  title: "Arcova · The AI-native revenue engine for life science",
  description:
    "Arcova watches your life science market for buying signals — funding, new hires, clinical milestones — ranks who's ready, and drafts the outreach. Know who to call, and exactly when.",
  alternates: { canonical: "/landing-test-5" },
  openGraph: {
    type: "website",
    url: "/landing-test-5",
    siteName: "Arcova",
    title: "Arcova · The AI-native revenue engine for life science",
    description:
      "Watches your market for buying signals, ranks who's ready, and drafts the outreach. Know who to call, and exactly when.",
    images: [{ url: "/images/network-og.png", width: 1200, height: 630, alt: "Arcova — GTM intelligence for life science" }],
  },
}

export default function Page() {
  return <LandingPage />
}
