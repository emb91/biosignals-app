import type { Metadata } from "next"
import LogoTest7 from "./LogoTest7"

export const metadata: Metadata = {
  title: "Logo test 7 · Arcova",
  description: "Arcova circle / scope logo explorations.",
  alternates: { canonical: "/logo-test-7" },
}

export default function Page() {
  return <LogoTest7 />
}
