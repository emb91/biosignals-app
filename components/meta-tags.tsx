import Head from "next/head"

export function MetaTags() {
  return (
    <Head>
      {/* Basic Meta Tags */}
      <meta property="og:title" content="Arcova | Revenue engine for life science" />
      <meta
        property="og:description"
        content="Revenue intelligence for life science teams."
      />
      <meta property="og:image" content="/images/arcova-logo-transparent.png" />
      <meta property="og:type" content="website" />

      {/* Twitter Card Tags
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="Arcova | Revenue engine for life science" />
      <meta
        name="twitter:description"
        content="Revenue intelligence for life science teams."
      />
      <meta name="twitter:image" content="/images/og-image.png" /> */}

      {/* Favicon */}
      <link rel="icon" type="image/png" href="/arcova-favicon.png" sizes="any" />

      {/* Basic image tag that some platforms might use */}
      <link rel="image_src" href="/images/og-image.png" />
    </Head>
  )
}
