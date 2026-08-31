using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using MySql.Data.MySqlClient;

namespace GuzellikMerkezi.Infrastructure.Persistence;

/// <summary>
/// BENZERSİZLİK İHLALİ Mİ? Veritabanı seviyesinde zorlanan tekilliğe dayanan her akışın (mükerrer
/// bildirim, mükerrer webhook, randevu numarası) ihtiyacı olan tek karar.
///
/// <para>
/// İki sinyal BİRLİKTE kullanılır çünkü tek başına hiçbiri yetmiyor:
/// <list type="number">
/// <item>Standart yol — SQLSTATE 23xxx (integrity constraint violation); başka sağlayıcılarda çalışır.</item>
/// <item><c>MySql.Data</c> <c>SqlState</c>'İ DOLDURMUYOR (gerçek MariaDB testinde doğrulandı: yalnız
/// SQLSTATE'e bakan sürüm duplicate-entry hatasını tanıyamıyordu). Bu yüzden sunucu hata numarasına
/// da bakılır: 1062 / 1586 = ER_DUP_ENTRY.</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Bu kontrol DAR tutulur.</b> "Herhangi bir <c>DbUpdateException</c>" yakalayıp "zaten var"
/// saymak, FK ihlalini ya da kolon taşmasını sessizce başarı sayar; o yüzden çağıran taraf
/// ihlalin BEKLENEN indeksten geldiğini ayrıca doğrulamalıdır (bkz. AppointmentNumbering).
/// </para>
/// </summary>
public static class UniqueViolation
{
    public static bool Is(Exception? exception)
    {
        for (var e = exception; e is not null; e = e.InnerException)
        {
            if (e is DbException { SqlState: { } state } && state.StartsWith("23", StringComparison.Ordinal))
                return true;
            if (e is MySqlException { Number: 1062 or 1586 })
                return true;
        }
        return false;
    }

    /// <inheritdoc cref="Is(Exception?)" />
    public static bool Is(DbUpdateException exception) => Is((Exception?)exception);
}
