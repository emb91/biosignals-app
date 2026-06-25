import type React from "react"
import { Inter, JetBrains_Mono, Manrope, Plus_Jakarta_Sans, Poppins, Quicksand } from "next/font/google"
import ClientLayout from "./ClientLayout"
import { AuthProvider } from "@/context/AuthContext"
import { EnrichmentGuardProvider } from "@/context/EnrichmentGuardContext"
import { CreditConfirmProvider } from "@/context/CreditConfirmContext"
import { SetupStateProvider } from "@/lib/use-setup-state"
import { PostHogProvider, PostHogIdentify } from "./posthog-provider"
import { ApolloTracker } from "./apollo-tracker"
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
        <ApolloTracker />
        <PostHogProvider>
          <AuthProvider>
            <PostHogIdentify />
            <SetupStateProvider>
              <EnrichmentGuardProvider>
                <CreditConfirmProvider>
                  <ClientLayout>{children}</ClientLayout>
                </CreditConfirmProvider>
              </EnrichmentGuardProvider>
            </SetupStateProvider>
            {process.env.NODE_ENV !== "production" && (
              // clickfix dev toolbar — loaded from the local `npx clickfix` sidecar (:7331).
              // eslint-disable-next-line @next/next/no-sync-scripts
              <script src="http://localhost:7331/toolbar.js" async />
            )}
          </AuthProvider>
        </PostHogProvider>
        {/* <Analytics /> */}
      </body>
    </html>
  )
}
