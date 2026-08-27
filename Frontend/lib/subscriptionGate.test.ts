import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * BU KURAL İKİ YERDE YAZILI: backend `TrialAccessMiddleware` ve burada. Sapma SESSİZDİR —
 * kullanıcı ya girebileceği panele alınmaz ya da giremeyeceği panele gönderilip 403 duvarına
 * çarpar. Testler kuralın her dalını, özellikle "kararsız kalınca panele" güvenli tarafını
 * sabitler.
 */

// `vi.hoisted`: mock nesnesi `vi.mock` fabrikasıyla AYNI anda yaratılır. Sarmalayıcı bir ok
// fonksiyonu kullanmak, reddedilen promise'in koşucuya sızmasına ve testin hatalı düşmesine
// yol açıyordu — sahte fonksiyon doğrudan dışa verilir.
const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock('@/lib/apiClient', () => ({ apiRequest }))

import { tenantHasPanelAccess } from './subscriptionGate'

const GECMIS = new Date(Date.now() - 86_400_000).toISOString()
const GELECEK = new Date(Date.now() + 86_400_000).toISOString()

/** En az alanla geçerli bir oturum; testler yalnız kurum kimliğini ve token'ı kullanır. */
function oturum(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: 'token',
    refreshToken: 'r',
    expiresAtUtc: GELECEK,
    createdAt: GECMIS,
    scope: null,
    selectedTenantId: 'tenant-1',
    selectedBranchId: null,
    user: { userId: 'u1', email: 'a@b.c', role: 'InstitutionOwner', roleLabel: '', permissions: [], avatar: '', tenantId: 'tenant-1' },
    ...overrides,
  } as never
}

beforeEach(() => apiRequest.mockReset())

describe('tenantHasPanelAccess', () => {
  it('süresi dolmamış abonelik panele girer', async () => {
    apiRequest.mockResolvedValue({ status: 'Active', subscriptionEndsAtUtc: GELECEK })
    expect(await tenantHasPanelAccess(oturum())).toBe(true)
  })

  it('süresi DOLMUŞ abonelik panele giremez', async () => {
    apiRequest.mockResolvedValue({ status: 'Active', subscriptionEndsAtUtc: GECMIS })
    expect(await tenantHasPanelAccess(oturum())).toBe(false)
  })

  it('devam eden deneme panele girer — 14 gün vaadi bozulmamalı', async () => {
    apiRequest.mockResolvedValue({ status: 'Trial', trialEndsAtUtc: GELECEK })
    expect(await tenantHasPanelAccess(oturum())).toBe(true)
  })

  it('bitmiş deneme panele giremez', async () => {
    apiRequest.mockResolvedValue({ status: 'Trial', trialEndsAtUtc: GECMIS })
    expect(await tenantHasPanelAccess(oturum())).toBe(false)
  })

  it('askıya alınmış kurum panele giremez', async () => {
    apiRequest.mockResolvedValue({ status: 'Suspended' })
    expect(await tenantHasPanelAccess(oturum())).toBe(false)
  })

  it('iptal edilmiş kurum panele giremez', async () => {
    apiRequest.mockResolvedValue({ status: 'Cancelled' })
    expect(await tenantHasPanelAccess(oturum())).toBe(false)
  })

  /**
   * GÜVENLİ TARAF. Ödeyen bir kurumu ağ hatası yüzünden kendi panelinden etmek, süresi dolmuş
   * birini panele alıp orada backend'in askı mesajını göstermekten daha kötüdür.
   *
   * NOT: hata `apiRequest`'in İÇİNDEN değil, yanıtı işlenirken üretiliyor. Sebebi koşucu:
   * sahte fonksiyonun döndürdüğü reddedilmiş promise'i Vitest ayrıca kaydediyor ve o kayda
   * kimse `catch` iliştirmediği için testi "unhandled rejection" sayıp düşürüyordu — oysa
   * `tenantHasPanelAccess` hatayı sorunsuz yakalıyor. Bozuk bir yanıt gövdesi aynı `catch`
   * dalına girer ve kuralı koşucuya takılmadan sabitler.
   */
  it('yanıt işlenemezse panele gönderir', async () => {
    apiRequest.mockResolvedValue({
      get status(): string {
        throw new Error('bozuk yanıt')
      },
    })
    expect(await tenantHasPanelAccess(oturum())).toBe(true)
  })

  it('tanınmayan durum panele gönderir', async () => {
    apiRequest.mockResolvedValue({ status: 'Bilinmeyen' })
    expect(await tenantHasPanelAccess(oturum())).toBe(true)
  })

  it('bitiş tarihi boşsa süre dolmuş sayılmaz', async () => {
    apiRequest.mockResolvedValue({ status: 'Active', subscriptionEndsAtUtc: null })
    expect(await tenantHasPanelAccess(oturum())).toBe(true)
  })

  it('kurum kimliği yoksa istek hiç yapılmaz', async () => {
    const res = await tenantHasPanelAccess(oturum({ selectedTenantId: null, user: { tenantId: null } }))
    expect(res).toBe(true)
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('token ve kapsam ELDEN geçirilir — yeni oturumda etkin token henüz yerleşmemiş olabilir', async () => {
    apiRequest.mockResolvedValue({ status: 'Active', subscriptionEndsAtUtc: GELECEK })
    await tenantHasPanelAccess(oturum())
    expect(apiRequest).toHaveBeenCalledWith('/api/admin/billing', {
      token: 'token',
      scope: { tenantId: 'tenant-1', branchId: null },
    })
  })
})
