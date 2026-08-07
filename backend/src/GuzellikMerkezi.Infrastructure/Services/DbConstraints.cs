using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using MySql.Data.MySqlClient;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Veritabanı kısıt ihlallerinin TANINMASI — "kontrol et, sonra yaz" desenini gerçekten atomik
/// yapan yerlerde kullanılır.
/// </summary>
internal static class DbConstraints
{
    /// <summary>
    /// Benzersizlik ihlali mi? İki yoldan bakılır:
    /// <list type="number">
    /// <item>Standart yol — SQLSTATE 23xxx (integrity constraint violation). Başka sağlayıcılarda çalışır.</item>
    /// <item><c>MySql.Data</c> <c>SqlState</c>'İ DOLDURMUYOR (gerçek MariaDB testinde doğrulandı:
    /// yalnız SQLSTATE'e bakan sürüm duplicate-entry hatasını tanıyamıyor ve koruma hiç devreye
    /// girmiyordu). Bu yüzden sunucu hata numarasına da bakılır: 1062 / 1586 = ER_DUP_ENTRY.</item>
    /// </list>
    /// <para>
    /// Hata METNİNE bakılmaz: sunucu diline/sürümüne göre değişir ve sessizce eşleşmeyi bırakır.
    /// </para>
    /// </summary>
    public static bool IsUniqueViolation(DbUpdateException ex)
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
}
