namespace GuzellikMerkezi.Application.Abstractions;

/// <summary>
/// Şifreli (AES-GCM, rastgele nonce) alanlar üzerinde SQL araması yapabilmek için <b>blind index</b> üretir.
/// </summary>
/// <remarks>
/// Ad/telefon/e-posta at-rest şifreli tutulduğundan aynı düz metin her satırda farklı ciphertext üretir;
/// bu yüzden bu kolonlarda <c>LIKE</c>/<c>=</c>/<c>ORDER BY</c> anlamlı çalışmaz. Çözüm, düz metnin
/// anahtarlı hash (HMAC) parçalarını ayrı, şifresiz bir kolonda tutmaktır:
/// <list type="bullet">
///   <item>İndeks düz metin İÇERMEZ — anahtar olmadan geri döndürülemez.</item>
///   <item>Ön-ek (prefix) parçaları sayesinde "meh" gibi kısmi aramalar da SQL'de daraltılabilir.</item>
///   <item>SQL yalnızca ADAY kümesini daraltır; kesin eşleşme çözülmüş değerler üzerinde bellekte doğrulanır
///         (prefix eşleşmesi ve hash çakışması yaklaşıktır — yanlış pozitif elenir, yanlış negatif olmaz).</item>
/// </list>
/// </remarks>
public interface ISearchIndexService
{
    /// <summary>
    /// Müşterinin aranabilir alanlarından indeks string'i üretir: <c>|hash|hash|...|</c>.
    /// Değer değişmediyse aynı sonucu döner (deterministik).
    /// </summary>
    string? BuildCustomerIndex(string? fullName, string? phone, string? email);

    /// <summary>
    /// Arama terimini indekste aranacak anahtarlara çevirir. Dönen anahtarların <b>hepsi</b> indekste
    /// bulunmalıdır (AND). Terimde kullanılabilir parça yoksa boş liste döner.
    /// </summary>
    IReadOnlyList<string> BuildLookupKeys(string? term);

    /// <summary>
    /// Telefonun tam-eşleşme anahtarı — mükerrer kayıt kontrolü için. Rakam sayısı yetersizse null.
    /// </summary>
    string? BuildPhoneKey(string? phone);
}
