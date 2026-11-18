/**
 * Şube talebinin faturasını bulur (şube ekleme penceresinin "Faturayı öde" adımı).
 *
 * Sunucunun `BranchAwaitingPayment` mesajı fatura numarasını taşır ("… BA-2026-000123 numaralı fatura kesildi …").
 * Önce o numara aranır; mesaj değişirse fatura notundaki "Ek şube · {ad} (ödenince açılacak)" izine düşülür (ad
 * birebir: "Kadıköy" araması "Kadıköy 2" faturasını bulmaz). Yalnız ödemeye açık (Sent / Overdue) faturalar döner —
 * ödenmiş ya da iptal edilmiş fatura için ödeme sayfası açılmaz.
 */
export interface PayableInvoice { id: string; number: string; status: string; notes?: string | null }

export function findBranchInvoice<T extends PayableInvoice>(invoices: readonly T[], message: string, branchName: string): T | null {
  const open = invoices.filter((inv) => inv.status === 'Sent' || inv.status === 'Overdue')
  const number = /\b([A-Z]{2}-\d{4}-\d+)\b/.exec(message)?.[1]
  const byNumber = number ? open.find((inv) => inv.number === number) : undefined
  if (byNumber) return byNumber
  const name = branchName.trim()
  if (!name) return null
  const marker = `Ek şube · ${name}`
  return open.find((inv) => {
    const notes = inv.notes ?? ''
    return notes.includes(`${marker} (`) || notes.endsWith(marker)
  }) ?? null
}
