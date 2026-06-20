import type { Metadata } from "next"
import LandingPage from "./landing-test-6/LandingPage"

export const metadata: Metadata = {
  title: "Know who to call, and exactly when | Arcova",
  description:
    "Arcova maps your life science market, watches it for buying signals, ranks who to reach out to, and drafts the outreach.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Arcova",
    title: "Know who to call, and exactly when | Arcova",
    description:
      "Your whole life science market, watched and ranked—with the outreach already drafted.",
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
