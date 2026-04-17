import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@kagetra/shared'],
  output: 'standalone',
  experimental: {
    // Allow middleware to use Node.js runtime (required for Auth.js v5 +
    // database sessions which rely on pg/crypto unavailable in Edge runtime).
    nodeMiddleware: true,
  },
}

export default nextConfig
