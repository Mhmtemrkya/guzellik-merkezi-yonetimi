using System.Text.RegularExpressions;

namespace GuzellikMerkezi.Tests.Conventions;

/// <summary>
/// KAPI: HATA SESSİZCE YUTULAMAZ.
///
/// <para>
/// BU KAPI NEDEN VAR: yutulan hata, veri bozulmasının en pahalı biçimidir çünkü hiçbir iz
/// bırakmaz. Bu depoda tam olarak bu yüzden bir tur kaybedildi — gönderilemeyen KVKK isteği,
/// bekleme teklifi ve değerlendirme linki kalıcı iş kuyruğunda "başarılı" damgalanıp kayboluyordu:
/// ne yeniden deneme, ne dead-letter, ne de bir log satırı vardı. Gövdesi boş bir <c>catch</c>,
/// "bu hatayı görmezden geliyorum" demenin sessiz yoludur.
/// </para>
/// <para>
/// KURAL: <c>catch</c> bloğu ya bir şey YAPMALI (log, telafi, yeniden fırlatma) ya da NEDEN
/// yutulduğunu yorumla açıklamalıdır. Boş gövde kabul edilmez; gerekçeli yutma kabul edilir çünkü
/// bazı durumlarda (temizlik, en iyi çaba) doğru davranış budur — ama gerekçe okunabilir olmalıdır.
/// </para>
/// </summary>
public sealed class SilentFailureTests
{
    [Fact]
    public void NoCatchBlockIsSilentlyEmpty()
    {
        var violations = new List<string>();

        foreach (var file in SourceTree.ProductionFiles())
        {
            var content = File.ReadAllText(file);

            // Gövdesi TAMAMEN boş catch: ne ifade ne yorum. (Yorumlu yutma bilinçli karardır.)
            foreach (Match m in Regex.Matches(content, @"catch\s*(\([^)]*\))?\s*(when\s*\([^)]*\)\s*)?\{\s*\}"))
            {
                violations.Add($"{SourceTree.Relative(file)}:{SourceTree.LineOf(content, m.Index)} → boş catch bloğu");
            }
        }

        Assert.True(violations.Count == 0, SourceTree.Describe(
            "BOŞ CATCH BLOĞU YASAK.",
            """
            Yutulan hata iz bırakmaz: para hareketi yarım kalır, mesaj gönderilmez, kayıt bozulur ve
            hiçbir yerde görünmez. En az biri gerekir:
              · logla (ILogger),
              · telafi et (geri al / yeniden dene / dead-letter'a düşür),
              · yeniden fırlat,
              · ya da NEDEN yok sayıldığını yorumla açıkla (temizlik, en iyi çaba vb.).
            """,
            violations));
    }

    /// <summary>
    /// "En iyi çaba" gönderim yolları sonucu YOK SAYAMAZ. Bir gönderim yolu sonucu döndürüyorsa
    /// (<c>WhatsAppDispatchReport</c>) çağıran ona bakmalıdır; aksi hâlde başarısız gönderim
    /// başarılı iş olarak kapanır — bu tam olarak kaybedilen turun sebebiydi.
    /// </summary>
    [Fact]
    public void DurableJobHandlersInspectDispatchResult()
    {
        var handlersFile = Path.Combine(
            SourceTree.SourceRoot, "GuzellikMerkezi.Infrastructure", "Background", "DurableJobHandlers.cs");
        var content = SourceTree.StripComments(File.ReadAllText(handlersFile));

        var violations = new List<string>();
        foreach (Match m in Regex.Matches(content, @"await\s+_whatsApp\.(?<call>\w+)\("))
        {
            // Sonucu değerlendirilmeyen çağrı: `await _whatsApp.X(` doğrudan ifade olarak duruyorsa
            // dönen rapora bakılmıyor demektir.
            var lineStart = content.LastIndexOf('\n', m.Index) + 1;
            var prefix = content[lineStart..m.Index].Trim();
            if (prefix.Length > 0) continue;   // "var report = await ..." → sonuç alınmış

            violations.Add(
                $"{SourceTree.Relative(handlersFile)}:{SourceTree.LineOf(content, m.Index)} " +
                $"→ {m.Groups["call"].Value}() sonucu yok sayılıyor");
        }

        Assert.True(violations.Count == 0, SourceTree.Describe(
            "GÖNDERİM SONUCU YOK SAYILAMAZ.",
            """
            Gönderim yolları "gönderildi / bilerek atlandı / gönderilemedi" ayrımını döndürür
            (WhatsAppDispatchReport). Sonuca bakılmazsa sağlayıcının reddettiği mesaj başarılı iş
            olarak kapanır ve YENİDEN DENENMEZ: müşteri KVKK isteğini/teklifi hiç almaz, hiçbir
            yerde de hata görünmez.

            ÇÖZÜM: raporu alın ve DurableJobDispatchGuard.EnsureDelivered ile kuyruğa bildirin.
            """,
            violations));
    }
}
