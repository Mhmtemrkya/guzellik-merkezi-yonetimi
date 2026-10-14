using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Infrastructure.Services;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// Müşteri girişinde ad eşleştirmesi. Kayıtta soyad Türkçe kültürle BÜYÜTÜLÜR
/// (PersonNameFormatter); karşılaştırma bunu ve Türkçe karakter farklarını tolere etmelidir.
/// Eskiden ToLowerInvariant kullanılıyordu ve "YILMAZ"/"MUSTERİ" kayıtları adını doğru yazan
/// müşteriyle bile eşleşmiyordu.
/// </summary>
public sealed class CustomerNameMatchingTests
{
    [Theory]
    [InlineData("Merve Yılmaz")]
    [InlineData("merve yılmaz")]
    [InlineData("Merve Yilmaz")]
    [InlineData("  MERVE   YILMAZ ")]
    public void FormattedSurnameWithDotlessI_Matches(string typed) =>
        Assert.Equal(
            CustomerIdentityLookup.NormalizeName(PersonNameFormatter.Format("Merve Yılmaz")),
            CustomerIdentityLookup.NormalizeName(typed));

    [Theory]
    [InlineData("Demo Musteri")]
    [InlineData("Demo Müşteri")]
    [InlineData("demo müsteri")]
    public void FormattedSurnameWithDottedI_Matches(string typed) =>
        Assert.Equal(
            CustomerIdentityLookup.NormalizeName(PersonNameFormatter.Format("Demo Musteri")),
            CustomerIdentityLookup.NormalizeName(typed));

    [Theory]
    [InlineData("Ayşe Çağlar", "ayse caglar")]
    [InlineData("İpek Şahin", "ipek sahin")]
    [InlineData("Gül Öztürk", "gul ozturk")]
    public void TurkishLettersFold(string stored, string typed) =>
        Assert.Equal(CustomerIdentityLookup.NormalizeName(stored), CustomerIdentityLookup.NormalizeName(typed));

    [Fact]
    public void DifferentNames_StillDiffer() =>
        Assert.NotEqual(
            CustomerIdentityLookup.NormalizeName("Merve Yılmaz"),
            CustomerIdentityLookup.NormalizeName("Merve Yıldız"));

    [Fact]
    public void Empty_IsEmpty() => Assert.Equal(string.Empty, CustomerIdentityLookup.NormalizeName("   "));
}
