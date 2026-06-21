'use client'

import { useEffect, useMemo, useState } from 'react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import { useBranch } from '@/components/dashboard/BranchContext'
import { useApiQuery } from '@/hooks/useApiQuery'
import { adminApi } from '@/lib/apiClient'
import { apiItems, formatTL, guidOrUndefined, initialsFromName, normalizeAccount } from '@/lib/apiMappers'
import { motion } from 'framer-motion'
import {
  CalendarCheck, CheckCircle2, Layers3, Package, Search, Sparkles, Timer, Users, Wallet, type LucideIcon,
} from 'lucide-react'
import type { ApiCustomerAccount, ApiCustomerPackageSession } from '@/lib/types'

interface SessionRow {
  id: string
  serviceName: string
  total: number
  used: number
  remaining: number
}

function StatCard({ icon: Icon, label, value, sub, tone = '#c85776' }: { icon: LucideIcon; label: string; value: string; sub?: string; tone?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-4 shadow-[0_18px_42px_-34px_rgba(150,78,104,0.42)]"
    >
      <div className="flex items-start gap-2.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[#fff1f6]" style={{ color: tone }}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="text-[11px] font-mono uppercase tracking-widest text-[#352432]/45">{label}</div>
      </div>
      <div className="mt-3 font-display text-3xl tabular-nums tracking-tight text-[#352432]">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-[#352432]/45">{sub}</div>}
    </motion.div>
  )
}

function ProgressBar({ value, tone = 'from-[#e0617f] to-[#f3a3bf]' }: { value: number; tone?: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[#f7e9ee]">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className={`h-full rounded-full bg-gradient-to-r ${tone}`}
      />
    </div>
  )
}

export default function SeanslarPage() {
  const { selectedInstitution, selectedBranch, selectedInstitutionId } = useBranch()
  const tenantId = guidOrUndefined(selectedInstitutionId)
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data, loading, error } = useApiQuery<ApiCustomerAccount[]>(
    async () => apiItems(await adminApi.accounts<ApiCustomerAccount>({ tenantId, search: filter || undefined, page: 1, pageSize: 100 })),
    [tenantId, filter],
    { initialData: [] },
  )

  // Yalnızca paket bazlı hesaplar seans taşır (servicePackageId olanlar).
  const accounts = useMemo(
    () => (data || []).map((a, i) => normalizeAccount(a, i)).filter((a) => a.servicePackageId),
    [data],
  )

  const selected = useMemo(() => accounts.find((a) => a.id === selectedId) || accounts[0], [accounts, selectedId])
  useEffect(() => {
    if (!selectedId && accounts[0]?.id) setSelectedId(accounts[0].id)
    if (selectedId && accounts.length && !accounts.some((a) => a.id === selectedId)) setSelectedId(accounts[0].id)
  }, [accounts, selectedId])

  // Seçili müşterinin hizmet-bazlı seans bakiyeleri
  const { data: sessionsData, loading: sessLoading } = useApiQuery<ApiCustomerPackageSession[]>(
    async () => (selected?.customerId ? adminApi.customerSessions<ApiCustomerPackageSession>(selected.customerId, tenantId) : []),
    [selected?.customerId, tenantId],
    { initialData: [] },
  )
  const sessions = useMemo<SessionRow[]>(
    () =>
      (sessionsData || []).map((s, i) => ({
        id: s.id || `sess-${i}`,
        serviceName: s.serviceName || 'Hizmet',
        total: Number(s.totalSessions || 0),
        used: Number(s.usedSessions || 0),
        remaining: Number(s.remainingSessions ?? Math.max(0, Number(s.totalSessions || 0) - Number(s.usedSessions || 0))),
      })),
    [sessionsData],
  )

  // İstatistikler (hesap listesinden — N+1 yok)
  const stats = useMemo(() => {
    const activeCount = accounts.filter((a) => a.isActive).length
    const customerCount = new Set(accounts.map((a) => a.customerId)).size
    const completedSessions = accounts.reduce((s, a) => s + (a.completedAppointmentCount || 0), 0)
    const remainingAmount = accounts.reduce((s, a) => s + (a.remainingAmount || 0), 0)
    return { activeCount, customerCount, completedSessions, remainingAmount }
  }, [accounts])

  const totalRemaining = sessions.reduce((s, r) => s + r.remaining, 0)
  const totalUsed = sessions.reduce((s, r) => s + r.used, 0)
  const totalSessions = sessions.reduce((s, r) => s + r.total, 0)

  return (
    <>
      <Topbar
        title="Seanslarım"
        subtitle={`${selectedInstitution?.name || 'Kurum'} · ${selectedBranch?.name || 'Merkez'} · Paket seans takibi`}
        breadcrumbs={['Personel', 'İşletme', 'Seanslarım']}
      />

      <div className="relative space-y-5 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice loading={loading} error={error} empty={!loading && !error && accounts.length === 0} emptyMessage="Henüz paket seansı olan müşteri yok." />

        {/* STAT CARDS */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Package} label="Aktif paket" value={String(stats.activeCount)} sub="seans taşıyan hesap" tone="#c85776" />
          <StatCard icon={Users} label="Paketli müşteri" value={String(stats.customerCount)} sub="benzersiz müşteri" tone="#3cae8d" />
          <StatCard icon={CheckCircle2} label="Tamamlanan seans" value={String(stats.completedSessions)} sub="bu kurumda toplam" tone="#9c70bb" />
          <StatCard icon={Wallet} label="Kalan tahsilat" value={formatTL(stats.remainingAmount)} sub="paket bakiyesi" tone="#e0617f" />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.05fr_1fr]">
          {/* PAKET HESAPLARI */}
          <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75"><Layers3 className="h-3.5 w-3.5" /> Paket Hesapları</div>
                <div className="font-display text-2xl tracking-tight">{accounts.length} paket</div>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#352432]/35" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Müşteri / paket ara"
                  className="w-44 rounded-[10px] border border-[#ead8df]/70 bg-white px-8 py-1.5 text-[12px] outline-none focus:border-[#c85776]"
                />
              </div>
            </div>

            <div className="grid gap-2.5">
              {accounts.map((a) => {
                const active = selected?.id === a.id
                const payPct = a.totalAmount > 0 ? Math.round((a.paidAmount / a.totalAmount) * 100) : 0
                return (
                  <motion.button
                    key={a.id}
                    type="button"
                    whileHover={{ y: -2 }}
                    onClick={() => setSelectedId(a.id)}
                    className={`rounded-[16px] border p-3.5 text-left transition-colors ${active ? 'border-[#c85776]/60 bg-[#fff1f6]/40' : 'border-[#ead8df]/70 bg-white hover:border-[#efbfd0]'}`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-gradient-to-br from-[#fbd2dc] to-[#fff0f5] font-display text-[13px] text-[#8e3f5b]">
                        {initialsFromName(a.customerName)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="truncate font-display text-[15px] tracking-tight text-[#352432]">{a.customerName}</div>
                          <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[8px] font-mono uppercase ${a.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{a.isActive ? 'Aktif' : 'Kapalı'}</span>
                        </div>
                        <div className="truncate text-[11px] text-[#c85776]/80">{a.servicePackageName || a.name}</div>
                        <div className="mt-2 flex items-center gap-3">
                          <span className="inline-flex items-center gap-1 text-[10px] text-[#352432]/55"><CalendarCheck className="h-3 w-3 text-[#c85776]" /> {a.completedAppointmentCount} seans</span>
                          <span className="text-[10px] text-[#352432]/45">{a.customerPhone}</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2.5">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-[#352432]/45">Ödeme</span>
                        <span className="font-medium text-[#352432]">{formatTL(a.paidAmount)} / {formatTL(a.totalAmount)}</span>
                      </div>
                      <div className="mt-1"><ProgressBar value={payPct} /></div>
                    </div>
                  </motion.button>
                )
              })}
              {!accounts.length && !loading && (
                <div className="rounded-[14px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-10 text-center text-[12px] text-[#352432]/45">
                  Paket seansı olan müşteri bulunamadı.
                </div>
              )}
            </div>
          </div>

          {/* SEANS BAKİYESİ */}
          <div className="rounded-[18px] border border-[#ead8df]/70 bg-white/90 p-5">
            {selected ? (
              <>
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-[#c85776]/75"><Sparkles className="h-3.5 w-3.5" /> Seans Bakiyesi</div>
                <div className="mt-3 flex items-center gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-[#fbd2dc] to-[#fff0f5] font-display text-base text-[#8e3f5b]">{initialsFromName(selected.customerName)}</span>
                  <div className="min-w-0">
                    <div className="truncate font-display text-xl tracking-tight">{selected.customerName}</div>
                    <div className="truncate text-[11px] text-[#352432]/50">{selected.servicePackageName || selected.name}</div>
                  </div>
                </div>

                {/* özet */}
                <div className="mt-4 grid grid-cols-3 gap-2.5">
                  <div className="rounded-[14px] border border-[#ead8df]/65 bg-[#fffafc] p-3 text-center">
                    <div className="font-display text-2xl tabular-nums text-[#c85776]">{totalRemaining}</div>
                    <div className="text-[8px] font-mono uppercase tracking-widest text-[#352432]/40">Kalan seans</div>
                  </div>
                  <div className="rounded-[14px] border border-[#ead8df]/65 bg-[#fffafc] p-3 text-center">
                    <div className="font-display text-2xl tabular-nums text-[#352432]">{totalUsed}</div>
                    <div className="text-[8px] font-mono uppercase tracking-widest text-[#352432]/40">Kullanılan</div>
                  </div>
                  <div className="rounded-[14px] border border-[#ead8df]/65 bg-[#fffafc] p-3 text-center">
                    <div className="font-display text-2xl tabular-nums text-[#352432]">{totalSessions}</div>
                    <div className="text-[8px] font-mono uppercase tracking-widest text-[#352432]/40">Toplam</div>
                  </div>
                </div>

                {/* hizmet bazlı seanslar */}
                <div className="mt-4">
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[#352432]/40"><Timer className="h-3.5 w-3.5" /> Hizmet Bazlı Seanslar</div>
                  {sessLoading ? (
                    <div className="py-8 text-center text-[12px] text-[#352432]/45">Yükleniyor…</div>
                  ) : sessions.length ? (
                    <div className="space-y-2.5">
                      {sessions.map((r) => {
                        const usedPct = r.total > 0 ? Math.round((r.used / r.total) * 100) : 0
                        const depleted = r.remaining <= 0
                        return (
                          <div key={r.id} className="rounded-[14px] border border-[#ead8df]/65 bg-[#fffafc] p-3.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-[13px] font-medium text-[#352432]">{r.serviceName}</span>
                              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-display tabular-nums ${depleted ? 'bg-rose-50 text-rose-600' : 'bg-[#fff1f6] text-[#c85776]'}`}>
                                {r.remaining} kaldı
                              </span>
                            </div>
                            <div className="mt-2"><ProgressBar value={usedPct} tone={depleted ? 'from-rose-400 to-rose-300' : 'from-[#e0617f] to-[#f3a3bf]'} /></div>
                            <div className="mt-1.5 flex items-center justify-between text-[10px] text-[#352432]/45">
                              <span>{r.used} / {r.total} seans kullanıldı</span>
                              <span className="font-mono">%{usedPct}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="rounded-[14px] border border-dashed border-[#ead8df] bg-[#fffafb] px-3 py-8 text-center text-[12px] text-[#352432]/45">
                      Bu müşteri için hizmet-bazlı seans kaydı yok.
                    </div>
                  )}
                </div>

                {/* paket finansal özet */}
                <div className="mt-4 grid grid-cols-3 gap-2 rounded-[14px] border border-[#ead8df]/65 bg-white p-3">
                  <div className="text-center">
                    <div className="font-display text-base text-[#352432]">{formatTL(selected.totalAmount)}</div>
                    <div className="text-[8px] font-mono uppercase text-[#352432]/40">Paket tutarı</div>
                  </div>
                  <div className="text-center">
                    <div className="font-display text-base text-emerald-600">{formatTL(selected.paidAmount)}</div>
                    <div className="text-[8px] font-mono uppercase text-[#352432]/40">Ödenen</div>
                  </div>
                  <div className="text-center">
                    <div className="font-display text-base text-[#c85776]">{formatTL(selected.remainingAmount)}</div>
                    <div className="text-[8px] font-mono uppercase text-[#352432]/40">Kalan</div>
                  </div>
                </div>
              </>
            ) : (
              <div className="grid h-full place-items-center py-16 text-center text-sm text-[#352432]/45">
                <div>
                  <Package className="mx-auto h-10 w-10 text-[#c85776]/40" strokeWidth={1.3} />
                  <div className="mt-3">Seans bakiyesini görmek için bir paket seç.</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
