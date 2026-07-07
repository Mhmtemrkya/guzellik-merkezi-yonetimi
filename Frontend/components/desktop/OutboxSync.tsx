'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiClientError, apiRequest, clearApiCache, notifyOutboxChanged, OUTBOX_EVENT } from '@/lib/apiClient'
import { outboxAll, outboxRemove, outboxUpdate, type OutboxEntry } from '@/lib/offlineStore'
import { useAuth } from '@/components/dashboard/AuthContext'
import { isDesktopApp } from '@/components/desktop/DesktopGuard'

const RETRY_MS = 20_000

/**
 * Çevrimdışı yazma kuyruğu senkronu (yalnızca masaüstü kabuğu):
 * - Kuyrukta işlem varken sağ altta "bağlantı bekleyen işlemler" rozeti gösterir.
 * - Bağlantı gelince kayıtları SIRAYLA sunucuya oynatır; her istek Idempotency-Key taşır
 *   (backend aynı anahtarı ikinci kez görürse ilk yanıtı döndürür — çift kayıt imkânsız).
 * - Sunucunun iş kuralıyla reddettikleri (slot dolu, kara liste, kota...) sessizce kaybolmaz:
 *   "uygulanamayan işlemler" panelinde nedeniyle birlikte gösterilir.
 */
export default function OutboxSync() {
  const [desktop, setDesktop] = useState(false)
  const [entries, setEntries] = useState<OutboxEntry[]>([])
  const [panelOpen, setPanelOpen] = useState(false)
  const { session } = useAuth()
  const syncingRef = useRef(false)

  useEffect(() => {
    setDesktop(isDesktopApp())
  }, [])

  const refresh = useCallback(async () => {
    setEntries(await outboxAll())
  }, [])

  const replay = useCallback(async () => {
    if (syncingRef.current) return
    syncingRef.current = true
    let applied = 0
    try {
      const queue = (await outboxAll()).filter((e) => !e.failedStatus)
      for (const entry of queue) {
        try {
          await apiRequest(entry.path, {
            method: entry.method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
            body: entry.body ?? undefined,
            scope: { tenantId: entry.tenantId, branchId: entry.branchId },
            headers: { 'Idempotency-Key': entry.id },
            _outboxBypass: true,
          })
          await outboxRemove(entry.id)
          applied += 1
        } catch (err) {
          if (err instanceof ApiClientError && err.status === 0) break // hâlâ çevrimdışı — sırayı koru
          // Sunucu reddi: kaydı "uygulanamadı" olarak işaretle, kuyruğun gerisini oynatmaya devam et.
          const message = err instanceof Error ? err.message : 'İşlem uygulanamadı.'
          const status = err instanceof ApiClientError ? err.status : 400
          await outboxUpdate({ ...entry, failedStatus: status, failedMessage: message })
        }
      }
    } finally {
      syncingRef.current = false
    }
    if (applied > 0) clearApiCache() // listeler taze veriyi çeksin
    await refresh()
    if (applied > 0) notifyOutboxChanged()
  }, [refresh])

  useEffect(() => {
    if (!desktop) return
    void refresh()
    const onChanged = (): void => void refresh()
    window.addEventListener(OUTBOX_EVENT, onChanged)
    return () => window.removeEventListener(OUTBOX_EVENT, onChanged)
  }, [desktop, refresh])

  useEffect(() => {
    if (!desktop || !session?.accessToken) return
    const onOnline = (): void => void replay()
    window.addEventListener('online', onOnline)
    // Emniyet kemeri: navigator.onLine güvenilmez olabilir; kuyruk doluyken periyodik dene.
    const id = window.setInterval(() => {
      if (entries.length > 0 && navigator.onLine) void replay()
    }, RETRY_MS)
    if (entries.length > 0 && navigator.onLine) void replay()
    return () => {
      window.removeEventListener('online', onOnline)
      window.clearInterval(id)
    }
  }, [desktop, session?.accessToken, entries.length, replay])

  if (!desktop || entries.length === 0) return null

  const pending = entries.filter((e) => !e.failedStatus)
  const failed = entries.filter((e) => e.failedStatus)

  return (
    <div style={{ position: 'fixed', right: 14, bottom: 14, zIndex: 2147483644, maxWidth: 380, fontFamily: 'inherit' }}>
      {panelOpen && failed.length > 0 && (
        <div
          style={{
            marginBottom: 10,
            borderRadius: 14,
            border: '1px solid rgba(114,47,55,0.22)',
            background: 'rgba(253,248,244,0.98)',
            boxShadow: '0 18px 44px -18px rgba(74,27,36,0.4)',
            padding: 14,
            color: '#352432',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Uygulanamayan işlemler</div>
          <div style={{ display: 'grid', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
            {failed.map((e) => (
              <div
                key={e.id}
                style={{ borderRadius: 10, border: '1px solid rgba(114,47,55,0.14)', padding: '8px 10px', fontSize: 12 }}
              >
                <div style={{ fontWeight: 600 }}>
                  {e.label} · {new Date(e.queuedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div style={{ marginTop: 3, color: '#8e3f5c' }}>{e.failedMessage || 'Sunucu isteği reddetti.'}</div>
                <button
                  type="button"
                  onClick={() => {
                    void outboxRemove(e.id).then(() => refresh())
                  }}
                  style={{
                    marginTop: 6,
                    border: '1px solid rgba(114,47,55,0.25)',
                    borderRadius: 8,
                    background: 'transparent',
                    color: '#722f37',
                    fontSize: 11,
                    padding: '3px 10px',
                    cursor: 'pointer',
                  }}
                >
                  Kaydı kaldır
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderRadius: 999,
          border: '1px solid rgba(114,47,55,0.22)',
          background: failed.length > 0 ? 'linear-gradient(90deg,#8e3f5c,#722f37)' : 'rgba(253,248,244,0.96)',
          color: failed.length > 0 ? '#fdf8f4' : '#722f37',
          fontSize: 12.5,
          fontWeight: 600,
          padding: '9px 16px',
          cursor: 'pointer',
          boxShadow: '0 12px 30px -14px rgba(74,27,36,0.45)',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: failed.length > 0 ? '#f7c6d6' : '#c85776',
            display: 'inline-block',
          }}
        />
        {failed.length > 0
          ? `${failed.length} işlem uygulanamadı${pending.length > 0 ? ` · ${pending.length} beklemede` : ''}`
          : `${pending.length} işlem bağlantı bekliyor`}
      </button>
    </div>
  )
}
