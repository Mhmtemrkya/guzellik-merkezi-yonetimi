const path = require('path');

const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname),
  images: {
    unoptimized: true,
  },
  // Next 15+ moved this out of experimental.
  serverExternalPackages: ['mongodb'],
  webpack(config, { dev }) {
    if (dev) {
      // Reduce CPU/memory from file watching
      config.watchOptions = {
        poll: 2000, // check every 2 seconds
        aggregateTimeout: 300, // wait before rebuilding
        ignored: ['**/node_modules'],
      };
    }
    return config;
  },
  onDemandEntries: {
    maxInactiveAge: 10000,
    pagesBufferLength: 2,
  },
  async headers() {
    // NOT: CORS header'ları BURADA global olarak verilmez. Tüm route'lara `Access-Control-Allow-*`
    // basmak (özellikle credential'lı `*`) güvenlik açığıdır. CORS yalnızca /api/proxy route handler'ında
    // (app/api/[[...path]]/route.ts) izinli origin listesine göre kontrollü yönetilir.
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "ALLOWALL" },
          { key: "Content-Security-Policy", value: "frame-ancestors *;" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
