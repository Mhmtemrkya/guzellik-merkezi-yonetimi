'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import { ArrowLeft, Check, Eye, EyeOff, KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { authApi } from '@/lib/apiClient'

/**
 * "ŞİFREMİ UNUTTUM" — e-posta koduyla parola sıfırlama.
 *
 * <p>
 * Burası eskiden bir BİLGİ KUTUSUYDU: kullanıcıya "yöneticine ya da destek ekibine başvur"
 * deniyordu. Kurum yöneticisinin üstünde yalnızca platform ekibi olduğu için, bir yöneticinin
 * parolasını unutması insan müdahalesi gerektiriyordu — gece yarısı panele giremeyen bir
 * işletme sabahı beklemek zorundaydı.
 * </p>
 *
 * <p>
 * AKIŞ İKİ ADIM: e-posta → (koda + yeni parola). Kanal E-POSTADIR, SMS değil; e-posta zaten
 * giriş kimliğinin ta kendisidir ve panel girişinin ikinci faktörü de odur. SMS sağlayıcısı
 * canlıya alındığında bile bu akışın kanalı değişmez.
 * </p>
 *
 * <p>
 * ENUMERASYON: sunucu, adres kayıtlı olsun olmasın AYNI yanıtı verir ve bu ekran da öyle
 * davranır — "böyle bir hesap yok" gibi bir mesaj HİÇBİR koşulda gösterilmez. Kayıtsız adres
 * girildiğinde kod ekranı yine açılır; kod gelmez, girilen hiçbir kod da doğrulanmaz.
 * </p>
 *
 * <p>
 * MOBİL/MASAÜSTÜ: masaüstü uygulaması bu sayfanın kendisini gömülü tarayıcıda açar
 * (Tauri uzak-URL kabuğu), dolayısıyla ayrı bir uygulama olarak ele alınmaz. Mobilde aynı
 * akışın Flutter karşılığı vardır (forgot_password_screen.dart).
 * </p>
 */

type Step = 'email' | 'code'

const fade: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
}

const labelCls = 'mb-2 block text-[10px] font-mono uppercase tracking-[0.22em] text-[#352432]/[0.55]'
const fieldWrap =
  'flex items-center gap-3 rounded-xl border border-[#ead8df] bg-white px-4 transition-colors focus-within:border-[#e798b4] focus-within:shadow-[0_0_0_4px_rgba(240,170,194,0.18)]'
const fieldCls =
  'min-h-12 w-full bg-transparent text-[14px] text-[#352432] outline-none placeholder:text-[#352432]/[0.30]'

/** Sunucudaki kuralla AYNI (PasswordResetService.MinPasswordLength). */
const MIN_PASSWORD = 8

export default function ForgotPasswordDialog({
  open,
  onOpenChange,
  /** Giriş formunda yazılı e-posta — kullanıcı aynı adresi ikinci kez yazmasın. */
  defaultEmail = '',
  /** Sıfırlama bitince giriş formuna dönerken adresi doldurmak için. */
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultEmail?: string
  onDone?: (email: string) => void
}) {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState(defaultEmail)
  const [challengeId, setChallengeId] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [devCode, setDevCode] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // Dialog her açılışta BAŞTAN başlar. Önceki denemenin meydan okuma kimliği ve yazılmış
  // parolası ekranda kalsaydı, kullanıcı "kod hatalı" diyen ölü bir oturumla karşılaşırdı.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setStep('email')
      setEmail(defaultEmail)
      setChallengeId('')
      setMaskedEmail('')
      setDevCode(null)
      setCode('')
      setPassword('')
      setShowPassword(false)
      setError('')
      setDone(false)
    }
    wasOpen.current = open
  }, [open, defaultEmail])

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  const submitEmail = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!emailValid) {
      setError('Geçerli bir e-posta adresi girin.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await authApi.passwordResetRequest(email.trim())
      setChallengeId(res.challengeId)
      setMaskedEmail(res.maskedEmail)
      setDevCode(res.devCode ?? null)
      setStep('code')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İstek gönderilemedi. Lütfen tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  const submitReset = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (code.length !== 6) {
      setError('E-postanıza gelen 6 haneli kodu girin.')
      return
    }
    if (password.trim().length < MIN_PASSWORD) {
      setError(`Yeni parola en az ${MIN_PASSWORD} karakter olmalı.`)
      return
    }
    setError('')
    setLoading(true)
    try {
      await authApi.passwordResetComplete(challengeId, code, password.trim())
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parola sıfırlanamadı.')
    } finally {
      setLoading(false)
    }
  }

  const finish = (): void => {
    onDone?.(email.trim())
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden rounded-[28px] border border-[#ead8df]/[0.90] bg-gradient-to-br from-white via-[#fff7fa] to-[#fff0f5] p-0 text-[#352432] shadow-[0_34px_120px_-58px_rgba(120,71,88,0.72)] backdrop-blur-2xl"
        style={{ width: 'min(94vw, 520px)', maxWidth: 'min(94vw, 520px)' }}
      >
        <div className="relative p-6 sm:p-7">
          <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[#f0aac2]/[0.22] blur-3xl" />

          <div className="relative flex items-start gap-3.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#efbfd0]/[0.80] bg-white text-[#c85776] shadow-[0_14px_34px_-24px_rgba(200,87,118,0.8)]">
              {done ? <Check className="h-4 w-4" strokeWidth={2.4} /> : <KeyRound className="h-4 w-4" strokeWidth={1.6} />}
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="font-display text-2xl tracking-tight">
                {done ? 'Parolanız güncellendi' : 'Şifreni mi unuttun?'}
              </DialogTitle>
              <DialogDescription className="mt-1.5 text-[12px] leading-relaxed text-[#352432]/[0.60]">
                {done
                  ? 'Yeni parolanızla giriş yapabilirsiniz. Güvenlik için diğer tüm oturumlarınız kapatıldı.'
                  : step === 'email'
                    ? 'Hesabınızın e-posta adresine 6 haneli bir doğrulama kodu göndereceğiz.'
                    : 'Kodu girin ve yeni parolanızı belirleyin.'}
              </DialogDescription>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {/* ---------------- BİTTİ ---------------- */}
            {done ? (
              <motion.div key="done" variants={fade} initial="hidden" animate="visible" exit="exit" className="relative mt-6">
                <div className="flex items-start gap-2.5 rounded-2xl border border-emerald-200/[0.90] bg-emerald-50/[0.86] px-3.5 py-3 text-[12px] leading-relaxed text-emerald-800">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Açık kalan tüm oturumlarınız (telefon, tablet, masaüstü) kapatıldı. Parolanızı
                    başkası sıfırlattıysa bile eski erişimi sürmez.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={finish}
                  className="mt-5 w-full rounded-2xl bg-gradient-to-r from-[#e798b4] via-[#d4789a] to-[#b75a7e] py-3 text-[12.5px] font-semibold text-white shadow-[0_16px_36px_-16px_rgba(183,90,126,0.75)] transition-opacity hover:opacity-90"
                >
                  Giriş ekranına dön
                </button>
              </motion.div>
            ) : step === 'email' ? (
              /* ---------------- ADIM 1: e-posta ---------------- */
              <motion.form key="email" onSubmit={submitEmail} variants={fade} initial="hidden" animate="visible" exit="exit" className="relative mt-6">
                <label className={labelCls} htmlFor="reset-email">
                  Hesap E-postanız
                </label>
                <div className={fieldWrap}>
                  <Mail className="h-4 w-4 shrink-0 text-[#c85776]/70" strokeWidth={1.6} />
                  <input
                    id="reset-email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ayse@guzelsalon.com"
                    className={fieldCls}
                  />
                </div>

                <p className="mt-3 text-[11.5px] leading-relaxed text-[#352432]/[0.55]">
                  Bu adresle birden fazla kurumda hesabınız varsa hepsinin parolası birlikte
                  güncellenir.
                </p>

                {error && <ErrorBox message={error} />}

                <SubmitButton loading={loading} label="Doğrulama Kodu Gönder" loadingLabel="Gönderiliyor" />

                <p className="mt-3 text-center text-[11px] leading-relaxed text-[#352432]/[0.45]">
                  Personelseniz kurum yöneticiniz de Personel sayfasından parolanızı sıfırlayabilir.
                </p>
              </motion.form>
            ) : (
              /* ---------------- ADIM 2: kod + yeni parola ---------------- */
              <motion.form key="code" onSubmit={submitReset} variants={fade} initial="hidden" animate="visible" exit="exit" className="relative mt-6">
                <p className="text-[12.5px] leading-relaxed text-[#352432]/[0.65]">
                  6 haneli kodu <b className="text-[#2f1724]">{maskedEmail}</b> adresine gönderdik.
                  Kod 15 dakika geçerlidir.
                </p>

                <div className="mt-5">
                  <label className={labelCls}>Doğrulama Kodu</label>
                  <div className={fieldWrap}>
                    <KeyRound className="h-4 w-4 shrink-0 text-[#c85776]/70" strokeWidth={1.6} />
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      autoFocus
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      className="min-h-12 w-full bg-transparent text-center text-[22px] font-semibold tracking-[0.5em] text-[#352432] outline-none placeholder:text-[#352432]/[0.25]"
                    />
                  </div>
                  {devCode && <p className="mt-2 text-center text-[11px] text-[#9d7386]">Test ortamı kodu: {devCode}</p>}
                </div>

                <div className="mt-4">
                  <label className={labelCls} htmlFor="reset-password">
                    Yeni Parola
                  </label>
                  <div className={fieldWrap}>
                    <Lock className="h-4 w-4 shrink-0 text-[#c85776]/70" strokeWidth={1.6} />
                    <input
                      id="reset-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={`En az ${MIN_PASSWORD} karakter`}
                      className={fieldCls}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Parolayı gizle' : 'Parolayı göster'}
                      className="text-[#352432]/[0.35] transition-colors hover:text-[#c85776]"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {error && <ErrorBox message={error} />}

                <SubmitButton loading={loading} label="Parolamı Güncelle" loadingLabel="Güncelleniyor" />

                <button
                  type="button"
                  onClick={() => {
                    setStep('email')
                    setError('')
                    setCode('')
                  }}
                  className="mt-3 flex w-full items-center justify-center gap-1.5 text-[12px] text-[#352432]/[0.55] transition-colors hover:text-[#c85776]"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> E-postayı değiştir
                </button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-2xl border border-rose-300/50 bg-rose-50 px-4 py-3 text-[12px] leading-relaxed text-rose-700">
      {message}
    </div>
  )
}

function SubmitButton({ loading, label, loadingLabel }: { loading: boolean; label: string; loadingLabel: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#e798b4] via-[#d4789a] to-[#b75a7e] text-[13px] font-semibold text-white shadow-[0_16px_36px_-16px_rgba(183,90,126,0.75)] transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {loading ? (
        <>
          <motion.span
            aria-hidden
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="h-3.5 w-3.5 rounded-full border-2 border-white/70 border-t-transparent"
          />
          {loadingLabel}
        </>
      ) : (
        label
      )}
    </button>
  )
}
