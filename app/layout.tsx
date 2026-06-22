import type React from "react"
import { Inter, JetBrains_Mono, Manrope, Plus_Jakarta_Sans, Poppins } from "next/font/google"
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

export const metadata = {
  metadataBase: new URL('https://arcova.bio'),
  title: "Arcova",
  description: "Revenue intelligence for life science teams.",
  icons: {
    icon: [
      { url: "/arcova-favicon.png", sizes: "200x200", type: "image/png" }
    ],
    shortcut: [
      { url: "/arcova-favicon.png", sizes: "200x200", type: "image/png" }
    ],
    apple: [
      { url: "/arcova-favicon.png", sizes: "200x200", type: "image/png" }
    ],
    other: [
      { url: "/arcova-favicon.png", sizes: "200x200", type: "image/png" }
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
    <html lang="en" className={`${poppins.variable} ${inter.variable} ${manrope.variable} ${plusJakarta.variable} ${jetbrainsMono.variable}`}>
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
              logo: "https://arcova.bio/arcova-logo.png",
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
