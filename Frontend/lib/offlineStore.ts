/**
 * Çevrimdışı okuma deposu (yalnızca masaüstü kabuğu kullanır): başarılı GET yanıtları
 * IndexedDB'ye yansıtılır; internet koptuğunda apiClient son bilinen veriyi buradan sunar.
 * Tüm işlemler sessizce başarısız olabilir — çevrimiçi akışı asla bloklamaz.
 */

const DB_NAME = 'beautyassist-offline'
const STORE = 'get-cache'
const OUTBOX_STORE = 'outbox'
const DB_VERSION = 2

export interface OfflineEntry<T = unknown> {
  data: T
  ts: number
}

/** Çevrimdışı kuyruğa alınmış yazma isteği. `id` aynı zamanda Idempotency-Key'dir. */
export interface OutboxEntry {
  id: string
  /** Sıra korunur: kayıtlar kuyruğa giriş sırasıyla oynatılır (önce müşteri, sonra randevusu). */
  seq: number
  path: string
  method: string
  body: unknown
  tenantId: string | null
  branchId: string | null
  /** UI'de gösterilecek Türkçe işlem etiketi (ör. "Yeni randevu"). */
  label: string
  queuedAt: number
  /** Sunucu iş kuralı reddi sonrası doldurulur; başarısızlar panelde gösterilir. */
  failedStatus?: number
  failedMessage?: string
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB yok'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      if (!req.result.objectStoreNames.contains(OUTBOX_STORE))
        req.result.createObjectStore(OUTBOX_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

export async function offlinePut(key: string, data: unknown): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ data, ts: Date.now() } satisfies OfflineEntry, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // sessiz — çevrimdışı depo en-iyi-çaba
  }
}

export async function offlineGet<T = unknown>(key: string): Promise<OfflineEntry<T> | null> {
  try {
    const db = await openDb()
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve((req.result as OfflineEntry<T>) ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

// --- Outbox (çevrimdışı yazma kuyruğu) ---------------------------------------------------

export async function outboxAdd(entry: OutboxEntry): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite')
    tx.objectStore(OUTBOX_STORE).put(entry)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function outboxAll(): Promise<OutboxEntry[]> {
  try {
    const db = await openDb()
    return await new Promise((resolve) => {
      const tx = db.transaction(OUTBOX_STORE, 'readonly')
      const req = tx.objectStore(OUTBOX_STORE).getAll()
      req.onsuccess = () => {
        const list = (req.result as OutboxEntry[]) ?? []
        list.sort((a, b) => a.seq - b.seq)
        resolve(list)
      }
      req.onerror = () => resolve([])
    })
  } catch {
    return []
  }
}

export async function outboxRemove(id: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(OUTBOX_STORE, 'readwrite')
      tx.objectStore(OUTBOX_STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    // sessiz
  }
}

/** Girişi günceller (başarısızlık bilgisini işlemek için). */
export async function outboxUpdate(entry: OutboxEntry): Promise<void> {
  try {
    await outboxAdd(entry)
  } catch {
    // sessiz
  }
}

export async function offlineClear(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    // sessiz
  }
}
