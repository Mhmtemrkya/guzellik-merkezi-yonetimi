'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Camera, ShieldCheck, Users } from 'lucide-react'
import { adminApi } from '@/lib/apiClient'

interface ApiScreenshotSettings {
  allowStaffScreenshots: boolean
}

interface ApiStaffScreenshot {
  tenantUserId: string
  fullName?: string | null
  email: string
  allow: boolean | null
  effective: boolean
}

/**
 * Güvenlik ayarları kartı — personel ekran görüntüsü izni.
 * Kurum geneli varsayılan anahtar + personel bazlı istisna (Varsayılan/İzinli/Engelli).
 * Kapalıyken personel, mobil uygulamada ekran görüntüsü/ekran kaydı alamaz (FLAG_SECURE).
 */
export default function SecuritySettingsCard({ tenantId }: { tenantId?: string }) {
  const [settings, setSettings] = useState<ApiScreenshotSettings | null>(null)
  const [staff, setStaff] = useState<ApiStaffScreenshot[]>([])
  const [saving, setSaving] = useState(false)
  const [savingUser, setSavingUser] = useState<string | null>(null)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([
        adminApi.screenshotSettings<ApiScreenshotSettings>(tenantId),
        adminApi.staffScreenshotOverrides<ApiStaffScreenshot>(tenantId).catch(() => [] as ApiStaffScreenshot[]),
      ])
      setSettings(s)
      setStaff(Array.isArray(list) ? list : [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Güvenlik ayarları yüklenemedi.')
    }
  }, [tenantId])

  useEffect(() => { void reload() }, [reload])

  const toggle = useCallback(async () => {
    if (!settings || saving) return
    setSaving(true); setError('')
    try {
      await adminApi.updateScreenshotSettings<ApiScreenshotSettings>(!settings.allowStaffScreenshots, tenantId)
      await reload()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ayar güncellenemedi.')
    } finally {
      setSaving(false)
    }
  }, [settings, saving, tenantId, reload])

  const setOverride = useCallback(async (userId: string, allow: boolean | null) => {
    setSavingUser(userId); setError('')
    try {
      await adminApi.updateStaffScreenshotOverride(userId, allow, tenantId)
      await reload()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Personel izni güncellenemedi.')
    } finally {
      setSavingUser(null)
    }
  }, [tenantId, reload])

  const allowed = settings?.allowStaffScreenshots === true

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.08 }}
      className="relative overflow-hidden rounded-[22px] border border-[#ead8df]/70 bg-white/92 p-6 shadow-[0_22px_54px_-38px_rgba(150,78,104,0.46)]"
    >
      <div className="relative flex items-center gap-2 text-[12px] font-medium">
        <ShieldCheck className="h-4 w-4 text-[#c85776]" /> <span className="font-display text-lg tracking-tight">GÜVENLİK</span>
      </div>
      <div className="relative text-[12px] text-[#352432]/50">Personel cihazlarında veri sızıntısı korumaları</div>

      <div className="relative mt-4 flex items-start justify-between gap-4 rounded-[14px] border border-[#ead8df]/70 bg-[#fffafc] px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[#fff1f6] text-[#c85776]"><Camera className="h-4 w-4" /></span>
          <div>
            <div className="text-[13px] font-medium text-[#352432]">Personel ekran görüntüsü alabilsin (kurum varsayılanı)</div>
            <div className="mt-0.5 max-w-md text-[11px] text-[#4a3a44]">
              Kapalıyken personel, mobil uygulamada ekran görüntüsü ve ekran kaydı alamaz. Aşağıdan kişi bazında istisna tanımlayabilirsiniz.
            </div>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={allowed}
          disabled={!settings || saving}
          onClick={() => void toggle()}
          className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${allowed ? 'bg-[#c85776]' : 'bg-[#d9c3cd]'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${allowed ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>

      {staff.length > 0 && (
        <div className="relative mt-4">
          <div className="flex items-center gap-2 text-[11px] font-medium text-[#352432]/70">
            <Users className="h-3.5 w-3.5 text-[#c85776]" /> Personel bazlı istisnalar
          </div>
          <div className="mt-2 divide-y divide-[#ead8df]/50 rounded-[14px] border border-[#ead8df]/70 bg-white">
            {staff.map((s) => (
              <div key={s.tenantUserId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-[13px] text-[#352432]">{s.fullName || s.email}</div>
                  <div className="text-[10px] text-[#4a3a44]">
                    Uygulanan: <span className={s.effective ? 'text-emerald-600' : 'text-[#c85776]'}>{s.effective ? 'İzinli' : 'Engelli'}</span>
                    {s.allow === null && ' (kurum varsayılanı)'}
                  </div>
                </div>
                <select
                  value={s.allow === null ? 'default' : s.allow ? 'allow' : 'deny'}
                  disabled={savingUser === s.tenantUserId}
                  onChange={(e) => {
                    const v = e.target.value
                    void setOverride(s.tenantUserId, v === 'default' ? null : v === 'allow')
                  }}
                  className="shrink-0 rounded-[10px] border border-[#ead8df] bg-[#fffafc] px-2 py-1.5 text-[11px] text-[#352432] outline-none disabled:opacity-50"
                >
                  <option value="default">Kurum varsayılanı</option>
                  <option value="allow">İzinli</option>
                  <option value="deny">Engelli</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div className="relative mt-3 text-[11px] text-red-600">{error}</div>}
    </motion.div>
  )
}
