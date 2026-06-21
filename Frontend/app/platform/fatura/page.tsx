'use client'

import { useState } from 'react'
import Topbar from '@/components/dashboard/Topbar'
import ApiStateNotice from '@/components/dashboard/ApiStateNotice'
import AdminEditDialog from '@/components/dashboard/AdminEditDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useApiQuery } from '@/hooks/useApiQuery'
import { platformApi } from '@/lib/apiClient'
import { apiItems, formatTL, normalizeTenant } from '@/lib/apiMappers'
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Download,
  Loader2,
  Receipt,
  Trash2,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import type { ApiTenant, NotificationItem, PagedResult, Tenant } from '@/lib/types'

const card = 'border border-[#fff4f8]/15 bg-[#fff4f8]/[0.025]'
const head = 'text-[10px] font-mono uppercase tracking-[0.26em] text-[#fff4f8]/45'
const mini =
  'inline-flex min-h-10 w-full items-center justify-center gap-2 border border-[#fff4f8]/15 px-3 py-2 text-center text-[10px] font-mono uppercase tracking-widest text-[#fff4f8]/70 transition-colors hover:bg-[#fff4f8]/5 hover:text-[#fff4f8] sm:w-auto'

function Stat({ label, value, icon: Icon }: { label: string; value: string | number; icon: LucideIcon }) {
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-start justify-between gap-4">
        <Icon className="h-4 w-4 text-[#fff4f8]/60" strokeWidth={1.4} />
        <span className="text-[9px] font-mono uppercase tracking-widest text-[#fff4f8]/35">canlı</span>
      </div>
      <div className="mt-4 font-display text-3xl tabular-nums tracking-tight">{value}</div>
      <div className="mt-1 text-[10px] font-mono uppercase tracking-widest text-[#fff4f8]/45">{label}</div>
    </div>
  )
}

export default function PlatformFaturaPage() {
  const { data, loading, error, reload } = useApiQuery<PagedResult<ApiTenant>>(
    () => platformApi.tenants<ApiTenant>({ page: 1, pageSize: 100 }),
    [],
    { initialData: { items: [] } },
  )
  const tenants = apiItems(data).map((tenant, index) => normalizeTenant(tenant, index))
  const [confirmTarget, setConfirmTarget] = useState<Tenant | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string>('')

  const openConfirm = (tenant: Tenant): void => {
    setDeleteError('')
    setConfirmTarget(tenant)
  }
  const closeConfirm = (): void => {
    if (deletingId) return
    setConfirmTarget(null)
    setDeleteError('')
  }
  const confirmDelete = async (): Promise<void> => {
    if (!confirmTarget) return
    setDeletingId(confirmTarget.id)
    setDeleteError('')
    try {
      await platformApi.deleteTenant(confirmTarget.id)
      await reload()
      setConfirmTarget(null)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : ''
      setDeleteError(message ? `Abonelik silinemedi: ${message}` : 'Abonelik silinemedi. Lütfen tekrar deneyin.')
    } finally {
      setDeletingId(null)
    }
  }
  const total = tenants.reduce((s, t) => s + Number(t.mrr || 0), 0)
  const paused = tenants.filter((t) => t.status === 'paused')
  const open = paused.reduce((s, t) => s + Number(t.mrr || 0), 0)
  const invoiceNotifications: NotificationItem[] = paused.map((t) => ({
    title: `${t.name} askıda`,
    description: `${formatTL(t.mrr)} aylık abonelik riski var.`,
    meta: 'Fatura',
    href: '/platform/fatura',
  }))
  const csvEscape = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`
  const downloadCsv = (): void => {
    const headers = ['Kurum', 'Tenant ID', 'Plan', 'Aylık Tutar', 'Durum', 'Abonelik Durumu']
    const rows: (string | number)[][] = tenants.map((t) => [
      t.name,
      t.id,
      t.plan,
      t.mrr,
      t.status,
      t.status === 'paused' ? 'Riskli' : 'Normal',
    ])
    const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(';')).join('\n')
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `abonelik-ozeti-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <Topbar
        title="Faturalama"
        subtitle="Kurum faturaları, ödeme takibi ve mutabakat · Tenant API bazlı abonelik listesi"
        breadcrumbs={['Platform', 'Faturalama']}
        pendingCount={invoiceNotifications.length}
        notifications={invoiceNotifications}
      />
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <ApiStateNotice
          loading={loading}
          error={error}
          empty={!loading && !error && tenants.length === 0}
          emptyMessage="Tenant API döndü ama faturalandırılacak kurum yok."
        />
        <ApiStateNotice missingModule="Fatura/ödeme tahsilatı için backend Invoice modeli henüz yok; bu ekran şimdilik gerçek tenant abonelik tutarlarından hesap yapıyor." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Aylık abonelik" value={formatTL(total)} icon={Receipt} />
          <Stat label="Riskli bakiye" value={formatTL(open)} icon={CreditCard} />
          <Stat label="Aktif kurum" value={tenants.filter((i) => i.status === 'active').length} icon={CheckCircle2} />
          <Stat label="Askıda" value={paused.length} icon={XCircle} />
        </div>
        <div className={card}>
          <div className="flex flex-col justify-between gap-3 border-b border-[#fff4f8]/10 px-5 py-4 sm:flex-row sm:items-center">
            <div>
              <div className={head}>Abonelik listesi</div>
              <div className="font-display text-2xl">Tenant bazlı dönem özeti</div>
            </div>
            <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto">
              <AdminEditDialog
                triggerLabel="Fatura taslağı"
                title="Yeni fatura taslağı"
                note="Invoice modeli backend’e eklendiğinde submit endpoint’e bağlanacak."
                fields={[
                  {
                    label: 'Kurum',
                    type: 'select',
                    value: tenants[0]?.name,
                    options: tenants.map((t) => t.name),
                  },
                  { label: 'Dönem', value: 'Mayıs 2026' },
                  { label: 'Tutar', type: 'number', value: tenants[0]?.mrr || 0 },
                  { label: 'Son ödeme', type: 'date', value: '2026-05-25' },
                  { label: 'Kalemler', type: 'textarea', value: 'Aylık abonelik' },
                ]}
              />
              <button type="button" onClick={downloadCsv} className={mini}>
                <Download className="h-3 w-3" /> Dışa aktar
              </button>
            </div>
          </div>
          <div className="divide-y divide-[#fff4f8]/10">
            {tenants.map((t) => {
              const isDeleting = deletingId === t.id
              return (
                <div key={t.id} className="grid items-center gap-4 px-5 py-4 text-xs md:grid-cols-12">
                  <div className="md:col-span-3">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-[9px] font-mono text-[#fff4f8]/40">{t.id}</div>
                  </div>
                  <div className="md:col-span-2">{t.plan}</div>
                  <div className="md:col-span-2 font-display">{formatTL(t.mrr)}</div>
                  <div className="md:col-span-2 text-[#fff4f8]/55">Dönemsel abonelik</div>
                  <div className="md:col-span-1 text-[#fff4f8]/55">{t.status === 'paused' ? 'Riskli' : 'Normal'}</div>
                  <div className="md:col-span-2 flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <AdminEditDialog
                      triggerVariant="ghost"
                      triggerLabel="İncele"
                      triggerClassName="px-2 py-1 text-[9px]"
                      title={`${t.name} aboneliği`}
                      note="Invoice modeli gelince gerçek fatura kaydı açılacak."
                      fields={[
                        { label: 'Kurum', value: t.name },
                        { label: 'Plan', value: t.plan },
                        { label: 'Tutar', type: 'number', value: t.mrr },
                        { label: 'Durum', value: t.status },
                      ]}
                    />
                    <button
                      type="button"
                      onClick={() => openConfirm(t)}
                      disabled={isDeleting || Boolean(deletingId)}
                      aria-label={`${t.name} aboneliğini sil`}
                      className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-rose-100 transition-colors hover:bg-rose-500/20 hover:text-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#2f1724] disabled:opacity-60 disabled:cursor-not-allowed sm:w-auto"
                    >
                      {isDeleting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.6} />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} />
                      )}{' '}
                      {isDeleting ? 'Siliniyor' : 'Aboneliği sil'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <Dialog
          open={Boolean(confirmTarget)}
          onOpenChange={(next) => {
            if (!next) closeConfirm()
          }}
        >
          <DialogContent className="flex max-w-md flex-col border-rose-300/30 bg-[#2f1724] p-0 text-[#fff4f8] shadow-2xl shadow-black/70 sm:rounded-none">
            <DialogHeader className="shrink-0 border-b border-[#fff4f8]/10 p-4 text-left sm:p-6">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.28em] text-rose-200/80">
                <AlertTriangle className="h-4 w-4" strokeWidth={1.6} /> Yıkıcı işlem
              </div>
              <DialogTitle className="mt-2 break-words font-display text-2xl tracking-tight sm:text-3xl">
                Aboneliği sil
              </DialogTitle>
              <DialogDescription className="mt-2 text-[12px] leading-5 text-[#fff4f8]/55 sm:text-sm sm:leading-6">
                <span className="font-medium text-[#fff4f8]/85">{confirmTarget?.name}</span> aboneliği iptal edilecek ve
                abonelik listesinden kaldırılacak. Bu işlem geri alınamaz; devam etmek istiyor musunuz?
              </DialogDescription>
            </DialogHeader>
            {deleteError && (
              <div className="mx-4 mt-4 border border-rose-300/30 bg-rose-500/10 p-3 text-[11px] leading-5 text-rose-100 sm:mx-6">
                {deleteError}
              </div>
            )}
            <DialogFooter className="shrink-0 gap-2 border-t border-[#fff4f8]/10 p-4 sm:p-6 sm:space-x-0">
              <button
                type="button"
                onClick={closeConfirm}
                disabled={Boolean(deletingId)}
                className="min-h-10 w-full border border-[#fff4f8]/20 px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-[#fff4f8]/70 transition-colors hover:text-[#fff4f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fff4f8]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#2f1724] disabled:opacity-60 disabled:cursor-not-allowed sm:w-auto"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={Boolean(deletingId)}
                className="inline-flex min-h-10 w-full items-center justify-center gap-2 border border-rose-300/40 bg-rose-500 px-5 py-2 text-[10px] font-mono uppercase tracking-widest text-[#2f1724] transition-colors hover:bg-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#2f1724] disabled:opacity-60 disabled:cursor-not-allowed sm:w-auto"
              >
                {deletingId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                )}
                {deletingId ? 'Siliniyor' : 'Aboneliği sil'}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  )
}
