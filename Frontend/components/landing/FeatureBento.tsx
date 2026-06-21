'use client'

import { motion } from 'framer-motion'
import {
  BarChart3,
  CalendarDays,
  CreditCard,
  Layers3,
  PackageCheck,
  Receipt,
  UsersRound,
  WalletCards,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import TiltCard from './three/TiltCard'

interface ModuleEntry {
  icon: LucideIcon
  title: string
  body: string
  span?: string
  accent: string
}

const modules: ModuleEntry[] = [
  {
    icon: UsersRound,
    title: 'Müşteri Yönetimi',
    body: 'Tek kart üzerinde paket, borç, ödeme, randevu, seans ve notlar. Tüm operasyonu müşteri özelinde okuyun.',
    span: 'md:col-span-2 md:row-span-2',
    accent: 'from-[#f0aac2]/30 to-transparent',
  },
  {
    icon: Wand2,
    title: 'Hizmet Yönetimi',
    body: 'Lazer, cilt bakımı, tüy sarartma — kendi hizmetlerinizi ekleyin, paketler içine yerleştirin.',
    accent: 'from-[#ffd3df]/22 to-transparent',
  },
  {
    icon: Layers3,
    title: 'Paket & Seans',
    body: 'Hizmet bazlı seans sayısı, toplam/kullanılan/kalan otomatik. Aktif, donduruldu, iptal — tek bakışta.',
    span: 'md:col-span-2',
    accent: 'from-[#f0aac2]/28 to-transparent',
  },
  {
    icon: CreditCard,
    title: 'Esnek Taksit',
    body: 'Düzensiz ödeme alırsanız sistem kalan borcu yeniden taksitlendirir. Eski ödemeler asla silinmez.',
    accent: 'from-[#ffd3df]/22 to-transparent',
  },
  {
    icon: CalendarDays,
    title: 'Randevu Takvimi',
    body: 'Müşteri, personel, hizmet, oda — çakışmasız tek takvim. Tamamlanan randevu seansı düşer.',
    accent: 'from-[#f0aac2]/24 to-transparent',
  },
  {
    icon: WalletCards,
    title: 'Kasa & Ön Muhasebe',
    body: 'Nakit, kart, havale, gider. Günlük net kasa, müşteri bazlı cari ve geciken ödeme listesi.',
    span: 'md:col-span-2',
    accent: 'from-[#f0aac2]/30 to-transparent',
  },
  {
    icon: BarChart3,
    title: 'Personel & Prim',
    body: 'Personel bazlı işlem, doluluk, performans ve aylık prim raporu — yöneticiye anlık görünür.',
    accent: 'from-[#ffd3df]/24 to-transparent',
  },
  {
    icon: PackageCheck,
    title: 'Stok & Ürün',
    body: 'Premium pakette: kritik stok, çıkış işlemi, tedarikçi ve hizmetle bağlı tüketim takibi.',
    accent: 'from-[#f0aac2]/24 to-transparent',
  },
  {
    icon: Receipt,
    title: 'Raporlama',
    body: 'Aylık tahsilat, açık alacak, en çok satan paket, geciken ödeme. PDF/Excel dışa aktarım.',
    accent: 'from-[#ffd3df]/26 to-transparent',
  },
]

function ModuleCard({ mod, i }: { mod: ModuleEntry; i: number }) {
  const Icon = mod.icon
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.96 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.65, delay: (i % 3) * 0.06 + Math.floor(i / 3) * 0.04, ease: [0.22, 1, 0.36, 1] }}
      className={`group relative overflow-hidden ${mod.span || ''}`}
      data-cursor={mod.title}
    >
      <TiltCard intensity={6} glare className="h-full">
        <div className="relative h-full overflow-hidden rounded-3xl border border-[#fff4f8]/12 bg-gradient-to-br from-[#1f1018]/85 via-[#160b12]/65 to-[#1a0d15]/85 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-all duration-500 group-hover:border-[#f0aac2]/45 group-hover:shadow-[0_30px_110px_rgba(240,170,194,0.22)]">
          <div className={`pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-gradient-to-br ${mod.accent} blur-2xl`} />
          <div className="relative">
            <div className="mb-5 inline-flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl border border-[#f0aac2]/35 bg-[#160b12]/60 shadow-[0_0_30px_rgba(240,170,194,0.18)]">
                <Icon className="h-[18px] w-[18px] text-[#ffd3df]" />
              </span>
            </div>
            <h3 className="font-display text-2xl tracking-[-0.02em] text-[#fff4f8]">{mod.title}</h3>
            <p className="mt-3 text-[14px] leading-relaxed text-[#fff4f8]/72">{mod.body}</p>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#f0aac2]/40 to-transparent opacity-0 transition group-hover:opacity-100" />
        </div>
      </TiltCard>
    </motion.div>
  )
}

export default function FeatureBento() {
  return (
    <section id="modules" className="relative bg-[#160b12] py-32">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_18%,rgba(240,170,194,0.16),transparent_45%),radial-gradient(circle_at_85%_70%,rgba(255,211,223,0.12),transparent_45%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04] [background-image:linear-gradient(rgba(255,244,248,.5)_1px,transparent_1px),linear-gradient(90deg,rgba(255,244,248,.5)_1px,transparent_1px)] [background-size:80px_80px]" />

      <div className="relative mx-auto max-w-7xl px-5 sm:px-8 lg:px-12">
        <motion.div
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.7 }}
          className="mb-14 max-w-3xl"
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#f0aac2]/35 bg-[#160b12]/55 px-4 py-2 text-[10px] uppercase tracking-[0.26em] text-[#ffd3df] backdrop-blur-xl">
            Ana Modüller
          </div>
          <h2 className="hero-title text-[clamp(2.4rem,5.2vw,5.6rem)] leading-[0.9] tracking-[-0.045em] text-[#fff4f8]">
            Bir güzellik merkezi neye ihtiyaç duyarsa, <br />
            <span className="armonessa-text-gradient">hepsi tek panelde.</span>
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-[#fff4f8]/72 sm:text-lg">
            Müşteri kartından kasaya, paketten randevuya. 9 modül; aynı veriyi paylaşır, aynı akışı konuşur.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 gap-4 md:auto-rows-[200px] md:grid-cols-4">
          {modules.map((m, i) => (
            <ModuleCard key={m.title} mod={m} i={i} />
          ))}
        </div>
      </div>
    </section>
  )
}
