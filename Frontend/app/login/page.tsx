'use client'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  MapPin,
  Shield,
  ShieldCheck,
  Sparkles,
  Users2,
  type LucideIcon,
} from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useAuth } from '@/components/dashboard/AuthContext'
import type { Branch, Institution, UserRole } from '@/lib/types'

function tenantStatusLabel(status: string | null | undefined): string {
  const key = String(status || '').toLowerCase()
  if (key === 'active') return 'aktif'
  if (key === 'trial') return 'deneme'
  if (key === 'suspended') return 'askıda'
  if (key === 'cancelled') return 'iptal'
  return status || 'durum yok'
}

interface RoleMeta {
  role: UserRole
  title: string
  badge: string
  desc: string
  icon: LucideIcon
  href: string
  /** Rol kartının arka plan degrade sınıfı — görseldeki açık pembe → bordo skalası. */
  cardClass: string
}

const roleMetas: RoleMeta[] = [
  {
    role: 'InstitutionOwner',
    title: 'Kurum Yöneticisi',
    badge: 'YÖNETİM',
    desc: 'Personel, müşteri, paket, taksit, randevu, kasa ve raporların tam yönetimi. Rol atama ve onay yetkisi.',
    icon: Building2,
    href: '/admin',
    cardClass: 'from-[#f7c6d6] via-[#f0aac2] to-[#e798b4] text-[#3a1f2c]',
  },
  {
    role: 'BranchManager',
    title: 'Şube Yöneticisi',
    badge: 'YÖNETİM',
    desc: 'Bağlı şubenin personel, randevu, müşteri ve kasa operasyonlarının yönetimi. Şube bazlı rapor erişimi.',
    icon: MapPin,
    href: '/admin',
    cardClass: 'from-[#c2718c] via-[#a85673] to-[#8e3f5c] text-white',
  },
  {
    role: 'Staff',
    title: 'Personel',
    badge: 'OPERASYON',
    desc: 'Atanmış yetkilere göre randevu, müşteri ve seans işlemleri. Tüm işlemler yönetici onayı ve log kaydı ile.',
    icon: Users2,
    href: '/personel',
    cardClass: 'from-[#8e3f5c] via-[#6e2f47] to-[#54243a] text-white',
  },
  {
    role: 'PlatformAdmin',
    title: 'Platform Admin',
    badge: 'SİSTEM',
    desc: 'Tüm kurumları yönetme, sistem sağlığı, abonelik durumları, MRR ve genel platform metriklerine erişim.',
    icon: Shield,
    href: '/platform',
    cardClass: 'from-[#4a2236] via-[#3a1a2b] to-[#2a1220] text-white',
  },
]

function roleMetaFor(role: UserRole | string | null | undefined): RoleMeta | null {
  return roleMetas.find((m) => m.role === role) ?? null
}

interface ScopeState {
  role: UserRole | string | null
  tenants: Institution[]
}

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

export default function LoginPage() {
  const [email, setEmail] = useState<string>('')
  const [password, setPassword] = useState<string>('')
  const [showPassword, setShowPassword] = useState<boolean>(false)
  const [remember, setRemember] = useState<boolean>(true)
  const [forgotOpen, setForgotOpen] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(false)
  const [scopeLoading, setScopeLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')
  const [scope, setScope] = useState<ScopeState | null>(null)
  const { selectedInstitutionId, selectedBranchId, setScope: setBranchScope } = useBranch()
  const { loginScope, login, hydrated, session, isAuthenticated } = useAuth()
  const [institutionId, setInstitutionId] = useState<string | null>(selectedInstitutionId)
  const [branchId, setBranchId] = useState<string | null>(selectedBranchId)
  const router = useRouter()

  const normalizedEmail = email.trim().toLowerCase()
  const emailLooksReady = normalizedEmail.includes('@') && normalizedEmail.includes('.')

  const detectedMeta = roleMetaFor(scope?.role)
  const isPlatform = detectedMeta?.role === 'PlatformAdmin'
  const availableInstitutions: Institution[] = !isPlatform ? scope?.tenants || [] : []
  const selectedInstitution: Institution | undefined =
    availableInstitutions.find((k) => k.id === institutionId || k.tenantId === institutionId) ||
    availableInstitutions[0]
  const availableBranches: Branch[] = selectedInstitution?.branches || []
  const selectedBranch: Branch | undefined =
    availableBranches.find((b) => b.id === branchId || b.branchId === branchId) ||
    availableBranches.find((b) => b.isDefault) ||
    availableBranches[0]

  // Masaüstü (Tauri) kabuğu her açılışta /login yükler; "beni hatırla" ile saklanan geçerli
  // oturum varsa formu göstermeden doğrudan role uygun panele geç. Web'de davranış değişmez.
  useEffect(() => {
    if (!hydrated || !isAuthenticated) return
    if (typeof navigator === 'undefined' || !navigator.userAgent.includes('BeautyAsistDesktop')) return
    if (session?.user?.mustChangePassword) {
      router.replace('/change-password')
      return
    }
    const meta = roleMetaFor(session?.user?.role)
    if (meta) router.replace(meta.href)
  }, [hydrated, isAuthenticated, session, router])

  // E-posta yazıldıkça rol + kurum kapsamı otomatik tespit edilir (rol gönderilmez, backend bulur).
  useEffect(() => {
    setScope(null)
    setError('')
    if (!emailLooksReady) return
    const run = setTimeout(async () => {
      try {
        setScopeLoading(true)
        const response = await loginScope({ email: normalizedEmail })
        setScope({ role: response.role, tenants: response.tenants })
        const firstTenant = response.tenants?.[0]
        const firstBranch = firstTenant?.branches?.find((b) => b.isDefault) || firstTenant?.branches?.[0]
        setInstitutionId(firstTenant?.id ?? null)
        setBranchId(firstBranch?.id ?? null)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Hesap kapsamı alınamadı.'
        setError(message || 'Hesap kapsamı alınamadı.')
      } finally {
        setScopeLoading(false)
      }
    }, 400)
    return () => clearTimeout(run)
  }, [emailLooksReady, normalizedEmail, loginScope])

  const chooseInstitution = (institution: Institution): void => {
    const defaultBranch = institution.branches?.find((b) => b.isDefault) || institution.branches?.[0]
    setInstitutionId(institution.id)
    setBranchId(defaultBranch?.id ?? null)
  }

  const handleLogin = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setError('')
    if (!detectedMeta) {
      setError('Bu e-posta için tanımlı bir rol bulunamadı.')
      return
    }
    if (!password) {
      setError('Parola zorunlu.')
      return
    }
    if (!isPlatform && (!selectedInstitution?.id || !selectedBranch?.id)) {
      setError('Bu e-posta için geçerli kurum/şube seçimi bulunamadı.')
      return
    }
    try {
      setLoading(true)
      const session = await login({
        email: normalizedEmail,
        password,
        roleKey: detectedMeta.role,
        tenantId: isPlatform ? null : selectedInstitution?.id ?? null,
        branchId: isPlatform ? null : selectedBranch?.id ?? null,
        scope: scope ? { role: detectedMeta.role, tenants: scope.tenants } : null,
        remember,
      })
      if (!isPlatform && selectedInstitution && selectedBranch) {
        setBranchScope(selectedInstitution.id, selectedBranch.id)
      }
      if (session?.user?.mustChangePassword) {
        router.push('/change-password')
        return
      }
      router.push(detectedMeta.href)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Giriş yapılamadı. Bilgileri kontrol edin.'
      setError(message || 'Giriş yapılamadı. Bilgileri kontrol edin.')
    } finally {
      setLoading(false)
    }
  }

  const RoleIcon = detectedMeta?.icon

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#fbe9f0] text-[#352432]">
      {/* arka plan görseli + dekor */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          src="/login-arkaplan.png"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
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
                  Beauty &amp; Wellness Technology
                </span>
              </span>
            </motion.a>

            <motion.div
              variants={itemVariants}
              className="mt-12 text-[10px] font-mono uppercase tracking-[0.32em] text-[#c85776]/75"
            >
              Güzelliği yönetmenin en zarif hali
            </motion.div>

            <motion.h1
              variants={itemVariants}
              className="mt-4 font-display text-5xl leading-[1.02] tracking-tight text-[#3a1f2c] xl:text-6xl"
            >
              Tek giriş,
              <br />
              <span className="beautyasist-text-gradient italic">tüm paneller.</span>
            </motion.h1>

            <motion.p variants={itemVariants} className="mt-6 max-w-sm text-[13px] leading-relaxed text-[#352432]/[0.60]">
              BeautyAsist ile kurumunuzun tüm süreçlerini tek platformda yönetin. Güvenli, hızlı ve role özel deneyimle
              fark yaratın.
            </motion.p>

            <div className="mt-10 space-y-6">
              <FeatureRow
                icon={BarChart3}
                title="Tüm süreçler tek platformda"
                desc="Randevu, müşteri, paket, finans ve raporlar tek ekosistemde."
              />
              <FeatureRow
                icon={ShieldCheck}
                title="Güvenli ve uyumlu altyapı"
                desc="Verileriniz KVKK uyumlu, yüksek güvenlik standartlarıyla korunur."
              />
              <FeatureRow
                icon={Sparkles}
                title="Rol bazlı akıllı erişim"
                desc="Yetkinize göre doğru panelde üretkenliğinizi artırın."
              />
            </div>

            <motion.div
              variants={itemVariants}
              className="mt-10 flex items-center gap-4 rounded-2xl border border-[#ead8df] bg-white/70 px-4 py-3.5 backdrop-blur"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl border border-[#ead8df] bg-white text-[#c85776]">
                <Lock className="h-4 w-4" strokeWidth={1.6} />
              </span>
              <div className="flex-1">
                <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.2em] text-[#352432]/[0.60]">
                  <span>Güvenli oturum</span>
                  <span>Süre: 30 dk</span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <span className="text-[10px] text-[#352432]/[0.45]">Uçtan uca şifreleme ile korunur</span>
                  <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-[#f0aac2]/[0.25]">
                    <motion.span
                      animate={{ x: ['-100%', '120%'] }}
                      transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
                      className="absolute inset-y-0 w-1/2 rounded-full bg-gradient-to-r from-[#f0aac2] to-[#c85776]"
                    />
                  </span>
                </div>
              </div>
            </motion.div>
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
            onSubmit={handleLogin}
            className="relative overflow-hidden rounded-[32px] border border-white/80 bg-gradient-to-br from-white/95 via-[#fff7fa]/95 to-[#fff0f5]/95 p-6 shadow-[0_44px_120px_-48px_rgba(120,71,88,0.55)] backdrop-blur-2xl sm:p-10"
          >
            <span aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#f0aac2]/[0.22] blur-3xl" />
            <span aria-hidden className="pointer-events-none absolute -left-20 bottom-0 h-56 w-56 rounded-full bg-[#ffd3df]/[0.20] blur-3xl" />

            <div className="relative text-center">
              <div className="text-[13px] font-medium text-[#c85776]">Hoş geldiniz</div>
              <h2 className="mt-1.5 flex items-center justify-center gap-3 font-display text-[32px] leading-tight tracking-tight text-[#2f1724] sm:text-[42px]">
                <Sparkles aria-hidden className="hidden h-4 w-4 text-[#e798b4] sm:block" />
                Hangi panelde devam edeceksiniz?
                <Sparkles aria-hidden className="hidden h-4 w-4 text-[#e798b4] sm:block" />
              </h2>
              <p className="mt-2 text-[12px] text-[#352432]/[0.50]">Tek oturum ile rol bazlı erişim</p>
            </div>

            <div className="relative mt-8 space-y-5">
              <div>
                <label className={labelCls}>E-posta / Kullanıcı adı</label>
                <div className={inputWrap}>
                  <Mail className="h-4 w-4 shrink-0 text-[#c85776]/70" strokeWidth={1.6} />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="E-posta adresiniz veya kullanıcı adınız"
                    className={inputCls}
                    autoComplete="username"
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Şifre</label>
                <div className={inputWrap}>
                  <Lock className="h-4 w-4 shrink-0 text-[#c85776]/70" strokeWidth={1.6} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Şifrenizi giriniz"
                    className={inputCls}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
                    className="text-[#352432]/[0.35] transition-colors hover:text-[#c85776]"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-[12px]">
                <button
                  type="button"
                  onClick={() => setRemember((v) => !v)}
                  className="flex items-center gap-2 text-[#352432]/[0.65] transition-colors hover:text-[#352432]"
                >
                  <span
                    className={`grid h-[18px] w-[18px] place-items-center rounded-md border transition-colors ${
                      remember ? 'border-[#c85776] bg-[#c85776]' : 'border-[#ead8df] bg-white'
                    }`}
                  >
                    {remember && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                  </span>
                  Beni hatırla
                </button>
                <button
                  type="button"
                  onClick={() => setForgotOpen(true)}
                  className="text-[#c85776] transition-colors hover:text-[#a23f5c]"
                >
                  Şifremi unuttum?
                </button>
              </div>

              {/* E-posta girilince: kurum/şube seçimi + tespit edilen rol */}
              <AnimatePresence mode="popLayout">
                {emailLooksReady && (
                  <motion.div
                    key="scope-area"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-4 pt-1">
                      {scopeLoading ? (
                        <div className="flex items-center gap-3 rounded-2xl border border-[#ead8df] bg-white/80 px-4 py-3.5 text-[12px] text-[#352432]/[0.60]">
                          <motion.span
                            aria-hidden
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
                            className="h-3.5 w-3.5 rounded-full border-2 border-[#c85776] border-t-transparent"
                          />
                          Hesabınız tanınıyor, erişim kapsamı hazırlanıyor...
                        </div>
                      ) : !detectedMeta ? (
                        <div className="rounded-2xl border border-amber-300/50 bg-amber-50 px-4 py-3.5 text-[12px] leading-relaxed text-amber-800">
                          Bu e-posta için sistemde tanımlı bir hesap bulunamadı. Kurum yöneticinizden veya Platform
                          Admin&apos;den erişim talep edin.
                        </div>
                      ) : (
                        <>
                          {/* Kurum seçimi — birden çok kurum varsa */}
                          {!isPlatform && availableInstitutions.length > 1 && (
                            <div>
                              <div className={labelCls}>Kurum seçimi</div>
                              <div className="grid gap-2">
                                {availableInstitutions.map((institution) => {
                                  const active = institution.id === selectedInstitution?.id
                                  return (
                                    <motion.button
                                      key={institution.id}
                                      whileTap={{ scale: 0.985 }}
                                      type="button"
                                      onClick={() => chooseInstitution(institution)}
                                      className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors ${
                                        active
                                          ? 'border-[#c85776] bg-[#fff0f5] shadow-[0_12px_30px_-22px_rgba(200,87,118,0.6)]'
                                          : 'border-[#ead8df] bg-white/80 hover:border-[#e798b4]'
                                      }`}
                                    >
                                      <span>
                                        <span className="block text-[13.5px] font-semibold text-[#2f1724]">
                                          {institution.name}
                                        </span>
                                        <span className="mt-0.5 block text-[10px] font-mono uppercase tracking-widest text-[#352432]/[0.45]">
                                          {institution.plan} · {institution.branches.length} şube ·{' '}
                                          {tenantStatusLabel(institution.status)}
                                        </span>
                                      </span>
                                      <span
                                        className={`grid h-5 w-5 place-items-center rounded-full border transition-colors ${
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
                          )}

                          {/* Şube seçimi */}
                          {!isPlatform && availableBranches.length > 0 && (
                            <div>
                              <div className={labelCls}>
                                {selectedInstitution?.name ? `${selectedInstitution.name} · Şube seçimi` : 'Şube seçimi'}
                              </div>
                              {availableInstitutions.length === 0 ? (
                                <div className="rounded-2xl border border-amber-300/50 bg-amber-50 px-4 py-3.5 text-[12px] text-amber-800">
                                  Bu hesap için tanımlı kurum bulunamadı.
                                </div>
                              ) : (
                                <div className="grid gap-2 sm:grid-cols-2">
                                  {availableBranches.map((branch) => {
                                    const active = branch.id === selectedBranch?.id
                                    return (
                                      <motion.button
                                        key={branch.id}
                                        whileTap={{ scale: 0.985 }}
                                        type="button"
                                        onClick={() => setBranchId(branch.id)}
                                        className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors ${
                                          active
                                            ? 'border-[#c85776] bg-[#fff0f5] shadow-[0_12px_30px_-22px_rgba(200,87,118,0.6)]'
                                            : 'border-[#ead8df] bg-white/80 hover:border-[#e798b4]'
                                        }`}
                                      >
                                        <span className="flex items-center gap-2.5">
                                          <MapPin
                                            className={`h-4 w-4 ${active ? 'text-[#c85776]' : 'text-[#352432]/[0.35]'}`}
                                            strokeWidth={1.6}
                                          />
                                          <span>
                                            <span className="block text-[13px] font-medium text-[#2f1724]">
                                              {branch.name}
                                            </span>
                                            <span className="mt-0.5 block text-[10px] font-mono uppercase tracking-widest text-[#352432]/[0.40]">
                                              {branch.city}
                                            </span>
                                          </span>
                                        </span>
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
                              )}
                            </div>
                          )}

                          {!isPlatform && availableInstitutions.length === 0 && (
                            <div className="rounded-2xl border border-amber-300/50 bg-amber-50 px-4 py-3.5 text-[12px] leading-relaxed text-amber-800">
                              Bu e-posta için tanımlı kurum bulunamadı. Platform Admin önce tenant erişimi vermeli.
                            </div>
                          )}

                          {/* Tespit edilen rol — tam genişlik kart */}
                          <div>
                            <div className={labelCls}>Erişim rolün</div>
                            <motion.div
                              initial={{ opacity: 0, y: 8, scale: 0.99 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                              className={`relative w-full overflow-hidden rounded-3xl bg-gradient-to-br p-5 shadow-[0_24px_60px_-30px_rgba(74,34,54,0.65)] sm:p-6 ${detectedMeta.cardClass}`}
                            >
                              <span
                                aria-hidden
                                className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-white/[0.16] blur-2xl"
                              />
                              <motion.span
                                aria-hidden
                                animate={{ opacity: [0, 0.5, 0] }}
                                transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
                                className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.12] to-transparent"
                              />
                              <div className="relative flex items-start gap-4">
                                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/40 bg-white/[0.18] shadow-inner backdrop-blur">
                                  {RoleIcon && <RoleIcon className="h-5 w-5" strokeWidth={1.5} />}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="font-display text-2xl leading-tight tracking-tight">
                                      {detectedMeta.title}
                                    </div>
                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/35 bg-black/[0.14] px-3 py-1 text-[9px] font-mono uppercase tracking-[0.2em]">
                                      <Check className="h-3 w-3" strokeWidth={2.5} />
                                      {detectedMeta.badge}
                                    </span>
                                  </div>
                                  <p className="mt-2 max-w-xl text-[11.5px] leading-relaxed opacity-80">
                                    {detectedMeta.desc}
                                  </p>
                                </div>
                              </div>
                            </motion.div>
                          </div>
                        </>
                      )}
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
                disabled={loading || scopeLoading || (emailLooksReady && !scopeLoading && !detectedMeta)}
                className="group relative mt-1 w-full overflow-hidden rounded-2xl bg-gradient-to-r from-[#e798b4] via-[#d4789a] to-[#b75a7e] py-4 text-[13px] font-semibold tracking-wide text-white shadow-[0_20px_44px_-18px_rgba(183,90,126,0.75)] transition-shadow hover:shadow-[0_24px_54px_-16px_rgba(183,90,126,0.85)] disabled:opacity-60"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.22] to-transparent transition-transform duration-700 group-hover:translate-x-full"
                />
                <span className="relative z-10 flex items-center justify-center gap-3">
                  {loading ? (
                    <>
                      Giriş yapılıyor
                      <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }}>
                        •••
                      </motion.span>
                    </>
                  ) : scopeLoading ? (
                    <>
                      Hesap tanınıyor
                      <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }}>
                        •••
                      </motion.span>
                    </>
                  ) : (
                    <>
                      Giriş Yap ve Devam Et
                      <ArrowRight className="absolute right-5 h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </>
                  )}
                </span>
              </motion.button>

              <p className="flex items-center justify-center gap-2 pt-1 text-center text-[11px] text-[#352432]/[0.45]">
                <ShieldCheck className="h-3.5 w-3.5 text-[#c85776]/70" strokeWidth={1.6} />
                Giriş sonrası yetkinize göre ilgili panele yönlendirileceksiniz.
              </p>
            </div>
          </form>
        </motion.div>
      </div>

      {/* Şifremi unuttum — sıfırlama yönetici üzerinden yapılır */}
      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent
          className="overflow-hidden rounded-[28px] border border-[#ead8df]/[0.90] bg-gradient-to-br from-white via-[#fff7fa] to-[#fff0f5] p-0 text-[#352432] shadow-[0_34px_120px_-58px_rgba(120,71,88,0.72)] backdrop-blur-2xl"
          style={{ width: 'min(94vw, 520px)', maxWidth: 'min(94vw, 520px)' }}
        >
          <div className="relative p-6 sm:p-7">
            <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[#f0aac2]/[0.22] blur-3xl" />
            <div className="relative flex items-start gap-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#efbfd0]/[0.80] bg-white text-[#c85776] shadow-[0_14px_34px_-24px_rgba(200,87,118,0.8)]">
                <KeyRound className="h-4 w-4" strokeWidth={1.6} />
              </span>
              <div className="min-w-0 flex-1">
                <DialogTitle className="font-display text-2xl tracking-tight">Şifreni mi unuttun?</DialogTitle>
                <DialogDescription className="mt-1.5 text-[12px] leading-relaxed text-[#352432]/[0.60]">
                  Güvenlik nedeniyle şifre sıfırlama yöneticin üzerinden yapılır.
                </DialogDescription>
              </div>
            </div>

            <div className="relative mt-5 space-y-3 text-[12.5px] leading-relaxed">
              <div className="rounded-2xl border border-[#ead8df]/[0.80] bg-white/[0.80] p-3.5">
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-[#c85776]/80">
                  <Users2 className="h-3.5 w-3.5" /> Personelsen
                </div>
                <p className="mt-1.5 text-[#352432]/[0.70]">
                  Kurum yöneticine başvur — Personel sayfasından şifreni sıfırlayıp sana yeni geçici şifre iletir.
                </p>
              </div>
              <div className="rounded-2xl border border-[#ead8df]/[0.80] bg-white/[0.80] p-3.5">
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-[#c85776]/80">
                  <Building2 className="h-3.5 w-3.5" /> Kurum yöneticisiysen
                </div>
                <p className="mt-1.5 text-[#352432]/[0.70]">
                  BeautyAsist destek ekibine ulaş — Platform Admin şifreni sıfırlayıp yeni geçici şifreni iletir.
                </p>
              </div>
              <div className="flex items-start gap-2 rounded-2xl border border-amber-200/[0.90] bg-amber-50/[0.86] px-3.5 py-3 text-[11.5px] text-amber-800">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Sıfırlama sonrası geçici şifreyle giriş yapar yapmaz yeni şifreni belirlemen istenir; eski oturumların
                  güvenlik için kapatılır.
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setForgotOpen(false)}
              className="relative mt-5 w-full rounded-2xl bg-gradient-to-r from-[#e798b4] via-[#d4789a] to-[#b75a7e] py-3 text-[12px] font-semibold text-white shadow-[0_16px_36px_-16px_rgba(183,90,126,0.75)] transition-opacity hover:opacity-90"
            >
              Anladım
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}
