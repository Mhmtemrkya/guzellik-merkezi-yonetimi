import { apiRequest } from '@/lib/apiClient'
import type { AuthSession } from '@/lib/types'

/**
 * GİRİŞ SONRASI YÖNLENDİRME KAPISI — kurumun panele girme hakkı var mı?
 *
 * Kural backend'deki `TrialAccessMiddleware` ile BİREBİR AYNIDIR ve öyle kalmalıdır; sapması
 * hâlinde kullanıcı ya girebileceği panele alınmaz ya da giremeyeceği panele gönderilip orada
 * 403 duvarına çarpar. Backend kaynağı:
 *   `backend/src/GuzellikMerkezi.Api/Middleware/TrialAccessMiddleware.cs`
 *
 * ENGELLİ SAYILAN DURUMLAR:
 *   · Cancelled / Suspended  → kurum kapatılmış ya da askıya alınmış
 *   · Trial  + deneme bitmiş → 14 gün dolmuş, paket alınmamış
 *   · Active + abonelik bitmiş → paket süresi dolmuş (middleware ilk istekte askıya alır)
 *
 * BURASI GÜVENLİK SINIRI DEĞİLDİR. Asıl kapı backend'dedir; buradaki tek amaç kullanıcıyı
 * doğru yere göndermek. Bu yüzden kararsız kalınan her durumda PANELE gönderilir — yanlış
 * yönlendirmenin bedeli, ödeyen bir kurumu kendi panelinden uzak tutmaktan düşüktür.
 */

interface BillingSummary {
  status?: string | null
  subscriptionEndsAtUtc?: string | null
  trialEndsAtUtc?: string | null
}

/** Geçmiş bir tarih mi? Boş/bozuk değer "geçmiş değil" sayılır. */
function isPast(value: string | null | undefined, now: number): boolean {
  if (!value) return false
  const t = Date.parse(value)
  return Number.isFinite(t) && t <= now
}

/**
 * Kurumun panele girme hakkı var mı?
 *
 * Yalnız ABONELİĞİ SATIN ALABİLEN rol için anlamlıdır (kurum yöneticisi). Personel ve şube
 * yöneticisi paket alamaz — onları ödeme sayfasına göndermek çıkmaz sokaktır, bu yüzden
 * çağıran taraf onlar için bu kapıyı hiç sormamalıdır.
 *
 * @returns `true` → panele; `false` → tanıtım sayfasına (paket seçsin)
 */
export async function tenantHasPanelAccess(session: AuthSession): Promise<boolean> {
  const tenantId = session.selectedTenantId || session.user?.tenantId || null
  if (!tenantId) return true

  try {
    // Token ve kapsam ELDEN geçirilir: oturum yeni kurulduğu için modül içindeki etkin
    // token/kapsam henüz yerleşmemiş olabilir ve istek yetkisiz gidip yanlış karar üretirdi.
    // Bu uç askıdayken de açıktır (bkz. TrialAccessMiddleware.IsSelfServiceBillingPath).
    const summary = await apiRequest<BillingSummary>('/api/admin/billing', {
      token: session.accessToken,
      scope: { tenantId, branchId: session.selectedBranchId || session.user?.branchId || null },
    })

    const now = Date.now()
    const status = (summary?.status || '').toLowerCase()

    if (status === 'cancelled' || status === 'suspended') return false
    if (status === 'trial') return !isPast(summary?.trialEndsAtUtc, now)
    if (status === 'active') return !isPast(summary?.subscriptionEndsAtUtc, now)

    // Tanınmayan durum: karar verilemiyor → panele. Backend kapısı zaten koruyor.
    return true
  } catch {
    // Ağ/yetki hatası kullanıcıyı kendi panelinden etmemeli.
    return true
  }
}
