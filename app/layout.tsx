import type React from "react"
import { Inter, JetBrains_Mono, Manrope, Plus_Jakarta_Sans, Poppins, Quicksand } from "next/font/google"
import ClientLayout from "./ClientLayout"
import { AuthProvider } from "@/context/AuthContext"
import { EnrichmentGuardProvider } from "@/context/EnrichmentGuardContext"
import { SetupStateProvider } from "@/lib/use-setup-state"
import { PostHogProvider, PostHogIdentify } from "./posthog-provider"
import './globals.css'
// import { Analytics } from "@vercel/analytics/next"

// Load Poppins font with specific weights
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
})

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
})

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-manrope",
})

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plus-jakarta",
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains-mono",
})

// Quicksand carries the Arcova wordmark (see components/brand/ArcovaLogo)
const quicksand = Quicksand({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-quicksand",
})

export const metadata = {
  metadataBase: new URL('https://arcova.bio'),
  title: "Arcova",
  description: "Revenue intelligence for life science teams.",
  icons: {
    icon: [
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" }
    ],
    shortcut: [
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" }
    ],
    // Apple home-screen icon keeps the navy squircle (iOS fills transparency with black)
    apple: [
      { url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" }
    ]
  },
  openGraph: {
    type: 'website',
    url: 'https://arcova.bio',
    title: "Arcova",
    description: "Revenue intelligence for life science teams.",
    siteName: 'Arcova',
    images: [
      {
        url: "/images/network-og.png",
        width: 1200,
        height: 630,
        alt: 'Arcova | AI-Powered Revenue Growth for Life Sciences'
      }
    ]
  },
  alternates: {
    canonical: '/',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${poppins.variable} ${inter.variable} ${manrope.variable} ${plusJakarta.variable} ${jetbrainsMono.variable} ${quicksand.variable}`}>
      <head>
        {/* Google tag (gtag.js) */}
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-0WTVF1D48X"></script>
        <script dangerouslySetInnerHTML={{ __html: `
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-0WTVF1D48X');
        ` }} />

        {/* Apollo website tracker (company + person-level visitor identification) */}
        <script dangerouslySetInnerHTML={{ __html: `
          function initApollo(){var n=Math.random().toString(36).substring(7),o=document.createElement("script");
          o.src="https://assets.apollo.io/micro/website-tracker/tracker.iife.js?nocache="+n,o.async=!0,o.defer=!0,
          o.onload=function(){window.trackingFunctions.onLoad({appId:"689866f9353c4d0015f32da8"})},
          document.head.appendChild(o)}initApollo();
        ` }} />

        {/* Organization Schema Markup */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Arcova",
              url: "https://arcova.bio",
              logo: "https://arcova.bio/brand/icon-512.png",
              description: "Revenue intelligence for life science teams.",
            }),
          }}
        />
      </head>
      <body className="font-jakarta antialiased">
        <PostHogProvider>
          <AuthProvider>
            <PostHogIdentify />
            <SetupStateProvider>
              <EnrichmentGuardProvider>
                <ClientLayout>{children}</ClientLayout>
              </EnrichmentGuardProvider>
            </SetupStateProvider>
          </AuthProvider>
        </PostHogProvider>
        {/* <Analytics /> */}
      </body>
    </html>
  )
}
