using GuzellikMerkezi.Domain.Assistant;

namespace GuzellikMerkezi.Infrastructure.Services.Assistant;

/// <summary>Maydi'nin sabit cümleleri (TR/EN). Rolüne göre hitap; veri cümleleri servis tarafında sayıyla kurulur.</summary>
internal sealed class AssistantVoice(string portal, bool english, string? firstName)
{
    public string Portal { get; } = portal;
    public bool English { get; } = english;

    private string Name => string.IsNullOrWhiteSpace(firstName) ? string.Empty : (English ? $" {firstName}" : $" {firstName}");

    public string T(string tr, string en) => English ? en : tr;

    public string Greeting(int localHour)
    {
        var part = localHour switch
        {
            < 5 => T("İyi geceler", "Good night"),
            < 12 => T("Günaydın", "Good morning"),
            < 18 => T("İyi günler", "Good afternoon"),
            _ => T("İyi akşamlar", "Good evening"),
        };
        return $"{part}{Name}! " + T("Ben Maydi.", "I'm Maydi.");
    }

    public string Intro() => Portal switch
    {
        AssistantPortals.Customer => T("Randevularınız, seanslarınız ve uygulamanın kullanımı hakkında yardımcı olabilirim.",
            "I can help with your appointments, sessions and how to use the app."),
        AssistantPortals.Staff => T("Randevularınız, müşterileriniz ve ekranların nasıl kullanıldığı hakkında yardımcı olabilirim.",
            "I can help with your appointments, customers and how the screens work."),
        _ => T("Randevular, kasa, stok, personel ve ekranların nasıl kullanıldığı hakkında yardımcı olabilirim.",
            "I can help with appointments, cash, stock, staff and how the screens work."),
    };

    public string Thanks() => T("Rica ederim, her zaman buradayım.", "You're welcome, I'm always here.");

    public string Identity() => T(
        "Ben Maydi, BeautyAsist'in uygulama içi asistanıyım. " + Intro(),
        "I'm Maydi, BeautyAsist's in-app assistant. " + Intro());

    public string Help() => T("Şunları sorabilirsiniz:", "You can ask me things like:");

    public string AdviceRefused() => T(
        "Güzellik ya da sağlık konusunda kişisel tavsiye veremiyorum; hangi işlemin size uygun olduğuna uzmanınız karar vermeli. "
        + "Uygulamanın kullanımı ve randevularınızla ilgili sorularda yardımcı olabilirim.",
        "I can't give personal beauty or health advice; your specialist should decide which treatment suits you. "
        + "I can help with using the app and your appointments.");

    public string NotFound() => T(
        "Bunu henüz bilmiyorum. Sorunuzu ekibe ilettim; uygulamanın kullanımıyla ilgili başka bir şey sorabilirsiniz.",
        "I don't know that yet. I've passed your question to the team; feel free to ask something else about the app.");

    public string HowTo(AssistantHelpArticle article) => T($"{article.TitleTr} şöyle yapılır:", $"Here is how: {article.TitleEn}");

    public string OtherPortal(AssistantHelpArticle article) => Portal == AssistantPortals.Staff
        ? T($"\"{article.TitleTr}\" yönetici panelinden yapılıyor; yöneticinizden destek isteyebilirsiniz.",
            $"\"{article.TitleEn}\" is done from the manager panel; ask your manager for help.")
        : T($"\"{article.TitleTr}\" başka bir panelden yapılıyor.", $"\"{article.TitleEn}\" is done from another panel.");

    public string OutOfPortal() => T("Bu bilgi sizin panelinizde yer almıyor.", "That information isn't part of your panel.");

    public string NoPermission() => T("Bu bilgiyi görme yetkiniz yok; yöneticinizden izin isteyebilirsiniz.",
        "You don't have permission to see this; you can ask your manager.");

    public string NotInPlan() => T("Bu modül kurumunuzun paketinde açık değil.", "This module isn't enabled in your institution's plan.");

    public string OpenPage() => T("Sayfayı aç", "Open page");

    public string Error() => T("Şu anda bilgileri getiremedim, lütfen biraz sonra tekrar deneyin.", "I couldn't fetch that right now, please try again shortly.");
}
