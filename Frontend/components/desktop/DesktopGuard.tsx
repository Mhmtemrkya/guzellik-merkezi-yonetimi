'use client'

import { useCallback, useEffect, useState } from 'react'
import { adminApi, clearSession, getStoredSession } from '@/lib/apiClient'
import { useAuth } from '@/components/dashboard/AuthContext'

// Masaüstü (Tauri) kabuğu kendini user agent ile tanıtır.
export function isDesktopApp(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent.includes('BeautyAssistDesktop')
}

/** Rust tarafındaki uygulama komutunu çağırır (withGlobalTauri). */
function tauriInvoke(command: string, args: Record<string, unknown> = {}): void {
  const tauri = (window as unknown as { __TAURI__?: { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } } }).__TAURI__
  tauri?.core?.invoke?.(command, args)?.catch(() => undefined)
}

/**
 * ✕ butonu: uygulama kapanmaz, tepsiye küçülür — gizli pencerede bildirim yoklaması sürer,
 * oturum ("beni hatırla") korunur. Rust tarafı bu sıradaki odak kaybını yok sayar.
 * Eski Tauri kabuğu (hide_to_tray komutu olmayan build) için pencere kapatma yedeği kalır.
 */
function hideToTray(): void {
  const tauri = (window as unknown as { __TAURI__?: { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } }; }).__TAURI__
  const invoke = tauri?.core?.invoke
  if (invoke) {
    invoke('hide_to_tray', {}).catch(() => {
      const t = (window as unknown as { __TAURI__?: { window?: { getCurrentWindow?: () => { close: () => Promise<void> } } } }).__TAURI__
      void t?.window?.getCurrentWindow?.()?.close()
    })
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
  const { session } = useAuth()

  useEffect(() => {
    setDesktop(isDesktopApp())
  }, [])

  // Çevrimdışı app-shell: yalnızca masaüstü kabuğunda service worker kaydedilir; internet
  // yokken panel beyaz ekran yerine son önbellekten açılır (veri katmanı apiClient'ta).
  useEffect(() => {
    if (!desktop || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/desktop-sw.js').catch(() => undefined)
  }, [desktop])

  // Ekran görüntüsü izni (web ayarlar + mobil FLAG_SECURE ile aynı model): pencere varsayılan
  // korumalı açılır; girişten sonra efektif izne göre gevşetilir. Staff için backend kişisel
  // istisna uygulanmış tek efektif değeri döner; yönetici rollerinde koruma kaldırılır.
  useEffect(() => {
    if (!desktop) return
    if (!session?.accessToken) {
      tauriInvoke('set_screenshot_protection', { block: true })
      return
    }
    if (session.user?.role !== 'Staff') {
      tauriInvoke('set_screenshot_protection', { block: false })
      return
    }
    let cancelled = false
    adminApi
      .screenshotSettings<{ allowStaffScreenshots?: boolean }>()
      .then((s) => {
        if (!cancelled) tauriInvoke('set_screenshot_protection', { block: !s?.allowStaffScreenshots })
      })
      .catch(() => {
        // Ayar okunamazsa güvenli tarafta kal: koruma açık.
        if (!cancelled) tauriInvoke('set_screenshot_protection', { block: true })
      })
    return () => {
      cancelled = true
    }
  }, [desktop, session?.accessToken, session?.user?.role])

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
      // Log gitmese bile küçülme engellenmez (kiosk kilitli kalmasın).
      adminApi.logDesktopEvent('AppClosed', 'Tepsiye küçültüldü').catch(() => undefined).finally(hideToTray)
      window.setTimeout(hideToTray, 1500)
    } else {
      hideToTray()
    }
  }, [])

  if (!desktop) return null

  return (
    <>
      <button
        type="button"
        onClick={handleClose}
        title="Tepsiye küçült — bildirimler arka planda gelmeye devam eder"
        aria-label="Tepsiye küçült"
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
