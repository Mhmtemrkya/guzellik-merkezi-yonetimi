using GuzellikMerkezi.Domain.Assistant;

namespace GuzellikMerkezi.Tests.Assistant;

/// <summary>Maydi kural motoru: veri, yardım, sohbet ve tavsiye ayrımı; sıra ve yazım toleransı.</summary>
public sealed class AssistantIntentResolverTests
{
    [Theory]
    [InlineData("Bugünkü randevularım", AssistantIntent.AppointmentsToday)]
    [InlineData("Maydi, bugün kaç randevu var?", AssistantIntent.AppointmentsToday)]
    [InlineData("Sıradaki müşterim kim?", AssistantIntent.NextAppointment)]
    [InlineData("yaklaşan randevum ne zaman", AssistantIntent.NextAppointment)]
    [InlineData("bu haftaki programım", AssistantIntent.WeekSchedule)]
    [InlineData("paketli müşterilerimin kalan seansı", AssistantIntent.RemainingSessions)]
    [InlineData("kaç seansım kaldı", AssistantIntent.RemainingSessions)]
    [InlineData("yıldız puanım kaç", AssistantIntent.MyRating)]
    [InlineData("onay bekleyen taslaklarım", AssistantIntent.PendingApprovals)]
    [InlineData("bugün boş saat var mı", AssistantIntent.FreeSlots)]
    [InlineData("bugünkü ciro ne kadar", AssistantIntent.Revenue)]
    [InlineData("geciken taksitler", AssistantIntent.OverdueInstallments)]
    [InlineData("kritik stoktaki ürünler", AssistantIntent.CriticalStock)]
    [InlineData("bekleme listesinde kimler var", AssistantIntent.Waitlist)]
    [InlineData("bu ay en çok çalışan personel kim", AssistantIntent.TopStaff)]
    [InlineData("gelmeyen müşteriler", AssistantIntent.NoShows)]
    [InlineData("randevu geçmişim", AssistantIntent.AppointmentHistory)]
    public void DataQuestions(string message, AssistantIntent expected) =>
        Assert.Equal(expected, AssistantIntentResolver.Resolve(message).Intent);

    [Theory]
    // "nasıl" içeren veri kelimeleri yardım sorusudur: "taksit nasıl girilir" taksit listesi değil.
    [InlineData("taksit nasıl girilir")]
    [InlineData("stok çıkışı nereden yapılır")]
    [InlineData("bekleme listesine nasıl eklerim")]
    [InlineData("lazer randevusu nasıl oluşturulur")]
    [InlineData("how do I add a customer")]
    public void HowTo_BeatsDataKeywords(string message) =>
        Assert.Equal(AssistantIntent.HowTo, AssistantIntentResolver.Resolve(message).Intent);

    [Theory]
    [InlineData("hangi işlem bana uygun")]
    [InlineData("cildim için hangi krem iyi gelir")]
    [InlineData("sivilce için ne önerirsin")]
    [InlineData("hamileyim lazer yaptırsam zararlı mı")]
    public void BeautyAdvice_IsRecognized(string message) =>
        Assert.Equal(AssistantIntent.BeautyAdvice, AssistantIntentResolver.Resolve(message).Intent);

    [Theory]
    [InlineData("Merhaba", AssistantIntent.Greeting)]
    [InlineData("Maydi!", AssistantIntent.Greeting)]
    [InlineData("teşekkürler", AssistantIntent.Thanks)]
    [InlineData("tşk", AssistantIntent.Thanks)]
    [InlineData("sen kimsin", AssistantIntent.SmallTalk)]
    [InlineData("Maydi kim?", AssistantIntent.SmallTalk)]
    [InlineData("neler yapabilirsin", AssistantIntent.Help)]
    // Selamlı veri sorusu veri sorusudur.
    [InlineData("Merhaba, bugünkü randevularım", AssistantIntent.AppointmentsToday)]
    public void Conversation(string message, AssistantIntent expected) =>
        Assert.Equal(expected, AssistantIntentResolver.Resolve(message).Intent);

    [Fact]
    public void Typo_IsResolvedOnlyAfterRulesFail()
    {
        var parse = AssistantIntentResolver.Resolve("kritk stok");
        Assert.Equal(AssistantIntent.CriticalStock, parse.Intent);
        Assert.Equal("kritik stok", parse.CorrectedText);

        var exact = AssistantIntentResolver.Resolve("kritik stok");
        Assert.Null(exact.CorrectedText);
    }

    [Fact]
    public void OffTopic_IsUnknown() =>
        Assert.Equal(AssistantIntent.Unknown, AssistantIntentResolver.Resolve("Türkiye'nin başkenti neresi").Intent);

    [Theory]
    [InlineData("bugünkü ciro", AssistantPeriod.Today)]
    [InlineData("bu hafta ciro", AssistantPeriod.Week)]
    [InlineData("bu ayki ciro ne kadar", AssistantPeriod.Month)]
    public void RevenuePeriod(string message, AssistantPeriod expected) =>
        Assert.Equal(expected, AssistantIntentResolver.Resolve(message).Period);

    [Fact]
    public void EverySuggestion_ResolvesToItsIntent()
    {
        foreach (var portal in AssistantPortals.All)
        foreach (var (tr, en, intent) in AssistantIntentCatalog.Suggestions(portal))
        {
            Assert.Equal(intent, AssistantIntentResolver.Resolve(tr).Intent);
            Assert.False(string.IsNullOrWhiteSpace(en));
            if (AssistantIntentCatalog.RuleFor(intent) is { } rule) Assert.Contains(portal, rule.Portals);
        }
    }

    [Fact]
    public void DataRules_AreConsistent()
    {
        foreach (var rule in AssistantIntentCatalog.DataRules)
        {
            Assert.True(AssistantIntentCatalog.IsData(rule.Intent));
            Assert.All(rule.Portals, portal => Assert.True(rule.Route.ContainsKey(portal), $"{rule.Intent}/{portal} rotası yok"));
            Assert.All(rule.FeatureKeys, key => Assert.True(GuzellikMerkezi.Domain.FeatureCatalog.Exists(key)));
            // Ciro ve finans yalnız yöneticiye.
            if (rule.Intent is AssistantIntent.Revenue or AssistantIntent.OverdueInstallments)
                Assert.DoesNotContain(AssistantPortals.Staff, rule.Portals);
        }
    }
}
