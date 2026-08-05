using System.Data.Common;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using MySql.Data.MySqlClient;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// KURUM İÇİ SIRALI RANDEVU NUMARASI (#RNDV-…) — üretim ve çakışma yeniden denemesi tek yerde.
///
/// <para>
/// Numara <c>MAX(Number)+1</c> ile hesaplanır ve <c>{TenantId, Number}</c> benzersiz indeksiyle
/// korunur. Hesap ile yazma arasına başka bir istek girerse ikinci insert reddedilir; o yüzden
/// yazma, numarayı yeniden hesaplayan bir döngü içinde yapılır.
/// </para>
/// <para>
/// YENİDEN DENEME YALNIZ NUMARA ÇAKIŞMASINDA OLUR. Eski döngüler her <c>DbUpdateException</c>'ı
/// yakalıyordu: FK ihlali, kolon taşması ya da başka bir kalıcılık hatası da "numara çakıştı"
/// sanılıp üç kez tekrarlanıyor, asıl hata ancak son denemede ve yanlış bağlamda yüzeye çıkıyordu.
/// Artık iki koşul birden aranır — hata bir bütünlük ihlali (SQLSTATE 23xxx) olmalı VE numara
/// gerçekten başka bir kayıt tarafından kapılmış olmalı; değilse istisna aynen dışarı verilir.
/// </para>
/// </summary>
public static class AppointmentNumbering
{
    /// <summary>Numaralandırma tabanı: ilk randevu 10001 olur.</summary>
    public const int Seed = 10000;

    /// <summary>Yeniden deneme üst sınırı — yoğun eşzamanlılıkta bile birkaç tur yeter.</summary>
    private const int MaxAttempts = 5;

    /// <summary>
    /// Kurumdaki en büyük numaranın bir fazlası. Global süzgeçleri ATLAR: aktif şube kapsamı ya da
    /// soft-delete yüzünden görünmeyen bir kayıt numarayı zaten kullanıyor olabilir.
    /// </summary>
    public static async Task<int> NextNumberAsync(GuzellikDbContext db, Guid tenantId, CancellationToken ct)
    {
        var max = await db.Appointments.AsNoTracking().IgnoreQueryFilters()
            .Where(a => a.TenantId == tenantId && a.Number != null)
            .MaxAsync(a => (int?)a.Number, ct) ?? Seed;
        return max + 1;
    }

    /// <summary>
    /// Numara ÜRETİMİNİ SERİLEŞTİRİR: kurum satırını kilitler (<c>SELECT … FOR UPDATE</c>), sonra
    /// sıradaki numarayı verir. Kilit çağıranın transaction'ı boyunca durur; aynı kurumda eşzamanlı
    /// numara üreten istekler kapıda sıraya girer, dolayısıyla çakışma normal koşulda hiç oluşmaz.
    /// <para>
    /// Kurum satırı sayaç görevi görür (ayrı sayaç tablosu gerekmez) ve kilit sırasında
    /// <c>customers</c>/<c>staff_members</c>/<c>appointments</c> tablolarından ÖNCE gelir
    /// (bkz. <see cref="RowLock.TableOrder"/>) — mevcut kilit protokolüyle çakışmaz.
    /// </para>
    /// </summary>
    public static async Task<int> NextNumberLockedAsync(GuzellikDbContext db, Guid tenantId, CancellationToken ct)
    {
        await RowLock.LockRowAsync(db, "tenants", tenantId, ct);
        return await NextNumberAsync(db, tenantId, ct);
    }

    /// <summary>
    /// Bekleyen değişiklikleri yazar; numara çakışmasında numarayı yeniden hesaplayıp yeniden dener.
    /// Diğer hatalar OLDUĞU GİBİ yükselir.
    /// </summary>
    public static async Task SaveWithNumberRetryAsync(
        GuzellikDbContext db, Guid tenantId, Appointment appointment, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await db.SaveChangesAsync(ct);
                return;
            }
            catch (DbUpdateException ex)
            {
                // Benzersizlik ihlali değilse (ya da deneme hakkı bittiyse) hatayı YUTMA.
                if (attempt >= MaxAttempts || !IsUniqueViolation(ex)) throw;
                // İhlal numaradan mı kaynaklandı? Değilse (ör. FK, başka bir benzersiz indeks) yükselt.
                if (!await IsNumberTakenAsync(db, tenantId, appointment, ct)) throw;

                // AssignNumber "yalnız bir kez" kuralı gereği dolu numarayı değiştirmez → retry'a özel setter.
                appointment.ReassignNumberForRetry(await NextNumberAsync(db, tenantId, ct));
            }
        }
    }

    /// <summary>
    /// BENZERSİZLİK İHLALİ Mİ? İki sinyal birlikte kullanılır çünkü tek başına hiçbiri yetmiyor:
    /// <list type="number">
    /// <item>Standart yol — SQLSTATE 23xxx (integrity constraint violation). Başka sağlayıcılarda
    /// çalışır.</item>
    /// <item><c>MySql.Data</c> <c>SqlState</c>'İ DOLDURMUYOR (gerçek MariaDB testinde doğrulandı:
    /// yalnız SQLSTATE'e bakan sürüm duplicate-entry hatasını tanıyamıyor ve yeniden deneme ağı hiç
    /// devreye girmiyordu). Bu yüzden sunucu hata numarasına da bakılır: 1062 / 1586 = ER_DUP_ENTRY.</item>
    /// </list>
    /// </summary>
    private static bool IsUniqueViolation(DbUpdateException ex)
    {
        for (Exception? e = ex; e is not null; e = e.InnerException)
        {
            if (e is DbException { SqlState: { } state } && state.StartsWith("23", StringComparison.Ordinal))
                return true;
            if (e is MySqlException { Number: 1062 or 1586 })
                return true;
        }
        return false;
    }

    /// <summary>Randevunun numarası BAŞKA bir kayıt tarafından kullanılıyor mu?</summary>
    private static async Task<bool> IsNumberTakenAsync(
        GuzellikDbContext db, Guid tenantId, Appointment appointment, CancellationToken ct)
    {
        if (appointment.Number is not { } number) return false;
        return await db.Appointments.AsNoTracking().IgnoreQueryFilters()
            .AnyAsync(a => a.TenantId == tenantId && a.Number == number && a.Id != appointment.Id, ct);
    }
}
