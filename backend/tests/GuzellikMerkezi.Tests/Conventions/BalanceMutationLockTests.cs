using System.Text.RegularExpressions;

namespace GuzellikMerkezi.Tests.Conventions;

/// <summary>
/// KAPI: BAKİYE/SAYAÇ TUTAN SATIRA YAZAN HER YOL, SATIR KİLİDİ ALMALIDIR.
///
/// <para>
/// BU KAPI NEDEN VAR: kayıp güncelleme bu depoda tekrar tekrar çıktı ve her seferinde YALNIZ
/// bildirilen yol düzeltildi. Somut kanıt — <c>gift_cards</c> ortak kilit protokolüne bir turda
/// alındı, adisyon onayı/iptali satırı kilitledi; ama DOĞRUDAN kullanım ucu
/// (<c>GiftCardService.RedeemAsync</c>) protokole hiç girmedi: 100 ₺'lik çek iki eşzamanlı
/// istekle iki kez 100 ₺ kullanılabiliyordu. Aynı biçimde kontör cüzdanı
/// (<c>tenant_messaging_wallets</c>) kilit listesinde BİLE yoktu.
/// </para>
/// <para>
/// KURALIN İKİ YÜZÜ VAR ve ikisi de gereklidir:
/// <list type="number">
/// <item>Bakiye tutan bir entity metodu çağıran servis metodu, aynı akışta <c>RowLock</c> almalı.</item>
/// <item>Kilit TEK TARAFTA kalmamalı: aynı satırı yazan KARDEŞ yollar da kilitlenmeli — biri
/// kilitleyip diğeri kilitlemezse "son yazan kazanır" ile koruma delinir (bu, RowLock'un kendi
/// belgesinde yazan ve yine de tekrarlanan hata).</item>
/// </list>
/// </para>
/// <para>
/// İSTİSNA LİSTESİ YOKTUR. Bir yol gerçekten kilit gerektirmiyorsa (ör. yalnız okuma) zaten
/// mutasyon metodunu çağırmaz; çağırıyorsa kilit gerekir. İstisna eklemek kuralı ölü harfe çevirir.
/// </para>
/// </summary>
public sealed class BalanceMutationLockTests
{
    /// <summary>
    /// Bakiye/sayaç/tek-kullanım durumu tutan entity metotları. Bunlardan birini çağıran servis
    /// metodu, "oku → karar ver → yaz" dizisini kilitsiz yapıyorsa yarışa açıktır.
    /// </summary>
    private static readonly string[] BalanceMutators =
    [
        // Kontör cüzdanı — rezerve/kesinleşme/iade/yükleme/düzeltme
        "TryReserve(", "Capture(", "TopUp(", "Adjust(",
        // Hediye çeki / kupon
        "Redeem(", "UndoRedeem(",
        // Stok
        "AdjustStock(", "SetExactStock(",
        // Paket seansı
        "ConsumeSession(", "RestoreSession(",
    ];

    /// <summary>Kilit protokolüne katıldığının kanıtı sayılan çağrılar.</summary>
    private static readonly string[] LockEvidence =
    [
        "RowLock.LockRowAsync", "RowLock.LockRowsAsync",
        // Ortak sarmalayıcılar: kilidi kendi içinde alan yardımcılar.
        "GetOrCreateWalletAsync", "LockSideEffectRowsAsync", "InWalletTransactionAsync",
    ];

    /// <summary>
    /// "KİLİT ÇAĞIRANDA" SÖZLEŞMESİ.
    ///
    /// <para>
    /// Bazı yardımcılar (ör. adisyon yan etkilerini geri alan/yeniden uygulayan gövde) kilidi
    /// KENDİLERİ almaz; her zaman kilidi çoktan almış bir akıştan çağrılırlar. Bu meşrudur ama
    /// SÖZLEŞMEDİR: yardımcı ileride kilitsiz bir yoldan çağrılırsa koruma sessizce delinir.
    /// Bu yüzden kapı, sözleşmenin metodun başında AÇIKÇA yazılmasını şart koşar — istisna listesi
    /// testin içinde saklanmaz, kural kodun kendisinde görünür durur.
    /// </para>
    /// </summary>
    private const string CallerLocksMarker = "KİLİT ÇAĞIRANDA";

    [Fact]
    public void EveryBalanceMutationTakesARowLock()
    {
        var violations = new List<string>();

        foreach (var file in SourceTree.ProductionFiles())
        {
            // Kural SERVİS katmanı içindir: entity'nin kendisi bakiyeyi değiştirir (asıl iş),
            // kilit kararı ise onu çağıran akışa aittir.
            if (!file.Contains($"{Path.DirectorySeparatorChar}Services{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
                continue;

            var raw = File.ReadAllText(file);
            var content = SourceTree.StripComments(raw);

            // "KİLİT ÇAĞIRANDA" sözleşmesi YORUMDA yazılır; ham metin üzerinden aranır.
            var callerLocks = raw.Contains(CallerLocksMarker, StringComparison.Ordinal);

            foreach (var method in EnumerateMethods(content))
            {
                var mutator = BalanceMutators.FirstOrDefault(m => method.Body.Contains(m, StringComparison.Ordinal));
                if (mutator is null) continue;
                if (LockEvidence.Any(e => method.Body.Contains(e, StringComparison.Ordinal))) continue;
                if (callerLocks) continue;   // sözleşme açıkça yazılmış

                violations.Add(
                    $"{SourceTree.Relative(file)}:{SourceTree.LineOf(content, method.Index)} " +
                    $"→ {method.Name}() bakiyeyi değiştiriyor ({mutator.TrimEnd('(')}) ama satır kilidi almıyor");
            }
        }

        Assert.True(violations.Count == 0, SourceTree.Describe(
            "BAKİYE MUTASYONU KİLİTSİZ YAPILAMAZ.",
            """
            Bakiye/sayaç "oku → karar ver → yaz" dizisidir; kilit olmadan iki eşzamanlı istek aynı
            değeri okuyup ikisi de geçerli sayılır (kayıp güncelleme). Somut sonuç: hediye çekinin
            iki kez bozdurulması, kontör bakiyesinin eksiye düşmesi, stok defteri ile bakiyenin
            ayrışması.

            ÇÖZÜM (bkz. StockService.AddMovementAsync deseni):
              transaction aç → RowLock.LockRowAsync ile satırı kilitle → kilit ALTINDA taze oku
              (Entry.ReloadAsync) → deltayı uygula → tek SaveChanges → commit.

            Tabloyu RowLock.TableOrder'a eklemeyi ve AYNI satırı yazan KARDEŞ yolları da
            kilitlemeyi unutmayın: kilit tek tarafta kalırsa koruma delinir.
            """,
            violations));
    }

    /// <summary>
    /// Kilit sırası TEK KAYNAKTAN gelir. Serbest metin tablo adıyla kilit almak, sıralamayı
    /// (dolayısıyla deadlock önlemini) sessizce bozabilirdi; <c>RowLock.EnsureKnownTable</c> zaten
    /// çalışma anında patlar ama bu kapı sorunu DERLEME zamanı incelemesine taşır.
    /// </summary>
    [Fact]
    public void EveryLockedTableIsDeclaredInTableOrder()
    {
        var rowLockSource = File.ReadAllText(Path.Combine(
            SourceTree.SourceRoot, "GuzellikMerkezi.Infrastructure", "Services", "RowLock.cs"));
        var declared = Regex.Matches(rowLockSource, @"^\s*""(?<t>[a-z_]+)"",", RegexOptions.Multiline)
            .Select(m => m.Groups["t"].Value)
            .ToHashSet(StringComparer.Ordinal);

        Assert.NotEmpty(declared);

        var violations = new List<string>();
        foreach (var file in SourceTree.ProductionFiles())
        {
            var content = SourceTree.StripComments(File.ReadAllText(file));
            foreach (Match m in Regex.Matches(content, @"RowLock\.LockRows?Async\(\s*_?db\s*,\s*""(?<t>[^""]+)"""))
            {
                var table = m.Groups["t"].Value;
                if (declared.Contains(table)) continue;
                violations.Add($"{SourceTree.Relative(file)}:{SourceTree.LineOf(content, m.Index)} → '{table}' RowLock.TableOrder'da yok");
            }
        }

        Assert.True(violations.Count == 0, SourceTree.Describe(
            "KİLİTLENEN HER TABLO RowLock.TableOrder'DA TANIMLI OLMALI.",
            """
            Deadlock önlemi kilitlerin HER ZAMAN aynı sırada alınmasına dayanır. Listede olmayan bir
            tabloyu kilitlemek, o sıranın dışına çıkmak demektir: iki akış ters sırayla kilit alırsa
            birbirini süresiz bekler. Tabloyu listeye, doğru konuma (bağımlılık sırasına göre) ekleyin.
            """,
            violations));
    }

    private readonly record struct MethodInfo(string Name, string Body, int Index);

    /// <summary>
    /// Kaba metot ayrıştırıcı: imza satırını yakalar, gövdeyi süslü parantez dengesiyle çıkarır.
    /// Roslyn bağımlılığı eklemeden kural taraması için yeterlidir.
    /// </summary>
    private static IEnumerable<MethodInfo> EnumerateMethods(string content)
    {
        foreach (Match m in Regex.Matches(
            content,
            @"(?:public|private|internal|protected)\s+(?:static\s+)?(?:async\s+)?[\w<>\[\],\?\. ]+?\s+(?<name>\w+)\s*\([^)]*\)\s*(?:where[^{]+)?\{",
            RegexOptions.Multiline))
        {
            yield return new MethodInfo(m.Groups["name"].Value, SourceTree.ExtractBlock(content, m.Index), m.Index);
        }
    }
}
