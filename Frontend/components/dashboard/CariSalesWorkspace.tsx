'use client'

import { useMemo, useState } from 'react'
import { adminApi } from '@/lib/apiClient'
import { apiItems, normalizeAccount } from '@/lib/apiMappers'
import { useApiQuery } from '@/hooks/useApiQuery'
import type { ApiCustomerAccount, CustomerAccount } from '@/lib/types'
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

  const { data, reload } = useApiQuery<ApiCustomerAccount[]>(
    async () => {
      if (!open || !customerId || !tenantId) return []
      const res = await adminApi
        .accounts<ApiCustomerAccount>({ tenantId, customerId, page: 1, pageSize: 100 })
        .catch(() => ({ items: [] }))
      return apiItems(res)
    },
    [open, customerId, tenantId, tick],
    { initialData: [] },
  )

  const accounts = useMemo<CustomerAccount[]>(
    () => (data || []).map((a, i) => normalizeAccount(a, i)),
    [data],
  )
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
        onCollectInstallment={(accountId, amount) =>
          run(() => adminApi.registerAccountPayment(accountId, { amount, method: 'cash' }, tenantId))}
      />
    </CustomerSalesModal>
  )
}
