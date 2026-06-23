import type { Metadata } from "next"
import Pricing7 from "./Pricing7"

export const metadata: Metadata = {
  title: "Pricing · Arcova",
  description: "Arcova pricing. One workspace, unlimited users on paid plans. Credit-based, with a full feature comparison.",
  alternates: { canonical: "/pricing-test-7" },
}

export default function Page() {
  return <Pricing7 />
}
