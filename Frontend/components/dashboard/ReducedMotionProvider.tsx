'use client'

import { MotionConfig } from 'framer-motion'
import type { ReactNode } from 'react'

/**
 * HAREKET AZALTMA TERCİHİNİ TÜM UYGULAMAYA UYGULAR.
 *
 * Panelde bol animasyon var (kart girişleri, layout geçişleri, sayaçlar). Bunlar Framer Motion
 * ile JS'ten sürülüyor; `globals.css`'teki `@media (prefers-reduced-motion: reduce)` blokları
 * yalnız CSS animasyonlarını durdurabiliyordu, JS ile sürülen hareketi HİÇ etkilemiyordu.
 * Vestibüler duyarlılığı olan kullanıcı işletim sisteminde "hareketi azalt" dese bile panel
 * aynı şekilde kayıp zıplıyordu.
 *
 * `reducedMotion="user"` tek yerden çözer: kullanıcı tercihi açıkken Framer Motion konum/ölçek
 * gibi DÖNÜŞÜM animasyonlarını atlar, opaklık geçişlerini korur (içerik yine de belirir, sadece
 * hareket etmez). Bileşenlerin tek tek `useReducedMotion` çağırması gerekmez.
 */
export default function ReducedMotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
