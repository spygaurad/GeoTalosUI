/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  images: {
    domains: ['your-s3-bucket.s3.amazonaws.com'],
  },
  // experimental: {
  //   devToolbar: {
  //     disabled: true,
  //   },
  // },
}

module.exports = nextConfig
