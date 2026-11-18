import { describe, expect, it } from 'vitest'
import { findBranchInvoice } from './branchInvoice'

// Benzer ad ("Kadıköy 2") listede ÖNCE: bulunan fatura sıraya değil ada göre seçilmeli.
const invoices = [
  { id: 'paid', number: 'BA-2026-000001', status: 'Paid', notes: 'BeautyAsist · Ek şube · Kadıköy (ödenince açılacak)' },
  { id: 'kadikoy-2', number: 'BA-2026-000003', status: 'Overdue', notes: 'BeautyAsist · Ek şube · Kadıköy 2 (ödenince açılacak)' },
  { id: 'kadikoy', number: 'BA-2026-000002', status: 'Sent', notes: 'BeautyAsist · Ek şube · Kadıköy (ödenince açılacak)' },
  { id: 'void', number: 'BA-2026-000004', status: 'Cancelled', notes: 'BeautyAsist · Ek şube · Moda (ödenince açılacak)' },
]

describe('findBranchInvoice', () => {
  it('finds the invoice by the number in the server message', () => {
    const message = 'Şube talebiniz alındı: 580,64 ₺ (KDV dahil) için BA-2026-000002 numaralı fatura kesildi.'
    expect(findBranchInvoice(invoices, message, 'Kadıköy 2')?.id).toBe('kadikoy')
  })

  it('falls back to the exact branch name in the notes, never a similar name', () => {
    expect(findBranchInvoice(invoices, 'Şube talebiniz alındı.', 'Kadıköy')?.id).toBe('kadikoy')
    expect(findBranchInvoice(invoices, 'Şube talebiniz alındı.', ' Kadıköy 2 ')?.id).toBe('kadikoy-2')
    expect(findBranchInvoice(invoices, 'Şube talebiniz alındı.', 'Kadı')).toBeNull()
  })

  it('returns only invoices that are open for payment', () => {
    expect(findBranchInvoice(invoices, 'BA-2026-000001 numaralı fatura', 'Yok')).toBeNull()
    expect(findBranchInvoice(invoices, 'mesaj', 'Moda')).toBeNull()
    expect(findBranchInvoice(invoices, 'mesaj', '  ')).toBeNull()
  })
})
