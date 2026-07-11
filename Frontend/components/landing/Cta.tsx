'use client'

import { motion } from 'framer-motion'
import {
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Sparkles,
  Users,
  CreditCard,
  Wallet,
  BarChart3,
  Bell,
  Search,
  LayoutGrid,
  Package,
  CalendarDays,
  Crown,
} from 'lucide-react'
import AnimatedCounter from './AnimatedCounter'

const bullets = [
  'Demo panelinde örnek müşteri, paket, taksit ve randevu hazır.',
  'Excel veri aktarımı + kurulum desteğiyle ilk gün operasyona.',
  'Yıllık planda ~17% indirim, KDV hariç fiyatlandırma.',
]

const trustChips = [
  { v: '7/24', l: 'bulut · web + tablet' },
  { v: '1.', l: 'gün operasyon' },
  { v: 'PDF', l: 'Excel rapor çıktısı' },
  { v: '∞', l: 'paket & müşteri (Pro+)' },
]

const kpis = [
  { icon: Wallet,     label: 'Günlük kasa',    value: 25700, prefix: '₺', accent: 'rose' },
  { icon: Users,      label: 'Aktif müşteri',  value: 412,            accent: 'gold' },
  { icon: Package,    label: 'Satılan paket',  value: 18,  suffix: ' bu hafta', accent: 'rose' },
  { icon: CalendarDays, label: 'Bugünkü randevu', value: 14, accent: 'gold' },
]

const chart = [42, 58, 51, 73, 64, 88, 76, 92, 81, 96, 84, 100]

const activity = [
  { t: '14:22', text: 'Selin Aksoy · paket ödemesi',         amount: '+₺5.000', tone: 'pos' },
  { t: '13:58', text: 'Aylin · lazer seansı tamamlandı',     amount: '−1 seans', tone: 'neu' },
  { t: '13:31', text: 'Yeni paket satışı · cilt + sarartma', amount: '+₺18.500', tone: 'pos' },
  { t: '12:40', text: 'Geciken ödeme uyarısı · 3 müşteri',   amount: '!',         tone: 'warn' },
]

export default function Cta() {
  return (
    <section id="cta" className="aurora relative overflow-hidden bg-[#160b12] py-16 sm:py-24 lg:py-28">
      <div className="pointer-events-none absolute inset-0 aurora-soft" />
      <div className="pointer-events-none absolute inset-0 bg-grid" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#160b12] to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#0f070b] to-transparent" />

      <div className="relative z-10 mx-auto grid w-full max-w-7xl items-center gap-10 px-4 sm:gap-12 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:px-12">
        {/* LEFT — text & CTA */}
        <div className="relative min-w-0">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6 }}
            className="eyebrow mb-4 inline-flex w-fit max-w-full items-center gap-2 rounded-full border border-[#f0aac2]/35 bg-[#160b12]/60 px-3 py-1.5 text-[#ffd3df] backdrop-blur-xl sm:mb-5 sm:px-4"
          >
            <Sparkles className="h-3 w-3" />
            Demo çağrısı
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 22 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.7, delay: 0.06 }}
            className="hero-title max-w-[15ch] text-[clamp(2rem,11vw,3rem)] leading-[0.95] text-[#fff4f8] sm:max-w-none sm:text-[clamp(2.45rem,7vw,4.8rem)] lg:text-[clamp(2.8rem,4.6vw,4.8rem)]"
          >
            Excel’i bırakın. <br />
            <span className="serif-italic beautyassist-text-gradient">
              Panele 30 saniyede girin.
            </span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6, delay: 0.16 }}
            className="mt-5 max-w-lg text-[15px] leading-relaxed text-[#fff4f8]/80 sm:text-base"
          >
            Demo panelinde örnek veri ile gerçek günü yaşayın — bugün kasa, geciken ödeme, randevu ve performansı tek bakışta okuyun.
          </motion.p>

          <motion.ul
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.18 } } }}
            className="mt-7 space-y-2.5"
          >
            {bullets.map((b) => (
              <motion.li
                key={b}
                variants={{ hidden: { opacity: 0, x: -10 }, show: { opacity: 1, x: 0, transition: { duration: 0.45 } } }}
                className="flex items-start gap-3 text-[14px] leading-relaxed text-[#fff4f8]/85"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#f0aac2]" />
                <span>{b}</span>
              </motion.li>
            ))}
          </motion.ul>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6, delay: 0.32 }}
            className="mt-8 grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-center"
          >
            <a
              href="/login"
              className="group inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-full bg-gradient-to-r from-[#f0aac2] via-[#ffd3df] to-[#fff4f8] px-5 py-3.5 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-[#2f1724] shadow-[0_22px_70px_rgba(240,170,194,0.32)] sm:w-auto sm:px-7 sm:text-[11px] sm:tracking-[0.24em]"
              data-cursor="DEMO"
            >
              Demo Paneline Git
              <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
            <a
              href="#pricing"
              className="inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-full border border-[#fff4f8]/20 bg-[#160b12]/55 px-5 py-3.5 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-[#fff4f8]/90 backdrop-blur-xl transition hover:bg-[#fff4f8]/8 sm:w-auto sm:px-7 sm:text-[11px] sm:tracking-[0.24em]"
              data-cursor="GÖRÜŞME"
            >
              <Calendar className="h-3.5 w-3.5" />
              Görüşme planla
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.7, delay: 0.42 }}
            className="mt-8 grid grid-cols-2 gap-2.5 sm:mt-10 sm:grid-cols-4 sm:gap-3 lg:max-w-md lg:grid-cols-2"
          >
            {trustChips.map((s) => (
              <div key={s.l} className="glass min-w-0 rounded-2xl p-3 sm:p-3.5">
                <div className="beautyassist-text-gradient truncate font-display text-xl leading-none sm:text-2xl">{s.v}</div>
                <div className="eyebrow mt-1 text-[8px] leading-snug text-[#fff4f8]/55 sm:text-[9px]">{s.l}</div>
              </div>
            ))}
          </motion.div>
        </div>

        {/* RIGHT — dashboard preview */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 22 }}
          whileInView={{ opacity: 1, scale: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="relative min-w-0"
        >
          {/* outer halo */}
          <div className="pointer-events-none absolute -inset-3 -z-10 rounded-[2rem] bg-gradient-to-br from-[#f0aac2]/22 via-transparent to-[#ffd3df]/12 blur-2xl sm:-inset-6 sm:rounded-[3rem]" />

          <div className="relative w-full max-w-full overflow-hidden rounded-[1.5rem] border border-[#fff4f8]/14 bg-gradient-to-br from-[#1f1018]/92 via-[#160b12]/85 to-[#1a0d15]/92 shadow-[0_28px_90px_rgba(0,0,0,0.48)] backdrop-blur-2xl sm:rounded-[2rem] sm:shadow-[0_40px_120px_rgba(0,0,0,0.55)]">
            {/* browser-like chrome */}
            <div className="flex min-w-0 items-center gap-2 border-b border-[#fff4f8]/8 bg-[#160b12]/60 px-3 py-2.5 sm:gap-3 sm:px-4">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#f0aac2]/50" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#ffd3df]/45" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#fff4f8]/30" />
              </div>
              <div className="flex min-w-0 flex-1 items-center justify-center">
                <div className="flex max-w-full min-w-0 items-center gap-2 rounded-full border border-[#fff4f8]/8 bg-[#fff4f8]/[0.03] px-2.5 py-1 font-mono text-[9px] text-[#fff4f8]/55 sm:px-3 sm:text-[10px]">
                  <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-[#f0aac2]" />
                  <span className="truncate">panel.ozlemozge.com / admin</span>
                </div>
              </div>
              <span className="hidden font-mono text-[10px] uppercase tracking-[0.22em] text-[#fff4f8]/45 sm:inline">live</span>
            </div>

            {/* dashboard inner */}
            <div className="grid min-w-0 grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] lg:grid-cols-[140px_minmax(0,1fr)]">
              {/* sidebar */}
              <aside className="hidden border-r border-[#fff4f8]/8 bg-[#160b12]/40 px-3 py-4 sm:block">
                <div className="mb-4 flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-lg border border-[#f0aac2]/45 bg-[#3a1a2a]/70 text-[10px] font-bold">ÖÖ</span>
                  <div className="leading-tight">
                    <div className="font-display text-[12px] text-[#fff4f8]">Özlem Özge</div>
                    <div className="font-mono text-[8px] uppercase tracking-[0.18em] text-[#fff4f8]/45">Yönetici</div>
                  </div>
                </div>
                <nav className="space-y-1">
                  {[
                    { icon: LayoutGrid, label: 'Dashboard', active: true },
                    { icon: Users, label: 'Müşteriler' },
                    { icon: Package, label: 'Paketler' },
                    { icon: CalendarDays, label: 'Randevu' },
                    { icon: Wallet, label: 'Kasa' },
                    { icon: BarChart3, label: 'Raporlar' },
                    { icon: Crown, label: 'Personel' },
                  ].map((it, i) => (
                    <motion.div
                      key={it.label}
                      initial={{ opacity: 0, x: -6 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.2 + i * 0.04, duration: 0.4 }}
                      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] ${
                        it.active ? 'bg-gradient-to-r from-[#f0aac2]/18 to-transparent text-[#ffd3df]' : 'text-[#fff4f8]/55'
                      }`}
                    >
                      <it.icon className="h-3.5 w-3.5" />
                      {it.label}
                    </motion.div>
                  ))}
                </nav>
              </aside>

              {/* main panel */}
              <div className="min-w-0 p-3 sm:p-4">
                {/* top row */}
                <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#fff4f8]/45">Bugün · 16 Şubat</div>
                    <div className="mt-0.5 truncate font-display text-[15px] text-[#fff4f8] sm:text-[16px]">Hoş geldin, Özlem</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="grid h-7 w-7 place-items-center rounded-lg border border-[#fff4f8]/10 bg-[#fff4f8]/[0.03] text-[#fff4f8]/70">
                      <Search className="h-3 w-3" />
                    </button>
                    <button className="relative grid h-7 w-7 place-items-center rounded-lg border border-[#fff4f8]/10 bg-[#fff4f8]/[0.03] text-[#fff4f8]/70">
                      <Bell className="h-3 w-3" />
                      <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#f0aac2]" />
                    </button>
                  </div>
                </div>

                {/* KPI grid */}
                <div className="grid grid-cols-2 gap-2">
                  {kpis.map((k, i) => {
                    const Icon = k.icon
                    return (
                      <motion.div
                        key={k.label}
                        initial={{ opacity: 0, y: 12, scale: 0.96 }}
                        whileInView={{ opacity: 1, y: 0, scale: 1 }}
                        viewport={{ once: true, amount: 0.3 }}
                        transition={{ delay: 0.3 + i * 0.07, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                        className={`relative min-w-0 overflow-hidden rounded-xl border p-2.5 sm:p-3 ${
                          k.accent === 'rose'
                            ? 'border-[#f0aac2]/35 bg-gradient-to-br from-[#f0aac2]/12 via-[#160b12]/50 to-transparent'
                            : 'border-[#fff4f8]/10 bg-[#fff4f8]/[0.03]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`grid h-7 w-7 place-items-center rounded-lg border ${
                            k.accent === 'rose' ? 'border-[#f0aac2]/45 bg-[#f0aac2]/15 text-[#ffd3df]' : 'border-[#fff4f8]/12 bg-[#fff4f8]/[0.04] text-[#fff4f8]/75'
                          }`}>
                            <Icon className="h-3 w-3" />
                          </span>
                          <span className="truncate pl-1 font-mono text-[7.5px] uppercase tracking-[0.12em] text-[#fff4f8]/45 sm:text-[8px] sm:tracking-[0.18em]">{k.label}</span>
                        </div>
                        <div className="mt-2 truncate font-display text-[15px] leading-none text-[#fff4f8] sm:text-[18px]">
                          {k.prefix || ''}
                          <AnimatedCounter to={k.value} duration={1.4} />
                          {k.suffix && <span className="ml-1 text-[10px] text-[#fff4f8]/45">{k.suffix}</span>}
                        </div>
                      </motion.div>
                    )
                  })}
                </div>

                {/* mini chart */}
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ delay: 0.6, duration: 0.6 }}
                  className="mt-3 rounded-xl border border-[#fff4f8]/10 bg-[#fff4f8]/[0.03] p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[8px] uppercase tracking-[0.14em] text-[#fff4f8]/55 sm:text-[9px] sm:tracking-[0.2em]">Aylık tahsilat</span>
                    <span className="rounded-full bg-[#f0aac2]/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[#ffd3df]">+24% ↑</span>
                  </div>
                  <div className="flex h-14 items-end gap-1">
                    {chart.map((v, i) => (
                      <motion.div
                        key={i}
                        initial={{ height: 0 }}
                        whileInView={{ height: `${v}%` }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.7 + i * 0.04, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                        className="flex-1 rounded-sm bg-gradient-to-t from-[#f0aac2]/45 to-[#ffd3df]/85"
                      />
                    ))}
                  </div>
                </motion.div>

                {/* activity list */}
                <motion.div
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true, amount: 0.3 }}
                  variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.9 } } }}
                  className="mt-3 min-w-0 space-y-1.5"
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-[#fff4f8]/55 sm:text-[9px] sm:tracking-[0.2em]">Son hareketler</span>
                    <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-[#fff4f8]/40 sm:text-[9px] sm:tracking-[0.2em]">canlı</span>
                  </div>
                  {activity.map((a, i) => (
                    <motion.div
                      key={i}
                      variants={{ hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0, transition: { duration: 0.4 } } }}
                      className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-[#fff4f8]/8 bg-[#160b12]/55 px-2.5 py-1.5 text-[10px] sm:text-[11px]"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#fff4f8]/45">{a.t}</span>
                        <span className="truncate text-[#fff4f8]/82">{a.text}</span>
                      </div>
                      <span
                        className={`shrink-0 font-display text-[12px] ${
                          a.tone === 'pos' ? 'text-[#ffd3df]' : a.tone === 'warn' ? 'text-amber-300' : 'text-[#fff4f8]/70'
                        }`}
                      >
                        {a.amount}
                      </span>
                    </motion.div>
                  ))}
                </motion.div>
              </div>
            </div>
          </div>

          {/* floating accent — appointment hint */}
          <motion.div
            initial={{ opacity: 0, y: 18, rotate: -3 }}
            whileInView={{ opacity: 1, y: 0, rotate: -2 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ delay: 0.6, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none absolute -left-4 bottom-6 hidden w-56 rounded-2xl border border-[#f0aac2]/35 bg-gradient-to-br from-[#3a1a2a]/95 via-[#160b12]/85 to-[#1a0d15]/95 p-3.5 shadow-[0_30px_80px_rgba(0,0,0,0.5)] backdrop-blur-2xl lg:block"
          >
            <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.2em] text-[#ffd3df]">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="h-3 w-3" />
                Sıradaki randevu
              </span>
              <span className="text-[#fff4f8]/55">14:00</span>
            </div>
            <div className="mt-2 font-display text-[13px] text-[#fff4f8]">Beyza · Tüy sarartma</div>
            <div className="mt-1.5 flex items-center justify-between text-[10px]">
              <span className="text-[#fff4f8]/60">Aylin uygulayacak · oda 2</span>
              <span className="rounded-full bg-[#f0aac2]/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-[#ffd3df]">−1 seans</span>
            </div>
          </motion.div>

          {/* floating accent — payment toast */}
          <motion.div
            initial={{ opacity: 0, y: -16, rotate: 3 }}
            whileInView={{ opacity: 1, y: 0, rotate: 2 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ delay: 0.8, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none absolute -right-4 top-10 hidden w-52 rounded-2xl border border-[#fff4f8]/14 bg-gradient-to-br from-[#160b12]/95 via-[#1a0d15]/85 to-[#160b12]/95 p-3.5 shadow-[0_30px_80px_rgba(0,0,0,0.5)] backdrop-blur-2xl lg:block"
          >
            <div className="flex items-center justify-between">
              <span className="grid h-7 w-7 place-items-center rounded-lg border border-[#f0aac2]/40 bg-[#f0aac2]/15 text-[#ffd3df]">
                <CreditCard className="h-3 w-3" />
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#f0aac2]">tahsilat</span>
            </div>
            <div className="mt-2 font-display text-[14px] text-[#fff4f8]">+₺5.000</div>
            <div className="mt-0.5 text-[10px] text-[#fff4f8]/60">Selin Aksoy · 2. ödeme</div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
