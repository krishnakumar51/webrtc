/** @type {import('next').NextConfig} */
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');

const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  swcMinify: true, // Use SWC for faster builds
  compress: true,
  poweredByHeader: false,
  generateEtags: false,
  env: {
    NEXT_PUBLIC_NGROK_URL: process.env.NEXT_PUBLIC_NGROK_URL,
    NEXT_PUBLIC_SIGNALING_SERVER_URL: process.env.NEXT_PUBLIC_SIGNALING_SERVER_URL || 'http://localhost:8000',
    NEXT_PUBLIC_MODE: process.env.NEXT_PUBLIC_MODE || 'wasm',
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/models/:path*',
        destination: '/models/:path*', // Served from public/models
      },
      {
        source: '/favicon.ico',
        destination: '/favicon.svg',
      },
    ];
  },
  // Removed experimental optimizeCss to avoid critters dependency requirement
  webpack: (config, { isServer }) => {
    config.resolve.extensions.push('.ts', '.tsx');
    config.resolve.fallback = { fs: false };

    // Only add plugins for client-side builds
    if (!isServer) {
      config.plugins.push(
        new NodePolyfillPlugin(),
        new CopyPlugin({
          patterns: [
            // Only copy the essential model files used by the app
            {
              from: './public/models/yolov10n.onnx',
              to: 'static/chunks/pages',
            },
          ],
        })
      );
    }

    // Optimize bundle size
    config.optimization = {
      ...config.optimization,
      splitChunks: {
        chunks: 'all',
        cacheGroups: {
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all',
          },
        },
      },
    };

    return config;
  },
};

const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  clientsClaim: true,
  cleanupOutdatedCaches: true,
  // Do NOT precache heavy artifacts like onnx/wasm
  buildExcludes: [
    /.*\.(?:onnx|wasm|mjs)$/i,
  ],
  // Avoid caching model/wasm and Next internal manifests at runtime
  runtimeCaching: [
    {
      urlPattern: /_buildManifest\.js$|_ssgManifest\.js$/,
      handler: 'NetworkOnly',
    },
    {
      urlPattern: /\/(.*)\.(?:onnx|wasm|mjs)$/i,
      handler: 'NetworkOnly',
    },
  ],
});

module.exports = withBundleAnalyzer(withPWA(nextConfig));

// module.exports = nextConfig
