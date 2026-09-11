/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  swcMinify: false,
  experimental: {
    workerThreads: false,
    cpus: 1,
  },
  webpack: (config) => {
    config.parallelism = 1;
    config.cache = false;
    config.snapshot = {
      ...config.snapshot,
      managedPaths: [],
      immutablePaths: [],
    };
    config.watchOptions = {
      ...config.watchOptions,
      poll: 1000,
      aggregateTimeout: 300,
    };
    return config;
  },
};

module.exports = nextConfig;
