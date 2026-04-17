import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@kagetra/shared'],
  output: 'standalone',
}

export default nextConfig
