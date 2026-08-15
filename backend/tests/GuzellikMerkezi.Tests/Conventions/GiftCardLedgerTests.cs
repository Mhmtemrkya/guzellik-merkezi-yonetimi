using System.Text.RegularExpressions;

namespace GuzellikMerkezi.Tests.Conventions;

/// <summary>
/// KAPI: HEDİYE ÇEKİ BAKİYESİNİ DEĞİŞTİREN HER YOL, HAREKET DEFTERİNE DE YAZAR.
///
/// <para>
/// BU KAPI NEDEN VAR: <c>GiftCard.Redeem</c> / <c>UndoRedeem</c> üç ayrı yerden çağrılıyordu
/// (doğrudan kullanım ucu, adisyon onayı, iptal/geri alma). Defteri (bkz. <c>GiftCardTransaction</c>)
/// "yazmayı hatırlamak" o üç noktaya bırakılsaydı, biri unutulduğunda defter SESSİZCE yalan
/// söylerdi — ki bu, defterin var olma sebebini tamamen ortadan kaldırır. Aynı sınıf kusur bu
/// depoda iki kez yaşandı: DTO projeksiyonu (ToDto güncellendi, explicit Select unutuldu) ve
/// iptal snapshot şeması (üç yerden ikisi güncellendi).
/// </para>
///
/// <para>
/// KURAL: <c>.Redeem(</c> ve <c>.UndoRedeem(</c> çağrılarının alıcısı YALNIZ <c>GiftCardLedger</c>
/// olabilir. Entity'nin kendi tanımı ile geçidin kendisi doğal olarak muaftır; başka muafiyet
/// YOKTUR — bir yol gerçekten defter tutmayacaksa bakiyeyi de değiştirmiyordur.
/// </para>
///
/// <para>
/// Başka bir varlık ileride <c>Redeem</c> adında bir metot kazanırsa bu kapı onu da yakalar;
/// bu bilinçli bir seçimdir: o zaman ya ad değişir ya kural o varlık için de düşünülür.
/// </para>
/// </summary>
public sealed class GiftCardLedgerTests
{
    /// <summary>Kuralın tanımlandığı yerler — kapı kendi kendini ihlal etmiş sayılmaz.</summary>
    private static readonly string[] RuleHomes =
    [
        "GuzellikMerkezi.Domain/Entities/GiftCard.cs",
        "GuzellikMerkezi.Infrastructure/Services/GiftCardLedger.cs",
    ];

    private static readonly Regex Call = new(@"(?<recv>[A-Za-z_][A-Za-z0-9_\.]*)\.(?<m>Redeem|UndoRedeem)\s*\(", RegexOptions.Compiled);

    [Fact]
    public void CekBakiyesiniDegistirenTumYollarDefteredenGecer()
    {
        var violations = new List<string>();

        foreach (var path in SourceTree.ProductionFiles())
        {
            var relative = SourceTree.Relative(path);
            if (RuleHomes.Any(h => relative.EndsWith(h, StringComparison.OrdinalIgnoreCase))) continue;

            var content = SourceTree.StripComments(File.ReadAllText(path));
            foreach (Match match in Call.Matches(content))
            {
                var receiver = match.Groups["recv"].Value;
                // Geçidin kendisi üzerinden yapılan çağrı KURALIN TA KENDİSİDİR.
                if (receiver == "GiftCardLedger" || receiver.EndsWith(".GiftCardLedger", StringComparison.Ordinal)) continue;

                violations.Add(
                    $"{relative}:{SourceTree.LineOf(content, match.Index)} — {receiver}.{match.Groups["m"].Value}(...) " +
                    "doğrudan çağrılmış; GiftCardLedger.Redeem/Undo kullanılmalı.");
            }
        }

        Assert.True(violations.Count == 0, SourceTree.Describe(
            "HEDİYE ÇEKİ BAKİYESİ YALNIZ GiftCardLedger ÜZERİNDEN DEĞİŞİR",
            "Bakiye mutasyonu ile defter kaydı TEK çağrıya bağlanmıştır (GiftCardLedger). Doğrudan " +
            "GiftCard.Redeem/UndoRedeem çağırmak, bakiyeyi değiştirip defteri boş bırakır: " +
            "'bu çekin parası nereye gitti' sorusunun cevabı kaybolur ve iptalde geri geldiği " +
            "doğrulanamaz. Değişmez: Σ BalanceDelta == Balance − Value.",
            violations));
    }
}
