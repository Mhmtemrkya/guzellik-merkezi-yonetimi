import Image from 'next/image'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { company, legalLinks } from '@/lib/legal/company'

/**
 * ÖDEME ALTYAPISI ŞERİDİ — iyzico'nun kendi footer bandı.
 *
 * Bant tek görselde "iyzico ile Öde" + Mastercard + Visa + American Express + troy
 * markalarını taşır; iyzico üye iş yeri kriterlerindeki "Visa ve MasterCard logoları"
 * ile "iyzico ile Öde logosu" maddelerinin ikisini birden karşılar.
 *
 * BİLEREK ÖDEME DÜĞMESİ DEĞİL: entegrasyonumuz Checkout Form (Ortak Ödeme Sayfası)
 * kullanır, iyzico'nun "Pay with iyzico" ürünü değil. Bu yüzden pakette gelen
 * `checkout_iyzico_ile_ode` düğme varlığı değil, footer bandı kullanılır — kullanmadığımız
 * bir ürünü reklam eden bir düğme koymuyoruz.
 *
 * Varlıklar `public/payment/` altındadır (renkli + beyaz sürüm).
 */
export default function PaymentBadges({
  variant = 'colored',
  className = '',
  showNote = true,
}: {
  /** Koyu zeminde `white`, açık zeminde `colored`. */
  variant?: 'colored' | 'white'
  className?: string
  showNote?: boolean
}) {
  const src = variant === 'white' ? '/payment/iyzico-band-white.svg' : '/payment/iyzico-band.svg'
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* GENİŞLİK AÇIKÇA VERİLİR: sütun yönlü flex kabında `w-auto` bir görseli kabın
          genişliğine ESNETİR (align-self: stretch), bant yamulur. Sabit genişlik + `max-w-full`
          + `h-auto` ile bant dar kapta oranını koruyarak küçülür. */}
      <Image
        src={src}
        alt="iyzico ile Öde · Mastercard · Visa · American Express · troy"
        width={429}
        height={32}
        className="h-auto w-[429px] max-w-full"
      />
      {showNote && (
        <p
          className={`inline-flex items-center gap-1.5 text-[12px] ${
            variant === 'white' ? 'text-white/70' : 'text-[#705A66]'
          }`}
        >
          <Lock className="h-3 w-3" aria-hidden />
          Ödemeler {company.paymentProvider} altyapısıyla, 256-bit SSL ile şifrelenerek alınır.
          Kart bilgileriniz sunucularımızda saklanmaz.
        </p>
      )}
    </div>
  )
}

/**
 * Ödeme adımında gösterilen yasal metin bağlantıları.
 *
 * Kriterleri inceleyen taraf bu bağlantıları yalnız footer'da değil, satın alma
 * noktasında da arar; bu yüzden paket/ödeme ekranlarına da konur.
 */
export function LegalLinkRow({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] ${className}`}>
      {legalLinks.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          target="_blank"
          className="underline-offset-2 hover:underline"
        >
          {link.label}
        </Link>
      ))}
    </div>
  )
}
