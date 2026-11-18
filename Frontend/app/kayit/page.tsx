import { redirect } from 'next/navigation'

/**
 * KAYIT MAYDANOZ'A TAŞINDI (kullanıcı kararı 18 Kas 2026): kurum maydanozasist.com/kayit/beauty'de belgeleriyle
 * başvurur, Maydanoz onayıyla hesap açılır (14 gün deneme). Eski bağlantılar (landing, mobil uygulama) oraya gider.
 */
export default function KayitPage() {
  redirect('https://maydanozasist.com/kayit/beauty')
}
