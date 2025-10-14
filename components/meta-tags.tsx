import Head from "next/head"

export function MetaTags() {
  return (
    <Head>
      {/* Basic Meta Tags */}
      <meta property="og:title" content="We make science make sense | Arcova" />
      <meta
        property="og:description"
        content="We help turn research into strategy, products, and progress."
      />
      <meta property="og:image" content="/images/arcova-logo-transparent.png" />
      <meta property="og:type" content="website" />

      {/* Twitter Card Tags
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="Arcova | Scientific Evidence for Business Decisions" />
      <meta
        name="twitter:description"
        content="Oxford-trained PhD team turning raw biomedical literature into decision-ready insight."
      />
      <meta name="twitter:image" content="/images/og-image.png" /> */}

      {/* Favicon */}
      <link rel="icon" type="image/png" href="/arcova-favicon.png" sizes="any" />

      {/* Basic image tag that some platforms might use */}
      <link rel="image_src" href="/images/og-image.png" />
    </Head>
  )
}
