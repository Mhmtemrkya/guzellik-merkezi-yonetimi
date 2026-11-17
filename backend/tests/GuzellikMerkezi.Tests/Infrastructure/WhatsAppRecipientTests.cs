using GuzellikMerkezi.Infrastructure.Services;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// Meta'ya giden alıcı numarası "+" ve ülke koduyla gitmeli. "+"sız numaranın önüne Meta işletmenin
/// ülke kodunu ekler: kayıtlı "0532 123 45 67" eskiden "05321234567" diye gidiyordu ve Meta onu
/// "+90 05321234567" okuyordu (yanlış numara / teslim yok).
/// </summary>
public sealed class WhatsAppRecipientTests
{
    [Theory]
    [InlineData("05321234567", "+905321234567")]      // en yaygın yazım: baştaki 0
    [InlineData("5321234567", "+905321234567")]       // 0'sız
    [InlineData("905321234567", "+905321234567")]     // ülke koduyla, "+"sız
    [InlineData("9005321234567", "+905321234567")]    // "+90 0532…" yazımı
    [InlineData("00905321234567", "+905321234567")]   // "00" çıkış öneki
    [InlineData("02121234567", "+902121234567")]      // sabit hat
    [InlineData("2121234567", "+902121234567")]       // sabit hat, 0'sız (Fas +212 sanılmamalı)
    [InlineData("4915112345678", "+4915112345678")]   // yabancı numara ülke koduyla kayıtlı
    [InlineData("0049 151 1234 5678", "+4915112345678")] // rakam dışı karakterler süzülür
    public void Format_AlwaysSendsPlusAndCountryCode(string input, string expected)
        => Assert.Equal(expected, WhatsAppRecipient.Format(input));

    [Fact]
    public void Format_EmptyInput_StaysEmpty()
    {
        Assert.Equal(string.Empty, WhatsAppRecipient.Format(null));
        Assert.Equal(string.Empty, WhatsAppRecipient.Format("  "));
    }

    [Theory]
    [InlineData("+905321234567", "905321234567", true)]
    [InlineData("+905321234567", "9005321234567", false)] // Meta başka numara çözdü → uyarı
    [InlineData("+905321234567", null, true)]             // yanıtta wa_id yoksa karşılaştırma yok
    public void SameAsSent_ComparesDigits(string sent, string? waId, bool expected)
        => Assert.Equal(expected, WhatsAppRecipient.SameAsSent(sent, waId));
}
