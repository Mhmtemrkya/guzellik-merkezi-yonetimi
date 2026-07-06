'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminApi, clearSession, getStoredSession } from '@/lib/apiClient'

// Masaüstü (Tauri) kabuğu kendini user agent ile tanıtır.
function isDesktopApp(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('BeautyAsistDesktop')
}

function closeDesktopWindow(): void {
  const tauri = (window as unknown as { __TAURI__?: { window?: { getCurrentWindow?: () => { close: () => Promise<void> } } } }).__TAURI__
  const current = tauri?.window?.getCurrentWindow?.()
  if (current) {
    void current.close()
  } else {
    window.close()
  }
}

/**
 * Masaüstü uygulaması güvenlik kabuğu:
 * - Sağ üstte kalıcı "uygulamayı kapat" butonu (kapatma, kullanıcı kimliğiyle loglanır)
 * - Uygulama alta alınır / başka pencereye geçilirse: log + oturum düşürme + bulanık kilit ekranı
 */
export default function DesktopGuard() {
  const [desktop, setDesktop] = useState(false)
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    setDesktop(isDesktopApp())
  }, [])

  const handleFocusLost = useCallback(() => {
    const session = getStoredSession()
    // Giriş yapılmamışsa (login ekranı) odak kaybı önemsiz.
    if (!session?.accessToken) return
    setLocked(true)
    // Önce log (token hâlâ elimizdeyken), sonra oturumu düşür.
    adminApi.logDesktopEvent('FocusLost').catch(() => undefined).finally(() => {
      clearSession()
      window.setTimeout(() => {
        window.location.href = '/login'
      }, 1600)
    })
  }, [])

  useEffect(() => {
    if (!desktop) return
    window.addEventListener('desktop-focus-lost', handleFocusLost)
    return () => window.removeEventListener('desktop-focus-lost', handleFocusLost)
  }, [desktop, handleFocusLost])

  const handleClose = useCallback(() => {
    const session = getStoredSession()
    if (session?.accessToken) {
      // Log gitmese bile kapanış engellenmez (kiosk kilitli kalmasın).
      adminApi.logDesktopEvent('AppClosed').catch(() => undefined).finally(closeDesktopWindow)
      window.setTimeout(closeDesktopWindow, 1500)
    } else {
      closeDesktopWindow()
    }
  }, [])

  if (!desktop) return null

  return (
    <>
      <button
        type="button"
        onClick={handleClose}
        title="Uygulamayı kapat"
        aria-label="Uygulamayı kapat"
        style={{
          position: 'fixed',
          top: 10,
          right: 10,
          zIndex: 2147483646,
          width: 38,
          height: 38,
          borderRadius: 10,
          border: '1px solid rgba(114,47,55,0.25)',
          background: 'rgba(253,248,244,0.92)',
          color: '#722f37',
          fontSize: 18,
          lineHeight: 1,
          cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(74,27,36,0.18)',
        }}
      >
        ✕
      </button>
      {locked && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2147483647,
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
            background: 'rgba(74,27,36,0.45)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            color: '#fdf8f4',
            fontFamily: 'inherit',
            textAlign: 'center',
            padding: 24,
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 600 }}>Güvenlik kilidi</div>
          <div style={{ fontSize: 14, maxWidth: 420 }}>
            Uygulamadan ayrıldığınız için oturumunuz sonlandırıldı. Giriş ekranına yönlendiriliyorsunuz…
          </div>
        </div>
      )}
    </>
  )
}
