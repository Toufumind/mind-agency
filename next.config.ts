/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['ts', 'tsx', 'js', 'jsx'],
  output: 'standalone',
  webpack: (config: any, { isServer }: { isServer: boolean }) => {
    if (isServer) {
      // Exclude native modules from webpack bundling
      config.externals = [
        ...(config.externals || []),
        '@xenova/transformers',
        '@lancedb/lancedb',
        'sharp',
        'onnxruntime-node',
      ];
    }
    return config;
  },
};
export default nextConfig;
