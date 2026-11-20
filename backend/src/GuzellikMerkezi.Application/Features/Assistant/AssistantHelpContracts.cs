using GuzellikMerkezi.Domain.Assistant;

namespace GuzellikMerkezi.Application.Features.Assistant;

/// <summary>
/// Yapay zekâya yardım makalesi seçtirir. Cevap şemayla makale kimliklerine kilitlidir; soruda yazan bir
/// "talimat" listenin dışına çıkaramaz. Kapalıysa (sağlayıcı/anahtar yok) hiç çağrılmaz.
/// </summary>
public interface IAssistantHelpMatcher
{
    bool IsEnabled { get; }

    /// <summary>Kişi başına günlük yapay zekâ eşleştirme sınırı (Türkiye günü).</summary>
    int DailyLimit { get; }

    /// <param name="maskedQuestion">Maskelenmiş soru (ad/sayı/e-posta gizli).</param>
    /// <param name="articles">Kişinin görebildiği makaleler: (kimlik, başlık).</param>
    /// <returns>Seçilen makale kimliği; uygun makale yoksa, konu dışıysa ya da çağrı başarısızsa null.</returns>
    Task<string?> PickArticleAsync(string maskedQuestion, IReadOnlyList<(string Id, string Title)> articles, CancellationToken cancellationToken);
}

/// <summary>
/// "Nasıl yapılır / nerede" sorusunu yardım kataloğuyla cevaplar: önce yapay zekâ (maskeli soru, yalnız kişinin
/// görebildiği makaleler, günlük sınır), "hiçbiri"/kapalı/sınır dolu ise anahtar kelime, o da tutmazsa yazım
/// düzeltmesiyle anahtar kelime. Kişi; oturumdaki rol, şube, personel izni ve kurumun paketiyle belirlenir.
/// </summary>
public interface IAssistantHelpService
{
    Task<AssistantHelpAnswer> AnswerAsync(string question, AssistantHelpOptions options, CancellationToken cancellationToken);
}

/// <param name="English">Başlıklar (yapay zekâya sunulan) ve kart metni İngilizce mi.</param>
/// <param name="StoreBuild">App Store / Mac App Store istemcisi: satın alma yüzeyleri gösterilmez (3.1.1).</param>
/// <param name="AllowAi">false: yapay zekâ hiç denenmez (ör. kural motoru zaten bir niyet buldu).</param>
/// <param name="DataChoices">
/// Kural motorunun anlamadığı soru bir VERİ sorusu da olabilir: kişinin cevaplayabildiği veri niyetleri yapay zekâya
/// tarifleriyle sunulur; seçilirse <see cref="AssistantHelpOutcome.Data"/> döner ve rakamı veritabanı hesaplar.
/// </param>
public sealed record AssistantHelpOptions(bool English = false, bool StoreBuild = false, bool AllowAi = true,
    IReadOnlyList<AssistantDataChoice>? DataChoices = null);

/// <summary>Yapay zekâya sunulan bir veri niyeti: yalnız kimliği ve kısa tarifi (hiçbir veri içermez).</summary>
public sealed record AssistantDataChoice(AssistantIntent Intent, string Description)
{
    public const string Prefix = "veri_";
    public string Id => Prefix + Intent;
}

public enum AssistantHelpOutcome
{
    /// <summary>Kişinin görebildiği bir makale bulundu.</summary>
    Article,
    /// <summary>Makale var ama başka bir portalda (ör. personel yönetici ekranını soruyor).</summary>
    OtherPortal,
    /// <summary>Eşleşme yok: Maydi bilmediğini söyler; soru "Maydi Soruları"na düşer.</summary>
    NotFound,
    /// <summary>Kişinin Maydi portalı yok (platform yöneticisi / oturumsuz).</summary>
    NoPortal,
    /// <summary>Soru bir veri sorusu: <see cref="AssistantHelpAnswer.DataIntent"/> cevaplanır (yapay zekâ seçti).</summary>
    Data,
}

/// <param name="MatchedBy">"ai", "rule", "rule_spelling" ya da boş.</param>
public sealed record AssistantHelpAnswer(
    AssistantHelpOutcome Outcome,
    string Portal,
    AssistantHelpArticle? Article,
    string MatchedBy,
    string? Route,
    AssistantIntent? DataIntent = null)
{
    public static AssistantHelpAnswer None(string portal, AssistantHelpOutcome outcome = AssistantHelpOutcome.NotFound) =>
        new(outcome, portal, null, string.Empty, null);
}
