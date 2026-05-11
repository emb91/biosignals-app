/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
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
        source: '/leads/health',
        destination: '/health',
        permanent: false,
      },
      {
        source: '/leads/data',
        destination: '/data',
        permanent: false,
      },
      {
        source: '/pipeline',
        destination: '/health',
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
    ]
  },
}

export default nextConfig
