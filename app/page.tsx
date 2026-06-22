import type { Metadata } from "next"
import LandingPage from "./landing-test-6/LandingPage"

export const metadata: Metadata = {
  title: "Arcova | Revenue engine for life science",
  description:
    "Arcova maps your life science market, watches it for buying signals, ranks who to reach out to, and drafts the outreach.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Arcova",
    title: "Arcova | Revenue engine for life science",
    description:
      "Revenue intelligence for life science teams, with account signals, fit scoring, and outreach workflow in one place.",
    images: [
      {
        url: "/images/network-og.png",
        width: 1200,
        height: 630,
        alt: "Arcova: GTM intelligence for life science",
      },
    ],
  },
}

export default function HomePage() {
  return <LandingPage />
}
