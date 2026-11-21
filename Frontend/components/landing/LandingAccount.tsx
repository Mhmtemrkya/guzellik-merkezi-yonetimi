'use client'

import Link from 'next/link'
import { ArrowUpRight, ShoppingBag } from 'lucide-react'
import { useAuth } from '@/components/dashboard/AuthContext'
import { useCart } from '@/lib/cart'
import styles from '@/app/home.module.css'

export default function LandingAccount() {
  const { hydrated, isAuthenticated } = useAuth()
  const { item } = useCart()
  const signedIn = hydrated && isAuthenticated

  return (
    <div className={styles.account}>
      {item && (
        <Link href="/odeme" className={styles.cartLink} aria-label="Sepeti aç">
          <ShoppingBag size={17} aria-hidden="true" />
          <span aria-hidden="true" />
        </Link>
      )}
      <Link href={signedIn ? '/panel' : '/login'} className={styles.loginLink}>
        {signedIn ? 'Panelim' : 'Giriş yap'} <ArrowUpRight size={15} aria-hidden="true" />
      </Link>
    </div>
  )
}
