import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { BILLING_ENABLED } from '@/lib/billing'

/**
 * Satış kapalıyken (bkz. lib/billing.ts) abonelik/paket sayfası açılmaz: eski bağlantı ya da
 * yer imiyle gelen kurum yöneticisi panele döner.
 */
export default function PaketLayout({ children }: { children: ReactNode }) {
  if (!BILLING_ENABLED) redirect('/panel')
  return children
}
