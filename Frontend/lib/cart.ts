'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * ABONELİK SEPETİ — TEK SLOT.
 *
 * Bu bir e-ticaret sepeti DEĞİLDİR: backend `POST /api/admin/billing/checkout` TEK bir
 * `subscriptionPlanId` + TEK bir `billingPeriod` alır. Adetli, çok satırlı bir sepet
 * uçta karşılanamaz; bu yüzden yeni plan seçmek öncekini DEĞİŞTİRİR.
 *
 * NEDEN CONTEXT DEĞİL: kök `layout.tsx` sağlayıcıları `/panel` dahil her rotayı sarar.
 * Yalnız tanıtım sayfasında kullanılan bir durum için o yuvalanmayı büyütmek gereksiz risk.
 * Bunun yerine `localStorage` + `useSyncExternalStore` — sunucu render'ında boş, istemcide
 * hidrasyondan sonra dolu.
 *
 * SEKMELER ARASI: `storage` olayı yalnız DİĞER sekmelerde tetiklenir; aynı sekmedeki
 * değişiklik için kendi olayımızı yayınlarız, yoksa sepete ekleyen sayfa kendi rozetini
 * güncellemez.
 */

const KEY = 'ba.cart.v1'
const EVENT = 'ba:cart'

export interface CartItem {
  planId: string
  planName: string
  period: 'monthly' | 'yearly'
  /** Gösterim içindir; TAHSİL EDİLECEK tutar her zaman sunucudan gelir (`amountTRY`). */
  priceTRY: number
}

function read(): CartItem | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CartItem
    // Bozuk/eski kayıt sepeti kilitlemesin.
    if (!parsed?.planId || (parsed.period !== 'monthly' && parsed.period !== 'yearly')) return null
    return parsed
  } catch {
    return null
  }
}

/** Aboneliği kimin okuduğu fark etmez; her yazma tek noktadan duyurulur. */
function announce(): void {
  window.dispatchEvent(new Event(EVENT))
}

export function setCart(item: CartItem): void {
  localStorage.setItem(KEY, JSON.stringify(item))
  announce()
}

export function clearCart(): void {
  localStorage.removeItem(KEY)
  announce()
}

/**
 * Anlık görüntü ÖNBELLEKLENİR: `useSyncExternalStore` her render'da `getSnapshot` çağırır ve
 * her seferinde yeni bir nesne dönerse React sonsuz döngüye girer. Depo değişmedikçe aynı
 * referans döner.
 */
let cached: CartItem | null = null
let cachedRaw: string | null = null

function getSnapshot(): CartItem | null {
  const raw = localStorage.getItem(KEY)
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cached = read()
  }
  return cached
}

/** Sunucuda `localStorage` yoktur; sepet orada her zaman boştur. */
function getServerSnapshot(): CartItem | null {
  return null
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useCart(): {
  item: CartItem | null
  set: (item: CartItem) => void
  clear: () => void
} {
  const item = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const set = useCallback((next: CartItem) => setCart(next), [])
  const clear = useCallback(() => clearCart(), [])
  return { item, set, clear }
}

/**
 * Sepette bekleyen bir plan var mı? Hook DEĞİLDİR: giriş sonrası yönlendirme gibi tek seferlik
 * kararlarda çağrılır, bileşen aboneliği kurmaz.
 */
export function hasPendingCart(): boolean {
  if (typeof window === 'undefined') return false
  return read() !== null
}
