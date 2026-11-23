import type { MetadataRoute } from 'next'

/** Herkese açık tanıtım sayfaları (salon vitrinleri /salonlar dizininden bulunur). */
export default function sitemap(): MetadataRoute.Sitemap {
  const site = 'https://beautyasist.com'
  const pages: [string, number][] = [
    ['/', 1], ['/moduller', 0.9], ['/uygulamalar', 0.8], ['/salonlar', 0.8], ['/kayit', 0.7], ['/hakkimizda', 0.6],
    ['/iletisim', 0.5], ['/destek', 0.5], ['/kvkk', 0.3], ['/gizlilik', 0.3], ['/mesafeli-satis-sozlesmesi', 0.3], ['/teslimat-ve-iade', 0.3],
  ]
  return pages.map(([path, priority]) => ({ url: `${site}${path === '/' ? '' : path}`, changeFrequency: 'weekly', priority }))
}
