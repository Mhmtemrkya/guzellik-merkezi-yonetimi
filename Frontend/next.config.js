const path = require('path');

// ANLIK GÜNCELLEME (SignalR) ÖN KOŞUL UYARISI.
//
// NEXT_PUBLIC_* değişkenleri BUILD ZAMANINDA gömülür: production build'i bu değişken olmadan
// alırsan, sonradan env'e eklemek işe yaramaz — yeniden build gerekir. Sessizce "realtime kapalı"
// bir sürüm yayınlamak yerine build çıktısında görünür bir uyarı bırakılır.
// (Hata değil: gerçek zamanlı katman olmadan uygulama normal çalışır.)
if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_REALTIME_URL) {
  console.warn('[BeautyAsist] UYARI: NEXT_PUBLIC_REALTIME_URL tanimli degil.');
  console.warn('  -> Anlik guncelleme (onay sonucu, adisyon, seans) bu build icin KAPALI olacak.');
  console.warn('  -> Acmak icin: NEXT_PUBLIC_REALTIME_URL=https://<api-domain>/hubs/realtime ve YENIDEN build.');
  console.warn('  -> Ayrica backend Cors:AllowedOrigins + nginx WebSocket upgrade gerekir (CANLI_DEPLOY_NOTLARI.md).');
}

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

  /**
   * ESKİ ARAYÜZ YOLLARI KALICI OLARAK TAŞINDI.
   *
   * `/admin` panelin adresinde görünmesin diye `/panel`, personel alanı da `/panel/personel`
   * ("personeli yönet") ile karışmasın diye `/ekip` oldu. Yer imleri, açık sekmeler ve Tauri
   * masaüstü kabuğunun kayıtlı adresi kırılmasın diye eski yollar 308 ile taşınır — 308,
   * 301'den farklı olarak metodu korur (POST POST kalır).
   *
   * DİKKAT: `/api/admin/*` API yoludur ve DEĞİŞMEMİŞTİR (mobil + backend ona bağlı). Buradaki
   * kurallar yalnız arayüz yollarını kapsar; `/api` ile başlayanlar eşleşmez.
   */
  async redirects() {
    return [
      { source: "/admin", destination: "/panel", permanent: true },
      { source: "/admin/:path*", destination: "/panel/:path*", permanent: true },
      { source: "/personel", destination: "/ekip", permanent: true },
      { source: "/personel/:path*", destination: "/ekip/:path*", permanent: true },
    ];
  },
};

module.exports = nextConfig;
