import type { Metadata } from "next"
import LandingPage from "./LandingPage"

export const metadata: Metadata = {
  title: "Arcova | Revenue engine for life science",
  description:
    "Arcova maps your life science market, watches it for buying signals like funding, new hires and clinical milestones, and hands your team a prioritized board every morning, with the outreach already drafted.",
  alternates: { canonical: "/" },
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Arcova",
    title: "Arcova | Revenue engine for life science",
    description:
      "Maps your market, watches it for buying signals, and hands your team a prioritized board every morning, with the outreach drafted.",
    images: [{ url: "/images/network-og.png", width: 1200, height: 630, alt: "Arcova: GTM intelligence for life science" }],
  },
}

export default function Page() {
  return <LandingPage />
}
