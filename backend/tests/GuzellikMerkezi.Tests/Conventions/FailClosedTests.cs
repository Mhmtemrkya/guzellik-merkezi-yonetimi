using System.Text.RegularExpressions;
using GuzellikMerkezi.Application.Features.Usage;

namespace GuzellikMerkezi.Tests.Conventions;

/// <summary>
/// KAPI: KORUMA KONTROLLERİ SESSİZCE "SERBEST" DİYEMEZ.
///
/// <para>
/// BU KAPI NEDEN VAR: bir koruma kontrolünün en sinsi başarısızlığı, kontrol edeceği şeyi
/// BULAMAYINCA geçirmesidir — çünkü hiçbir hata görünmez, koruma çalışıyor sanılır. Somut örnek:
/// paket limiti kontrolü, metrik anahtarı eşleşmediğinde sessizce "sınır yok" diyordu. Bir yazım
/// hatası ya da metriğin yeniden adlandırılması o limiti tamamen devre dışı bırakırdı ve kimse
/// "acaba limit gerçekten çalışıyor mu?" diye bakmazdı.
/// </para>
/// </summary>
public sealed class FailClosedTests
{
    /// <summary>
    /// Limit kontrolü çağrıları SABİT anahtar kullanmalı. Serbest metin, sessizce eşleşmeyen
    /// (dolayısıyla limiti kapatan) bir anahtarın kod incelemesinden geçmesini kolaylaştırır.
    /// </summary>
    [Fact]
    public void LimitChecksUseSharedConstants()
    {
        var violations = new List<string>();

        foreach (var file in SourceTree.ProductionFiles())
        {
            var content = SourceTree.StripComments(File.ReadAllText(file));
            foreach (Match m in Regex.Matches(content, @"CheckLimitAsync\([^,]+,\s*""(?<k>[^""]+)"""))
            {
                violations.Add(
                    $"{SourceTree.Relative(file)}:{SourceTree.LineOf(content, m.Index)} " +
                    $"→ serbest metin metrik anahtarı \"{m.Groups["k"].Value}\"");
            }
        }

        Assert.True(violations.Count == 0, SourceTree.Describe(
            "LİMİT KONTROLÜ SABİT ANAHTAR KULLANMALI.",
            """
            Metrik anahtarı serbest metin olduğunda, eşleşmeyen bir değer limitin HİÇ uygulanmaması
            demektir ve bu hiçbir yerde iz bırakmaz.

            ÇÖZÜM: UsageMetricKeys sabitlerini kullanın (UsageMetricKeys.Customers vb.).
            """,
            violations));
    }

    /// <summary>
    /// Sabit listesi ile ÜRETİLEN metrikler aynı olmalı. Biri diğerinden kayarsa (yeni metrik
    /// eklenip sabiti unutulur ya da tersi) limit kontrolü çalışma anında patlar; bu test kaymayı
    /// derleme/test zamanında yakalar.
    /// </summary>
    [Fact]
    public void MetricKeyConstantsMatchProducedMetrics()
    {
        var usageService = File.ReadAllText(Path.Combine(
            SourceTree.SourceRoot, "GuzellikMerkezi.Infrastructure", "Services", "UsageService.cs"));

        var produced = Regex.Matches(usageService, @"new UsageMetric\(\s*UsageMetricKeys\.(?<k>\w+)")
            .Select(m => m.Groups["k"].Value)
            .ToHashSet(StringComparer.Ordinal);

        var declared = typeof(UsageMetricKeys)
            .GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)
            .Where(f => f.FieldType == typeof(string))
            .Select(f => f.Name)
            .ToHashSet(StringComparer.Ordinal);

        Assert.Equal(declared.OrderBy(x => x), produced.OrderBy(x => x));
        Assert.Equal(declared.Count, UsageMetricKeys.All.Length);
    }
}
