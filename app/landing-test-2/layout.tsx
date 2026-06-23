import type { Metadata } from "next"
import type { ReactNode } from "react"

export const metadata: Metadata = {
  title: "Arcova | Revenue engine for life science",
  openGraph: {
    title: "Arcova | Revenue engine for life science",
    siteName: "Arcova",
    url: "/landing-test-2",
  },
  alternates: { canonical: "/landing-test-2" },
}

export default function LandingTest2Layout({ children }: { children: ReactNode }) {
  return children
}
