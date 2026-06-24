import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  images: {
    unoptimized: true,
  },
  async headers() {
    const commonHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
      },
      {
        key: 'Content-Security-Policy-Report-Only',
        value: [
          "default-src 'self'",
          "base-uri 'self'",
          "frame-ancestors 'none'",
          "object-src 'none'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data: https:",
          "style-src 'self' 'unsafe-inline'",
          "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://challenges.cloudflare.com https://us-assets.i.posthog.com",
          "connect-src 'self' https: wss:",
          "frame-src 'self' https://challenges.cloudflare.com https:",
          "form-action 'self'",
        ].join('; '),
      },
    ];
    if (process.env.NODE_ENV === 'production') {
      commonHeaders.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      });
    }
    return [
      { source: '/(.*)', headers: commonHeaders },
      {
        source: '/landing-test-:variant',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      {
        source: '/admin/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      {
        source: '/log',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
  /** Legacy API path → handlers live under `/api/icps/*`. Transparent rewrite preserves POST/DELETE bodies. */
  async rewrites() {
    return [
      { source: '/api/company-criteria', destination: '/api/icps' },
      { source: '/api/company-criteria/:path*', destination: '/api/icps/:path*' },
      // PostHog reverse proxy — avoids ad-blocker interference and keeps
      // ingestion on the same origin as the app.
      { source: '/ingest/static/:path*', destination: 'https://us-assets.i.posthog.com/static/:path*' },
      { source: '/ingest/array/:path*', destination: 'https://us-assets.i.posthog.com/array/:path*' },
      { source: '/ingest/:path*', destination: 'https://us.i.posthog.com/:path*' },
    ];
  },
  // Required for PostHog trailing-slash API requests to route correctly.
  skipTrailingSlashRedirect: true,
  async redirects() {
    return [
      {
        source: '/sign-up',
        destination: '/invite',
        permanent: true,
      },
      {
        source: '/results',
        destination: '/contacts',
        permanent: false,
      },
      {
        source: '/leads/contacts',
        destination: '/contacts',
        permanent: false,
      },
      {
        source: '/accounts',
        destination: '/companies',
        permanent: false,
      },
      {
        source: '/leads/accounts',
        destination: '/companies',
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

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
});
