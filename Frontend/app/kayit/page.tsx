'use client'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  Copy,
  Download,
  KeyRound,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  Phone,
  ShieldCheck,
  Sparkles,
  Store,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/components/dashboard/AuthContext'
import { generateCredentialsPdf } from '@/lib/credentialsPdf'
import { company } from '@/lib/legal/company'
import {
  getSignupReadiness,
  resendSignupCode,
  startSignup,
  verifySignupEmail,
  verifySignupPhone,
  type SignupCompleted,
  type SignupForm,
  type SignupReadiness,
} from '@/lib/tenantSignupApi'

/*
 * SELF-SERVİS KURUM KAYDI — 14 gün ücretsiz deneme.
 *
 * Akış üç adım + sonuç ekranıdır. Adımlar bilinçli olarak AYRI ekranlar: tek uzun formda
 * doğrulama kodu alanları da görünür olurdu ve kullanıcı hangi kodun nereye geldiğini karıştırırdı.
 *
 * Kurum SON adımda oluşur (backend kararı): yarım bırakılan kayıt veritabanına hiç yazılmaz.
 */

const steps = [
  { key: 'form', label: 'İşletme bilgileri', icon: Building2 },
  { key: 'email', label: 'E-posta doğrulama', icon: Mail },
  { key: 'phone', label: 'Telefon doğrulama', icon: Phone },
  { key: 'done', label: 'Hesabınız hazır', icon: CheckCircle2 },
] as const

type StepKey = (typeof steps)[number]['key']

const fade: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.25 } },
}

const inputWrap =
  'flex items-center gap-3 rounded-xl border border-[#ead8df] bg-white px-4 transition-colors focus-within:border-[#e798b4] focus-within:shadow-[0_0_0_4px_rgba(240,170,194,0.18)]'
const inputCls =
  'min-h-12 w-full bg-transparent text-[14px] text-[#352432] outline-none placeholder:text-[#352432]/[0.30]'
const labelCls = 'mb-2 block text-[10px] font-mono uppercase tracking-[0.22em] text-[#352432]/[0.55]'

function Field({
  label,
  icon: Icon,
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
}: {
  label: string
  icon: LucideIcon
  value: string
  onChange: (v: string) => void
  placeholder: string
  type?: string
  autoComplete?: string
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className={inputWrap}>
        <Icon className="h-4 w-4 shrink-0 text-[#c85776]/70" strokeWidth={1.6} />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={inputCls}
          autoComplete={autoComplete}
        />
      </div>
    </div>
  )
}

/** 6 haneli kod alanı — tek input, geniş harf aralığıyla kod hissi verir. */
function CodeInput({ value, onChange, onSubmit }: { value: string; onChange: (v: string) => void; onSubmit: () => void }) {
  return (
    <div className={inputWrap}>
      <KeyRound className="h-4 w-4 shrink-0 text-[#c85776]/70" strokeWidth={1.6} />
      <input
        type="text"
        inputMode="numeric"
        maxLength={6}
        value={value}
        autoFocus
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onSubmit()
          }
        }}
        placeholder="000000"
        className={`${inputCls} text-center text-[22px] font-semibold tracking-[0.5em]`}
      />
    </div>
  )
}

export default function TenantSignupPage() {
  const router = useRouter()
  const { adoptSession } = useAuth()

  const [step, setStep] = useState<StepKey>('form')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [readiness, setReadiness] = useState<SignupReadiness | null>(null)

  const [form, setForm] = useState<SignupForm>({
    tenantName: '',
    ownerName: '',
    email: '',
    phone: '',
    branchName: 'Merkez',
    city: '',
  })
  const set = (k: keyof SignupForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }))

  const [signupId, setSignupId] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [maskedPhone, setMaskedPhone] = useState('')
  const [phoneChannel, setPhoneChannel] = useState<string>('sms')
  const [code, setCode] = useState('')
  const [devHint, setDevHint] = useState('')
  const [result, setResult] = useState<SignupCompleted | null>(null)
  const [copied, setCopied] = useState(false)

  // Kayıt alınabilir mi? (Kanal kurulu değilse 3 adım doldurup duvara çarpmasın.)
  useEffect(() => {
    let cancelled = false
    void getSignupReadiness()
      .then((r) => !cancelled && setReadiness(r))
      // Uç okunamazsa formu göster: sunucu zaten son sözü söyleyecek.
      .catch(() => !cancelled && setReadiness({ email: true, phone: true, canSignup: true }))
    return () => {
      cancelled = true
    }
  }, [])

  // Adım değişince kod alanı ve hata temizlenir; aksi halde önceki adımın hatası yeni ekranda kalır.
  const prevStep = useRef<StepKey>('form')
  useEffect(() => {
    if (prevStep.current !== step) {
      setCode('')
      setError('')
      prevStep.current = step
    }
  }, [step])

  const stepIndex = steps.findIndex((s) => s.key === step)

  const handleStart = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await startSignup(form)
      setSignupId(res.signupId)
      setMaskedEmail(res.maskedEmail)
      setDevHint(res.devCode ? `Test ortamı kodu: ${res.devCode}` : '')
      setStep('email')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kayıt başlatılamadı.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyEmail = async (): Promise<void> => {
    if (code.length !== 6) {
      setError('E-postanıza gelen 6 haneli kodu girin.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await verifySignupEmail(signupId, code)
      setMaskedPhone(res.maskedPhone)
      setPhoneChannel(res.channel)
      setDevHint(res.devCode ? `Test ortamı kodu: ${res.devCode}` : '')
      setStep('phone')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kod doğrulanamadı.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyPhone = async (): Promise<void> => {
    if (code.length !== 6) {
      setError('Telefonunuza gelen 6 haneli kodu girin.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await verifySignupPhone(signupId, code)
      setResult(res)
      setStep('done')
      // Oturumu hemen benimse: kullanıcı yeni öğrendiği geçici parolayı elle yazmak zorunda kalmasın.
      adoptSession({
        accessToken: res.session.accessToken,
        refreshToken: res.session.refreshToken,
        expiresAtUtc: res.session.expiresAtUtc,
        user: {
          userId: res.session.user.userId,
          email: res.session.user.email,
          fullName: res.session.user.fullName,
          role: res.session.user.role,
          tenantId: res.session.user.tenantId,
          branchId: res.session.user.branchId,
          permissions: [],
          mustChangePassword: res.session.user.mustChangePassword,
        },
      } as Parameters<typeof adoptSession>[0])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kod doğrulanamadı.')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async (): Promise<void> => {
    setError('')
    setLoading(true)
    try {
      const res = await resendSignupCode(signupId)
      setDevHint(res.devCode ? `Test ortamı kodu: ${res.devCode}` : '')
      setCode('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kod gönderilemedi.')
    } finally {
      setLoading(false)
    }
  }

  const [pdfBusy, setPdfBusy] = useState(false)

  /**
   * Giriş bilgileri belgesi — platform panelindeki TenantCredentialsDialog ile AYNI şablon
   * ve alanlar. Şablon zemininde başlık ve "YÖNETİCİ" etiketi basılı olduğu için buradan
   * gönderilen değerler o dosyayla birebir aynı tutulur; ayrışırsa iki farklı belge çıkar.
   */
  const handleDownloadPdf = async (): Promise<void> => {
    if (!result || pdfBusy) return
    setPdfBusy(true)
    try {
      await generateCredentialsPdf({
        heading: 'Giriş Bilgileri',
        subjectLabel: 'YÖNETİCİ',
        personName: result.credentials.ownerName || result.credentials.email,
        email: result.credentials.email,
        initialPassword: result.credentials.initialPassword,
        tenantName: result.credentials.tenantName,
        branchName: result.credentials.branchName,
        // Kurum kodu belgeye de basılır: destek çağrısında elinin altında olsun.
        roleLine: `Kurum Yöneticisi · ${result.tenantCode}`,
        filenameBase: `${result.credentials.tenantName}-${result.tenantCode}`,
      })
    } finally {
      setPdfBusy(false)
    }
  }

  const copyCode = async (): Promise<void> => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.tenantCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* pano izni yoksa sessizce geç — kod zaten ekranda yazıyor */
    }
  }

  const channelLabel = phoneChannel === 'whatsapp' ? 'WhatsApp' : 'SMS'
  const ChannelIcon = phoneChannel === 'whatsapp' ? MessageCircle : MessageSquare

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#fbe9f0] text-[#352432]">
      {/* arka plan — giriş sayfalarıyla aynı dil */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <img src="/login-arkaplan.png" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <motion.span
          animate={{ opacity: [0.25, 0.45, 0.25], scale: [1, 1.06, 1] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute -left-32 top-1/4 h-[420px] w-[420px] rounded-full bg-[#f0aac2]/[0.25] blur-[120px]"
        />
        <motion.span
          animate={{ opacity: [0.2, 0.4, 0.2], scale: [1, 1.08, 1] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 1.6 }}
          className="absolute -right-24 bottom-1/4 h-[380px] w-[380px] rounded-full bg-[#ffd3df]/[0.30] blur-[110px]"
        />
      </div>

      <div className="relative z-10 mx-auto grid min-h-screen w-full max-w-[1500px] gap-10 px-6 py-8 lg:grid-cols-12 lg:items-center lg:px-12">
        {/* SOL — marka + adım göstergesi */}
        <motion.aside
          initial="hidden"
          animate="visible"
          variants={fade}
          className="relative hidden flex-col justify-between lg:col-span-5 lg:flex lg:min-h-[86vh] lg:py-6"
        >
          <div>
            <Link href="/" className="group inline-flex items-center gap-4">
              <span className="relative h-20 w-20">
                <img src="/logo.png" alt="BeautyAsist logosu" className="h-full w-full object-contain" />
              </span>
              <span>
                <span className="block font-display text-2xl tracking-[-0.02em] text-[#3a1f2c]">BeautyAsist</span>
                <span className="mt-0.5 block text-[10px] font-mono uppercase tracking-[0.24em] text-[#c85776]/80">
                  Ücretsiz Deneme
                </span>
              </span>
            </Link>

            <h1 className="mt-12 font-display text-5xl leading-[1.02] tracking-tight text-[#3a1f2c] xl:text-6xl">
              14 gün ücretsiz,
              <br />
              <span className="beautyasist-text-gradient italic">kartsız.</span>
            </h1>

            <p className="mt-6 max-w-sm text-[13px] leading-relaxed text-[#352432]/[0.60]">
              Randevu, danışan, paket seansı, stok ve tahsilat tek panelde. Kurulum yok — bilgilerinizi
              girin, hesabınız dakikalar içinde hazır olsun.
            </p>

            {/* adım göstergesi */}
            <ol className="mt-12 space-y-4">
              {steps.map((s, i) => {
                const done = i < stepIndex
                const active = i === stepIndex
                const Icon = s.icon
                return (
                  <li key={s.key} className="flex items-center gap-4">
                    <span
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl border transition-colors ${
                        done
                          ? 'border-[#c85776] bg-[#c85776] text-white'
                          : active
                            ? 'border-[#c85776] bg-white text-[#c85776] shadow-[0_10px_26px_-18px_rgba(200,87,118,0.55)]'
                            : 'border-[#ead8df] bg-white/70 text-[#c85776]/40'
                      }`}
                    >
                      {done ? <Check className="h-4 w-4" strokeWidth={3} /> : <Icon className="h-[17px] w-[17px]" strokeWidth={1.6} />}
                    </span>
                    <span className={`text-[13px] ${active ? 'font-semibold text-[#352432]' : 'text-[#352432]/[0.55]'}`}>
                      {s.label}
                    </span>
                  </li>
                )
              })}
            </ol>
          </div>

          <div className="mt-10 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.22em] text-[#352432]/[0.40]">
            <span>© 2026 BeautyAsist</span>
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5" /> kvkk uyumlu
            </span>
          </div>
        </motion.aside>

        {/* SAĞ — kart */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative lg:col-span-7"
        >
          <div className="relative overflow-hidden rounded-[32px] border border-white/80 bg-gradient-to-br from-white/95 via-[#fff7fa]/95 to-[#fff0f5]/95 p-6 shadow-[0_44px_120px_-48px_rgba(120,71,88,0.55)] backdrop-blur-2xl sm:p-10">
            <span aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#f0aac2]/[0.22] blur-3xl" />
            <span aria-hidden className="pointer-events-none absolute -left-20 bottom-0 h-56 w-56 rounded-full bg-[#ffd3df]/[0.20] blur-3xl" />

            {/* mobil adım çubuğu */}
            <div className="relative mb-6 flex items-center gap-1.5 lg:hidden">
              {steps.map((s, i) => (
                <span
                  key={s.key}
                  className={`h-1 flex-1 rounded-full transition-colors ${i <= stepIndex ? 'bg-[#c85776]' : 'bg-[#ead8df]'}`}
                />
              ))}
            </div>

            {readiness && !readiness.canSignup ? (
              <div className="relative py-10 text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-[#ead8df] bg-white">
                  <Store className="h-6 w-6 text-[#c85776]" strokeWidth={1.5} />
                </div>
                <h2 className="mt-5 font-display text-[26px] text-[#2f1724]">Online kayıt geçici olarak kapalı</h2>
                <p className="mx-auto mt-3 max-w-sm text-[13px] leading-relaxed text-[#352432]/[0.60]">
                  Hesabınızı sizin için biz açalım. Bize ulaşın, aynı gün içinde 14 günlük denemenizi
                  başlatalım.
                </p>
                {/*
                  ÇIKIŞSIZ BIRAKMA: kayıt kapalıyken "ana sayfaya dön" demek, ilgilenen bir
                  işletmeyi elimizden kaçırmak olurdu. Doğrudan iletişim yolu verilir.
                */}
                <div className="mx-auto mt-6 flex max-w-sm flex-col gap-2.5">
                  <a
                    href={`mailto:${company.email}?subject=${encodeURIComponent('BeautyAsist deneme hesabı talebi')}`}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#e798b4] via-[#d4789a] to-[#b75a7e] px-6 py-3.5 text-[13px] font-semibold text-white"
                  >
                    <Mail className="h-4 w-4" /> {company.email}
                  </a>
                  <a
                    href={`tel:${company.phone.replace(/\s/g, '')}`}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#ead8df] bg-white px-6 py-3.5 text-[13px] font-semibold text-[#352432] transition-colors hover:border-[#e798b4]"
                  >
                    <Phone className="h-4 w-4 text-[#c85776]" /> {company.phone}
                  </a>
                  <Link href="/" className="mt-1 text-[12px] text-[#9d7386] transition-colors hover:text-[#c85776]">
                    Ana sayfaya dön
                  </Link>
                </div>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                {/* ---------------- ADIM 1: bilgiler ---------------- */}
                {step === 'form' && (
                  <motion.form key="form" variants={fade} initial="hidden" animate="visible" exit="exit" onSubmit={handleStart} className="relative">
                    <div className="text-center">
                      <div className="text-[13px] font-medium text-[#c85776]">Hoş geldiniz</div>
                      <h2 className="mt-1.5 flex items-center justify-center gap-3 font-display text-[30px] leading-tight tracking-tight text-[#2f1724] sm:text-[38px]">
                        <Sparkles aria-hidden className="hidden h-4 w-4 text-[#e798b4] sm:block" />
                        İşletmenizi tanıyalım
                        <Sparkles aria-hidden className="hidden h-4 w-4 text-[#e798b4] sm:block" />
                      </h2>
                      <p className="mt-2 text-[12px] text-[#352432]/[0.50]">Tüm alanlar zorunludur — hesabınız bu bilgilerle açılır</p>
                    </div>

                    <div className="mt-8 space-y-5">
                      <Field label="İşletme Adı" icon={Building2} value={form.tenantName} onChange={set('tenantName')} placeholder="Güzel Salon Güzellik Merkezi" autoComplete="organization" />
                      <Field label="Yetkili Ad Soyad" icon={UserRound} value={form.ownerName} onChange={set('ownerName')} placeholder="Ayşe Yılmaz" autoComplete="name" />
                      <div className="grid gap-5 sm:grid-cols-2">
                        <Field label="E-posta" icon={Mail} value={form.email} onChange={set('email')} placeholder="ayse@guzelsalon.com" type="email" autoComplete="email" />
                        <Field label="Telefon" icon={Phone} value={form.phone} onChange={set('phone')} placeholder="05XX XXX XX XX" type="tel" autoComplete="tel" />
                      </div>
                      <div className="grid gap-5 sm:grid-cols-2">
                        <Field label="Şube Adı" icon={Store} value={form.branchName} onChange={set('branchName')} placeholder="Merkez" />
                        <Field label="Şehir" icon={MapPin} value={form.city} onChange={set('city')} placeholder="İstanbul" autoComplete="address-level2" />
                      </div>
                    </div>

                    {error && <ErrorBox message={error} />}

                    <SubmitButton loading={loading} label="Devam Et" loadingLabel="Kontrol ediliyor" />

                    <p className="mt-4 text-center text-[11px] leading-relaxed text-[#352432]/[0.45]">
                      Devam ederek e-postanıza ve telefonunuza birer doğrulama kodu göndereceğiz.
                      Kredi kartı istemiyoruz.
                    </p>
                    <p className="mt-3 text-center text-[12px] text-[#352432]/[0.55]">
                      Zaten hesabınız var mı?{' '}
                      <Link href="/login" className="font-semibold text-[#c85776] hover:underline">
                        Giriş yapın
                      </Link>
                    </p>
                  </motion.form>
                )}

                {/* ---------------- ADIM 2: e-posta kodu ---------------- */}
                {step === 'email' && (
                  <motion.div key="email" variants={fade} initial="hidden" animate="visible" exit="exit" className="relative">
                    <StepHeader
                      icon={Mail}
                      title="E-postanızı doğrulayın"
                      subtitle={
                        <>
                          6 haneli kodu <b className="text-[#2f1724]">{maskedEmail}</b> adresine gönderdik.
                        </>
                      }
                    />
                    <div className="mt-7">
                      <label className={labelCls}>Doğrulama Kodu</label>
                      <CodeInput value={code} onChange={setCode} onSubmit={handleVerifyEmail} />
                    </div>
                    {devHint && <p className="mt-2 text-center text-[11px] text-[#9d7386]">{devHint}</p>}
                    {error && <ErrorBox message={error} />}
                    <SubmitButton loading={loading} label="Doğrula ve Devam Et" loadingLabel="Doğrulanıyor" onClick={handleVerifyEmail} />
                    <StepFooter onBack={() => setStep('form')} backLabel="Bilgileri düzenle" onResend={handleResend} loading={loading} />
                  </motion.div>
                )}

                {/* ---------------- ADIM 3: telefon kodu ---------------- */}
                {step === 'phone' && (
                  <motion.div key="phone" variants={fade} initial="hidden" animate="visible" exit="exit" className="relative">
                    <StepHeader
                      icon={ChannelIcon}
                      title="Telefonunuzu doğrulayın"
                      subtitle={
                        <>
                          Son adım — kodu <b className="text-[#2f1724]">{maskedPhone}</b> numarasına{' '}
                          <b className="text-[#2f1724]">{channelLabel}</b> ile gönderdik.
                        </>
                      }
                    />
                    <div className="mt-7">
                      <label className={labelCls}>Doğrulama Kodu</label>
                      <CodeInput value={code} onChange={setCode} onSubmit={handleVerifyPhone} />
                    </div>
                    {devHint && <p className="mt-2 text-center text-[11px] text-[#9d7386]">{devHint}</p>}
                    {error && <ErrorBox message={error} />}
                    <SubmitButton loading={loading} label="Hesabımı Oluştur" loadingLabel="Hesabınız açılıyor" onClick={handleVerifyPhone} />
                    <StepFooter onBack={() => setStep('email')} backLabel="Geri" onResend={handleResend} loading={loading} />
                  </motion.div>
                )}

                {/* ---------------- SONUÇ ---------------- */}
                {step === 'done' && result && (
                  <motion.div key="done" variants={fade} initial="hidden" animate="visible" exit="exit" className="relative">
                    <div className="text-center">
                      <motion.div
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 220, damping: 16 }}
                        className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-[#e798b4] to-[#b75a7e] text-white shadow-[0_20px_44px_-18px_rgba(183,90,126,0.8)]"
                      >
                        <CheckCircle2 className="h-8 w-8" strokeWidth={1.8} />
                      </motion.div>
                      <h2 className="mt-5 font-display text-[30px] leading-tight text-[#2f1724] sm:text-[36px]">Hesabınız hazır</h2>
                      <p className="mt-2 text-[13px] text-[#352432]/[0.55]">
                        {result.credentials.tenantName} · 14 günlük ücretsiz denemeniz başladı
                      </p>
                    </div>

                    {/* kurum kodu — destek için ayırt edici bilgi */}
                    <div className="mt-7 rounded-2xl border border-[#e798b4]/50 bg-[#fff0f5]/70 p-5 text-center">
                      <div className="text-[10px] font-mono uppercase tracking-[0.24em] text-[#352432]/[0.55]">Kurum Kodunuz</div>
                      <button
                        type="button"
                        onClick={copyCode}
                        className="mt-2 inline-flex items-center gap-3 font-display text-[34px] tracking-[0.06em] text-[#b75a7e] transition-opacity hover:opacity-80"
                      >
                        {result.tenantCode}
                        {copied ? <Check className="h-5 w-5 text-emerald-600" /> : <Copy className="h-5 w-5 text-[#c85776]/60" />}
                      </button>
                      <p className="mt-2 text-[11.5px] leading-relaxed text-[#352432]/[0.55]">
                        Destek aldığınızda bu kodu söylemeniz yeterli — kaydınızı anında buluruz.
                      </p>
                    </div>

                    {/* giriş bilgileri */}
                    <div className="mt-4 space-y-2 rounded-2xl border border-[#ead8df] bg-white/80 p-5">
                      <Row label="E-posta" value={result.credentials.email} />
                      <Row label="Geçici şifre" value={result.credentials.initialPassword} mono />
                      <p className="pt-1 text-[11.5px] leading-relaxed text-[#352432]/[0.55]">
                        İlk girişte şifrenizi değiştirmeniz istenecek. Bu bilgileri PDF olarak indirip
                        saklayın — geçici şifre bir daha gösterilmez.
                      </p>
                    </div>

                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={handleDownloadPdf}
                        disabled={pdfBusy}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#ead8df] bg-white px-5 py-3.5 text-[13px] font-semibold text-[#352432] transition-colors hover:border-[#e798b4] hover:bg-[#fff7fa] disabled:opacity-60"
                      >
                        {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin text-[#c85776]" /> : <Download className="h-4 w-4 text-[#c85776]" />}
                        {pdfBusy ? 'Hazırlanıyor' : 'Giriş bilgilerini indir'}
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push('/change-password')}
                        className="group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-[#e798b4] via-[#d4789a] to-[#b75a7e] px-5 py-3.5 text-[13px] font-semibold text-white shadow-[0_20px_44px_-18px_rgba(183,90,126,0.75)]"
                      >
                        Panele giriş yap <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                      </button>
                    </div>

                    <div className="mt-5 flex items-center justify-center gap-2 text-[11.5px] text-[#352432]/[0.50]">
                      <CalendarClock className="h-3.5 w-3.5 text-[#c85776]/70" />
                      Denemeniz {new Date(result.tenant.trialEndsAtUtc || Date.now()).toLocaleDateString('tr-TR')} tarihinde biter
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>
        </motion.div>
      </div>
    </main>
  )
}

// ------------------------------------------------------------------ parçalar

function StepHeader({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle: React.ReactNode }) {
  return (
    <div className="text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-[#ead8df] bg-white text-[#c85776] shadow-[0_10px_26px_-18px_rgba(200,87,118,0.55)]">
        <Icon className="h-6 w-6" strokeWidth={1.5} />
      </div>
      <h2 className="mt-5 font-display text-[27px] leading-tight text-[#2f1724] sm:text-[32px]">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-[#352432]/[0.60]">{subtitle}</p>
    </div>
  )
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-[11px] font-mono uppercase tracking-[0.18em] text-[#352432]/[0.55]">{label}</span>
      <span className={`text-right text-[13.5px] font-semibold text-[#2f1724] ${mono ? 'tracking-[0.12em]' : 'break-all'}`}>{value}</span>
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      className="mt-5 overflow-hidden rounded-2xl border border-rose-300/50 bg-rose-50 px-4 py-3 text-[12px] leading-relaxed text-rose-700"
    >
      {message}
    </motion.div>
  )
}

function SubmitButton({
  loading,
  label,
  loadingLabel,
  onClick,
}: {
  loading: boolean
  label: string
  loadingLabel: string
  onClick?: () => void
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.005 }}
      whileTap={{ scale: 0.99 }}
      type={onClick ? 'button' : 'submit'}
      onClick={onClick}
      disabled={loading}
      className="group relative mt-6 w-full overflow-hidden rounded-2xl bg-gradient-to-r from-[#e798b4] via-[#d4789a] to-[#b75a7e] py-4 text-[13px] font-semibold tracking-wide text-white shadow-[0_20px_44px_-18px_rgba(183,90,126,0.75)] transition-shadow hover:shadow-[0_24px_54px_-16px_rgba(183,90,126,0.85)] disabled:opacity-60"
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.22] to-transparent transition-transform duration-700 group-hover:translate-x-full" />
      <span className="relative z-10 flex items-center justify-center gap-3">
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> {loadingLabel}
          </>
        ) : (
          <>
            {label} <ArrowRight className="absolute right-5 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </>
        )}
      </span>
    </motion.button>
  )
}

function StepFooter({
  onBack,
  backLabel,
  onResend,
  loading,
}: {
  onBack: () => void
  backLabel: string
  onResend: () => void
  loading: boolean
}) {
  return (
    <div className="mt-4 flex items-center justify-between text-[12px]">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[#9d7386] transition-colors hover:text-[#c85776]">
        <ArrowLeft className="h-3.5 w-3.5" /> {backLabel}
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={onResend}
        className="font-semibold text-[#c85776] transition-opacity hover:underline disabled:opacity-50"
      >
        Kodu tekrar gönder
      </button>
    </div>
  )
}
