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
  async rewrites() {
    return [
      {
        source: '/models/:path*',
        destination: '/models/:path*', // Served from public/models
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
            {
              from: './node_modules/onnxruntime-web/dist/ort-wasm.wasm',
              to: 'static/chunks/pages',
            },
            {
              from: './node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm',
              to: 'static/chunks/pages',
            },
            // Only copy the essential model file
            {
              from: './public/models/yolov10n-int8-320.onnx',
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
});

module.exports = withBundleAnalyzer(withPWA(nextConfig));

// module.exports = nextConfig
