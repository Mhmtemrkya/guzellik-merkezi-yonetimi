'use client'

import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import type { MouseEventHandler } from 'react'
import { ShoppingBag } from 'lucide-react'
import { useCart } from '@/lib/cart'
import styles from '@/components/public/MaydiMenu.module.css'

/**
 * Menüdeki sepet bağlantısı. "Giriş yap" / "Panelim" 22 Kas 2026'dan beri üst çubuktadır (MaydiMenu).
 */
export default function LandingAccount({ onNavigate }: { onNavigate: MouseEventHandler<HTMLAnchorElement> }) {
  const { item } = useCart()
  if (!item) return null

  return (
    <div className={styles.account}>
      <Dialog.Close asChild>
        <Link href="/odeme" className={styles.accountLink} aria-label="Sepeti aç" onClick={onNavigate}>
          <ShoppingBag size={17} aria-hidden="true" /> Sepetim
        </Link>
      </Dialog.Close>
    </div>
  )
}
