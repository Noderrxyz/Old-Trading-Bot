/**
 * Next.js Configuration
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001'
  },
  // Enable server-side rendering
  ssr: true,
  // Enable image optimization
  images: {
    domains: ['localhost'],
  },
  // Configure redirects
  async redirects() {
    return [
      {
        source: '/dashboard',
        destination: '/dashboard/compare',
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig; 