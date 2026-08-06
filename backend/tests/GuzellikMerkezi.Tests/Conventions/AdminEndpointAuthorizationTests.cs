using System.Text.RegularExpressions;

namespace GuzellikMerkezi.Tests.Conventions;

/// <summary>
/// KAPI: /api/admin/* UÇ GRUPLARININ YETKİ KARARI AÇIKÇA YAZILIR.
///
/// <para>
/// BU KAPI NEDEN VAR: yetkilendirme kararı ÖRTÜK kaldığında kimse eksikliği fark etmiyor. Bugün
/// bazı yönetim grupları yalnızca <c>RequireAuthorization()</c> taşıyor — yani "giriş yapmış
/// herkes" demek: sayfa izni yok, onay kapısının yol→izin haritasında da karşılığı yok. Personel
/// bu uçları hiçbir izin kontrolünden geçmeden çağırabiliyor.
/// </para>
/// <para>
/// KURAL: her <c>/api/admin/*</c> grubu YA bir sayfa izni (<c>RequirePermission</c>) taşımalı YA da
/// "bu uç bilerek tüm kurum kullanıcılarına açık" bildirimini içermelidir. İkisi de yoksa kapı
/// düşer. Amaç izin dayatmak değil, KARARI GÖRÜNÜR kılmak: bilerek açık bırakılan bir uç ile
/// unutulmuş bir uç aynı görünmemelidir.
/// </para>
/// </summary>
public sealed class AdminEndpointAuthorizationTests
{
    /// <summary>
    /// "Bu grup bilerek tüm kurum kullanıcılarına açıktır" bildirimi. Yorumda yazılır; kapı bunu
    /// arar. Bildirim, kararı veren kişinin gerekçesini de yanına yazmasını teşvik eder.
    /// </summary>
    private const string DeliberatelyOpenMarker = "YETKİ: TÜM KURUM KULLANICILARI";

    [Fact]
    public void EveryAdminEndpointGroupDeclaresItsAuthorization()
    {
        var endpointsDir = Path.Combine(SourceTree.SourceRoot, "GuzellikMerkezi.Api", "Endpoints");
        Assert.True(Directory.Exists(endpointsDir), $"Uç dizini bulunamadı: {endpointsDir}");

        var violations = new List<string>();

        foreach (var file in Directory.EnumerateFiles(endpointsDir, "*.cs"))
        {
            var raw = File.ReadAllText(file);
            var content = SourceTree.StripComments(raw);

            foreach (Match m in Regex.Matches(content, @"MapGroup\(\s*""(?<path>/api/admin/[^""]*)""\s*\)(?<chain>[^;]*);"))
            {
                var chain = m.Groups["chain"].Value;
                if (chain.Contains("RequirePermission", StringComparison.Ordinal)) continue;

                // Platform yöneticisine kapalı gruplar zaten en dar kapsamdır.
                if (chain.Contains("\"PlatformAdmin\"", StringComparison.Ordinal)) continue;

                // Bilerek açık bırakılmış: dosyada gerekçesiyle bildirilmiş olmalı.
                if (raw.Contains(DeliberatelyOpenMarker, StringComparison.Ordinal)) continue;

                violations.Add(
                    $"{Path.GetFileName(file)}:{SourceTree.LineOf(content, m.Index)} " +
                    $"→ {m.Groups["path"].Value} yalnız RequireAuthorization() taşıyor (sayfa izni yok)");
            }
        }

        Assert.True(violations.Count == 0, SourceTree.Describe(
            "/api/admin/* GRUBUNUN YETKİ KARARI AÇIK OLMALI.",
            $"""
            Yalnız RequireAuthorization() "giriş yapmış herkes" demektir: personel bu uçları hiçbir
            sayfa/işlem izni kontrolünden geçmeden çağırabilir. Bu bir güvenlik açığı olabilir de
            olmayabilir de — ama KARAR GÖRÜNÜR olmalıdır, aksi hâlde unutulan uç ile bilerek açık
            bırakılan uç aynı görünür.

            İKİ SEÇENEKTEN BİRİ:
              · Sayfa izni ekleyin:  .RequirePermission(Permissions.<Alan>)
              · Ya da bilerek açıksa dosyaya gerekçesiyle şunu yazın:
                  // {DeliberatelyOpenMarker} — <neden herkes erişebilmeli>
            """,
            violations));
    }
}
