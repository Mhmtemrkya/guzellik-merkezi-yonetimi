'use client'

import { useMemo, useState } from 'react'
import { adminApi } from '@/lib/apiClient'
import { mapCancelledSale, normalizeAccount } from '@/lib/apiMappers'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { ApiCustomerAccount, CancelledSale, CustomerAccount } from '@/lib/types'
import CustomerSalesModal, { summarizeCustomerSales } from '@/components/dashboard/CustomerSalesModal'
import CustomerSalesPanel from '@/components/dashboard/CustomerSalesPanel'
import type { HistoricalCatalogOption, HistoricalSaleValues } from '@/components/dashboard/HistoricalSaleDialog'

/**
 * CARİ HESAPLAR → BİR MÜŞTERİNİN SATIŞ ÇALIŞMA ALANI.
 *
 * <p>
 * Satış listesi, geçmiş satış ekleme ve satış iptali şimdiye kadar YALNIZ müşteri kartında vardı.
 * Ön muhasebeden çalışan biri, borcunu gördüğü satışı iptal etmek ya da yazılıma geçmeden önceki
 * bir satışı girmek için müşteriler sayfasına gidip müşteriyi yeniden bulmak zorundaydı. Aynı
 * paneller burada da açılır — iki yerde iki ayrı liste değil, AYNI bileşen.
 * </p>
 *
 * <p>
 * VERİ MÜŞTERİ BAŞINA ÇEKİLİR, sayfanın cari listesinden SÜZÜLMEZ. İki sebep:
 * (1) o liste `pageSize: 500` ile sınırlı — büyük kurumda müşterinin satışının orada olacağı
 * garanti değil; (2) liste iptal edilmiş satışları dışlıyor (`liveAccounts`), oysa bu panelin
 * "İptal" sekmesi onları göstermek zorunda. Müşteriler sayfası da bu ucu aynı şekilde kullanıyor.
 * </p>
 */
export default function CariSalesWorkspace({
  customerId,
  customerName,
  tenantId,
  branchId,
  staffOptions,
  packageOptions,
  serviceOptions,
  open,
  onClose,
  onChanged,
}: {
  customerId: string
  customerName: string
  tenantId?: string
  branchId?: string | null
  staffOptions: { id: string; name: string }[]
  packageOptions: HistoricalCatalogOption[]
  serviceOptions: HistoricalCatalogOption[]
  open: boolean
  onClose: () => void
  /** Satış değiştiğinde çağrılır — cari listesi/özetleri tazelensin. */
  onChanged: () => Promise<void> | void
}) {
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  const { data, reload, error } = useApiQuery<{
    live: ApiCustomerAccount[]
    cancelled: CancelledSale[]
    archiveUnavailable: boolean
  }>(
    async () => {
      if (!open || !customerId || !tenantId) return { live: [], cancelled: [], archiveUnavailable: false }
      // CANLI + ARŞİV TEK İSTEKTE (tek anlık görüntü). İkisi ayrı çekilirken aradaki bir iptal
      // aynı satışı ÇİFT saydırabiliyor ya da tamamen kaybettirebiliyordu. Hata da YUTULMAZ:
      // boş liste "satış yok" demektir, oysa gerçek "veri alınamadı"dır.
      // SAYFA BOYUTU GÖNDERİLMEZ. Burada `pageSize: 500` vardı ve 500'den fazla canlı satışı
      // olan müşteride fazlası SESSİZCE kesiliyordu — üstelik panelin özet rakamları bu eksik
      // listeden hesaplanıyordu. Uç, müşteri kapsamında listenin TAMAMINI döndürür ya da açıkça
      // reddeder; sayfaları burada dolaşmak tek-anlık-görüntü garantisini bozardı.
      const res = await adminApi.accountsWithArchive<{
        live?: { items?: ApiCustomerAccount[] }
        cancelled?: unknown[]
      }>({ customerId }, tenantId)

      const live = Array.isArray(res?.live?.items) ? res.live!.items! : []
      const cancelled = Array.isArray(res?.cancelled) ? res.cancelled.map(mapCancelledSale) : []
      return { live, cancelled, archiveUnavailable: false }
    },
    [open, customerId, tenantId, tick],
    { initialData: { live: [], cancelled: [], archiveUnavailable: false } },
  )

  /**
   * Panelin gördüğü satışlar: canlı + ARŞİVDEN geri kurulan iptaller.
   * Arşiv kaydı cari satırı değildir; panelin beklediği şekle çevrilir ki "İptal" sekmesi
   * gerçekten dolsun (tutar, tarih, iptal gerekçesi arşivden gelir).
   */
  const accounts = useMemo<CustomerAccount[]>(() => {
    const live = (data?.live || []).map((a, i) => normalizeAccount(a, i))
    const cancelled = (data?.cancelled || []).map((c) => normalizeAccount({
      id: c.originalAccountId || c.id,
      tenantId,
      branchId: c.branchId,
      customerId: c.customerId,
      customerName: c.customerName,
      customerPhone: c.customerPhone,
      servicePackageId: c.servicePackageId,
      name: c.name,
      totalAmount: c.totalAmount,
      depositAmount: c.depositAmount,
      // İptalde alacak kalmaz; tahsil edilen tutar KURUMDA KALAN paradır.
      paidAmount: c.retainedAmount,
      remainingAmount: 0,
      soldAtUtc: c.soldAtUtc,
      soldByStaffName: c.soldByStaffName,
      isHistorical: c.isHistorical,
      sessionsTotal: c.sessionsTotal,
      sessionsUsed: c.sessionsUsed,
      cancelledAtUtc: c.cancelledAtUtc,
      cancellationReason: c.cancellationReason,
      saleStatus: 'Cancelled',
      installments: [],
      payments: [],
    } as unknown as ApiCustomerAccount, 0))
    return [...live, ...cancelled]
  }, [data, tenantId])
  const summary = useMemo(() => summarizeCustomerSales(accounts), [accounts])

  /** Her satış aksiyonundan sonra HEM bu panel HEM çağıran sayfa tazelenir: cari listesindeki
      kalan borç, iptal sayacı ve kasa özetleri aynı işlemden etkileniyor. */
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      setTick((v) => v + 1)
      await reload()
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  const createHistorical = (values: HistoricalSaleValues): Promise<void> =>
    run(() => adminApi.createHistoricalSale({
      customerId,
      name: values.name,
      soldAtUtc: values.soldAt,
      totalAmount: values.totalAmount,
      paidAmount: values.paidAmount,
      soldByStaffMemberId: values.soldByStaffMemberId,
      servicePackageId: values.servicePackageId,
      serviceDefinitionId: values.serviceDefinitionId,
      sessionsTotal: values.sessionsTotal,
      sessionsUsed: values.sessionsUsed,
      installmentCount: values.installmentCount,
      firstDueDate: values.firstDueDate,
      // Ödenen aylar KENDİ VADE TARİHLERİYLE tahsilat yazılır → geçmiş satış geçmiş cariye düşer.
      paidInstallmentCount: values.paidInstallmentCount,
      paymentMethod: values.paymentMethod,
      appliedByStaffMemberId: values.appliedByStaffMemberId,
      createSessionAppointments: values.createSessionAppointments,
      sessionIntervalDays: values.sessionIntervalDays,
      notes: values.notes,
      branchId: branchId ?? null,
    }, tenantId))

  return (
    <CustomerSalesModal open={open} onClose={onClose} customerName={customerName} summary={summary}>
      {/* VERİ ALINAMADIYSA AÇIKÇA SÖYLE: boş liste "satış yok" gibi okunuyordu ve kullanıcı
          eksik veri üzerinden iptal/geçmiş satış işlemi yapabilirdi. */}
      {error && (
        <div className="mb-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12px] text-rose-800">
          Satışlar alınamadı: {error} — liste eksik olabilir, işlem yapmadan önce sayfayı yenileyin.
        </div>
      )}
      {/* ARŞİV OKUNAMADI: "İptal" sekmesinin boş olması GERÇEK sıfır sanılıyordu. */}
      {data?.archiveUnavailable && (
        <div className="mb-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12px] text-rose-800">
          İptal edilen satışlar yüklenemedi — &quot;İptal&quot; sekmesi eksik olabilir (boş görünmesi
          &quot;iptal yok&quot; anlamına gelmez). İşlem yapmadan önce sayfayı yenileyin.
        </div>
      )}
      <CustomerSalesPanel
        variant="flush"
        customerName={customerName}
        accounts={accounts}
        staffOptions={staffOptions}
        packageOptions={packageOptions}
        serviceOptions={serviceOptions}
        busy={busy}
        onCreateHistorical={createHistorical}
        onCancelSale={(accountId, reason, refundedAmount = 0, refundMethod = 'cash') =>
          run(() => adminApi.cancelSale(accountId, reason || null, refundedAmount, tenantId, refundMethod))}
        onRestoreSale={(accountId) => run(() => adminApi.restoreSale(accountId, tenantId))}
        // Gövdeye damga YAZILMAZ (sunucu kendi "şimdi"sini koyar) — bu yüzden gövde zaten
        // tıklamalar arasında sabittir ve opts'tan yalnız anahtar gerekir.
        onCollectInstallment={(accountId, amount, opts) =>
          run(() => adminApi.registerAccountPayment(accountId, { amount, method: 'cash' }, tenantId, opts.idempotencyKey))}
      />
    </CustomerSalesModal>
  )
}
