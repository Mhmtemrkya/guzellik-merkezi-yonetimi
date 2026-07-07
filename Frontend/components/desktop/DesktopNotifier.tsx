'use client'

import { useEffect, useRef, useState } from 'react'
import { adminApi } from '@/lib/apiClient'
import { useAuth } from '@/components/dashboard/AuthContext'
import { isDesktopApp } from '@/components/desktop/DesktopGuard'

// Bir sonraki yoklamanın "since" imleci — yeniden açılışta eski bildirimler tekrar düşmesin.
const CURSOR_KEY = 'beautyasist.desktop.notifSince'
const POLL_MS = 45_000
// Tek yoklamada en fazla bu kadar ayrı bildirim göster; fazlası tek özet bildirime katlanır.
const MAX_TOASTS_PER_POLL = 4

interface FeedItem {
  id: string
  title: string
  body: string
  isRead: boolean
  createdAtUtc: string
}

interface FeedResponse {
  items?: FeedItem[]
  unreadCount?: number
  serverTimeUtc?: string
}

interface TauriNotificationApi {
  isPermissionGranted?: () => Promise<boolean>
  requestPermission?: () => Promise<string>
  sendNotification?: (options: { title: string; body?: string }) => void
}

function tauriNotification(): TauriNotificationApi | null {
  const tauri = (window as unknown as { __TAURI__?: { notification?: TauriNotificationApi } }).__TAURI__
  return tauri?.notification ?? null
}

/** Native bildirim gönderir; global API yoksa plugin komutunu doğrudan çağırır. */
function sendNative(title: string, body: string): void {
  const api = tauriNotification()
  if (api?.sendNotification) {
    api.sendNotification({ title, body })
    return
  }
  const tauri = (window as unknown as { __TAURI__?: { core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } } }).__TAURI__
  tauri?.core?.invoke?.('plugin:notification|notify', { options: { title, body } })?.catch(() => undefined)
}

async function ensurePermission(): Promise<boolean> {
  const api = tauriNotification()
  if (!api?.isPermissionGranted || !api.requestPermission) return true // masaüstünde varsayılan: izinli
  try {
    if (await api.isPermissionGranted()) return true
    return (await api.requestPermission()) === 'granted'
  } catch {
    return true
  }
}

/**
 * Masaüstü native bildirimleri (WhatsApp/Discord tarzı): oturum açıkken /api/notifications/feed
 * yoklanır, yeni bildirimler Windows toast / macOS Bildirim Merkezi / Linux libnotify olarak düşer.
 * Yalnızca Tauri kabuğunda çalışır; web tarayıcıda hiçbir şey yapmaz.
 */
export default function DesktopNotifier() {
  const [desktop, setDesktop] = useState(false)
  const { session } = useAuth()
  const pollingRef = useRef(false)

  useEffect(() => {
    setDesktop(isDesktopApp())
  }, [])

  useEffect(() => {
    if (!desktop || !session?.accessToken) return
    let disposed = false

    const poll = async (): Promise<void> => {
      if (pollingRef.current) return
      pollingRef.current = true
      try {
        const cursor = window.localStorage.getItem(CURSOR_KEY)
        const feed = await adminApi.notificationFeed<FeedResponse>(cursor)
        if (disposed || !feed?.serverTimeUtc) return
        // İlk yoklamada (imleç yok) geçmişi bildirim yağmuruna çevirme; sadece imleci kur.
        if (cursor) {
          const fresh = (feed.items || []).filter((n) => !n.isRead)
          if (fresh.length > 0 && (await ensurePermission()) && !disposed) {
            fresh.slice(0, MAX_TOASTS_PER_POLL).forEach((n) => sendNative(n.title || 'BeautyAsist', n.body || ''))
            if (fresh.length > MAX_TOASTS_PER_POLL) {
              sendNative('BeautyAsist', `+${fresh.length - MAX_TOASTS_PER_POLL} yeni bildirim daha var.`)
            }
          }
        }
        window.localStorage.setItem(CURSOR_KEY, feed.serverTimeUtc)
      } catch {
        // Ağ/oturum hatası: sessiz geç, sonraki turda tekrar denenir.
      } finally {
        pollingRef.current = false
      }
    }

    void poll()
    const id = window.setInterval(() => void poll(), POLL_MS)
    return () => {
      disposed = true
      window.clearInterval(id)
    }
  }, [desktop, session?.accessToken])

  return null
}
