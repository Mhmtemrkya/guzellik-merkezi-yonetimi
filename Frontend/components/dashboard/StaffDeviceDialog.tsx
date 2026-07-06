'use client'

// Cihaz güvenliği yönetimi: kurum düzeyinde aç/kapat + personel başına cihaz limiti
// + tanımlı cihaz listesi (yeniden adlandır / sil). Yalnızca kurum yöneticisi kullanır.
// Özellik pakette yoksa backend 409 döner; dialog bilgilendirir.

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MonitorSmartphone, PencilLine, ShieldCheck, Smartphone, Trash2, Wifi, X } from 'lucide-react'
import { adminApi } from '@/lib/apiClient'

interface ApiStaffDevice {
  id: string
  tenantUserId: string
  deviceId: string
  name: string
  deviceType?: string | null
  userAgent?: string | null
  networkInfoJson?: string | null
  lastIpAddress?: string | null
  lastSeenUtc?: string
  createdAtUtc?: string
}

interface ApiDeviceLimit {
  tenantUserId: string
  maxDeviceCount: number | null
  deviceCount: number
}

interface ApiDeviceSettings {
  enabled: boolean
  featureAllowed: boolean
}

interface StaffDeviceDialogProps {
  open: boolean
  onClose: () => void
  staffName: string
  tenantUserId: string
  tenantId?: string
}

function networkSummary(json: string | null | undefined): string | null {
  if (!json) return null
  try {
    const net = JSON.parse(json) as Record<string, unknown>
    const parts = [net.effectiveType, net.connectionType, net.downlinkMbps ? `${net.downlinkMbps} Mbps` : null].filter(Boolean)
    return parts.length ? parts.join(' · ') : null
  } catch {
    return null
  }
}

export default function StaffDeviceDialog({ open, onClose, staffName, tenantUserId, tenantId }: StaffDeviceDialogProps) {
  const [settings, setSettings] = useState<ApiDeviceSettings | null>(null)
  const [devices, setDevices] = useState<ApiStaffDevice[]>([])
  const [limit, setLimit] = useState<ApiDeviceLimit | null>(null)
  const [limitInput, setLimitInput] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [s, d, l] = await Promise.all([
        adminApi.deviceControlSettings<ApiDeviceSettings>(tenantId),
        adminApi.userDevices<ApiStaffDevice>(tenantUserId, tenantId),
        adminApi.userDeviceLimit<ApiDeviceLimit>(tenantUserId, tenantId),
      ])
      setSettings(s)
      setDevices(Array.isArray(d) ? d : [])
      setLimit(l)
      setLimitInput(l?.maxDeviceCount != null ? String(l.maxDeviceCount) : '')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Cihaz bilgileri yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [tenantUserId, tenantId])

  useEffect(() => { if (open) void reload() }, [open, reload])

  const toggleEnabled = useCallback(async () => {
    if (!settings) return
    setSaving(true); setError('')
    try {
      const next = await adminApi.updateDeviceControlSettings<ApiDeviceSettings>(!settings.enabled, tenantId)
      setSettings(next)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ayar güncellenemedi.')
    } finally { setSaving(false) }
  }, [settings, tenantId])

  const saveLimit = useCallback(async () => {
    setSaving(true); setError('')
    try {
      const value = limitInput.trim() === '' ? null : Number(limitInput)
      const next = await adminApi.setUserDeviceLimit<ApiDeviceLimit>(tenantUserId, value, tenantId)
      setLimit(next)
      setLimitInput(next.maxDeviceCount != null ? String(next.maxDeviceCount) : '')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Cihaz limiti kaydedilemedi.')
    } finally { setSaving(false) }
  }, [limitInput, tenantUserId, tenantId])

  const saveRename = useCallback(async (device: ApiStaffDevice) => {
    if (!renameValue.trim()) { setRenamingId(null); return }
    setSaving(true); setError('')
    try {
      await adminApi.updateDevice(device.id, { name: renameValue.trim(), deviceType: device.deviceType ?? null }, tenantId)
      setRenamingId(null)
      await reload()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Cihaz adı güncellenemedi.')
    } finally { setSaving(false) }
  }, [renameValue, tenantId, reload])

  const removeDevice = useCallback(async (device: ApiStaffDevice) => {
    setSaving(true); setError('')
    try {
      await adminApi.deleteDevice(device.id, tenantId)
      await reload()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Cihaz silinemedi.')
    } finally { setSaving(false) }
  }, [tenantId, reload])

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-white/80 px-4 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: 0.98 }} transition={{ duration: 0.22 }}
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-[18px] border border-[#ead8df]/80 bg-white p-5 shadow-2xl shadow-black/15">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-[#fff1f6] text-[#c85776]">
                  <MonitorSmartphone className="h-5 w-5" strokeWidth={1.6} />
                </span>
                <div>
                  <div className="font-display text-xl tracking-tight text-[#352432]">Cihaz Güvenliği</div>
                  <div className="text-[11px] text-[#352432]/55">{staffName} · tanımlı cihazlar ve giriş kısıtı</div>
                </div>
              </div>
              <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-[9px] border border-[#ead8df] text-[#352432]/55 hover:bg-[#fff4f8]/50">
                <X className="h-4 w-4" />
              </button>
            </div>

            {error && <div className="mt-3 rounded-[10px] border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-700">{error}</div>}

            {/* Kurum düzeyinde aç/kapat */}
            <div className="mt-4 flex items-center justify-between gap-3 rounded-[14px] border border-[#ead8df]/70 bg-[#fffafc] px-4 py-3">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className={`h-4.5 w-4.5 ${settings?.enabled ? 'text-emerald-600' : 'text-[#352432]/35'}`} />
                <div>
                  <div className="text-[12.5px] font-medium text-[#352432]">Cihaz güvenliği (kurum geneli)</div>
                  <div className="text-[10.5px] text-[#352432]/50">
                    {settings?.featureAllowed === false
                      ? 'Bu özellik paketinize dahil değil — paket yükseltmesi gerekir.'
                      : 'Açıkken personel yalnızca tanımlı cihazlarından giriş yapabilir; loglara cihaz + ağ bilgisi düşer.'}
                  </div>
                </div>
              </div>
              <button type="button" onClick={toggleEnabled} disabled={saving || loading || settings?.featureAllowed === false}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${settings?.enabled ? 'bg-emerald-500' : 'bg-[#ead8df]'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${settings?.enabled ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </div>

            {/* Cihaz limiti */}
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3 rounded-[14px] border border-[#ead8df]/70 bg-[#fffafc] px-4 py-3">
              <div>
                <div className="text-[12.5px] font-medium text-[#352432]">Cihaz limiti</div>
                <div className="text-[10.5px] text-[#352432]/50">
                  Bu personelin tanımlayabileceği en fazla cihaz sayısı (boş = sınırsız). Şu an {limit?.deviceCount ?? 0} cihaz tanımlı.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" min={1} max={10} value={limitInput} placeholder="—"
                  onChange={(e) => setLimitInput(e.target.value)}
                  className="w-20 rounded-[10px] border border-[#ead8df]/80 bg-white px-3 py-2 text-center text-[13px] text-[#352432] outline-none focus:border-[#c85776]" />
                <button type="button" onClick={saveLimit} disabled={saving}
                  className="rounded-[10px] bg-[#c85776] px-3.5 py-2 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50">
                  Kaydet
                </button>
              </div>
            </div>

            {/* Cihaz listesi */}
            <div className="mt-4">
              <div className="text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75">Tanımlı Cihazlar</div>
              <div className="mt-2 space-y-2">
                {loading && <div className="py-6 text-center text-[12px] text-[#352432]/45">Yükleniyor…</div>}
                {!loading && devices.length === 0 && (
                  <div className="rounded-[12px] border border-dashed border-[#ead8df] px-4 py-6 text-center text-[12px] text-[#352432]/50">
                    Henüz tanımlı cihaz yok. Personel bir sonraki girişinde cihazı otomatik tanımlanır (limit dahilinde).
                  </div>
                )}
                {devices.map((d) => {
                  const net = networkSummary(d.networkInfoJson)
                  const isMobile = (d.deviceType || '').toLowerCase() === 'mobile'
                  return (
                    <div key={d.id} className="flex items-center gap-3 rounded-[14px] border border-[#ead8df]/70 bg-white px-4 py-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#fff1f6] text-[#c85776]">
                        {isMobile ? <Smartphone className="h-4 w-4" /> : <MonitorSmartphone className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        {renamingId === d.id ? (
                          <div className="flex items-center gap-2">
                            <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') void saveRename(d); if (e.key === 'Escape') setRenamingId(null) }}
                              className="w-full max-w-[220px] rounded-[8px] border border-[#c85776]/50 bg-white px-2 py-1 text-[12px] outline-none" />
                            <button type="button" onClick={() => void saveRename(d)} className="rounded-[8px] bg-[#c85776] px-2 py-1 text-[10px] text-white">Tamam</button>
                          </div>
                        ) : (
                          <div className="truncate text-[12.5px] font-medium text-[#352432]">{d.name}</div>
                        )}
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 truncate text-[9.5px] font-mono text-[#352432]/45">
                          <span>{d.deviceId.slice(0, 12)}…</span>
                          {net && <span className="inline-flex items-center gap-1"><Wifi className="h-3 w-3 text-sky-500/80" />{net}</span>}
                          {d.lastIpAddress && <span>IP {d.lastIpAddress}</span>}
                          {d.lastSeenUtc && <span>Son görülme: {new Date(d.lastSeenUtc).toLocaleString('tr-TR')}</span>}
                        </div>
                      </div>
                      <button type="button" title="Yeniden adlandır" onClick={() => { setRenamingId(d.id); setRenameValue(d.name) }}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border border-[#ead8df] text-[#352432]/55 hover:bg-[#fff4f8]/50">
                        <PencilLine className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" title="Cihazı sil" onClick={() => void removeDevice(d)} disabled={saving}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border border-rose-300/40 bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-50">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
