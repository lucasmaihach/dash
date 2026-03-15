import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      // Thumbnails de criativos da Meta (Facebook CDN)
      { protocol: 'https', hostname: '**.fbcdn.net' },
      { protocol: 'https', hostname: '**.facebook.com' },
      { protocol: 'https', hostname: 'scontent.fbcdn.net' },
    ],
  },
}

export default nextConfig
