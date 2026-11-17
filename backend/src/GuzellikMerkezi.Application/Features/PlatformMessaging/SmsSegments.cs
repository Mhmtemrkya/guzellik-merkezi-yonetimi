namespace GuzellikMerkezi.Application.Features.PlatformMessaging;

/// <summary>
/// SMS PARÇA SAYACI — mesaj kredisi parça başına düşer, bu yüzden sayım tek kaynaktan yapılır.
///
/// <para>
/// Varsayılan sağlayıcı (Verimor) Türkçe karakter bozulmasın diye her SMS'i Unicode gönderir
/// (<c>datacoding=2</c>, bkz. PlatformMessagingService). Unicode'da tek SMS 70 karakter taşır;
/// daha uzun mesaj birleştirilmiş parçalara bölünür ve her parçanın 3 karakteri birleştirme
/// başlığına gider (parça başına 67). Sayım, sağlayıcıya GİDEN metin üzerinden — yani şablon
/// değişkenleri doldurulduktan SONRA — yapılmalıdır; ad/tarih uzadıkça parça sayısı değişir.
/// </para>
/// <para>
/// .NET <see cref="string.Length"/> UTF-16 kod birimi sayar; emoji gibi BMP dışı karakterler iki
/// birim tutar. Bu, telde UCS-2/UTF-16 olarak harcanan alanla örtüşür — emoji gerçekten iki
/// karakterlik yer kaplar.
/// </para>
/// </summary>
public static class SmsSegments
{
    /// <summary>Tek parçalık Unicode SMS'in taşıyabildiği karakter.</summary>
    public const int SinglePartChars = 70;

    /// <summary>Birleştirilmiş Unicode SMS'te parça başına karakter (3'ü başlığa gider).</summary>
    public const int MultiPartChars = 67;

    /// <summary>Metnin kaç SMS parçası tutacağı. Boş metin 0 parçadır (gönderilmez).</summary>
    public static int Count(string? body)
    {
        if (string.IsNullOrEmpty(body)) return 0;
        var length = body.Length;
        return length <= SinglePartChars ? 1 : (length + MultiPartChars - 1) / MultiPartChars;
    }
}
