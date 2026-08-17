import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { LEGAL_LAST_UPDATED, company, isPlaceholder, legalLinks } from '@/lib/legal/company'

/**
 * E-posta bağlantısı — adres henüz doldurulmadıysa `mailto:` ÜRETİLMEZ.
 * Damga metnine tıklanabilir bir bağlantı vermek, çalışmayan bir posta penceresi açardı.
 */
export function MailLink({ className = '' }: { className?: string }) {
  if (isPlaceholder(company.email)) {
    return <span className={className}>{company.email}</span>
  }
  return (
    <a
      className={`font-medium text-[#EF6F94] underline underline-offset-2 ${className}`}
      href={`mailto:${company.email}`}
    >
      {company.email}
    </a>
  )
}

/**
 * YASAL SAYFA KABUĞU — Hakkımızda, Mesafeli Satış, Teslimat & İade, Gizlilik.
 *
 * Dört sayfa da aynı iskeleti kullanır: marka başlığı, okunabilir tek sütun metin,
 * altta diğer yasal sayfalara geçiş ve ödeme altyapısı şeridi. Ödeme sağlayıcısının
 * (iyzico) üye iş yeri incelemesinde bu sayfaların hem VAR olması hem de birbirine
 * bağlı ve markayla tutarlı olması aranır.
 *
 * Dil landing sayfasıyla ortak: krem zemin (#FFF7FA), pembe aksan (#EF6F94),
 * koyu mürekkep (#352432) — ayrı bir "belge teması" kurulmadı.
 */

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 scroll-mt-24">
      <h2 className="font-display text-[19px] font-semibold leading-snug tracking-[-0.02em] text-[#352432] sm:text-[21px]">
        {title}
      </h2>
      <div className="mt-2.5 space-y-3 text-[14.5px] leading-[1.75] text-[#4A3A44]">{children}</div>
    </section>
  )
}

/** Madde listesi — sözleşme metinlerinde tekrar eden biçim. */
export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="ml-5 list-disc space-y-1.5 marker:text-[#EF6F94]">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  )
}

/** Künye satırı — satıcı bilgileri tablosu. */
export function LegalFacts({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="mt-3 overflow-hidden rounded-[16px] border border-[#EEC9D7] bg-white">
      {rows.map((row, index) => (
        <div
          key={row.label}
          className={`flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4 ${
            index > 0 ? 'border-t border-[#F2DFE7]' : ''
          }`}
        >
          <dt className="w-full shrink-0 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#A8697F] sm:w-52">
            {row.label}
          </dt>
          <dd className="text-[14.5px] leading-relaxed text-[#352432]">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function LegalPage({
  eyebrow,
  title,
  intro,
  children,
  showUpdatedAt = true,
}: {
  eyebrow: string
  title: string
  intro?: ReactNode
  children: ReactNode
  showUpdatedAt?: boolean
}) {
  return (
    <div className="min-h-screen bg-[#FFF7FA] text-[#352432]">
      {/* Zeminde tek, çok yumuşak renk bulutu — landing ile aynı dil. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-[420px] w-[560px] -translate-x-1/2 rounded-full bg-[#FFDCE8]/50 blur-[120px]" />
      </div>

      <header className="border-b border-[#F2DFE7]">
        <div className="mx-auto flex max-w-[900px] items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="" width={36} height={36} className="h-9 w-9 object-contain" />
            <span className="text-[15.5px] font-semibold tracking-[-0.015em]">{company.brand}</span>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-[#EEC9D7] bg-white px-3.5 py-1.5 text-[13px] text-[#4A3A44] transition-colors hover:border-[#EF6F94] hover:text-[#EF6F94]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Ana sayfa
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[900px] px-5 py-10 sm:px-8 sm:py-14">
        <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#EF6F94]">{eyebrow}</p>
        <h1 className="mt-2 font-display text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-[36px]">
          {title}
        </h1>
        {showUpdatedAt && (
          <p className="mt-2.5 text-[13px] text-[#705A66]">Son güncelleme: {LEGAL_LAST_UPDATED}</p>
        )}
        {intro && (
          <div className="mt-5 rounded-[18px] border border-[#EEC9D7] bg-white/80 p-5 text-[14.5px] leading-[1.75] text-[#4A3A44]">
            {intro}
          </div>
        )}

        <article className="mt-2">{children}</article>

        {/* Diğer yasal sayfalar — inceleyen taraf tek sayfadan hepsine ulaşabilmeli. */}
        <nav className="mt-12 rounded-[18px] border border-[#EEC9D7] bg-white p-5">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#A8697F]">
            Diğer yasal metinler
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {legalLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="inline-flex rounded-full border border-[#EEC9D7] bg-[#FFF7FA] px-3.5 py-1.5 text-[13px] text-[#4A3A44] transition-colors hover:border-[#EF6F94] hover:text-[#EF6F94]"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <footer className="mt-8 flex flex-col gap-4 border-t border-[#F2DFE7] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] text-[#705A66]">
            © {new Date().getFullYear()} {company.brand}
          </p>
          <p className="inline-flex items-center gap-1.5 text-[12.5px] text-[#705A66]">
            <ShieldCheck className="h-3.5 w-3.5 text-[#EF6F94]" />
            Ödemeler {company.paymentProvider} altyapısıyla, SSL korumalı olarak alınır.
          </p>
        </footer>
      </main>
    </div>
  )
}
