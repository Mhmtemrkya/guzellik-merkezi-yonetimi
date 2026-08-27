'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import PressButton from './PressButton'
import { useCart } from '@/lib/cart'

/**
 * "PLANI SEÇ" — planı sepete koyar ve ödeme sayfasına götürür.
 *
 * GİRİŞ BURADA İSTENMEZ. Ziyaretçi henüz kimse bile plan seçebilmelidir; kimlik, paranın
 * gerçekten isteneceği yerde (ödeme sayfası) sorulur. Seçim `localStorage`'da durduğu için
 * giriş/kayıt turundan sonra kaybolmaz.
 *
 * ABONELİK TEK SLOTTUR (bkz. lib/cart.ts): yeni seçim öncekini değiştirir, üst üste eklenmez.
 */
export default function PlanPicker({
  planId,
  planName,
  priceTRY,
  period = 'monthly',
  featured = false,
}: {
  planId: string
  planName: string
  priceTRY: number
  period?: 'monthly' | 'yearly'
  featured?: boolean
}) {
  const router = useRouter()
  const { set } = useCart()

  return (
    <PressButton
      tone={featured ? 'primary' : 'glass-light'}
      className={`mt-7 w-full px-5 py-3 text-[14px] font-medium ${featured ? '' : 'border border-[#EEC9D7]'}`}
      onClick={() => {
        set({ planId, planName, period, priceTRY })
        router.push('/odeme')
      }}
    >
      Planı seç <ArrowRight className="h-4 w-4" />
    </PressButton>
  )
}
