/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Allow chrome-extension origins for local dev (extension sidepanel)
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:8080', '127.0.0.1:8080'],
    },
  },
};

module.exports = nextConfig;
