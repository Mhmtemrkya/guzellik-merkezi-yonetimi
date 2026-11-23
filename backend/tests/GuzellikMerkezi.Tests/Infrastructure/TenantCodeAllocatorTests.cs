using GuzellikMerkezi.Infrastructure.Services;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>Kurum kodu BA-ŞEHİR-SIRA (kullanıcı kararı 23 Kas 2026): şehir ASCII, sıra şehir içinde, en az 3 hane.</summary>
public sealed class TenantCodeAllocatorTests
{
    [Theory]
    [InlineData("İstanbul", "ISTANBUL")]
    [InlineData("şanlıurfa", "SANLIURFA")]
    [InlineData("Afyon Karahisar", "AFYONKARAHISAR")]
    [InlineData("Çanakkale", "CANAKKALE")]
    [InlineData(" ", "GENEL")]
    [InlineData(null, "GENEL")]
    public void CityKey_FoldsTurkishLetters(string? city, string expected) =>
        Assert.Equal(expected, TenantCodeAllocator.CityKey(city));

    [Fact]
    public void Numbers_ArePerCity_AndOldCodesAreRecognised()
    {
        Assert.Equal("BA-IZMIR-001", TenantCodeAllocator.Format("İzmir", 1));
        Assert.Equal("BA-IZMIR-1000", TenantCodeAllocator.Format("İzmir", 1000));
        Assert.Equal(8, TenantCodeAllocator.NextNumber("izmir", ["BA-IZMIR-007", "BA-IZMIRX-050", "BA-ANKARA-099", "BA-01", null]));
        Assert.Equal(1, TenantCodeAllocator.NextNumber("Erzurum", ["BA-IZMIR-007"]));
        Assert.True(TenantCodeAllocator.IsCityCode("BA-ERZURUM-001"));
        Assert.False(TenantCodeAllocator.IsCityCode("BA-01"));
        Assert.False(TenantCodeAllocator.IsCityCode(null));
        Assert.True(TenantCodeAllocator.Format("Afyonkarahisar", 999).Length <= 40);
    }
}
