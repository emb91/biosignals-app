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
    ]
  },
}

export default nextConfig