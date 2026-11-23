import type { MetadataRoute } from 'next'

/**
 * Tanıtım sayfaları arama motorlarına ve yapay zekâ tarayıcılarına açıktır (kullanıcı isteği 23 Kas 2026); panel,
 * platform, ödeme ve kişiye özel bağlantılar dizine girmez. Bu dosya erişim güvencesi DEĞİLDİR: o sayfalar zaten oturum ister.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/panel', '/platform', '/api/', '/odeme', '/login', '/change-password', '/imza', '/rate/', '/destek/takip', '/hediye-kart', '/ekip'],
    },
    sitemap: 'https://beautyasist.com/sitemap.xml',
  }
}
