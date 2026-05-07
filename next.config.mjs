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
        source: '/health',
        destination: '/leads/health',
        permanent: false,
      },
      {
        source: '/data',
        destination: '/leads/data',
        permanent: false,
      },
      {
        source: '/pipeline',
        destination: '/leads/health',
        permanent: false,
      },
    ]
  },
}

export default nextConfig
