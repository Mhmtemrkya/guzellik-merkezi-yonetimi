'use client'

import { useState, type ReactNode } from 'react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import AdminEditDialog, { type AdminField } from '@/components/dashboard/AdminEditDialog'
import PlatformMessagingSettings from '@/components/platform/PlatformMessagingSettings'
import { useApiQuery } from '@/hooks/useApiQuery'
import { healthApi, platformApi } from '@/lib/apiClient'
import {
  Activity,
  Database,
  Globe2,
  PlugZap,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { NotificationItem } from '@/lib/types'

const card = 'border border-[#fff4f8]/15 bg-[#fff4f8]/[0.025]'
const head = 'text-[10px] font-mono uppercase tracking-[0.26em] text-[#fff4f8]/45'

type StatusTone = 'pending' | 'active' | 'warning' | 'info' | 'muted'

const toneStyles: Record<StatusTone, string> = {
  pending: 'border-amber-200/30 bg-amber-200/10 text-amber-100',
  active: 'border-emerald-200/30 bg-emerald-200/10 text-emerald-100',
  warning: 'border-rose-200/30 bg-rose-200/10 text-rose-100',
  info: 'border-sky-200/30 bg-sky-200/10 text-sky-100',
  muted: 'border-[#fff4f8]/15 bg-[#fff4f8]/5 text-[#fff4f8]/70',
}

function StatusChip({ tone = 'muted', children }: { tone?: StatusTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[9px] font-mono uppercase tracking-widest ${
        toneStyles[tone] || toneStyles.muted
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          tone === 'active'
            ? 'bg-emerald-300'
            : tone === 'pending'
              ? 'bg-amber-300'
              : tone === 'warning'
                ? 'bg-rose-300'
                : tone === 'info'
                  ? 'bg-sky-300'
                  : 'bg-[#fff4f8]/60'
        }`}
      />
      {children}
    </span>
  )
}

function Stat({
  label,
  value,
  icon: Icon,
  sub,
}: {
  label: string
  value: string | number
  icon: LucideIcon
  sub?: string
}) {
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-start justify-between gap-4">
        <Icon className="h-4 w-4 text-[#fff4f8]/60" strokeWidth={1.4} />
        <span className="text-[9px] font-mono uppercase tracking-widest text-[#fff4f8]/35">canlı</span>
      </div>
      <div className="mt-4 font-display text-3xl tabular-nums tracking-tight">{value}</div>
      <div className="mt-1 text-[10px] font-mono uppercase tracking-widest text-[#fff4f8]/45">{label}</div>
      {sub && <div className="mt-3 text-xs text-[#fff4f8]/55">{sub}</div>}
    </div>
  )
}

interface SettingsCard {
  /** Backend bölüm anahtarı (PUT /api/platform/system/settings). */
  key: string
  title: string
  desc: string
  icon: LucideIcon
  chip: { tone: StatusTone; label: string }
  bullets: string[]
  fields: AdminField[]
}

const settings: SettingsCard[] = [
  {
    key: 'planLimits',
    title: 'Plan limitleri',
    desc: 'Varsayılan plan, kullanıcı ve müşteri tavanları, depolama ile aşım politikası.',
    icon: SlidersHorizontal,
    chip: { tone: 'active', label: 'Canlı' },
    bullets: [
      'Varsayılan plan: Profesyonel · Deneme süresi 14 gün',
      'Kullanıcı tavanı 25 · Müşteri tavanı 5.000',
      'Depolama tavanı 50 GB · Aşım: blokla ve uyar',
      'Tenant override: yalnız Platform Admin onayıyla',
    ],
    fields: [
      {
        label: 'Varsayılan plan',
        type: 'select',
        value: 'Profesyonel',
        options: ['Başlangıç', 'Profesyonel', 'Premium', 'AI Klinik', 'Enterprise'],
      },
      { label: 'Kullanıcı limiti', type: 'number', value: 25 },
      { label: 'Müşteri limiti', type: 'number', value: 5000 },
      { label: 'Depolama tavanı (GB)', type: 'number', value: 50 },
      {
        label: 'Aşım politikası',
        type: 'select',
        value: 'Blokla ve uyar',
        options: ['Blokla ve uyar', 'Esnek (kademeli ücret)', 'Sadece uyar'],
      },
      { label: 'Deneme süresi (gün)', type: 'number', value: 14 },
      { label: 'Tenant override izni', type: 'checkbox', value: false },
      {
        label: 'Operasyon notu',
        type: 'textarea',
        value: 'Limit artışı Platform Admin onayı ile yapılır; her artış audit log’a düşer.',
      },
    ],
  },
  {
    key: 'security',
    title: 'Global güvenlik',
    desc: '2FA politikası, oturum süresi, parola kuralları ve IP allowlist.',
    icon: ShieldCheck,
    chip: { tone: 'warning', label: '2FA zorunlu değil' },
    bullets: [
      '2FA: opsiyonel · Admin rolleri için zorunlu hale alınmalı',
      'Oturum süresi 60 dk · Inaktivite sonrası logout',
      'Parola en az 10 karakter · 5 başarısız giriş = 15 dk kilit',
      'IP allowlist: ofis VPN aralığı ve oncall sabit IP’leri',
    ],
    fields: [
      {
        label: '2FA politikası',
        type: 'select',
        value: 'Opsiyonel',
        options: ['Kapalı', 'Opsiyonel', 'Admin için zorunlu', 'Herkes için zorunlu'],
      },
      { label: 'Oturum süresi (dk)', type: 'number', value: 60 },
      { label: 'Parola minimum uzunluk', type: 'number', value: 10 },
      { label: 'Başarısız giriş limiti', type: 'number', value: 5 },
      { label: 'Hesap kilitleme süresi (dk)', type: 'number', value: 15 },
      {
        label: 'IP allowlist notları',
        type: 'textarea',
        value:
          'Ofis VPN: 10.20.0.0/16 · Oncall sabit IP listesi internal wiki/security/allowlist üzerinde tutulur.',
      },
    ],
  },
  {
    key: 'integrations',
    title: 'Entegrasyonlar',
    desc: 'SMTP, SMS, WhatsApp, ödeme sağlayıcısı ve webhook politikaları.',
    icon: PlugZap,
    chip: { tone: 'info', label: 'Kısmen aktif' },
    bullets: [
      'SMTP: noreply@beautyassist.app · SPF/DKIM doğrulandı',
      'SMS: NetGSM · WhatsApp template: onay bekliyor',
      'Ödeme: iyzico canlı · Test modu kapalı',
      'Webhook retry: 5 deneme · exponential backoff',
    ],
    fields: [
      { label: 'SMTP gönderici', type: 'email', value: 'noreply@beautyassist.app' },
      {
        label: 'SMS sağlayıcı',
        type: 'select',
        value: 'NetGSM',
        options: ['NetGSM', 'İletimerkezi', 'Twilio', 'Vatansms'],
      },
      {
        label: 'WhatsApp template durumu',
        type: 'select',
        value: 'Onay bekliyor',
        options: ['Onaylandı', 'Onay bekliyor', 'Reddedildi', 'Taslak'],
      },
      {
        label: 'Ödeme sağlayıcı',
        type: 'select',
        value: 'iyzico',
        options: ['iyzico', 'Param', 'PayTR', 'Stripe'],
      },
      { label: 'Webhook retry sayısı', type: 'number', value: 5 },
      { label: 'Test modu', type: 'checkbox', value: false },
      {
        label: 'Operasyon notu',
        type: 'textarea',
        value: 'WhatsApp template Meta tarafından onaylanmadan canlı kampanya açılmaz.',
      },
    ],
  },
  {
    key: 'maintenance',
    title: 'Bakım modu',
    desc: 'Planlı bakım penceresi, müşteri duyurusu ve admin bypass.',
    icon: Wrench,
    chip: { tone: 'muted', label: 'Kapalı' },
    bullets: [
      'Bakım modu: kapalı · Bir sonraki pencere planlanmadı',
      'Planlanan pencere: Pazar 03:00 – 05:00 (TRT)',
      'Müşteri duyurusu hazır · Üst banner otomatik gösterilir',
      'Admin bypass açık · Pencere bitiminde otomatik kapanır',
    ],
    fields: [
      { label: 'Bakım modu', type: 'checkbox', value: false },
      { label: 'Planlanan pencere', type: 'text', value: 'Pazar 03:00 – 05:00 (TRT)' },
      { label: 'Otomatik kapanma (dk)', type: 'number', value: 120 },
      { label: 'Admin bypass', type: 'checkbox', value: true },
      {
        label: 'Müşteri duyurusu',
        type: 'textarea',
        value:
          'Sistemimiz bu gece 03:00 – 05:00 arasında planlı bakım için kısa süreli erişime kapanacaktır. Randevu işlemleriniz etkilenmeyecek; bakım sonrası tüm modüller otomatik açılır.',
      },
    ],
  },
  {
    key: 'dataRetention',
    title: 'Veri saklama',
    desc: 'Yedekleme takvimi, log saklama süreleri ve KVKK anonimleştirme.',
    icon: Database,
    chip: { tone: 'active', label: 'Politika tanımlı' },
    bullets: [
      'Yedekleme: her gün 02:00 (TRT) · 30 gün saklanır',
      'Audit log: 365 gün · Sistem olay log: 90 gün',
      'KVKK anonimleştirme: pasif müşteri için 24 ay sonra otomatik',
      'Dışa aktarım onayı: KVKK Sorumlusu rolü zorunlu',
    ],
    fields: [
      { label: 'Yedekleme saati (0-23)', type: 'number', value: 2 },
      { label: 'Yedek saklama (gün)', type: 'number', value: 30 },
      { label: 'Audit log saklama (gün)', type: 'number', value: 365 },
      { label: 'Sistem log saklama (gün)', type: 'number', value: 90 },
      {
        label: 'KVKK anonimleştirme',
        type: 'select',
        value: 'Otomatik (24 ay)',
        options: ['Kapalı', 'Manuel', 'Otomatik (12 ay)', 'Otomatik (24 ay)', 'Otomatik (36 ay)'],
      },
      {
        label: 'Dışa aktarım onayı',
        type: 'select',
        value: 'KVKK Sorumlusu',
        options: ['Platform Admin', 'KVKK Sorumlusu', 'Tenant Admin', 'İki onay (KVKK + Admin)'],
      },
      {
        label: 'Politika notu',
        type: 'textarea',
        value:
          'KVKK Sorumlusu onayı olmadan tenant-dışı veri aktarımı yapılmaz; tüm işlemler audit log’a yazılır.',
      },
    ],
  },
]

interface HealthData {
  live: { status?: string; Status?: string; [key: string]: unknown }
  ready: { status?: string; Status?: string; [key: string]: unknown }
  system: ApiSystemSettings | null
  queue: ApiQueueStatus | null
}

interface ApiQueueStatus {
  pending: number
  processing: number
  failed: number
  succeededLast24h: number
  recentFailures: Array<{ id: string; type: string; attempts: number; lastError?: string | null; completedAtUtc?: string | null }>
}

interface ApiSystemSettings {
  planLimits?: string | null
  security?: string | null
  integrations?: string | null
  maintenance?: string | null
  dataRetention?: string | null
  maintenanceEnabled?: boolean
  updatedAtUtc?: string
}

type SectionValues = Record<string, unknown>

function parseSection(json: string | null | undefined): SectionValues {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as SectionValues) : {}
  } catch {
    return {}
  }
}

/** Varsayılan alanların üzerine kayıtlı değerleri bindirir (label = form anahtarı). */
function mergeFields(fields: AdminField[], saved: SectionValues): AdminField[] {
  return fields.map((f) => {
    const key = f.name || f.label
    if (!(key in saved)) return f
    return { ...f, value: saved[key] as AdminField['value'] }
  })
}

export default function PlatformSistemPage() {
  const [savedTick, setSavedTick] = useState(0)
  const { data, loading, error } = useApiQuery<HealthData>(
    async () => ({
      live: (await healthApi.live()) as HealthData['live'],
      ready: (await healthApi.ready()) as HealthData['ready'],
      system: await platformApi.systemSettings<ApiSystemSettings>().catch(() => null),
      queue: await platformApi.queueStatus<ApiQueueStatus>().catch(() => null),
    }),
    [savedTick],
    { initialData: null },
  )
  const sectionValues: Record<string, SectionValues> = {
    planLimits: parseSection(data?.system?.planLimits),
    security: parseSection(data?.system?.security),
    integrations: parseSection(data?.system?.integrations),
    maintenance: parseSection(data?.system?.maintenance),
    dataRetention: parseSection(data?.system?.dataRetention),
  }
  const maintenanceOn = data?.system?.maintenanceEnabled === true
  const liveStatus = data?.live?.status || data?.live?.Status
  const readyStatus = data?.ready?.status || data?.ready?.Status
  const systemNotifications: NotificationItem[] = [
    {
      title: error ? 'Health API okunamadı' : `Health live: ${liveStatus || 'yükleniyor'}`,
      description: error
        ? 'Backend health kontrolünde hata var; Sistem sayfasındaki hata detayına bakılmalı.'
        : 'Canlılık endpoint’i gerçek API’den okunuyor.',
      meta: error ? 'Hata' : 'Health',
      href: '/platform/sistem',
    },
    {
      title: `Health ready: ${readyStatus || (loading ? 'yükleniyor' : 'bilinmiyor')}`,
      description: 'Readiness endpoint’i servis bağımlılıklarının hazır olup olmadığını gösterir.',
      meta: 'Ready',
      href: '/platform/sistem',
    },
  ]
  return (
    <>
      <Topbar
        title="Sistem Ayarları"
        subtitle="Global plan, güvenlik, entegrasyon ve veri politikaları · canlı ayar kaydı + iş kuyruğu izleme"
        breadcrumbs={['Platform', 'Sistem']}
        pendingCount={systemNotifications.length}
        notifications={systemNotifications}
      />
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice loading={loading} error={error} empty={false} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Live" value={liveStatus || '—'} icon={Globe2} sub="Health canlılık endpoint" />
          <Stat label="Ready" value={readyStatus || '—'} icon={Database} sub="Bağımlılıklar hazır mı?" />
          <Stat label="Ayar kaydı" value={data?.system ? 'Canlı' : '—'} icon={PlugZap} sub="Platform ayarları veritabanında" />
          <Stat label="Bakım modu" value={maintenanceOn ? 'AÇIK' : 'Kapalı'} icon={Server} sub={maintenanceOn ? 'Bakım bayrağı aktif' : 'Bakım bayrağı kapalı'} />
        </div>

        {/* SMS + E-POSTA ALTYAPISI (platform geneli) */}
        <div>
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className="font-display text-lg tracking-tight text-[#fff4f8]">Mesajlaşma Altyapısı</h2>
            <span className="text-[11px] text-[#fff4f8]/40">SMS &amp; e-posta · tüm kurumlar için merkezi</span>
          </div>
          <PlatformMessagingSettings />
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {settings.map((s, i) => {
            const Icon = s.icon
            return (
              <div key={s.title} className={`${card} flex flex-col gap-4 p-5`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center border border-[#fff4f8]/15 bg-[#fff4f8]/[0.03]">
                    <Icon className="h-5 w-5 text-[#fff4f8]/70" strokeWidth={1.4} />
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StatusChip tone={s.chip.tone}>{s.chip.label}</StatusChip>
                    <span className="text-[9px] font-mono text-[#fff4f8]/35">0{i + 1}</span>
                  </div>
                </div>
                <div>
                  <div className="font-display text-2xl tracking-tight">{s.title}</div>
                  <p className="mt-2 text-sm leading-6 text-[#fff4f8]/55">{s.desc}</p>
                </div>
                <ul className="space-y-1.5 border-t border-[#fff4f8]/10 pt-4">
                  {s.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-[12px] leading-5 text-[#fff4f8]/70">
                      <span className="mt-2 inline-block h-1 w-1 shrink-0 bg-[#fff4f8]/40" />
                      <span className="min-w-0">{b}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto">
                  <AdminEditDialog
                    triggerVariant="ghost"
                    triggerLabel="Yönet"
                    title={s.title}
                    description={s.desc}
                    note="Değişiklikler platform ayarlarına kaydedilir ve audit log'a düşer."
                    submitLabel="Politikayı uygula"
                    fields={mergeFields(s.fields, sectionValues[s.key] || {})}
                    onSubmit={async (values) => {
                      // Bakım modu kartında checkbox hızlı bayrak olarak da saklanır.
                      const maintenanceFlag = s.key === 'maintenance' ? values['Bakım modu'] === true : undefined
                      await platformApi.saveSystemSection(s.key, values, maintenanceFlag)
                      setSavedTick((t) => t + 1)
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
        {/* KALICI İŞ KUYRUĞU — canlı sağlık */}
        <div className={`${card} p-5`}>
          <div className={head}>Arka plan iş kuyruğu</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            {[
              ['Bekleyen', data?.queue?.pending ?? '—'],
              ['İşleniyor', data?.queue?.processing ?? '—'],
              ['Başarısız (dead-letter)', data?.queue?.failed ?? '—'],
              ['Son 24s başarılı', data?.queue?.succeededLast24h ?? '—'],
            ].map(([label, value]) => (
              <div key={String(label)} className="border border-[#fff4f8]/10 p-4">
                <div className="flex items-center gap-2 text-sm"><Activity className="h-4 w-4" /> {label}</div>
                <div className="mt-2 font-display text-3xl tabular-nums">{value}</div>
              </div>
            ))}
          </div>
          {(data?.queue?.recentFailures?.length ?? 0) > 0 && (
            <div className="mt-4 space-y-2">
              <div className={head}>Son başarısız işler</div>
              {data!.queue!.recentFailures.map((f) => (
                <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 border border-rose-300/25 bg-rose-500/5 p-3 text-xs">
                  <div className="min-w-0">
                    <span className="font-mono text-rose-200">{f.type}</span>
                    <span className="ml-2 text-[#fff4f8]/50">{f.attempts} deneme · {f.lastError || 'hata detayı yok'}</span>
                  </div>
                  <button
                    type="button"
                    className="border border-[#fff4f8]/20 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-[#fff4f8]/70 hover:text-[#fff4f8]"
                    onClick={async () => {
                      await platformApi.requeueJob(f.id).catch(() => undefined)
                      setSavedTick((t) => t + 1)
                    }}
                  >
                    Yeniden dene
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
