// Cihaz güvenliği: istemci tarafı kalıcı cihaz kimliği + cihaz/ağ bilgisi.
// Kimlik localStorage'da tutulur; tarayıcı verisi silinirse cihaz "yeni" sayılır
// (kurum yöneticisi panelden eski kaydı silebilir).

const DEVICE_ID_KEY = 'gm_device_id'

export function getDeviceId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    let id = window.localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
      window.localStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

interface NavigatorConnection {
  effectiveType?: string
  type?: string
  downlink?: number
  rtt?: number
}

export interface DeviceInfo {
  name: string | null
  deviceType: string | null
  platform: string | null
  userAgent: string | null
  networkInfoJson: string | null
}

/** Tarayıcının izin verdiği ölçüde cihaz + ağ (wifi/hücresel) bilgisi toplar. */
export function getDeviceInfo(): DeviceInfo | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null
  const ua = navigator.userAgent || ''
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
  const isTablet = /iPad|Tablet/i.test(ua)
  const deviceType = isTablet ? 'tablet' : isMobile ? 'mobile' : 'pc'

  const nav = navigator as Navigator & { connection?: NavigatorConnection; userAgentData?: { platform?: string } }
  const connection = nav.connection
  const network = {
    // Tarayıcılar SSID'yi vermez; bağlantı türü/hızı ve çevrimiçi durumu kaydedilir.
    connectionType: connection?.type ?? null,
    effectiveType: connection?.effectiveType ?? null,
    downlinkMbps: connection?.downlink ?? null,
    rttMs: connection?.rtt ?? null,
    online: navigator.onLine,
    language: navigator.language ?? null,
    screen: typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
  }

  return {
    name: null,
    deviceType,
    platform: nav.userAgentData?.platform || navigator.platform || null,
    userAgent: ua || null,
    networkInfoJson: JSON.stringify(network),
  }
}

/** X-Device-Info header değeri: base64(UTF-8 JSON). Header'lar ASCII olmak zorunda. */
export function getDeviceInfoHeader(): string | null {
  const info = getDeviceInfo()
  if (!info) return null
  try {
    const json = JSON.stringify(info)
    return window.btoa(unescape(encodeURIComponent(json)))
  } catch {
    return null
  }
}
