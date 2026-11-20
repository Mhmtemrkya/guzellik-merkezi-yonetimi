'use client'

import { useState } from 'react'
import { parseUtc } from '@/lib/datetime'
import { Bot, Building2, CircleHelp, MessageSquare, ShieldCheck, ThumbsDown, ThumbsUp, Users, Zap } from 'lucide-react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import { useApiQuery } from '@/hooks/useApiQuery'
import { fetchPlatformAssistantStats, type AssistantPlatformStats, type AssistantStatsCount } from '@/lib/assistantApi'

const RANGES = [7, 30, 90] as const

const PORTAL_LABELS: Record<string, string> = { owner: 'Kurum sahibi', branch: 'Şube yöneticisi', staff: 'Personel', customer: 'Müşteri' }
const OUTCOME_LABELS: Record<string, string> = {
  answered: 'Veri cevabı', how_to: 'Nasıl yapılır', small_talk: 'Sohbet', other_portal: 'Başka panele yönlendirme',
  not_found: 'Cevaplanamadı', denied: 'Yetki / paket dışı', advice_refused: 'Tavsiye reddi', error: 'Hata',
}
const INTENT_LABELS: Record<string, string> = {
  HowTo: 'Nasıl yapılır', Unknown: 'Anlaşılamadı', Help: 'Neler yapabilirsin', BeautyAdvice: 'Güzellik/sağlık tavsiyesi',
  AppointmentsToday: 'Bugünkü randevular', NextAppointment: 'Sıradaki randevu', WeekSchedule: 'Haftalık program',
  RemainingSessions: 'Kalan seans', MyRating: 'Yıldız puanı', PendingApprovals: 'Onay bekleyenler', FreeSlots: 'Boş saatler',
  Revenue: 'Ciro', OverdueInstallments: 'Geciken taksitler', CriticalStock: 'Kritik stok', Waitlist: 'Bekleme listesi',
  TopStaff: 'En çok çalışan personel', NoShows: 'Gelmeyen müşteriler', AppointmentHistory: 'Randevu geçmişi',
}
const MATCHED_LABELS: Record<string, string> = { ai: 'Yapay zekâ', rule: 'Anahtar kelime', rule_spelling: 'Yazım düzeltmeli' }

const fmt = (value: number) => value.toLocaleString('tr-TR')

/**
 * MAYDİ İSTATİSTİKLERİ (platform) — kurum bazında kullanım, cevaplama oranı, geri bildirim ve yapay zekâ maliyeti.
 * KİŞİ ve KONUŞMA İÇERİĞİ GÖSTERİLMEZ. "Ortak cevaplanamayan sorular" yalnız en az iki farklı kurumda sorulmuş
 * genel sorulardır (sayı/e-posta gizli) — katalogda eksik makaleyi bulmak içindir.
 */
export default function PlatformMaydiStatsPage() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30)
  const { data, loading, error } = useApiQuery<AssistantPlatformStats | null>(() => fetchPlatformAssistantStats(days), [days], { initialData: null })

  return (
    <>
      <Topbar title="Maydi İstatistikleri" subtitle={`Son ${days} gün · kurum bazında kullanım (kişi ve konuşma içeriği yok)`} breadcrumbs={['Platform', 'Sistem', 'Maydi']} />
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2 text-[12px] text-[#5A4B53]">
            <ShieldCheck className="h-4 w-4 text-emerald-600" /> Yalnız sayılar ve kurum adları gösterilir; kullanıcı ve sohbet metni yoktur.
          </p>
          <div className="flex gap-1 rounded-xl border border-[#EAD8DF] bg-white p-1">
            {RANGES.map((range) => (
              <button key={range} type="button" onClick={() => setDays(range)}
                className={`rounded-lg px-3 py-1 text-[11.5px] font-semibold ${days === range ? 'bg-[#8e3f5b] text-white' : 'text-[#5A4B53]'}`}>
                {range} gün
              </button>
            ))}
          </div>
        </div>

        <ApiStateNotice loading={loading && !data} error={error} empty={false} />

        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi icon={MessageSquare} label="Soru" value={fmt(data.totals.questions)} hint={`${fmt(data.totals.conversations)} sohbet`} />
              <Kpi icon={CircleHelp} label="Cevaplama oranı" value={`%${data.totals.answerRate.toLocaleString('tr-TR')}`} hint={`${fmt(data.totals.notFound)} cevaplanamadı`} />
              <Kpi icon={Building2} label="Aktif kurum" value={fmt(data.totals.activeTenants)} hint={`${fmt(data.totals.activeUsers)} aktif kullanıcı`} />
              <Kpi icon={ThumbsUp} label="Geri bildirim" value={`${fmt(data.totals.feedbackUp)} / ${fmt(data.totals.feedbackDown)}`} hint="👍 / 👎" />
            </div>

            <Card title="Günlük soru sayısı" subtitle="Koyu: cevaplanan · açık pembe: cevaplanamayan">
              <DailyBars daily={data.daily} />
            </Card>

            <div className="grid gap-4 md:grid-cols-3">
              <Card title="Sonuçlar"><Breakdown rows={data.byOutcome} labels={OUTCOME_LABELS} /></Card>
              <Card title="Kim soruyor"><Breakdown rows={data.byPortal} labels={PORTAL_LABELS} /></Card>
              <Card title="Yardım eşleştirmesi" subtitle="Nasıl yapılır cevapları hangi yolla bulundu">
                <Breakdown rows={data.helpMatchedBy} labels={MATCHED_LABELS} empty="Henüz yardım cevabı yok." />
              </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card title="En çok sorulan konular"><Breakdown rows={data.byIntent.slice(0, 12)} labels={INTENT_LABELS} /></Card>
              <Card title="Yapay zekâ kullanımı" subtitle={data.llm.configured ? 'Sağlayıcı tanımlı (OpenRouter)' : 'Sağlayıcı anahtarı tanımlı değil — Maydi kural + anahtar kelimeyle çalışıyor'}>
                <dl className="grid grid-cols-2 gap-3 text-[12.5px]">
                  <Stat label="Çağrı" value={fmt(data.llm.calls)} />
                  <Stat label="Başarısız" value={fmt(data.llm.failed)} />
                  <Stat label="Girdi token" value={fmt(data.llm.promptTokens)} />
                  <Stat label="Çıktı token" value={fmt(data.llm.completionTokens)} />
                  <Stat label="Ort. süre" value={`${fmt(data.llm.averageDurationMs)} ms`} />
                  <Stat label="Ort. Maydi cevabı" value={`${fmt(data.totals.averageResponseMs)} ms`} />
                </dl>
                {data.llm.errors.length > 0 && (
                  <p className="mt-3 text-[11px] text-[#74616A]">Hatalar: {data.llm.errors.map((e) => `${e.key} (${e.count})`).join(', ')}</p>
                )}
              </Card>
            </div>

            <Card title="Kurumlar" subtitle="Soru sayısına göre">
              {data.tenants.length === 0 ? <Empty text="Bu dönemde Maydi kullanan kurum yok." /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[12.5px]">
                    <thead className="text-[11px] uppercase tracking-wide text-[#74616A]">
                      <tr>
                        <th className="py-2 pr-3">Kurum</th><th className="py-2 pr-3 text-right">Soru</th><th className="py-2 pr-3 text-right">Cevaplanamayan</th>
                        <th className="py-2 pr-3 text-right">Kullanıcı</th><th className="py-2 pr-3 text-right">👍 / 👎</th><th className="py-2">Son kullanım</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.tenants.map((tenant) => (
                        <tr key={tenant.tenantId} className="border-t border-[#f6edf1]">
                          <td className="py-2 pr-3 font-semibold text-[#2A2027]">{tenant.tenantName}</td>
                          <td className="py-2 pr-3 text-right">{fmt(tenant.questions)}</td>
                          <td className="py-2 pr-3 text-right">{fmt(tenant.notFound)} <span className="text-[#74616A]">(%{tenant.questions ? Math.round((100 * tenant.notFound) / tenant.questions) : 0})</span></td>
                          <td className="py-2 pr-3 text-right">{fmt(tenant.activeUsers)}</td>
                          <td className="py-2 pr-3 text-right">{fmt(tenant.feedbackUp)} / {fmt(tenant.feedbackDown)}</td>
                          <td className="py-2 text-[#74616A]">{parseUtc(tenant.lastActivityUtc)?.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card title="Ortak cevaplanamayan sorular" subtitle="En az iki farklı kurumda sorulmuş; sayı ve e-posta gizli. Yardım kataloğuna eklenecek makaleleri gösterir.">
              {data.commonUnanswered.length === 0 ? <Empty text="Birden fazla kurumda sorulup cevaplanamayan soru yok." /> : (
                <ul className="divide-y divide-[#f6edf1]">
                  {data.commonUnanswered.map((row) => (
                    <li key={row.question} className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
                      <span className="text-[#2A2027]">{row.question}</span>
                      <span className="shrink-0 text-[11px] text-[#74616A]">{fmt(row.count)} kez · {fmt(row.tenants)} kurum</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  )
}

function Kpi({ icon: Icon, label, value, hint }: { icon: typeof Bot; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[18px] border border-[#EAD8DF] bg-white p-4">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[#74616A]"><Icon className="h-3.5 w-3.5 text-[#C85776]" />{label}</div>
      <div className="mt-1.5 text-[24px] font-bold text-[#2A2027]">{value}</div>
      <div className="text-[11px] text-[#74616A]">{hint}</div>
    </div>
  )
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[20px] border border-[#EAD8DF] bg-white p-4">
      <h2 className="text-[13.5px] font-bold text-[#2A2027]">{title}</h2>
      {subtitle && <p className="mt-0.5 text-[11px] text-[#74616A]">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="py-4 text-center text-[12px] text-[#74616A]">{text}</p>
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-[#74616A]">{label}</dt>
      <dd className="font-semibold text-[#2A2027]">{value}</dd>
    </div>
  )
}

function Breakdown({ rows, labels, empty = 'Veri yok.' }: { rows: AssistantStatsCount[]; labels: Record<string, string>; empty?: string }) {
  if (rows.length === 0) return <Empty text={empty} />
  const max = Math.max(...rows.map((row) => row.count), 1)
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="mb-0.5 flex justify-between text-[11.5px]">
            <span className="text-[#3b2330]">{labels[row.key] ?? row.key}</span>
            <span className="font-semibold text-[#2A2027]">{fmt(row.count)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-[#f3e6ec]">
            <div className="h-full rounded-full bg-[#A5556E]" style={{ width: `${(100 * row.count) / max}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function DailyBars({ daily }: { daily: AssistantPlatformStats['daily'] }) {
  const max = Math.max(...daily.map((day) => day.questions), 1)
  const total = daily.reduce((sum, day) => sum + day.questions, 0)
  if (total === 0) return <Empty text="Bu dönemde soru yok." />
  return (
    <div className="flex h-36 items-end gap-[3px]" role="img" aria-label={`Günlük soru sayısı, toplam ${total}`}>
      {daily.map((day) => (
        <div key={day.date} className="group relative flex h-full flex-1 flex-col justify-end" title={`${new Date(day.date).toLocaleDateString('tr-TR')}: ${day.questions} soru, ${day.notFound} cevaplanamadı`}>
          <div className="w-full rounded-t-[3px] bg-[#8e3f5b]" style={{ height: `${(100 * (day.questions - day.notFound)) / max}%` }} />
          <div className="w-full bg-[#F2B7C8]" style={{ height: `${(100 * day.notFound) / max}%` }} />
        </div>
      ))}
    </div>
  )
}
