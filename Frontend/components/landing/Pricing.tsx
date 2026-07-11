'use client'

import { motion } from 'framer-motion'
import {
  ArrowUpRight,
  CheckCircle2,
  Crown,
  Phone,
  Rocket,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import AnimatedCounter from './AnimatedCounter'
import TiltCard from './three/TiltCard'

interface Plan {
  name: string
  monthly: number
  yearly: number
  tag: string
  icon: LucideIcon
  highlight?: boolean
  features: string[]
}

interface Addon {
  title: string
  price: string
  body: string
}

const plans: Plan[] = [
  {
    name: 'Başlangıç',
    monthly: 799,
    yearly: 7990,
    tag: 'Excel’den çıkış',
    icon: ShieldCheck,
    features: [
      '1 şube',
      '3 kullanıcı / personel',
      '500 müşteri kaydı',
      'Hizmet & paket oluşturma',
      'Paket satışı',
      'Taksit ve ödeme takibi',
      'Kalan borç takibi',
      'Seans takibi',
      'Randevu takvimi',
      'Günlük kasa',
      'Excel dışa aktarma',
    ],
  },
  {
    name: 'Profesyonel',
    monthly: 1499,
    yearly: 14990,
    tag: 'En çok tercih edilen',
    icon: Crown,
    highlight: true,
    features: [
      '10 kullanıcı / personel',
      'Sınırsız müşteri & paket',
      'Esnek taksit yönetimi',
      'Düzensiz ödeme takibi',
      'Kalan borç yeniden taksitlendirme',
      'Cari hesap takibi',
      'Geciken ödeme raporu',
      'Personel bazlı randevu',
      'Personel prim raporu',
      'PDF / Excel rapor çıktısı',
      'Manuel WhatsApp hatırlatma',
    ],
  },
  {
    name: 'Premium',
    monthly: 2990,
    yearly: 29990,
    tag: 'Çok şube · 25 kullanıcı',
    icon: Rocket,
    features: [
      'Çoklu şube desteği',
      '25 kullanıcı / personel',
      'Gelişmiş cari hesap',
      'Gelişmiş kasa raporları',
      'Personel performans raporları',
      'Personel prim yönetimi',
      'Stok ve ürün takibi',
      'Gelişmiş gelir-gider',
      'Geciken ödeme bildirimleri',
      'Yönetici dashboard',
      'Muhasebeci raporu',
      'Öncelikli teknik destek',
    ],
  },
  {
    name: 'AI Klinik',
    monthly: 4990,
    yearly: 49900,
    tag: 'AI otomasyon · çok şube',
    icon: Sparkles,
    features: [
      '75 kullanıcı / personel',
      '25 şube ve 75.000 müşteri limiti',
      'AI müşteri segmentasyonu',
      'Kampanya ve sadakat önerileri',
      'WhatsApp botu ile otomatik hatırlatma',
      'Akıllı seans yenileme ve churn uyarıları',
      'Doluluk, kapasite ve gelir tahmini',
      'Gelişmiş rapor exportları',
      'API, webhook ve denetim logu',
      '7/24 öncelikli destek',
    ],
  },
]

const addons: Addon[] = [
  { title: 'Standart Kurulum', price: '3.000 – 5.000 TL', body: 'Firma hesabı, kullanıcılar, temel ayarlar, örnek paketler ve online eğitim.' },
  { title: 'Excel Veri Aktarımı', price: '5.000 – 15.000 TL', body: 'Mevcut müşteri, borç, paket ve seans kayıtlarının sisteme aktarılması.' },
  { title: 'Yerinde Eğitim', price: '10.000 TL+', body: 'İşletme personeline yüz yüze kullanım eğitimi.' },
  { title: 'Özel Geliştirme', price: 'Proje bazlı', body: 'Özel rapor, modül, entegrasyon veya marka bazlı istekler.' },
]

export default function Pricing() {
  const [yearly, setYearly] = useState<boolean>(false)

  return (
    <section id="pricing" className="relative bg-[#160b12] py-32">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_15%,rgba(240,170,194,0.16),transparent_50%),radial-gradient(circle_at_82%_85%,rgba(255,211,223,0.14),transparent_50%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04] [background-image:linear-gradient(rgba(255,244,248,.5)_1px,transparent_1px),linear-gradient(90deg,rgba(255,244,248,.5)_1px,transparent_1px)] [background-size:80px_80px]" />

      <div className="relative mx-auto max-w-7xl px-5 sm:px-8 lg:px-12">
        <motion.div
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 0.7 }}
          className="mb-12 text-center"
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#f0aac2]/35 bg-[#160b12]/55 px-4 py-2 text-[10px] uppercase tracking-[0.26em] text-[#ffd3df] backdrop-blur-xl">
            <Crown className="h-3.5 w-3.5" /> SaaS Paketleri · KDV hariç
          </div>
          <h2 className="hero-title text-[clamp(2.4rem,5vw,5.4rem)] leading-[0.9] tracking-[-0.045em] text-[#fff4f8]">
            Hangi büyüklükte olursanız olun, <br />
            <span className="beautyassist-text-gradient">bir paket size uyar.</span>
          </h2>

          <div className="mt-7 inline-flex items-center gap-1 rounded-full border border-[#fff4f8]/14 bg-[#160b12]/55 p-1 backdrop-blur-xl">
            <button
              type="button"
              onClick={() => setYearly(false)}
              className={`rounded-full px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] transition ${
                !yearly ? 'bg-gradient-to-r from-[#f0aac2] to-[#ffd3df] text-[#2f1724]' : 'text-[#fff4f8]/65'
              }`}
              data-cursor="AYLIK"
            >
              Aylık
            </button>
            <button
              type="button"
              onClick={() => setYearly(true)}
              className={`rounded-full px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] transition ${
                yearly ? 'bg-gradient-to-r from-[#f0aac2] to-[#ffd3df] text-[#2f1724]' : 'text-[#fff4f8]/65'
              }`}
              data-cursor="YILLIK"
            >
              Yıllık · ~17% indirim
            </button>
          </div>
        </motion.div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan, i) => {
            const Icon = plan.icon
            const price = yearly ? plan.yearly : plan.monthly
            const suffix = yearly ? 'TL / yıl' : 'TL / ay'
            return (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 36 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ delay: i * 0.12, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              >
                <TiltCard intensity={7} className="h-full">
                  <div
                    className={`relative h-full overflow-hidden rounded-3xl border p-7 backdrop-blur-2xl ${
                      plan.highlight
                        ? 'border-[#f0aac2]/55 bg-gradient-to-br from-[#3a1a2a]/90 via-[#160b12]/65 to-[#2a1320]/85 shadow-[0_36px_120px_rgba(240,170,194,0.32)]'
                        : 'border-[#fff4f8]/14 bg-[#160b12]/55 shadow-[0_24px_80px_rgba(0,0,0,0.35)]'
                    }`}
                  >
                    {plan.highlight && (
                      <div className="absolute right-5 top-5 rounded-full bg-gradient-to-r from-[#f0aac2] to-[#ffd3df] px-3 py-1 text-[9px] font-bold uppercase tracking-[0.2em] text-[#2f1724]">
                        Önerilen
                      </div>
                    )}
                    <div className="mb-5 flex items-center gap-3">
                      <span className="grid h-11 w-11 place-items-center rounded-xl border border-[#f0aac2]/35 bg-[#fff4f8]/5">
                        <Icon className="h-[18px] w-[18px] text-[#ffd3df]" />
                      </span>
                      <div>
                        <div className="font-display text-xl text-[#fff4f8]">{plan.name}</div>
                        <div className="text-[10px] uppercase tracking-[0.2em] text-[#fff4f8]/55">{plan.tag}</div>
                      </div>
                    </div>

                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="beautyassist-text-gradient font-display text-5xl leading-none">
                        <AnimatedCounter key={`${plan.name}-${yearly}`} to={price} duration={1.4} />
                      </span>
                      <span className="text-sm text-[#fff4f8]/55">{suffix}</span>
                    </div>
                    <div className="mb-6 text-[11px] uppercase tracking-[0.18em] text-[#fff4f8]/45">
                      {yearly
                        ? `Aylık ${Math.round(plan.yearly / 12).toLocaleString('tr-TR')} TL`
                        : `Yıllık ${plan.yearly.toLocaleString('tr-TR')} TL`}
                    </div>

                    <a
                      href="/login"
                      className={`mb-6 flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-[11px] font-bold uppercase tracking-[0.22em] transition ${
                        plan.highlight
                          ? 'bg-gradient-to-r from-[#f0aac2] via-[#ffd3df] to-[#fff4f8] text-[#2f1724] shadow-[0_18px_60px_rgba(240,170,194,0.32)]'
                          : 'border border-[#fff4f8]/16 bg-[#160b12]/55 text-[#fff4f8]/85 hover:bg-[#fff4f8]/8'
                      }`}
                      data-cursor={plan.name}
                    >
                      Demo ile başla
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>

                    <ul className="space-y-2.5 text-[13px] text-[#fff4f8]/78">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#f0aac2]" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </TiltCard>
              </motion.div>
            )
          })}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.7 }}
          className="mt-6 overflow-hidden rounded-3xl border border-[#fff4f8]/12 bg-gradient-to-br from-[#1f1018]/85 via-[#160b12]/65 to-[#1a0d15]/85 p-7 backdrop-blur-2xl"
        >
          <div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
            <div className="max-w-2xl">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#f0aac2]/35 bg-[#160b12]/55 px-3 py-1 text-[9px] uppercase tracking-[0.22em] text-[#ffd3df]">
                <Crown className="h-3 w-3" /> Kurumsal / Özel Paket
              </div>
              <h3 className="font-display text-2xl tracking-[-0.02em] text-[#fff4f8] md:text-3xl">
                Markaya özel panel, özel modül, kaynak kod opsiyonu.
              </h3>
              <p className="mt-2 text-[14px] text-[#fff4f8]/72">
                Özel domain, özel raporlar, gelişmiş yetkilendirme, eğitim ve danışmanlık. Teklif ile belirlenir.
              </p>
            </div>
            <a
              href="/login"
              className="inline-flex items-center gap-3 rounded-full bg-gradient-to-r from-[#f0aac2] via-[#ffd3df] to-[#fff4f8] px-7 py-4 text-[11px] font-bold uppercase tracking-[0.22em] text-[#2f1724] shadow-[0_20px_70px_rgba(240,170,194,0.32)]"
              data-cursor="TEKLİF"
            >
              <Phone className="h-3.5 w-3.5" />
              Teklif al
            </a>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.65 }}
          className="mt-12"
        >
          <div className="mb-5 text-[10px] uppercase tracking-[0.26em] text-[#fff4f8]/52">Ek hizmet ücretleri</div>
          <div className="grid gap-3 md:grid-cols-4">
            {addons.map((a) => (
              <div
                key={a.title}
                className="rounded-2xl border border-[#fff4f8]/12 bg-[#160b12]/55 p-4 backdrop-blur-xl"
              >
                <div className="text-[11px] uppercase tracking-[0.2em] text-[#ffd3df]">{a.title}</div>
                <div className="mt-1 font-display text-lg text-[#fff4f8]">{a.price}</div>
                <div className="mt-2 text-[12px] leading-relaxed text-[#fff4f8]/65">{a.body}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
