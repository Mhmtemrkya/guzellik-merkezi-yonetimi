using GuzellikMerkezi.Domain.Assistant;

namespace GuzellikMerkezi.Tests.Assistant;

/// <summary>Metin katlama, "Maydi" hitabı, KVKK maskelemesi ve yazım düzeltmesi.</summary>
public sealed class AssistantTextTests
{
    [Theory]
    [InlineData("  İPTAL   Ettiğim  RANDEVULAR ", "iptal ettigim randevular")]
    [InlineData("Müşteri Kartı Çizelge Şube", "musteri karti cizelge sube")]
    public void Fold_LowercasesTurkishAndStripsDiacritics(string input, string expected) =>
        Assert.Equal(expected, AssistantText.Fold(input));

    [Theory]
    [InlineData("Maydi, randevu nasıl oluşturulur?", "randevu nasıl oluşturulur?")]
    [InlineData("maydi'ciğim kasa kapanışı nerede", "kasa kapanışı nerede")]
    [InlineData("Maydi!", "merhaba")]
    [InlineData("Maydi kim?", "sen kimsin")]
    [InlineData("Maydanoz Hesabım nerede", "Maydanoz Hesabım nerede")] // benzer kelime ad sayılmaz
    public void WithoutName_StripsTheAssistantName(string input, string expected) =>
        Assert.Equal(expected, AssistantText.WithoutName(input));

    [Fact]
    public void Mask_HidesEmailNumbersAndKnownNames()
    {
        var names = new HashSet<string>(StringComparer.Ordinal) { "ayse", "yilmaz" };
        var masked = AssistantPrivacy.Mask("Ayşe Yılmaz'ın 0532 123 45 67 numarasına ve ayse@ornek.com adresine TC 12345678901 ile nasıl randevu veririm", names);

        Assert.Equal("[ad] [ad] [sayı] numarasına ve [e-posta] adresine TC [sayı] ile nasıl randevu veririm", masked);
        Assert.DoesNotContain("532", masked);
        Assert.DoesNotContain("Ayşe", masked);
    }

    [Fact]
    public void CandidateWords_AreFoldedRoots() =>
        Assert.Equal(["ayse", "nin", "randevusu"], AssistantPrivacy.CandidateWords("Ayşe'nin nin randevusu"));

    [Theory]
    [InlineData("randvu nasil olusturulur", "randevu nasil olusturulur")]
    [InlineData("yeni personl ekle", "yeni personel ekle")]
    [InlineData("tesekkurlerrr", "tesekkurler")]
    [InlineData("tsk", "tesekkurler")]
    public void Spelling_CorrectsTowardsKnownVocabulary(string input, string expected) =>
        Assert.Equal(expected, AssistantSpelling.Correct(input).Text);

    [Fact]
    public void Spelling_KeepsPersonNames()
    {
        var keep = new HashSet<string>(StringComparer.Ordinal) { "randa" };
        var result = AssistantSpelling.Correct("randa randvu", keep);
        Assert.Equal("randa randevu", result.Text);
        Assert.Equal(["randvu"], result.ChangedTokens);
    }

    [Fact]
    public void Spelling_LeavesCommonNamesAlone() =>
        Assert.False(AssistantSpelling.Correct("seda gamze").Changed);

    [Fact]
    public void Spelling_IsConservative_WhenTwoStemsAreEquallyClose() =>
        // "kapnisi" hem "kapanisi" (kasa kapanışı) hem "kapisi" (onay kapısı) için bir harf uzak: dokunulmaz.
        Assert.False(AssistantSpelling.Correct("kapnisi").Changed);
}
