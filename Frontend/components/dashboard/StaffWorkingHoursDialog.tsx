'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { CalendarClock, CheckCircle2, Loader2, Moon, X } from 'lucide-react'
import { adminApi } from '@/lib/apiClient'

const DAY_LABELS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']

interface DayRow {
  dayOfWeek: number
  startMinute: number
  endMinute: number
  isDayOff: boolean
}

interface ApiWorkingHours {
  staffMemberId?: string
  days?: Array<{ dayOfWeek?: number; startMinute?: number; endMinute?: number; isDayOff?: boolean }>
}

function minutesToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
function hhmmToMinutes(v: string): number {
  const [h, m] = v.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Varsayılan şablon: hafta içi + cumartesi 09:00–19:00, pazar tatil. */
function defaultRows(): DayRow[] {
  return DAY_LABELS.map((_, i) => ({ dayOfWeek: i, startMinute: 540, endMinute: 1140, isDayOff: i === 6 }))
}

/**
 * Personel haftalık çalışma saatleri — mesai penceresi dışına (web/mobil/online portal/bekleme
 * listesi) randevu alınamaz. Şablon hiç kaydedilmemişse personel kısıtsız çalışır.
 */
export default function StaffWorkingHoursDialog({
  staffId,
  staffName,
  tenantId,
  trigger,
  onSaved,
}: {
  staffId: string
  staffName: string
  tenantId?: string
  trigger: ReactNode
  onSaved?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [rows, setRows] = useState<DayRow[]>(defaultRows())
  // Şablon var mı? (yoksa "kısıt yok" bilgisi + Temizle butonu gizlenir)
  const [hasTemplate, setHasTemplate] = useState(false)
  // Kurum geneli anahtar: kapalıysa şablonlar saklanır ama hiçbir kanalda denetlenmez.
  const [enforced, setEnforced] = useState(true)
  const [enforceBusy, setEnforceBusy] = useState(false)

  const toggleEnforcement = async (): Promise<void> => {
    setEnforceBusy(true)
    try {
      const res = await adminApi.setWorkingHoursEnforcement<{ enabled?: boolean }>(!enforced, tenantId)
      setEnforced(Boolean(res?.enabled))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ayar değiştirilemedi.')
    } finally {
      setEnforceBusy(false)
    }
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    setSaved(false)
    adminApi
      .workingHoursEnforcement<{ enabled?: boolean }>(tenantId)
      .then((res) => {
        if (!cancelled) setEnforced(res?.enabled !== false)
      })
      .catch(() => {})
    adminApi
      .staffWorkingHours<ApiWorkingHours>(staffId, tenantId)
      .then((res) => {
        if (cancelled) return
        const days = res?.days || []
        setHasTemplate(days.length > 0)
        if (days.length > 0) {
          const map = new Map(days.map((d) => [d.dayOfWeek ?? 0, d]))
          setRows(
            DAY_LABELS.map((_, i) => {
              const d = map.get(i)
              return d
                ? { dayOfWeek: i, startMinute: d.startMinute ?? 540, endMinute: d.endMinute ?? 1140, isDayOff: Boolean(d.isDayOff) }
                : { dayOfWeek: i, startMinute: 540, endMinute: 1140, isDayOff: true }
            }),
          )
        } else {
          setRows(defaultRows())
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Çalışma saatleri yüklenemedi.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, staffId, tenantId])

  const setRow = (i: number, patch: Partial<DayRow>): void =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const save = async (days: DayRow[]): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await adminApi.setStaffWorkingHours(staffId, { days }, tenantId)
      setSaved(true)
      setHasTemplate(days.length > 0)
      onSaved?.()
      setTimeout(() => setOpen(false), 900)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kaydedilemedi.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg rounded-[22px] border border-[#efe1e7] bg-white p-0 text-[#4a3a44] [&>button:last-child]:hidden">
        <div className="flex items-start justify-between border-b border-[#efe1e7] px-6 py-4">
          <div>
            <DialogTitle className="flex items-center gap-2 font-display text-xl text-[#241923]">
              <CalendarClock className="h-5 w-5 text-[#c85776]" /> Çalışma Saatleri
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-[#705a66]">
              {staffName} · mesai penceresi dışına (online dahil) randevu alınamaz
            </DialogDescription>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-full text-[#705a66] hover:bg-[#f7ecf1] hover:text-[#c85776]" aria-label="Kapat">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto px-6 py-4">
          {/* Kurum geneli anahtar — yönetici kısıtı tamamen kapatabilir */}
          <button
            type="button"
            onClick={toggleEnforcement}
            disabled={enforceBusy}
            className="mb-1 flex w-full items-center justify-between rounded-[12px] border border-[#efe1e7] bg-[#fffafc] px-3 py-2.5 text-left transition-colors hover:border-[#efbfd0] disabled:opacity-60"
          >
            <span>
              <span className="block text-[12.5px] font-semibold text-[#241923]">Çalışma saatleri kısıtı (kurum geneli)</span>
              <span className="mt-0.5 block text-[10.5px] text-[#705a66]">
                {enforced ? 'Açık — mesai dışına randevu alınamaz' : 'Kapalı — şablonlar saklanır ama denetlenmez'}
              </span>
            </span>
            <span className={`relative inline-block h-5 w-10 shrink-0 rounded-full transition-colors ${enforced ? 'bg-[#c85776]' : 'bg-[#efe1e7]'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${enforced ? 'left-[22px]' : 'left-0.5'}`} />
            </span>
          </button>

          {loading ? (
            <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-[#c85776]" /></div>
          ) : (
            <>
              {!hasTemplate && (
                <div className="mb-2 rounded-[12px] border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-800">
                  Bu personel için şablon kaydedilmemiş — şu an <strong>her saatte</strong> randevu alabilir. Kaydettiğinizde aşağıdaki pencere geçerli olur.
                </div>
              )}
              {rows.map((r, i) => (
                <div key={r.dayOfWeek} className={`flex items-center gap-3 rounded-[12px] border px-3 py-2 ${r.isDayOff ? 'border-[#efe1e7] bg-[#faf5f7]' : 'border-[#efe1e7] bg-white'}`}>
                  <span className="w-20 text-[12.5px] font-semibold text-[#241923]">{DAY_LABELS[i]}</span>
                  {r.isDayOff ? (
                    <span className="flex flex-1 items-center gap-1.5 text-[12px] text-[#9d7386]"><Moon className="h-3.5 w-3.5" /> Tatil — randevu alınamaz</span>
                  ) : (
                    <span className="flex flex-1 items-center gap-2">
                      <input type="time" value={minutesToHHMM(r.startMinute)} onChange={(e) => setRow(i, { startMinute: hhmmToMinutes(e.target.value) })}
                        className="rounded-[10px] border border-[#efe1e7] bg-white px-2 py-1 text-[12px] outline-none focus:border-[#c85776]" />
                      <span className="text-[#9d7386]">–</span>
                      <input type="time" value={minutesToHHMM(r.endMinute)} onChange={(e) => setRow(i, { endMinute: hhmmToMinutes(e.target.value) })}
                        className="rounded-[10px] border border-[#efe1e7] bg-white px-2 py-1 text-[12px] outline-none focus:border-[#c85776]" />
                    </span>
                  )}
                  <button type="button" onClick={() => setRow(i, { isDayOff: !r.isDayOff })}
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold transition-colors ${r.isDayOff ? 'border-[#efbfd0] bg-white text-[#c85776] hover:bg-[#fff4f8]' : 'border-[#efe1e7] bg-white text-[#705a66] hover:border-[#efbfd0] hover:text-[#c85776]'}`}>
                    {r.isDayOff ? 'Çalışsın' : 'Tatil yap'}
                  </button>
                </div>
              ))}
            </>
          )}
          {error && <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">{error}</div>}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[#efe1e7] px-6 py-3.5">
          {hasTemplate ? (
            <button type="button" disabled={busy} onClick={() => save([])}
              className="text-[11.5px] font-medium text-[#9d7386] transition-colors hover:text-[#c85776] disabled:opacity-50">
              Şablonu temizle (kısıtsız çalışsın)
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} disabled={busy}
              className="rounded-lg border border-[#efe1e7] bg-white px-4 py-2 text-[12.5px] font-medium text-[#4a3a44] hover:bg-[#f7ecf1] disabled:opacity-50">
              Vazgeç
            </button>
            <button type="button" disabled={busy || loading} onClick={() => save(rows)}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#f47699] to-[#ef6088] px-5 py-2 text-[12.5px] font-medium text-white shadow-[0_8px_20px_-12px_rgba(200,87,118,0.5)] disabled:opacity-60">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CalendarClock className="h-3.5 w-3.5" />}
              {saved ? 'Kaydedildi' : 'Kaydet'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
