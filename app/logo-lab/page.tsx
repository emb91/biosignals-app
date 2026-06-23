import type { Metadata } from "next"
import { Poppins, Quicksand, Urbanist, Comfortaa } from "next/font/google"
import LogoLab from "./LogoLab"

const poppins = Poppins({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--font-poppins" })
const quicksand = Quicksand({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-quicksand" })
const urbanist = Urbanist({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-urbanist" })
const comfortaa = Comfortaa({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-comfortaa" })

export const metadata: Metadata = {
  title: "Logo lab · Arcova",
  description: "Arcova curtain mark explorations in the brand palette.",
  alternates: { canonical: "/logo-lab" },
}

export default function Page() {
  return (
    <div className={`${poppins.variable} ${quicksand.variable} ${urbanist.variable} ${comfortaa.variable}`}>
      <LogoLab />
    </div>
  )
}
