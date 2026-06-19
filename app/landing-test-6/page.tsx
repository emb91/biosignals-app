import type { Metadata } from "next"
import LandingPage from "./LandingPage"

export const metadata: Metadata = {
  title: "Arcova · Your whole market, watched and ranked",
  description:
    "Arcova maps your life science market, watches it for buying signals — funding, new hires, clinical milestones — and hands your team a prioritized board every morning, with the outreach already drafted.",
  alternates: { canonical: "/landing-test-6" },
  openGraph: {
    type: "website",
    url: "/landing-test-6",
    siteName: "Arcova",
    title: "Arcova · Your whole market, watched and ranked",
    description:
      "Maps your market, watches it for buying signals, and hands your team a prioritized board every morning — outreach drafted.",
    images: [{ url: "/images/network-og.png", width: 1200, height: 630, alt: "Arcova — GTM intelligence for life science" }],
  },
}

export default function Page() {
  return <LandingPage />
}
