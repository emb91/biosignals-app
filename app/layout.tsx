import type React from "react"
import { Poppins } from "next/font/google"
import ClientLayout from "./ClientLayout"
import { AuthProvider } from "@/context/AuthContext"
import { EnrichmentGuardProvider } from "@/context/EnrichmentGuardContext"
import './globals.css'
// import { Analytics } from "@vercel/analytics/next"

// Load Poppins font with specific weights
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
})

export const metadata = {
  metadataBase: new URL('https://arcova.app'),
  title: "AI-Powered Revenue Growth for Life Science Companies | Arcova",
  description: "We build AI-powered sales engines for life science companies.",
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
    url: 'https://arcova.app',
    title: "AI-Powered Revenue Growth for Life Science Companies | Arcova",
    description: "We build AI-powered sales engines for life science companies.",
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
  // twitter: {
  //   card: "summary_large_image",
  //   title: "Arcova | Scientific Evidence for Business Decisions",Right, so this is all right, I think. 
  //   description: "Oxford-trained PhD team turning raw biomedical literature into decision-ready insight.",
  //   images: ["/images/og-image.png"],
  //   creator: "@arcova",
  // },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={poppins.variable}>
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
              url: "https://arcova.app",
              logo: "https://arcova.app/arcova-logo.png",
              description: "We build AI-powered sales engines for life science companies.",
            }),
          }}
        />
      </head>
      <body>
        <AuthProvider>
          <EnrichmentGuardProvider>
            <ClientLayout>{children}</ClientLayout>
          </EnrichmentGuardProvider>
        </AuthProvider>
        {/* <Analytics /> */}
      </body>
    </html>
  )
}