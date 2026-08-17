using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Müşteri portalı kimlik eşleştirmesinin TEK yeri: telefon (+ ad soyad) ile müşteri arar.
///
/// <para>
/// <b>Neden ortak sınıf?</b> Aynı eşleştirme iki yerde yapılır — kod isteği (CustomerOtpService) ve
/// kodun doğrulanmasından sonraki giriş (AuthService). İkisi ayrı yazıldığında biri "eşleşme var"
/// deyip kod gönderirken diğeri "yok" diyebiliyordu; kullanıcı kodu alıyor ama giremiyordu.
/// Kural burada tek kopya.
/// </para>
///
/// <para>
/// <b>Ölçek:</b> ad/telefon at-rest şifreli olduğu için SQL'de <c>=</c> ile aranamaz. Eskiden sorgu
/// <c>BirthDate == …</c> ile daraltılıyordu; doğum tarihi kimlikten çıkınca (App Store 5.1.1(v))
/// o daraltma da gitti. Yerine <b>blind index</b> kullanılır: SQL yalnızca ADAY kümesini getirir,
/// kesin eşitlik çözülmüş numarada bellekte doğrulanır. Daraltma olmadan bu yol tüm müşterileri
/// belleğe çekip tek tek çözmek anlamına gelirdi.
/// </para>
/// </summary>
public static class CustomerIdentityLookup
{
    /// <summary>Ad soyad eşleştirme anahtarı: kırp, çoklu boşluğu teke indir, küçült.</summary>
    public static string NormalizeName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return string.Empty;
        var collapsed = string.Join(' ', name.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries));
        return collapsed.ToLowerInvariant();
    }

    /// <summary>E-posta eşleştirme anahtarı (büyük/küçük ve boşluk duyarsız).</summary>
    public static string NormalizeEmail(string? email) => (email ?? string.Empty).Trim().ToLowerInvariant();

    /// <summary>Girişte kabul edilebilir telefon mu? (TR: normalize edilmiş 10 hane)</summary>
    public static bool IsUsablePhone(string? phone) => PhoneMask.LoginKey(phone).Length >= 10;

    /// <summary>
    /// Bu telefona ait (silinmemiş) müşterileri döndürür. <paramref name="source"/> tracking
    /// davranışını ÇAĞIRAN belirler: giriş akışı kaydı güncellediği için izlenen sorgu verir,
    /// kod isteği <c>AsNoTracking()</c> verir.
    /// </summary>
    public static async Task<List<Customer>> FindByPhoneAsync(
        IQueryable<Customer> source,
        ISearchIndexService search,
        string? phone,
        CancellationToken cancellationToken = default)
    {
        var key = PhoneMask.LoginKey(phone);
        if (key.Length < 10) return [];

        var baseQuery = source.Where(c => !c.IsDeleted);

        // Blind index henüz doldurulmamış kayıt varsa (backfill sürüyor) DARALTMA YAPILMAZ: eksik
        // sonuç dönüp kullanıcıyı kendi hesabından kilitlemektense yavaş ama doğru çalışmak yeğdir.
        var indexKey = search.BuildPhoneKey(phone);
        var narrowed = indexKey is not null && !await baseQuery.AnyAsync(c => c.SearchIndex == null, cancellationToken)
            ? baseQuery.Where(c => c.SearchIndex != null && c.SearchIndex.Contains(indexKey))
            : baseQuery;

        // İndeks yalnızca ADAY üretir (hash çakışması/ön-ek yaklaşıktır) — kesin eşitlik burada.
        var candidates = await narrowed.ToListAsync(cancellationToken);
        return candidates.Where(c => PhoneMask.LoginKey(c.Phone) == key).ToList();
    }

    /// <summary>Aday kümesini ad soyada göre süzer.</summary>
    public static List<Customer> WithName(IEnumerable<Customer> candidates, string? fullName)
    {
        var name = NormalizeName(fullName);
        return name.Length == 0
            ? []
            : candidates.Where(c => NormalizeName(c.FullName) == name).ToList();
    }
}
