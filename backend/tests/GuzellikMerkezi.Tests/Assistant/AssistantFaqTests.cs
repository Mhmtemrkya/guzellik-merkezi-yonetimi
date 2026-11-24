using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Assistant;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Tests.Assistant;

/// <summary>
/// Sık sorulan sorular yapay zekâ olmadan da (anahtar kelimeyle) doğru makaleye gider; kural motoru onları veri
/// sorusu sanmaz. Metinler destek sayfasındaki cevaplarla aynıdır.
/// </summary>
public sealed class AssistantFaqTests
{
    [Theory]
    [InlineData("owner", "şifremi unuttum", "password-forgot")]
    [InlineData("staff", "şifremi unuttum ne yapmalıyım", "password-forgot")]
    [InlineData("owner", "personelin şifresini nasıl sıfırlarım", "staff-password-reset")]
    [InlineData("owner", "personel cihaz onayı nasıl verilir", "staff-devices")]
    [InlineData("owner", "personele nasıl izin girerim", "staff-leave")]
    [InlineData("owner", "prim oranını nereden ayarlarım", "staff-commission")]
    [InlineData("owner", "personelim hangi sayfaları görebilir", "staff-permissions")]
    [InlineData("owner", "müşteriye nasıl iade yaparım", "sale-cancel-refund")]
    [InlineData("owner", "hizmet fiyatını nasıl değiştiririm", "service-price-change")]
    [InlineData("owner", "randevuyu başka personele nasıl aktarırım", "appointment-reassign")]
    [InlineData("owner", "whatsapp hatırlatmaları nasıl çalışıyor", "whatsapp-reminders")]
    [InlineData("owner", "şube değiştirmek istiyorum", "branches-multi")]
    [InlineData("owner", "hesabımı nasıl silerim", "account-delete")]
    [InlineData("owner", "deneme süresi bitince verilerim silinir mi", "trial-end")]
    [InlineData("owner", "verilerim güvende mi", "data-security")]
    [InlineData("owner", "listeyi excele nasıl aktarırım", "excel-export")]
    [InlineData("customer", "hesabımı silmek istiyorum", "customer-account-delete")]
    [InlineData("customer", "bilgilerim güvende mi", "customer-data-security")]
    public void Faq_MatchesItsArticle(string portal, string question, string expected)
    {
        var parse = AssistantIntentResolver.Resolve(question);
        Assert.False(AssistantIntentCatalog.IsData(parse.Intent), $"'{question}' veri sanıldı: {parse.Intent}");
        var role = portal switch { "staff" => UserRole.Staff, "customer" => UserRole.Customer, _ => UserRole.InstitutionOwner };
        var visible = AssistantHelpCatalog.VisibleTo(portal, role, [], null, storeBuild: false);
        var (article, _) = AssistantHelpCatalog.Match(AssistantText.Fold(question), portal, visible);
        Assert.Equal(expected, article?.Id);
    }
}
