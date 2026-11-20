using System.Text.Json;
using GuzellikMerkezi.Domain.Assistant;

namespace GuzellikMerkezi.Tests.Assistant;

/// <summary>
/// Yardım değerlendirme setlerindeki ("nasıl yapılır") sorular veri sorusu SANILMAMALI: genişleyen veri kalıpları
/// "randevu almak istiyorum", "gider eklemek istiyorum" gibi bir şey YAPMA isteklerini yakalarsa kişi makale yerine
/// rakam (ya da müşteri portalında ret) alır. Her soru HowTo / Unknown (→ yardım) kalmalı.
/// </summary>
public sealed class AssistantHelpQuestionsStayHelpTests
{
    private sealed record Case(string Portal, string Question, string Expected);

    public static TheoryData<string> Questions()
    {
        var data = new TheoryData<string>();
        foreach (var file in new[] { "help-eval.json", "help-eval-holdout.json" })
        {
            var path = Path.Combine(AppContext.BaseDirectory, "TestData", file);
            foreach (var item in JsonSerializer.Deserialize<List<Case>>(File.ReadAllText(path), new JsonSerializerOptions(JsonSerializerDefaults.Web))!)
                data.Add(item.Question);
        }
        return data;
    }

    /// <summary>
    /// "…görmek istiyorum" bir GÖRME isteğidir: rakamı/listeyi doğrudan göstermek (ve sayfa bağlantısı vermek)
    /// kullanıcının istediği davranıştır ("sayfaya aktarıyor, orada göstermesi gerekiyor").
    /// </summary>
    private static readonly HashSet<string> ViewRequests =
    [
        "geçen ay ne kadar kazandığımızı grafikle görmek istiyorum",
        "hangi hizmetin daha çok tercih edildiğini görmek istiyorum",
        "takvimi haftalık görmek istiyorum",
    ];

    [Theory]
    [MemberData(nameof(Questions))]
    public void HelpQuestion_IsNotData(string question)
    {
        if (ViewRequests.Contains(question)) return;
        var intent = AssistantIntentResolver.Resolve(question, nowLocal: new DateTime(2026, 11, 20, 14, 0, 0)).Intent;
        Assert.False(AssistantIntentCatalog.IsData(intent), $"'{question}' → {intent}");
    }
}
