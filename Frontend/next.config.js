const path = require('path');

const nextConfig = {
  output: 'standalone',
  // Sunucu/sürüm parmak izi verme.
  poweredByHeader: false,
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
    //
    // CLICKJACKING: panel HİÇBİR origin tarafından iframe'e alınamaz. Önceki değerler
    // (`X-Frame-Options: ALLOWALL` + `frame-ancestors *`) tüm sitelere izin veriyordu;
    // `ALLOWALL` zaten standart bir değer değil (tarayıcılar yok sayar) ve CSP açıkça
    // her origin'e izin verdiği için oturum açmış yöneticiye görünmez iframe üzerinden
    // tıklatma yapılabiliyordu. Gerçekten gömülmesi gereken bir route çıkarsa YALNIZ o
    // route için ayrı bir kayıt eklenip partner origin'i tek tek listelenmelidir.
    const securityHeaders = [
      {
        key: "Content-Security-Policy",
        value: [
          "frame-ancestors 'none'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; "),
      },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    ];

    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
