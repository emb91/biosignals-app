/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  /** Legacy API path → handlers live under `/api/icps/*`. Transparent rewrite preserves POST/DELETE bodies. */
  async rewrites() {
    return [
      { source: '/api/company-criteria', destination: '/api/icps' },
      { source: '/api/company-criteria/:path*', destination: '/api/icps/:path*' },
    ];
  },
  async redirects() {
    return [
      {
        source: '/sign-up',
        destination: '/invite',
        permanent: true,
      },
      {
        source: '/results',
        destination: '/leads/contacts',
        permanent: false,
      },
      {
        source: '/accounts',
        destination: '/leads/accounts',
        permanent: false,
      },
      {
        source: '/briefing',
        destination: '/today',
        permanent: false,
      },
      {
        source: '/dashboard',
        destination: '/gtm-base',
        permanent: false,
      },
      {
        // Page renamed Health → Coverage; keep old links working.
        source: '/health',
        destination: '/coverage',
        permanent: false,
      },
      {
        source: '/leads/health',
        destination: '/coverage',
        permanent: false,
      },
      {
        source: '/leads/data',
        destination: '/data',
        permanent: false,
      },
      {
        source: '/pipeline',
        destination: '/coverage',
        permanent: false,
      },
      {
        source: '/customer-signals',
        destination: '/signals',
        permanent: false,
      },
      {
        source: '/contact',
        destination: '/contact-us',
        permanent: false,
      },
      {
        source: '/upload',
        destination: '/import',
        permanent: false,
      },
      {
        source: '/api/briefing/pulse-series',
        destination: '/api/today/pulse-series',
        permanent: false,
      },
      {
        source: '/contacts/:id/edit',
        destination: '/icps',
        permanent: false,
      },
      {
        source: '/personas/:id/edit',
        destination: '/icps',
        permanent: false,
      },
      {
        source: '/personas',
        destination: '/icps',
        permanent: false,
      },
      {
        source: '/my-profile',
        destination: '/my-company',
        permanent: false,
      },
      {
        source: '/company-criteria',
        destination: '/icps',
        permanent: false,
      },
      {
        source: '/company-criteria/:path*',
        destination: '/icps/:path*',
        permanent: false,
      },
    ]
  },
}

export default nextConfig
