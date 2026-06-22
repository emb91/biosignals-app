import type { Metadata } from "next"
import LandingPage from "./LandingPage"

export const metadata: Metadata = {
  title: "Arcova | Revenue engine for life science",
  description:
    "Arcova is a revenue engine for life science teams. It tracks account signals, ranks fit and timing, and supports outreach from one workspace.",
  alternates: { canonical: "/landing-test-5" },
  openGraph: {
    type: "website",
    url: "/landing-test-5",
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
