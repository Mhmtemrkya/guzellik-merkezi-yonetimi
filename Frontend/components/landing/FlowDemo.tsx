'use client'

import { motion, useMotionValueEvent, useScroll, useSpring, useTransform } from 'framer-motion'
import { ArrowRight, CheckCircle2, CreditCard, Receipt, RotateCcw, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import AnimatedCounter from './AnimatedCounter'

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(min-width: 1024px)')
    const onChange = () => setIsDesktop(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return isDesktop
}

const steps = [
  { k: '01', title: 'Paket satışı',         badge: 'Paket · 50.000 TL',          icon: Sparkles },
  { k: '02', title: '1. ödeme · 20.000 TL', badge: '+20.000 TL · Nakit',         icon: CreditCard },
  { k: '03', title: '2. ödeme · 5.000 TL',  badge: '+5.000 TL · Kart',           icon: CreditCard },
  { k: '04', title: 'Kalan borç · 25.000',  badge: 'Ödenen 25.000 · Kalan 25.000', icon: Receipt },
  { k: '05', title: 'Yeniden taksitlendir', badge: '5 taksit ↻ · plan güncel',   icon: RotateCcw },
]

export default function FlowDemo() {
  const ref = useRef<HTMLDivElement | null>(null)
  const isDesktop = useIsDesktop()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const smoothed = useSpring(scrollYProgress, { damping: 24, stiffness: 110 })
  const [step, setStep] = useState(0)

  useMotionValueEvent(smoothed, 'change', (v) => {
    if (!isDesktop) return
    const idx = Math.min(steps.length - 1, Math.max(0, Math.floor(v * steps.length)))
    setStep(idx)
  })

  const paid = step === 0 ? 0 : step === 1 ? 20000 : step >= 2 ? 25000 : 0
  const remaining = 50000 - paid
  const newPlan = step >= 4

  return (
    <section ref={ref} id="flow" className="relative bg-[#160b12] lg:min-h-[500vh]">
      {/* DESKTOP (lg+) — sticky scroll-scrubbed flow */}
      <div className="sticky top-0 hidden h-screen items-center overflow-hidden lg:flex">
        <div className="pointer-events-none absolute inset-0 aurora-soft" />
        <div className="pointer-events-none absolute inset-0 bg-grid" />

        <div className="relative mx-auto grid w-full max-w-7xl items-center gap-8 px-5 sm:px-8 lg:grid-cols-[5fr_7fr] lg:gap-10 lg:px-12">
          {/* LEFT — compact step list */}
          <div className="flex max-h-full flex-col">
            <motion.span
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55 }}
              className="eyebrow mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-[#f0aac2]/35 bg-[#160b12]/55 px-3 py-1.5 text-[#ffd3df] backdrop-blur-xl"
            >
              Esnek tahsilat
            </motion.span>

            <h2 className="hero-title text-[clamp(1.6rem,2.6vw,2.6rem)] text-[#fff4f8]">
              50.000 TL paket.{' '}
              <span className="serif-italic text-[#fff4f8]/55">Düzensiz ödeme.</span>{' '}
              <br className="hidden md:block" />
              <span className="beautyassist-text-gradient">Sistem dengeyi koruyor.</span>
            </h2>

            <p className="mt-3 max-w-md text-[13px] leading-relaxed text-[#fff4f8]/68">
              Aşağı kaydırın — paket satışı, kısmi ödeme ve yeniden taksitlendirmeyi canlı izleyin.
            </p>

            <div className="mt-5 space-y-2">
              {steps.map((s, i) => {
                const Icon = s.icon
                const isActive = i === step
                const isDone = i < step
                return (
                  <motion.button
                    key={s.k}
                    type="button"
                    onClick={() => {
                      if (!ref.current) return
                      const el = ref.current
                      const total = el.getBoundingClientRect().height - window.innerHeight
                      const ratio = (i + 0.4) / steps.length
                      const target = el.offsetTop + total * ratio
                      if (window.__lenis) window.__lenis.scrollTo(target, { duration: 1.2 })
                      else window.scrollTo({ top: target, behavior: 'smooth' })
                    }}
                    animate={{ opacity: isActive ? 1 : isDone ? 0.82 : 0.5, x: isActive ? 4 : 0 }}
                    transition={{ duration: 0.4 }}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left backdrop-blur-xl ${
                      isActive
                        ? 'border-[#f0aac2]/55 bg-gradient-to-r from-[#3a1a2a]/80 via-[#160b12]/55 to-transparent shadow-[0_14px_40px_rgba(240,170,194,0.18)]'
                        : 'border-[#fff4f8]/10 bg-[#160b12]/45 hover:border-[#f0aac2]/30'
                    }`}
                  >
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${
                        isActive ? 'border-[#f0aac2]/55 bg-[#f0aac2]/15 text-[#ffd3df]' : 'border-[#fff4f8]/15 bg-[#fff4f8]/5 text-[#fff4f8]/60'
                      }`}
                    >
                      {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-display text-[14px] text-[#fff4f8]">
                          <span className="text-[#f0aac2]/85">{s.k}</span> · {s.title}
                        </div>
                        <ArrowRight className={`h-3 w-3 shrink-0 transition ${isActive ? 'text-[#ffd3df] translate-x-0.5' : 'text-[#fff4f8]/30'}`} />
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-[#fff4f8]/52">
                        {s.badge}
                      </div>
                    </div>
                  </motion.button>
                )
              })}
            </div>
          </div>

          {/* RIGHT — customer card */}
          <div className="relative">
            <motion.div
              initial={{ opacity: 0, y: 22, scale: 0.96 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="relative rounded-3xl border border-[#fff4f8]/14 bg-gradient-to-br from-[#1f1018]/85 via-[#160b12]/72 to-[#1a0d15]/85 p-5 shadow-[0_36px_90px_rgba(0,0,0,0.5)] backdrop-blur-2xl"
            >
              <div className="flex items-center justify-between border-b border-[#fff4f8]/10 pb-3">
                <div>
                  <div className="eyebrow text-[#fff4f8]/52">Müşteri kartı</div>
                  <div className="mt-0.5 font-display text-base text-[#fff4f8]">Selin Aksoy</div>
                </div>
                <span className="rounded-full border border-[#f0aac2]/40 bg-[#f0aac2]/12 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[#ffd3df]">
                  Aktif Paket
                </span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2.5">
                <div className="rounded-xl border border-[#fff4f8]/10 bg-[#fff4f8]/[0.04] p-3">
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#fff4f8]/50">Paket</div>
                  <div className="beautyassist-text-gradient mt-1 font-display text-xl leading-none">
                    ₺<AnimatedCounter to={50000} duration={1.2} />
                  </div>
                </div>
                <div className="rounded-xl border border-[#fff4f8]/10 bg-[#fff4f8]/[0.04] p-3">
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#fff4f8]/50">Ödenen</div>
                  <motion.div key={`paid-${paid}`} initial={{ scale: 0.92, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} className="mt-1 font-display text-xl leading-none text-[#fff4f8]">
                    ₺{paid.toLocaleString('tr-TR')}
                  </motion.div>
                </div>
                <div className="rounded-xl border border-[#f0aac2]/35 bg-gradient-to-br from-[#f0aac2]/15 via-[#160b12]/60 to-transparent p-3">
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#ffd3df]/85">Kalan</div>
                  <motion.div key={`rem-${remaining}`} initial={{ scale: 0.92, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} className="mt-1 font-display text-xl leading-none text-[#ffd3df]">
                    ₺{remaining.toLocaleString('tr-TR')}
                  </motion.div>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-1.5 flex justify-between font-mono text-[9px] uppercase tracking-[0.22em] text-[#fff4f8]/50">
                  <span>Ödeme ilerlemesi</span>
                  <span>{Math.round((paid / 50000) * 100)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[#fff4f8]/8">
                  <motion.div
                    style={{ width: `${(paid / 50000) * 100}%` }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    className="h-full rounded-full bg-gradient-to-r from-[#f0aac2] via-[#ffd3df] to-[#fff4f8]"
                  />
                </div>
              </div>

              <div className="mt-4 space-y-1.5">
                <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#fff4f8]/50">Ödeme geçmişi</div>
                <motion.div
                  initial={false}
                  animate={{ opacity: step >= 1 ? 1 : 0.2, x: step >= 1 ? 0 : -8 }}
                  transition={{ duration: 0.5 }}
                  className="flex items-center justify-between rounded-lg border border-[#fff4f8]/8 bg-[#fff4f8]/[0.03] px-3 py-1.5 text-[11px] text-[#fff4f8]/85"
                >
                  <span>1. ödeme · Nakit</span>
                  <span className="font-display text-[#ffd3df]">+₺20.000</span>
                </motion.div>
                <motion.div
                  initial={false}
                  animate={{ opacity: step >= 2 ? 1 : 0.2, x: step >= 2 ? 0 : -8 }}
                  transition={{ duration: 0.5 }}
                  className="flex items-center justify-between rounded-lg border border-[#fff4f8]/8 bg-[#fff4f8]/[0.03] px-3 py-1.5 text-[11px] text-[#fff4f8]/85"
                >
                  <span>2. ödeme · Kart</span>
                  <span className="font-display text-[#ffd3df]">+₺5.000</span>
                </motion.div>
              </div>

              <motion.div
                initial={false}
                animate={{ opacity: newPlan ? 1 : 0, y: newPlan ? 0 : 10 }}
                transition={{ duration: 0.5 }}
                className="mt-4 rounded-xl border border-[#f0aac2]/40 bg-gradient-to-r from-[#f0aac2]/15 via-[#160b12]/55 to-transparent p-3"
              >
                <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.22em] text-[#ffd3df]">
                  <span className="flex items-center gap-2">
                    <RotateCcw className="h-3 w-3" />
                    Yeni plan oluştu
                  </span>
                  <span>otomatik</span>
                </div>
                <div className="mt-2 grid grid-cols-5 gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <motion.div
                      key={n}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: newPlan ? 1 : 0, y: 0 }}
                      transition={{ delay: 0.12 + n * 0.06, duration: 0.4 }}
                      className="rounded-lg border border-[#fff4f8]/10 bg-[#160b12]/60 py-1.5 text-center"
                    >
                      <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#fff4f8]/55">{n}. tk</div>
                      <div className="mt-0.5 font-display text-[11px] text-[#fff4f8]">₺5.000</div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* MOBILE / TABLET (<lg) — normal-flow stepper + final card */}
      <FlowDemoMobile />
    </section>
  )
}

function FlowDemoMobile() {
  return (
    <div className="relative overflow-hidden lg:hidden">
      <div className="pointer-events-none absolute inset-0 aurora-soft" />
      <div className="pointer-events-none absolute inset-0 bg-grid" />

      <div className="relative mx-auto max-w-2xl space-y-10 px-5 py-20 sm:px-8">
        {/* Intro */}
        <div>
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.55 }}
            className="eyebrow inline-flex w-fit items-center gap-2 rounded-full border border-[#f0aac2]/35 bg-[#160b12]/55 px-3 py-1.5 text-[#ffd3df] backdrop-blur-xl"
          >
            Esnek tahsilat
          </motion.span>

          <motion.h2
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.65, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
            className="hero-title mt-4 text-[clamp(1.8rem,7vw,2.4rem)] text-[#fff4f8]"
          >
            50.000 TL paket.{' '}
            <span className="serif-italic text-[#fff4f8]/55">Düzensiz ödeme.</span>{' '}
            <br />
            <span className="beautyassist-text-gradient">Sistem dengeyi koruyor.</span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="mt-3 max-w-md text-[15px] leading-relaxed text-[#fff4f8]/72"
          >
            Paket satışı, kısmi ödeme ve yeniden taksitlendirme — her adım sırayla, kayıp yok.
          </motion.p>
        </div>

        {/* Vertical timeline */}
        <ol className="relative space-y-3 border-l border-[#f0aac2]/22 pl-5">
          {steps.map((s, i) => {
            const Icon = s.icon
            return (
              <motion.li
                key={s.k}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.35 }}
                transition={{ duration: 0.5, delay: i * 0.06 }}
                className="relative"
              >
                <span className="absolute -left-[27px] top-4 grid h-4 w-4 place-items-center rounded-full border border-[#f0aac2]/55 bg-[#160b12] shadow-[0_0_0_4px_#160b12]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#f0aac2]" />
                </span>
                <div className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-[#fff4f8]/10 bg-[#160b12]/55 p-3.5 backdrop-blur-xl">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[#f0aac2]/40 bg-[#f0aac2]/12 text-[#ffd3df]">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[15px] text-[#fff4f8]">
                      <span className="text-[#f0aac2]/85">{s.k}</span> · {s.title}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-[#fff4f8]/55">
                      {s.badge}
                    </div>
                  </div>
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#f0aac2]/55" aria-hidden />
                </div>
              </motion.li>
            )
          })}
        </ol>

        {/* Final customer card */}
        <motion.div
          initial={{ opacity: 0, y: 22, scale: 0.96 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="relative rounded-3xl border border-[#fff4f8]/14 bg-gradient-to-br from-[#1f1018]/85 via-[#160b12]/72 to-[#1a0d15]/85 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.5)] backdrop-blur-2xl"
        >
          <div className="flex items-center justify-between border-b border-[#fff4f8]/10 pb-3">
            <div>
              <div className="eyebrow text-[#fff4f8]/52">Müşteri kartı</div>
              <div className="mt-0.5 font-display text-base text-[#fff4f8]">Selin Aksoy</div>
            </div>
            <span className="rounded-full border border-[#f0aac2]/40 bg-[#f0aac2]/12 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[#ffd3df]">
              Aktif Paket
            </span>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2.5">
            <div className="rounded-xl border border-[#fff4f8]/10 bg-[#fff4f8]/[0.04] p-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#fff4f8]/50">Paket</div>
              <div className="beautyassist-text-gradient mt-1 font-display text-lg leading-none">₺50.000</div>
            </div>
            <div className="rounded-xl border border-[#fff4f8]/10 bg-[#fff4f8]/[0.04] p-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#fff4f8]/50">Ödenen</div>
              <div className="mt-1 font-display text-lg leading-none text-[#fff4f8]">₺25.000</div>
            </div>
            <div className="rounded-xl border border-[#f0aac2]/35 bg-gradient-to-br from-[#f0aac2]/15 via-[#160b12]/60 to-transparent p-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#ffd3df]/85">Kalan</div>
              <div className="mt-1 font-display text-lg leading-none text-[#ffd3df]">₺25.000</div>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex justify-between font-mono text-[9px] uppercase tracking-[0.22em] text-[#fff4f8]/50">
              <span>Ödeme ilerlemesi</span>
              <span>50%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#fff4f8]/8">
              <motion.div
                initial={{ width: 0 }}
                whileInView={{ width: '50%' }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                className="h-full rounded-full bg-gradient-to-r from-[#f0aac2] via-[#ffd3df] to-[#fff4f8]"
              />
            </div>
          </div>

          <div className="mt-4 space-y-1.5">
            <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#fff4f8]/50">Ödeme geçmişi</div>
            <div className="flex items-center justify-between rounded-lg border border-[#fff4f8]/8 bg-[#fff4f8]/[0.03] px-3 py-1.5 text-[12px] text-[#fff4f8]/85">
              <span>1. ödeme · Nakit</span>
              <span className="font-display text-[#ffd3df]">+₺20.000</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-[#fff4f8]/8 bg-[#fff4f8]/[0.03] px-3 py-1.5 text-[12px] text-[#fff4f8]/85">
              <span>2. ödeme · Kart</span>
              <span className="font-display text-[#ffd3df]">+₺5.000</span>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-[#f0aac2]/40 bg-gradient-to-r from-[#f0aac2]/15 via-[#160b12]/55 to-transparent p-3">
            <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.22em] text-[#ffd3df]">
              <span className="flex items-center gap-2">
                <RotateCcw className="h-3 w-3" />
                Yeni plan oluştu
              </span>
              <span>otomatik</span>
            </div>
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <motion.div
                  key={n}
                  initial={{ opacity: 0, y: 6 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ delay: 0.1 + n * 0.05, duration: 0.4 }}
                  className="rounded-lg border border-[#fff4f8]/10 bg-[#160b12]/60 py-1.5 text-center"
                >
                  <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#fff4f8]/55">{n}. tk</div>
                  <div className="mt-0.5 font-display text-[11px] text-[#fff4f8]">₺5.000</div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
