'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, BookOpenText, Check, HelpCircle, X } from 'lucide-react'
import { resolveGuide } from '@/lib/guideContent'
import { adminApi } from '@/lib/apiClient'
import { useAuth } from './AuthContext'

// "Görüldü" kayıtları KULLANICI bazlıdır (v2): aynı tarayıcıdan başka bir hesap
// girince kılavuz ona baştan gösterilir. Ayrıca platform admin kurum için
// "kılavuzu sıfırla" dediğinde sunucudaki resetAt değişir; yereldeki onaydan
// (ack) farklıysa tüm görüldü kayıtları temizlenir → kılavuz yeniden açılır.
const seenKey = (uid: string): string => `beautyasist.guide.seen.v2.${uid}`
const skipAllKey = (uid: string): string => `beautyasist.guide.skipAll.v2.${uid}`
const resetAckKey = (uid: string): string => `beautyasist.guide.resetAck.v2.${uid}`

function readSeen(uid: string): string[] {
  try {
    const raw = window.localStorage.getItem(seenKey(uid))
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

function markSeen(uid: string, key: string): void {
  try {
    const seen = readSeen(uid)
    if (!seen.includes(key)) {
      window.localStorage.setItem(seenKey(uid), JSON.stringify([...seen, key]))
    }
  } catch {
    /* storage kapalıysa sessizce geç */
  }
}

function isSkipAll(uid: string): boolean {
  try {
    return window.localStorage.getItem(skipAllKey(uid)) === '1'
  } catch {
    return false
  }
}

/** Sunucudaki sıfırlama yereldekinden yeniyse tüm görüldü kayıtlarını temizler. */
function applyServerReset(uid: string, resetAtUtc: string | null | undefined): void {
  if (!resetAtUtc) return
  try {
    if (window.localStorage.getItem(resetAckKey(uid)) === resetAtUtc) return
    window.localStorage.removeItem(seenKey(uid))
    window.localStorage.removeItem(skipAllKey(uid))
    window.localStorage.setItem(resetAckKey(uid), resetAtUtc)
  } catch {
    /* yut */
  }
}

function normalizeTr(text: string): string {
  return text.toLocaleLowerCase('tr-TR').replace(/[()&·—-]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Adımın hedef bölümünü bulur.
 * 1) Öncelik: adımın açık `anchor`'ı → sayfadaki [data-guide="<anchor>"] öğesi (kesin hedef).
 * 2) Yedek: SADECE içerik alanındaki başlıklarda (h1-h4) tam kapsama eşleşmesi.
 *    Güvenli eşleşme yoksa null döner — yanlış yer vurgulamaktansa spot gösterilmez.
 */
function findAnchorElement(stepTitle: string, anchor?: string): HTMLElement | null {
  if (anchor) {
    const el = document.querySelector<HTMLElement>(`[data-guide="${anchor}"]`)
    if (el && (el.offsetParent || el.getClientRects().length > 0)) return el
    return null
  }

  const title = normalizeTr(stepTitle)
  if (title.length < 5) return null

  const headings = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3, h4')).filter((el) => {
    // Navigasyon/sidebar/topbar ve sabit katmanlardaki başlıklar hedef olamaz.
    if (el.closest('aside, nav, header, [data-guide-ignore]')) return false
    if (!el.offsetParent && el.getClientRects().length === 0) return false
    const text = normalizeTr(el.innerText || '')
    return text.length >= 5 && text.length < 90
  })

  let best: HTMLElement | null = null
  let bestScore = 0
  for (const el of headings) {
    const text = normalizeTr(el.innerText || '')
    // Yalnızca güçlü eşleşme: biri diğerini tamamen kapsıyor ve uzunluklar makul oranda.
    const contains = text.includes(title) || title.includes(text)
    if (!contains) continue
    const ratio = Math.min(text.length, title.length) / Math.max(text.length, title.length)
    if (ratio < 0.45) continue
    const score = 100 + Math.round(ratio * 50)
    if (score > bestScore) {
      bestScore = score
      best = el
    }
  }
  if (!best) return null
  const card = best.closest<HTMLElement>('section, [class*="rounded-["]')
  return card && card.getBoundingClientRect().height < window.innerHeight * 0.85 ? card : best
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

/**
 * Sayfa kullanım kılavuzu — rehber tur: kart ekranın altına sabitlenir,
 * her adımda ilgili bölüme kaydırıp bölgeyi spot ışığıyla vurgular.
 * İlk girişte otomatik açılır; "Atla" otomatik gösterimi tamamen kapatır.
 */
export default function PageGuide() {
  const pathname = usePathname()
  const { user } = useAuth()
  const uid = user?.userId || user?.email || 'anon'
  const resolved = useMemo(() => resolveGuide(pathname), [pathname])
  const [open, setOpen] = useState<boolean>(false)
  const [step, setStep] = useState<number>(0)
  const [spot, setSpot] = useState<Rect | null>(null)
  const [mounted, setMounted] = useState(false)
  const [resetChecked, setResetChecked] = useState(false)
  const anchorRef = useRef<HTMLElement | null>(null)

  useEffect(() => setMounted(true), [])

  // Sunucu taraflı kılavuz sıfırlaması: platform admin kurum için sıfırladıysa
  // yerel görüldü kayıtları temizlenir (yalnız tenant kullanıcılarında sorulur).
  useEffect(() => {
    let alive = true
    const isTenantUser = Boolean(user) && user?.role !== 'PlatformAdmin'
    if (!isTenantUser) {
      setResetChecked(true)
      return
    }
    adminApi
      .tenantGuideReset<{ resetAtUtc?: string | null }>()
      .then((res) => {
        if (!alive) return
        applyServerReset(uid, res?.resetAtUtc)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setResetChecked(true)
      })
    return () => {
      alive = false
    }
  }, [uid, user])

  // Sayfaya ilk girişte otomatik aç (sıfırlama kontrolü bittikten sonra)
  useEffect(() => {
    if (!resolved || !resetChecked) return
    if (isSkipAll(uid)) return
    if (readSeen(uid).includes(resolved.key)) return
    const t = setTimeout(() => {
      setStep(0)
      setOpen(true)
    }, 800)
    return () => clearTimeout(t)
  }, [resolved, resetChecked, uid])

  const close = useCallback(
    (skipAll = false) => {
      setOpen(false)
      setSpot(null)
      anchorRef.current = null
      if (resolved) markSeen(uid, resolved.key)
      if (skipAll) {
        try {
          window.localStorage.setItem(skipAllKey(uid), '1')
        } catch {
          /* yut */
        }
      }
    },
    [resolved, uid],
  )

  // Adım değişince ilgili bölümü bul, kaydır ve spot ışığını konumlandır.
  useEffect(() => {
    if (!open || !resolved) return
    const current = resolved.guide.steps[Math.min(step, resolved.guide.steps.length - 1)]
    if (!current) return

    const el = findAnchorElement(current.title, current.anchor)
    anchorRef.current = el
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })

    let raf = 0
    const measure = (): void => {
      const target = anchorRef.current
      if (!target) {
        setSpot(null)
        return
      }
      const r = target.getBoundingClientRect()
      setSpot({ top: r.top - 8, left: r.left - 8, width: r.width + 16, height: r.height + 16 })
    }
    // Smooth scroll bitene kadar ölçümü tazele.
    const tick = (): void => {
      measure()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const stop = setTimeout(() => cancelAnimationFrame(raf), 900)

    const onScroll = (): void => measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(stop)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, step, resolved])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') close()
      if (event.key === 'ArrowRight') setStep((s) => Math.min((resolved?.guide.steps.length ?? 1) - 1, s + 1))
      if (event.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, close, resolved])

  if (!resolved) return null

  const { guide } = resolved
  const total = guide.steps.length
  const current = guide.steps[Math.min(step, total - 1)]!
  const isLast = step >= total - 1
  const Icon = current.icon
  const progress = ((step + 1) / total) * 100

  return (
    <>
      {/* NAVBAR TETİKLEYİCİ */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.92 }}
        onClick={() => {
          setStep(0)
          setOpen(true)
        }}
        aria-label="Bu sayfanın kullanım kılavuzunu aç"
        title="Sayfa kılavuzu"
        className="group relative grid min-h-10 min-w-10 place-items-center overflow-hidden rounded-2xl border border-[#ead8df]/80 bg-white/82 text-[#7c6170] shadow-[0_14px_32px_-28px_rgba(150,78,104,0.45)] transition-colors hover:border-[#ef9ab5] hover:text-[#c85776]"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#ffdce8]/65 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        />
        <HelpCircle className="relative z-10 h-3.5 w-3.5" strokeWidth={1.6} />
      </motion.button>

      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
          <>
            {/* SPOT IŞIĞI — hedef bölge aydınlık kalır, kalan alan kararır */}
            {spot ? (
              <motion.div
                key="guide-spot"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                aria-hidden
                className="pointer-events-none fixed z-[290] rounded-[20px] border-2 border-[#ef6f94] shadow-[0_0_0_9999px_rgba(58,28,45,0.45)]"
                style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
              />
            ) : (
              <motion.div
                key="guide-dim"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                aria-hidden
                className="pointer-events-none fixed inset-0 z-[290] bg-[#3a1c2d]/30"
              />
            )}

            {/* ALTA SABİT REHBER KARTI */}
            <motion.div
              key="guide-card"
              initial={{ opacity: 0, y: 60 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="fixed inset-x-3 bottom-3 z-[300] mx-auto max-w-xl overflow-hidden rounded-[24px] border border-[#ead8df] bg-white/98 shadow-[0_30px_90px_-30px_rgba(150,78,104,0.55)] backdrop-blur-xl sm:inset-x-6 sm:bottom-5"
            >
              {/* İlerleme çubuğu */}
              <div className="relative h-1 bg-[#f6e6ec]">
                <motion.span
                  className="absolute inset-y-0 left-0 rounded-r-full bg-gradient-to-r from-[#f7b6cb] via-[#ef6f94] to-[#d65f83]"
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>

              <div className="px-5 pb-3.5 pt-4">
                <div className="flex items-start gap-3">
                  <motion.span
                    key={`icon-${step}`}
                    initial={{ scale: 0.6, rotate: -12 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 20 }}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#efbfd0] bg-gradient-to-br from-[#fff1f6] to-[#ffe1ea] text-[#c85776]"
                  >
                    <Icon className="h-5 w-5" strokeWidth={1.7} />
                  </motion.span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-widest text-[#c85776]">
                        <BookOpenText className="h-3 w-3" strokeWidth={1.8} />
                        {guide.title} · Adım {step + 1}/{total}
                      </div>
                      <button
                        type="button"
                        onClick={() => close()}
                        aria-label="Kılavuzu kapat"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-xl text-[#9d7386] transition-colors hover:bg-[#fff1f6] hover:text-[#c85776]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={step}
                        initial={{ opacity: 0, x: 18 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -14 }}
                        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <h3 className="mt-0.5 text-[14.5px] font-semibold leading-snug text-[#352432]">
                          {current.title}
                        </h3>
                        <p className="mt-1 max-h-28 overflow-y-auto text-[12px] leading-relaxed text-[#5f4855]">
                          {current.desc}
                        </p>
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>

                {/* Alt aksiyonlar */}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => close(true)}
                    className="text-[10.5px] font-semibold text-[#9d7386] transition-colors hover:text-[#c85776]"
                  >
                    Atla — bir daha gösterme
                  </button>
                  <div className="flex items-center gap-1.5">
                    {/* Nokta navigasyonu */}
                    <div className="mr-1.5 hidden items-center gap-1 sm:flex">
                      {guide.steps.map((s, i) => (
                        <button
                          key={`${s.title}-${i}`}
                          type="button"
                          onClick={() => setStep(i)}
                          aria-label={`${i + 1}. adıma git`}
                          className="grid h-4 place-items-center"
                        >
                          <span
                            className={`h-1.5 rounded-full transition-all ${
                              i === step ? 'w-4 bg-[#ef6f94]' : i < step ? 'w-1.5 bg-[#f0aac2]' : 'w-1.5 bg-[#ecd7de]'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                    {step > 0 && (
                      <button
                        type="button"
                        onClick={() => setStep((s) => Math.max(0, s - 1))}
                        className="inline-flex min-h-9 items-center gap-1 rounded-xl border border-[#ead8df] bg-white px-3 text-[11.5px] font-semibold text-[#7c6170] transition-colors hover:border-[#ef9ab5] hover:text-[#c85776]"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" /> Geri
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => (isLast ? close() : setStep((s) => Math.min(total - 1, s + 1)))}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#ef6f94] to-[#d65f83] px-4 text-[11.5px] font-semibold text-white shadow-[0_12px_26px_-14px_rgba(214,95,131,0.75)] transition-opacity hover:opacity-92"
                    >
                      {isLast ? (
                        <>
                          Anladım <Check className="h-3.5 w-3.5" />
                        </>
                      ) : (
                        <>
                          İleri <ArrowRight className="h-3.5 w-3.5" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  )
}
