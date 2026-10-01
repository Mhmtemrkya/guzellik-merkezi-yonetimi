import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { BILLING_ENABLED } from '@/lib/billing'

/** Satış kapalıyken (bkz. lib/billing.ts) satış metni yayında değildir; ziyaretçi tanıtıma döner. */
export default function SalesLegalLayout({ children }: { children: ReactNode }) {
  if (!BILLING_ENABLED) redirect('/')
  return children
}
