'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Clock, Eye, EyeOff, KeyRound, Loader2, Lock, Mail, ShieldCheck, Sparkles } from 'lucide-react'
import { authApi, getStoredSession, storeSession } from '@/lib/apiClient'
import type { AuthSession } from '@/lib/types'

/** Sağ üst dekoratif kilit illüstrasyonu — yapraklar + parıltılar arasında pembe asma kilit. */
function LockIllustration() {
  return (
    <motion.div
      aria-hidden
      animate={{ y: [0, -6, 0] }}
      transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      className="relative hidden h-28 w-28 shrink-0 sm:block"
    >
      <span className="absolute inset-3 rounded-full bg-[#f7b9cc]/45 blur-2xl" />
      {/* yapraklar */}
      <svg viewBox="0 0 112 112" className="absolute inset-0 h-full w-full" fill="none">
        <path d="M22 84 C9 70 22 52 44 56 C41 74 34 86 22 84 Z" fill="#cfe0bd" fillOpacity="0.9" />
        <path d="M92 80 C104 65 90 47 69 53 C73 71 81 82 92 80 Z" fill="#d9e8c9" fillOpacity="0.9" />
      </svg>
      {/* asma kilit */}
      <div className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[20px] bg-gradient-to-br from-[#fbc6d7] via-[#f1a3bf] to-[#e07fa1] shadow-[0_18px_38px_-14px_rgba(224,127,161,0.75)]">
        <span className="pointer-events-none absolute inset-0 rounded-[20px] bg-gradient-to-tr from-transparent via-white/25 to-white/45" />
        <span className="absolute -top-[15px] h-6 w-9 rounded-t-full border-[3px] border-b-0 border-[#ecaac3]" />
        <span className="relative flex flex-col items-center">
          <span className="h-[14px] w-[14px] rounded-full bg-white/90 shadow-inner" />
          <span className="-mt-[3px] h-[11px] w-[6px] rounded-b-full bg-white/90" />
        </span>
      </div>
      <Sparkles className="absolute right-0 top-1 h-4 w-4 text-[#f2b3c8]" strokeWidth={1.6} />
      <Sparkles className="absolute left-1 top-8 h-3 w-3 text-[#f8cdda]" strokeWidth={1.6} />
      <Sparkles className="absolute bottom-3 right-6 h-2.5 w-2.5 text-[#f4bccd]" strokeWidth={1.6} />
    </motion.div>
  )
}

function Requirement({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors ${
          ok ? 'bg-[#e98bab] text-white' : 'bg-white text-[#dcc2cc] ring-1 ring-[#f0d6df]'
        }`}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
      <span className={`text-[12.5px] transition-colors ${ok ? 'text-[#6b5560]' : 'text-[#a8949d]'}`}>{label}</span>
    </div>
  )
}

const STRENGTH_LEVELS = [
  { label: 'Çok zayıf', color: '#e0617f' },
  { label: 'Çok zayıf', color: '#e0617f' },
  { label: 'Zayıf', color: '#e67d72' },
  { label: 'Orta', color: '#e2a13f' },
  { label: 'İyi', color: '#7bb36a' },
  { label: 'Güçlü', color: '#3fae73' },
] as const

const fieldWrap =
  'flex items-center gap-3 rounded-2xl border border-[#f1d7df] bg-white px-4 transition-all focus-within:border-[#e89bb4] focus-within:shadow-[0_0_0_4px_rgba(232,155,180,0.16)]'
const inputCls =
  'min-h-[52px] w-full bg-transparent text-[14px] text-[#4a2f3c] outline-none placeholder:text-[#cbb7c0]'
const labelCls =
  'mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#a4909a]'
const eyeBtn = 'shrink-0 text-[#cf86a0] transition-colors hover:text-[#d9799a]'

export default function ChangePasswordPage() {
  const router = useRouter()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [newPwd2, setNewPwd2] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const s = getStoredSession()
    if (!s) {
      router.replace('/login')
      return
    }
    setSession(s)
  }, [router])

  const req = {
    length: newPwd.length >= 8,
    lower: /[a-z]/.test(newPwd),
    upper: /[A-Z]/.test(newPwd),
    numSpecial: /\d/.test(newPwd) && /[^A-Za-z0-9]/.test(newPwd),
  }
  const allOk = req.length && req.lower && req.upper && req.numSpecial

  let score = 0
  if (newPwd.length >= 8) score++
  if (newPwd.length >= 12) score++
  if (/[a-z]/.test(newPwd) && /[A-Z]/.test(newPwd)) score++
  if (/\d/.test(newPwd)) score++
  if (/[^A-Za-z0-9]/.test(newPwd)) score++
  const level = STRENGTH_LEVELS[score]

  const goToDashboard = (): void => {
    const role = session?.user?.role
    if (role === 'PlatformAdmin') router.replace('/platform')
    else if (role === 'Staff') router.replace('/personel')
    else router.replace('/admin')
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')
    if (!allOk) {
      setError('Yeni şifre aşağıdaki tüm güvenlik koşullarını karşılamalıdır.')
      return
    }
    if (newPwd !== newPwd2) {
      setError('Yeni şifre tekrarı uyuşmuyor.')
      return
    }
    if (currentPwd && currentPwd === newPwd) {
      setError('Yeni şifre, geçici şifreyle aynı olamaz.')
      return
    }
    setBusy(true)
    try {
      await authApi.changePassword(currentPwd, newPwd)
      setSuccess(true)
      if (session) {
        const updated: AuthSession = {
          ...session,
          user: { ...session.user, mustChangePassword: false },
        }
        storeSession(updated)
      }
      setTimeout(goToDashboard, 1200)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Şifre değiştirilemedi.')
    } finally {
      setBusy(false)
    }
  }

  if (!session) return null

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#fbe4ec] px-4 py-10 text-[#4a2f3c]">
      {/* yumuşak pembe arka plan + ince kıvrımlar */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(900px_520px_at_15%_-12%,rgba(255,226,237,0.95),transparent_60%),radial-gradient(820px_560px_at_88%_115%,rgba(248,206,221,0.85),transparent_58%)]" />
        <svg className="absolute inset-0 h-full w-full opacity-60" preserveAspectRatio="none" viewBox="0 0 1440 900" fill="none">
          <path d="M-100 720 C 300 600 700 880 1540 560" stroke="#f8d4e0" strokeWidth="1.5" />
          <path d="M-100 820 C 360 700 760 980 1540 660" stroke="#fadfe8" strokeWidth="1.5" />
        </svg>
      </div>

      <div className="relative z-10 flex min-h-screen items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[640px] rounded-[34px] border border-[#f6e2e9] bg-white/95 p-8 shadow-[0_50px_120px_-50px_rgba(180,110,140,0.5)] backdrop-blur-sm sm:p-11"
        >
          {/* başlık + dekoratif kilit */}
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#dd7e9d]">İlk Giriş</div>
              <h1 className="mt-2.5 font-display text-[34px] leading-[1.05] tracking-tight text-[#4a2f3c]">
                Şifreni Değiştir
              </h1>
              <p className="mt-3 max-w-md text-[13.5px] leading-relaxed text-[#9a8791]">
                Güvenliğin için, sisteme devam edebilmek adına aşağıdaki alanlardan yeni şifrenizi oluşturmanız
                gerekmektedir.
              </p>
            </div>
            <LockIllustration />
          </div>

          <form onSubmit={handleSubmit} className="mt-7 space-y-5">
            {/* e-posta (salt okunur) */}
            <div className={fieldWrap}>
              <Mail className="h-4 w-4 shrink-0 text-[#d9799a]" strokeWidth={1.7} />
              <span className="min-h-[52px] flex-1 truncate text-[14px] leading-[52px] text-[#d9799a]">
                {session.user.email}
              </span>
            </div>

            {/* mevcut (geçici) şifre */}
            <div>
              <label className={labelCls}>
                <KeyRound className="h-3.5 w-3.5 text-[#d9799a]" strokeWidth={1.9} /> Mevcut (Geçici) Şifre
              </label>
              <div className={fieldWrap}>
                <input
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPwd}
                  onChange={(e) => setCurrentPwd(e.target.value)}
                  autoFocus
                  required
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent((v) => !v)}
                  aria-label={showCurrent ? 'Şifreyi gizle' : 'Şifreyi göster'}
                  className={eyeBtn}
                  tabIndex={-1}
                >
                  {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* yeni şifre */}
            <div>
              <label className={labelCls}>
                <ShieldCheck className="h-3.5 w-3.5 text-[#d9799a]" strokeWidth={1.9} /> Yeni Şifre
              </label>
              <div className={fieldWrap}>
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="••••••••••"
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  aria-label={showNew ? 'Şifreyi gizle' : 'Şifreyi göster'}
                  className={eyeBtn}
                  tabIndex={-1}
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              <AnimatePresence>
                {newPwd.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-2.5 flex items-center gap-3">
                      <span className="shrink-0 whitespace-nowrap text-[11.5px] text-[#9a8791]">
                        Şifre gücü:{' '}
                        <span className="font-semibold" style={{ color: level.color }}>
                          {level.label}
                        </span>
                      </span>
                      <div className="flex flex-1 gap-1.5">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <span
                            key={i}
                            className={`h-1.5 flex-1 rounded-full transition-colors ${
                              i < score ? 'bg-gradient-to-r from-[#f4a9c0] to-[#e87fa0]' : 'bg-[#f2e3e9]'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* yeni şifre (tekrar) */}
            <div>
              <label className={labelCls}>
                <ShieldCheck className="h-3.5 w-3.5 text-[#d9799a]" strokeWidth={1.9} /> Yeni Şifre (Tekrar)
              </label>
              <div className={fieldWrap}>
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={newPwd2}
                  onChange={(e) => setNewPwd2(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="••••••••••"
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  aria-label={showConfirm ? 'Şifreyi gizle' : 'Şifreyi göster'}
                  className={eyeBtn}
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <AnimatePresence>
                {newPwd2.length > 0 && newPwd !== newPwd2 && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="mt-1.5 text-[11px] text-[#e0617f]"
                  >
                    Şifreler uyuşmuyor.
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* gereksinim listesi */}
            <div className="rounded-2xl border border-[#f4dbe4] bg-[#fdeef3] px-5 py-4">
              <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <Requirement ok={req.length} label="En az 8 karakter" />
                <Requirement ok={req.lower} label="En az 1 küçük harf" />
                <Requirement ok={req.upper} label="En az 1 büyük harf" />
                <Requirement ok={req.numSpecial} label="En az 1 rakam ve 1 özel karakter" />
              </div>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden rounded-2xl border border-[#f3c6cf] bg-[#fdebef] px-4 py-3 text-[12px] leading-relaxed text-[#c0506c]"
                >
                  {error}
                </motion.div>
              )}
              {success && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="flex items-center gap-2 overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[12px] text-emerald-700"
                >
                  <Check className="h-4 w-4" strokeWidth={2.5} /> Şifren değiştirildi, yönlendiriliyorsun…
                </motion.div>
              )}
            </AnimatePresence>

            {/* aksiyonlar */}
            <div className="flex flex-col gap-3 pt-1 sm:flex-row">
              <button
                type="button"
                onClick={goToDashboard}
                disabled={busy || success}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#efd3dc] bg-white px-5 py-3.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[#7a6470] transition-colors hover:border-[#e89bb4] hover:text-[#4a2f3c] disabled:opacity-50 sm:flex-1"
              >
                <Clock className="h-4 w-4" strokeWidth={1.8} /> Daha Sonra
              </button>
              <motion.button
                type="submit"
                disabled={busy || success}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                className="group relative inline-flex items-center justify-center gap-2.5 overflow-hidden rounded-2xl bg-gradient-to-r from-[#f4a9c0] via-[#ec84a4] to-[#e06a90] px-6 py-3.5 text-[11px] font-bold uppercase tracking-[0.16em] text-white shadow-[0_20px_44px_-18px_rgba(224,106,144,0.85)] transition-shadow hover:shadow-[0_24px_54px_-16px_rgba(224,106,144,0.95)] disabled:opacity-70 sm:flex-[1.35]"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                />
                <span className="relative z-10 inline-flex items-center gap-2.5">
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : success ? (
                    <Check className="h-4 w-4" strokeWidth={2.5} />
                  ) : (
                    <Lock className="h-4 w-4" strokeWidth={1.9} />
                  )}
                  {busy ? 'Kaydediliyor' : success ? 'Yönlendiriliyor' : 'Şifreyi Değiştir'}
                </span>
              </motion.button>
            </div>
          </form>
        </motion.div>
      </div>
    </main>
  )
}
