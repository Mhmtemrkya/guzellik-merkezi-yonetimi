'use client'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowRight,
  CalendarDays,
  CalendarHeart,
  Check,
  Lock,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  ShieldCheck,
  Sparkles,
  UserRound,
  UserRoundPlus,
  type LucideIcon,
} from 'lucide-react'
import {
  customerOtpRequest,
  customerOtpVerify,
  getCustomerOtpChannels,
  getCustomerSession,
  type CustomerOtpChannel,
  type CustomerOtpChannels,
} from '@/lib/customerPortalApi'

const sectionVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1], staggerChildren: 0.07 } },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } },
}

const inputWrap =
  'flex items-center gap-3 rounded-xl border border-[#ead8df] bg-white px-4 transition-colors focus-within:border-[#e798b4] focus-within:shadow-[0_0_0_4px_rgba(240,170,194,0.18)]'
const inputCls =
  'min-h-12 w-full bg-transparent text-[14px] text-[#352432] outline-none placeholder:text-[#352432]/[0.30]'
const labelCls = 'mb-2 block text-[10px] font-mono uppercase tracking-[0.22em] text-[#352432]/[0.55]'

function FeatureRow({ icon: Icon, title, desc }: { icon: LucideIcon; title: string; desc: string }) {
  return (
    <motion.div variants={itemVariants} className="flex items-start gap-4">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#ead8df] bg-white/80 text-[#c85776] shadow-[0_10px_26px_-18px_rgba(200,87,118,0.55)]">
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
      </span>
      <div>
        <div className="text-[13px] font-semibold text-[#352432]">{title}</div>
        <div className="mt-0.5 max-w-xs text-[11.5px] leading-relaxed text-[#352432]/[0.55]">{desc}</div>
      </div>
    </motion.div>
  )
}

const genderOptions = [
  { value: 0, label: 'Belirtmek istemiyorum' },
  { value: 1, label: 'Kadın' },
  { value: 2, label: 'Erkek' },
]

type Mode = 'login' | 'register'

/** Kanal seçenekleri — WhatsApp yalnızca SEÇENEKLERDEN BİRİ (bkz. App Store 3.2.2(v) notu). */
const channelOptions: { key: CustomerOtpChannel; label: string; icon: LucideIcon; hint: string }[] = [
  { key: 'sms', label: 'SMS', icon: MessageSquare, hint: 'Kod telefonunuza SMS ile gelir.' },
  { key: 'email', label: 'E-posta', icon: Mail, hint: 'Kod, kayıtlı e-posta adresinize gönderilir.' },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle, hint: 'Kod WhatsApp mesajı olarak gelir.' },
]

export default function CustomerLoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('login')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  // Doğum tarihi ARTIK GİRİŞTE SORULMAZ; yalnızca kayıtta ve İSTEĞE BAĞLI (App Store 5.1.1(v)).
  const [birthDate, setBirthDate] = useState('')
  const [gender, setGender] = useState(0)
  const [email, setEmail] = useState('')
  const [channel, setChannel] = useState<CustomerOtpChannel>('sms')
  const [channels, setChannels] = useState<CustomerOtpChannels | null>(null)
  // KVKK AÇIK RIZASI: kayıt akışında zorunlu. Sunucu da ayrıca doğrular (tek kapı istemci olamaz).
  const [kvkkConsent, setKvkkConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Girişten sonra dönülecek hedef (?next=/randevu?branch=..) — yalnızca site içi yollar kabul edilir.
  const nextTarget = (): string => {
    const raw = new URLSearchParams(window.location.search).get('next') || '/randevu'
    return raw.startsWith('/randevu') || raw.startsWith('/salon') ? raw : '/randevu'
  }

  // Zaten müşteri oturumu varsa doğrudan portala geç.
  useEffect(() => {
    if (getCustomerSession()) router.replace(nextTarget())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  // Çalışmayan kanalı seçenek olarak göstermeyelim: platformda hangileri kurulu?
  useEffect(() => {
    let cancelled = false
    void getCustomerOtpChannels().then((available) => {
      if (cancelled) return
      setChannels(available)
      if (!available) return // bilinmiyor → seçici gizli, sunucu karar verir
      // Varsayılan: SMS → e-posta → WhatsApp sırasıyla ilk çalışan kanal.
      const preferred: CustomerOtpChannel[] = ['sms', 'email', 'whatsapp']
      const first = preferred.find((key) =>
        key === 'sms' ? available.sms : key === 'email' ? available.email : available.whatsApp,
      )
      if (first) setChannel(first)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // FAIL-CLOSED: kanal listesi bilinmiyorsa (uç okunamadı) seçici GÖSTERİLMEZ. Eskiden hepsi
  // açık varsayılıyordu; kullanıcı SMS seçiyor ama sunucu kurulu olmayan kanalı atlayıp başka
  // kanala düşüyordu — yani kod seçilen yerden gelmiyordu. Bilinmiyorsa sunucu karar verir.
  const enabledChannels = channels
    ? channelOptions.filter(({ key }) => (key === 'sms' ? channels.sms : key === 'email' ? channels.email : channels.whatsApp))
    : []

  // OTP akışı: 'idle' → kod istendi ('code') → doğrula.
  const [otpStage, setOtpStage] = useState<'idle' | 'code'>('idle')
  const [otpCode, setOtpCode] = useState('')
  const [otpInfo, setOtpInfo] = useState('')

  /** Ortak kimlik doğrulaması — geçersizse hata basar ve null döner. */
  const validateIdentity = (): { name: string; normalizedPhone: string } | null => {
    const name = fullName.trim()
    const phoneDigits = phone.replace(/\D/g, '')
    if (name.split(/\s+/).length < 2) {
      setError('Lütfen ad ve soyadınızı birlikte girin.')
      return null
    }
    if (phoneDigits.length < 10) {
      setError('Lütfen geçerli bir telefon numarası girin (örn. 05XX XXX XX XX).')
      return null
    }
    // KAYITTA e-posta kanalı seçildiyse adres zorunlu: kodun gideceği yer başka türlü bilinmez.
    // (Girişte adres sorulmaz — kod kurum kayıtlarındaki adrese gider.)
    if (mode === 'register' && channel === 'email' && !email.trim()) {
      setError('E-posta ile kod almak için e-posta adresinizi girin.')
      return null
    }
    // KVKK açık rızası kayıtta ZORUNLU. Kod göndermeden ÖNCE bakılır: onay vermeyecek kullanıcıya
    // boş yere SMS/e-posta göndermenin anlamı yok (hem maliyet hem gereksiz adım).
    if (mode === 'register' && !kvkkConsent) {
      setError('Devam etmek için KVKK aydınlatma metnini onaylamanız gerekir.')
      return null
    }
    return { name, normalizedPhone: phoneDigits.length === 10 ? `0${phoneDigits}` : phoneDigits }
  }

  const handleOtpRequest = async (): Promise<void> => {
    setError('')
    const id = validateIdentity()
    if (!id) return
    try {
      setLoading(true)
      const res = await customerOtpRequest(
        {
          fullName: id.name,
          phone: id.normalizedPhone,
          channel,
          email: mode === 'register' ? email.trim() || null : null,
        },
        mode === 'register' ? 'register' : 'login',
      )
      setOtpStage('code')
      setOtpCode('')
      // `hint` sunucudan gelir: kod gelmediğinde ne yapılacağını söyler. Yalnız e-posta kanalının
      // kurulu olduğu bir platformda, kayıtlarda adresi olmayan kullanıcı için tek çıkış yolu bu.
      const base = res?.devCode
        ? `Doğrulama kodu gönderildi. (Test ortamı kodu: ${res.devCode})`
        : 'Bilgileriniz kayıtlarımızla eşleşiyorsa 6 haneli doğrulama kodunuz gönderildi. Kod 5 dakika geçerlidir.'
      setOtpInfo(res?.hint ? `${base} ${res.hint}` : base)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kod gönderilemedi. Lütfen tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError('')
    const id = validateIdentity()
    if (!id) return
    const { name, normalizedPhone } = id
    try {
      setLoading(true)
      // GİRİŞ DE KAYIT DA OTP'DEN GEÇER: token yalnız telefon doğrulandıktan sonra üretilir.
      if (otpStage !== 'code') {
        await handleOtpRequest()
        return
      }
      if (otpCode.trim().length !== 6) {
        setError('Size gönderilen 6 haneli kodu girin.')
        return
      }
      await customerOtpVerify({
        fullName: name,
        phone: normalizedPhone,
        code: otpCode.trim(),
        purpose: mode === 'register' ? 'register' : 'login',
        gender,
        email: email.trim() || null,
        // Yalnız kayıtta ve yalnız kullanıcı girdiyse profile yazılır.
        birthDate: mode === 'register' ? birthDate || null : null,
        kvkkConsent: mode === 'register' ? kvkkConsent : false,
      })
      router.push(nextTarget())
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ''
      setError(
        message ||
          (mode === 'login'
            ? 'Bilgilerinizle eşleşen bir kayıt bulunamadı. Bilgilerinizi kontrol edin veya kayıt olun.'
            : 'Kayıt tamamlanamadı. Lütfen tekrar deneyin.'),
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#fbe9f0] text-[#352432]">
      {/* arka plan görseli + dekor — panel girişiyle aynı dil */}
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
        {/* SOL — marka paneli */}
        <motion.aside
          variants={sectionVariants}
          initial="hidden"
          animate="visible"
          className="relative hidden flex-col justify-between lg:col-span-5 lg:flex lg:min-h-[86vh] lg:py-6"
        >
          <div>
            <motion.a variants={itemVariants} href="/" className="group inline-flex items-center gap-4">
              <span className="relative h-20 w-20">
                <img src="/logo.png" alt="BeautyAsist logosu" className="h-full w-full object-contain" />
              </span>
              <span>
                <span className="block font-display text-2xl tracking-[-0.02em] text-[#3a1f2c]">BeautyAsist</span>
                <span className="mt-0.5 block text-[10px] font-mono uppercase tracking-[0.24em] text-[#c85776]/80">
                  Online Randevu
                </span>
              </span>
            </motion.a>

            <motion.div
              variants={itemVariants}
              className="mt-12 text-[10px] font-mono uppercase tracking-[0.32em] text-[#c85776]/75"
            >
              Güzelliğinize ayrılan zaman
            </motion.div>

            <motion.h1
              variants={itemVariants}
              className="mt-4 font-display text-5xl leading-[1.02] tracking-tight text-[#3a1f2c] xl:text-6xl"
            >
              Randevunuz,
              <br />
              <span className="beautyasist-text-gradient italic">bir dakikada.</span>
            </motion.h1>

            <motion.p variants={itemVariants} className="mt-6 max-w-sm text-[13px] leading-relaxed text-[#352432]/[0.60]">
              Hizmetinizi, uzmanınızı ve saatinizi seçin; randevunuz anında oluşsun. Şifre gerekmez — bilgilerinizle
              güvenle giriş yapın.
            </motion.p>

            <div className="mt-10 space-y-6">
              <FeatureRow
                icon={CalendarHeart}
                title="7/24 online randevu"
                desc="Salonu aramadan, size uyan saati seçerek randevu oluşturun."
              />
              <FeatureRow
                icon={Sparkles}
                title="Uzmanınızı siz seçin"
                desc="Hizmete göre uygun uzmanları ve boş saatlerini anında görün."
              />
              <FeatureRow
                icon={ShieldCheck}
                title="Bilgileriniz güvende"
                desc="Verileriniz KVKK uyumlu, uçtan uca şifreli altyapıda saklanır."
              />
            </div>
          </div>

          <motion.div
            variants={itemVariants}
            className="mt-10 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.22em] text-[#352432]/[0.40]"
          >
            <span>© 2026 BeautyAsist</span>
            <span className="flex items-center gap-2">
              <motion.span
                aria-hidden
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                className="h-1.5 w-1.5 rounded-full bg-[#c85776]"
              />
              secure.session
            </span>
          </motion.div>
        </motion.aside>

        {/* SAĞ — giriş kartı */}
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative lg:col-span-7"
        >
          <form
            onSubmit={handleSubmit}
            className="relative overflow-hidden rounded-[32px] border border-white/80 bg-gradient-to-br from-white/95 via-[#fff7fa]/95 to-[#fff0f5]/95 p-6 shadow-[0_44px_120px_-48px_rgba(120,71,88,0.55)] backdrop-blur-2xl sm:p-10"
          >
            <span aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#f0aac2]/[0.22] blur-3xl" />
            <span aria-hidden className="pointer-events-none absolute -left-20 bottom-0 h-56 w-56 rounded-full bg-[#ffd3df]/[0.20] blur-3xl" />

            <div className="relative text-center">
              <div className="text-[13px] font-medium text-[#c85776]">Hoş geldiniz</div>
              <h2 className="mt-1.5 flex items-center justify-center gap-3 font-display text-[32px] leading-tight tracking-tight text-[#2f1724] sm:text-[42px]">
                <Sparkles aria-hidden className="hidden h-4 w-4 text-[#e798b4] sm:block" />
                Online randevunuzu alın
                <Sparkles aria-hidden className="hidden h-4 w-4 text-[#e798b4] sm:block" />
              </h2>
              <p className="mt-2 text-[12px] text-[#352432]/[0.50]">Şifresiz güvenli giriş — bilgileriniz yeterli</p>
            </div>

            {/* Giriş / Kayıt sekmesi */}
            <div className="relative mx-auto mt-7 grid w-full max-w-sm grid-cols-2 rounded-2xl border border-[#ead8df] bg-white/80 p-1">
              {(
                [
                  { key: 'login', label: 'Giriş Yap', icon: UserRound },
                  { key: 'register', label: 'Kayıt Ol', icon: UserRoundPlus },
                ] as { key: Mode; label: string; icon: LucideIcon }[]
              ).map(({ key, label, icon: Icon }) => {
                const active = mode === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      if (key === mode) return
                      setMode(key)
                      setError('')
                      // BAYAT OTP TEMİZLENİR. Giriş için kod isteyip Kayıt sekmesine geçildiğinde
                      // eski kod yeni amaçla doğrulanmaya çalışılıyordu; sunucu kodu amaca (login /
                      // register) bağladığı için kullanıcı kaçınılmaz bir hataya düşüyordu.
                      setOtpStage('idle')
                      setOtpCode('')
                      setOtpInfo('')
                    }}
                    className={`relative flex min-h-10 items-center justify-center gap-2 rounded-xl text-[12.5px] font-semibold transition-colors ${
                      active ? 'text-white' : 'text-[#352432]/[0.55] hover:text-[#c85776]'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="customer-mode-pill"
                        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                        className="absolute inset-0 rounded-xl bg-gradient-to-r from-[#e798b4] via-[#d4789a] to-[#b75a7e] shadow-[0_12px_28px_-14px_rgba(183,90,126,0.75)]"
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                      {label}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="relative mt-7 space-y-5">
              <div>
                <label className={labelCls}>Ad Soyad</label>
                <div className={inputWrap}>
                  <UserRound className="h-4 w-4 shrink-0 text-[#c85776]/70" strokeWidth={1.6} />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Adınız ve soyadınız"
                    className={inputCls}
                    autoComplete="name"
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Telefon</label>
                <div className={inputWrap}>
                  <Phone className="h-4 w-4 shrink-0 text-[#c85776]/70" strokeWidth={1.6} />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="05XX XXX XX XX"
                    className={inputCls}
                    autoComplete="tel"
                  />
                </div>
              </div>

              {/* KANAL SEÇİMİ — kod tek bir uygulamaya mahkûm değildir. WhatsApp'ı olmayan da
                  SMS ya da e-posta ile giriş yapar (App Store 3.2.2(v)). */}
              {enabledChannels.length > 1 && (
                <div>
                  <label className={labelCls}>Doğrulama Kodu Nereye Gelsin?</label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {enabledChannels.map(({ key, label, icon: Icon }) => {
                      const active = channel === key
                      return (
                        <motion.button
                          key={key}
                          whileTap={{ scale: 0.985 }}
                          type="button"
                          onClick={() => {
                            setChannel(key)
                            setError('')
                          }}
                          className={`flex items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-[12.5px] font-medium transition-colors ${
                            active
                              ? 'border-[#c85776] bg-[#fff0f5] text-[#2f1724] shadow-[0_12px_30px_-22px_rgba(200,87,118,0.6)]'
                              : 'border-[#ead8df] bg-white/80 text-[#352432]/[0.70] hover:border-[#e798b4]'
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" strokeWidth={1.7} />
                          {label}
                        </motion.button>
                      )
                    })}
                  </div>
                  <p className="mt-2 text-[11.5px] leading-relaxed text-[#352432]/[0.55]">
                    {channelOptions.find((c) => c.key === channel)?.hint}
                    {channel === 'email' && mode === 'login'
                      ? ' Salonun kayıtlarında e-posta adresiniz yoksa kod telefonunuza gönderilir.'
                      : ''}
                  </p>
                </div>
              )}

              <AnimatePresence mode="popLayout">
                {mode === 'register' && (
                  <motion.div
                    key="register-extra"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-5 pt-1">
                      <div>
                        {/* İSTEĞE BAĞLI: doğum tarihi randevu almak için gerekmez, yalnız doğum
                            günü kampanyalarında kullanılır (App Store 5.1.1(v)). */}
                        <label className={labelCls}>Doğum Tarihi (isteğe bağlı)</label>
                        <div className={inputWrap}>
                          <CalendarDays className="h-4 w-4 shrink-0 text-[#c85776]/70" strokeWidth={1.6} />
                          <input
                            type="date"
                            value={birthDate}
                            onChange={(e) => setBirthDate(e.target.value)}
                            max={new Date().toISOString().slice(0, 10)}
                            className={inputCls}
                            autoComplete="bday"
                          />
                        </div>
                      </div>
                      <div>
                        <label className={labelCls}>Cinsiyet (isteğe bağlı)</label>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {genderOptions.map((option) => {
                            const active = gender === option.value
                            return (
                              <motion.button
                                key={option.value}
                                whileTap={{ scale: 0.985 }}
                                type="button"
                                onClick={() => setGender(option.value)}
                                className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-[12.5px] font-medium transition-colors ${
                                  active
                                    ? 'border-[#c85776] bg-[#fff0f5] text-[#2f1724] shadow-[0_12px_30px_-22px_rgba(200,87,118,0.6)]'
                                    : 'border-[#ead8df] bg-white/80 text-[#352432]/[0.70] hover:border-[#e798b4]'
                                }`}
                              >
                                {option.label}
                                <span
                                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors ${
                                    active ? 'border-[#c85776] bg-[#c85776]' : 'border-[#ead8df]'
                                  }`}
                                >
                                  {active && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                                </span>
                              </motion.button>
                            )
                          })}
                        </div>
                      </div>
                      <div>
                        <label className={labelCls}>
                          {channel === 'email' ? 'E-posta' : 'E-posta (isteğe bağlı)'}
                        </label>
                        <div className={inputWrap}>
                          <Mail className="h-4 w-4 shrink-0 text-[#c85776]/70" strokeWidth={1.6} />
                          <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="ornek@eposta.com"
                            className={inputCls}
                            autoComplete="email"
                          />
                        </div>
                        {channel === 'email' && (
                          <p className="mt-2 text-[11.5px] text-[#352432]/[0.55]">
                            Doğrulama kodu bu adrese gönderilecek.
                          </p>
                        )}
                      </div>

                      {/*
                        KVKK AÇIK RIZASI — ZORUNLU.
                        Eskiden hiçbir ekran onay sormuyordu ama kayıt veritabanına
                        "onay verildi" yazıyordu. Onay hukuki bir beyandır: alınmadan üretilemez.
                        Sunucu da ayrıca doğrular; bu kutu tek kapı değildir.
                      */}
                      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#ead8df] bg-white/80 p-4 transition-colors hover:border-[#e798b4]">
                        <input
                          type="checkbox"
                          checked={kvkkConsent}
                          onChange={(e) => {
                            setKvkkConsent(e.target.checked)
                            setError('')
                          }}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[#c85776]"
                        />
                        <span className="text-[12px] leading-relaxed text-[#352432]/[0.70]">
                          <a
                            href="/gizlilik"
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="font-semibold text-[#c85776] underline underline-offset-2"
                          >
                            KVKK aydınlatma metnini
                          </a>{' '}
                          okudum; kişisel verilerimin randevu işlemlerim için işlenmesine onay veriyorum.
                        </span>
                      </label>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* OTP kod adımı — WhatsApp ile gelen 6 haneli kod */}
              <AnimatePresence>
                {otpStage === 'code' && (
                  <motion.div
                    key="otp-code"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-2xl border border-[#e798b4]/50 bg-[#fff0f5]/70 p-4">
                      <div className="text-[12px] leading-relaxed text-[#352432]/[0.70]">{otpInfo}</div>
                      <div className="mt-3">
                        <label className={labelCls}>Doğrulama Kodu</label>
                        <div className={inputWrap}>
                          <Check className="h-4 w-4 shrink-0 text-[#c85776]/70" strokeWidth={1.6} />
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                            placeholder="6 haneli kod"
                            className={`${inputCls} tracking-[0.4em]`}
                            autoFocus
                          />
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px]">
                        <button type="button" onClick={() => { setOtpStage('idle'); setError('') }} className="text-[#9d7386] hover:text-[#c85776]">
                          ← Bilgilerle giriş yap
                        </button>
                        <button type="button" disabled={loading} onClick={() => void handleOtpRequest()} className="font-semibold text-[#c85776] hover:underline disabled:opacity-50">
                          Kodu tekrar gönder
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {error && (
                  <motion.div
                    key="error"
                    initial={{ opacity: 0, y: -6, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                    exit={{ opacity: 0, y: -6, height: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden rounded-2xl border border-rose-300/50 bg-rose-50 px-4 py-3 text-[12px] leading-relaxed text-rose-700"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.button
                whileHover={{ scale: 1.005 }}
                whileTap={{ scale: 0.99 }}
                type="submit"
                disabled={loading}
                className="group relative mt-1 w-full overflow-hidden rounded-2xl bg-gradient-to-r from-[#e798b4] via-[#d4789a] to-[#b75a7e] py-4 text-[13px] font-semibold tracking-wide text-white shadow-[0_20px_44px_-18px_rgba(183,90,126,0.75)] transition-shadow hover:shadow-[0_24px_54px_-16px_rgba(183,90,126,0.85)] disabled:opacity-60"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.22] to-transparent transition-transform duration-700 group-hover:translate-x-full"
                />
                <span className="relative z-10 flex items-center justify-center gap-3">
                  {loading ? (
                    <>
                      {mode === 'login' ? 'Giriş yapılıyor' : 'Kayıt oluşturuluyor'}
                      <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }}>
                        •••
                      </motion.span>
                    </>
                  ) : (
                    <>
                      {otpStage === 'code'
                        ? (mode === 'login' ? 'Kodu Doğrula ve Giriş Yap' : 'Kodu Doğrula ve Kaydı Tamamla')
                        : 'Doğrulama Kodu Gönder'}
                      <ArrowRight className="absolute right-5 h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </>
                  )}
                </span>
              </motion.button>

              {/* Ayrı "WhatsApp kodu ile giriş" butonu kaldırıldı: kod artık ALTERNATİF değil,
                  tek yol. Ana buton önce kodu gönderir, sonra doğrular. Kanalı kullanıcı seçer. */}

              <p className="flex items-center justify-center gap-2 pt-1 text-center text-[11px] text-[#352432]/[0.45]">
                <Lock className="h-3.5 w-3.5 text-[#c85776]/70" strokeWidth={1.6} />
                {otpStage === 'code'
                  ? 'Güvenliğiniz için size gönderilen doğrulama kodunu girmeniz gerekir.'
                  : mode === 'login'
                    ? 'Kaydınız yoksa "Kayıt Ol" sekmesinden saniyeler içinde hesap oluşturabilirsiniz.'
                    : 'Bilgileriniz yalnızca randevu işlemleriniz için kullanılır.'}
              </p>
            </div>
          </form>
        </motion.div>
      </div>
    </main>
  )
}
