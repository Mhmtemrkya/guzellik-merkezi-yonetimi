'use client'

import { useEffect, useState } from 'react'
import { OFFLINE_DATA_EVENT } from '@/lib/apiClient'
import { isDesktopApp } from '@/components/desktop/DesktopGuard'

/**
 * Masaüstü çevrimdışı şeridi: bağlantı koptuğunda üstte sabit uyarı gösterir.
 * Çevrimdışı depodan veri sunulduğunda "son bilinen veriler" ibaresi eklenir.
 * Web tarayıcıda render edilmez.
 */
export default function OfflineBanner() {
  const [desktop, setDesktop] = useState(false)
  const [offline, setOffline] = useState(false)
  const [staleTs, setStaleTs] = useState<number | null>(null)

  useEffect(() => {
    setDesktop(isDesktopApp())
  }, [])

  useEffect(() => {
    if (!desktop) return
    setOffline(!navigator.onLine)
    const goOffline = (): void => setOffline(true)
    const goOnline = (): void => {
      setOffline(false)
      setStaleTs(null)
    }
    const onStaleData = (e: Event): void => {
      // apiClient sunucuya ulaşamayıp depodan veri sundu — navigator.onLine yanlış pozitif
      // olabilir (modem var, internet yok); şeridi buradan da tetikle.
      setOffline(true)
      const ts = (e as CustomEvent<{ ts?: number }>).detail?.ts
      if (typeof ts === 'number') setStaleTs((prev) => (prev === null || ts < prev ? ts : prev))
    }
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    window.addEventListener(OFFLINE_DATA_EVENT, onStaleData)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
      window.removeEventListener(OFFLINE_DATA_EVENT, onStaleData)
    }
  }, [desktop])

  if (!desktop || !offline) return null

  const staleLabel = staleTs
    ? ` — son bilinen veriler gösteriliyor (${new Date(staleTs).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })})`
    : ''

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 2147483645,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '7px 48px',
        fontSize: 12.5,
        fontWeight: 600,
        color: '#fdf8f4',
        background: 'linear-gradient(90deg, #8e3f5c, #722f37)',
        boxShadow: '0 6px 18px -8px rgba(74,27,36,0.5)',
      }}
    >
      <span
        aria-hidden
        style={{ width: 8, height: 8, borderRadius: 999, background: '#f7c6d6', display: 'inline-block' }}
      />
      Bağlantı yok — çevrimdışı mod{staleLabel}. Değişiklikler bağlantı gelince yapılabilir.
    </div>
  )
}
