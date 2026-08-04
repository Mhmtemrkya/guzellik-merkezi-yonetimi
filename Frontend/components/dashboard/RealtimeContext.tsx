'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { HubConnectionBuilder, HubConnectionState, LogLevel, type HubConnection } from '@microsoft/signalr'
import { getAccessToken, getStoredSession } from '@/lib/apiClient'

/**
 * Sunucudan gelen anlık olay. VERİ TAŞIMAZ, yalnız "şu konu değişti" der; ekran ilgilendiği
 * konuyu görünce kendi verisini yeniden çeker. Böylece yetki kapıları normal HTTP uçlarında kalır.
 */
export interface RealtimeEvent {
  kind: string
  title?: string | null
  message?: string | null
  topics?: string[] | null
  data?: Record<string, string> | null
}

type Listener = (event: RealtimeEvent) => void

interface RealtimeContextValue {
  connected: boolean
  /** Verilen konulardan biri değişince çağrılır. Konu verilmezse TÜM olaylar gelir. */
  subscribe: (topics: string[] | null, listener: Listener) => () => void
}

const RealtimeContext = createContext<RealtimeContextValue>({
  connected: false,
  subscribe: () => () => {},
})

/**
 * Hub adresi. WebSocket, Next.js route handler'ından (/api/proxy) GEÇEMEZ — bu yüzden
 * bağlantı doğrudan API'ye kurulur. Adres verilmemişse gerçek zamanlı katman sessizce
 * devre dışı kalır; uygulama normal isteklerle çalışmaya devam eder.
 */
/**
 * BAĞLANMAYA DEĞER TOKEN. Yalnız "token var mı" bakmak yetmiyordu: sekme uzun süre açık kaldıysa
 * (ya da kayıtlı oturumla yeniden açıldıysa) depodaki access token SÜRESİ DOLMUŞ olabilir. Bu
 * durumda negotiate kesin 401 döner ve SignalR istemcisi konsola hata basar — kullanıcı çalışan
 * bir uygulamada kırmızı hata görür. Süresi dolmuşsa hiç denemeyiz; uygulamanın kendi token
 * yenilemesi tamamlanınca (birkaç saniye) bağlantı sessizce kurulur.
 *
 * Süre bilgisi yoksa ENGELLEMEYİZ (fail-open): eski/eksik oturum şekilleri gerçek zamanlı katmanı
 * büsbütün kapatmasın.
 */
function usableToken(): string | null {
  const token = getAccessToken()
  if (!token) return null
  const expiresAt = Date.parse(getStoredSession()?.expiresAtUtc || '')
  // 10 sn pay: negotiate/handshake sırasında dolacak token da işe yaramaz.
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() < 10_000) return null
  return token
}

function resolveHubUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_REALTIME_URL
  if (explicit) return explicit.replace(/\/$/, '')

  const apiOrigin = process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL
  if (apiOrigin) return `${apiOrigin.replace(/\/$/, '')}/hubs/realtime`

  // Geliştirme kolaylığı: yerelde backend'in bilinen adresi.
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
    return 'http://localhost:5019/hubs/realtime'
  }
  return null
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false)
  const listenersRef = useRef(new Set<{ topics: string[] | null; listener: Listener }>())
  const connectionRef = useRef<HubConnection | null>(null)

  const subscribe = useCallback((topics: string[] | null, listener: Listener) => {
    const entry = { topics, listener }
    listenersRef.current.add(entry)
    return () => {
      listenersRef.current.delete(entry)
    }
  }, [])

  useEffect(() => {
    const url = resolveHubUrl()
    if (!url) return undefined
    // Token yoksa henüz giriş yapılmamıştır; oturum açılınca bu efekt yeniden çalışmaz,
    // bu yüzden bağlantı kurulumunu token gelene kadar kısa aralıklarla dener.
    let disposed = false
    let connection: HubConnection | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const dispatch = (event: RealtimeEvent): void => {
      const topics = event.topics || []
      for (const { topics: wanted, listener } of listenersRef.current) {
        if (wanted && wanted.length > 0 && !wanted.some((t) => topics.includes(t))) continue
        try {
          listener(event)
        } catch {
          /* bir dinleyicinin hatası diğerlerini engellemesin */
        }
      }
    }

    const start = async (): Promise<void> => {
      if (disposed) return
      // Token yok ya da süresi dolmuş: giriş/yenileme tamamlanana kadar sessizce bekle.
      if (!usableToken()) {
        retryTimer = setTimeout(() => void start(), 3000)
        return
      }
      connection = new HubConnectionBuilder()
        .withUrl(url, { accessTokenFactory: () => getAccessToken() || '' })
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .configureLogging(LogLevel.Error)
        .build()

      connection.on('realtime', (event: RealtimeEvent) => dispatch(event))
      connection.onreconnected(() => {
        setConnected(true)
        // Bağlantı koptuğu sürede kaçan olaylar OLABİLİR: "her şeyi tazele" diyerek
        // ekranların sunucudaki gerçek duruma dönmesini sağla (kalıcılık DB'de).
        dispatch({ kind: 'realtime.reconnected', topics: null })
      })
      connection.onreconnecting(() => setConnected(false))
      connection.onclose(() => setConnected(false))

      try {
        await connection.start()
        if (disposed) {
          void connection.stop()
          return
        }
        connectionRef.current = connection
        setConnected(true)
      } catch {
        // Backend kapalı olabilir — uygulama normal isteklerle çalışmaya devam eder.
        setConnected(false)
        retryTimer = setTimeout(() => void start(), 10000)
      }
    }

    void start()
    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      const active = connection
      connectionRef.current = null
      if (active && active.state !== HubConnectionState.Disconnected) void active.stop()
    }
  }, [])

  const value = useMemo<RealtimeContextValue>(() => ({ connected, subscribe }), [connected, subscribe])
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

/**
 * Belirli konular değiştiğinde çalışacak geri çağrıyı kaydeder.
 *
 * @example useRealtime(['adisyon', 'sessions'], () => reload())
 */
export function useRealtime(topics: string[] | null, listener: Listener): void {
  const { subscribe } = useContext(RealtimeContext)
  // Dinleyici her render'da yeniden kurulmasın; ref üzerinden güncel tutulur.
  const listenerRef = useRef(listener)
  listenerRef.current = listener
  const topicsKey = topics ? topics.join('|') : ''

  useEffect(() => {
    const wanted = topicsKey ? topicsKey.split('|') : null
    return subscribe(wanted, (event) => listenerRef.current(event))
  }, [subscribe, topicsKey])
}

export function useRealtimeStatus(): boolean {
  return useContext(RealtimeContext).connected
}
