using GuzellikMerkezi.Domain.Assistant;

namespace GuzellikMerkezi.Tests.Assistant;

/// <summary>
/// Maydi'nin dönem ayrıştırıcısı. "Şimdi" sabit: 20 Kasım 2026 Cuma 14:00 (Türkiye). Aralıklar [başlangıç, bitiş).
/// </summary>
public sealed class AssistantDateParserTests
{
    private static readonly DateTime Now = new(2026, 11, 20, 14, 0, 0);

    private static AssistantDateRange? P(string text, bool ahead = false) => AssistantDateParser.Parse(AssistantText.Fold(text), Now, ahead);

    [Theory]
    [InlineData("bugünün geliri ne", "2026-11-20", "2026-11-21", "Bugün")]
    [InlineData("dünkü ciro", "2026-11-19", "2026-11-20", "Dün")]
    [InlineData("yarınki randevular", "2026-11-21", "2026-11-22", "Yarın")]
    [InlineData("evvelsi gün kaç randevu vardı", "2026-11-18", "2026-11-19", "Önceki gün (18 Kasım 2026)")]
    [InlineData("bu hafta", "2026-11-16", "2026-11-23", "Bu hafta (16–22 Kasım 2026)")]
    [InlineData("geçen haftaki gelir", "2026-11-09", "2026-11-16", "Geçen hafta (9–15 Kasım 2026)")]
    [InlineData("haftaya randevular", "2026-11-23", "2026-11-30", "Gelecek hafta (23–29 Kasım 2026)")]
    [InlineData("bu ayın kârı", "2026-11-01", "2026-12-01", "Bu ay (Kasım 2026)")]
    [InlineData("geçen ayın giderleri", "2026-10-01", "2026-11-01", "Geçen ay (Ekim 2026)")]
    [InlineData("ocak ayı gelirlerini göster", "2026-01-01", "2026-02-01", "Ocak 2026")]
    [InlineData("ocakta ne kadar kazandık", "2026-01-01", "2026-02-01", "Ocak 2026")]
    [InlineData("aralık ayı cirosu", "2025-12-01", "2026-01-01", "Aralık 2025")]
    [InlineData("şubat 2025 giderleri", "2025-02-01", "2025-03-01", "Şubat 2025")]
    [InlineData("ocaktan marta kadar gelir", "2026-01-01", "2026-04-01", "Ocak – Mart 2026")]
    [InlineData("15 ocak cirosu", "2026-01-15", "2026-01-16", "15 Ocak 2026")]
    [InlineData("1-15 ocak gelir", "2026-01-01", "2026-01-16", "1–15 Ocak 2026")]
    [InlineData("15.03.2026 satışları", "2026-03-15", "2026-03-16", "15 Mart 2026")]
    [InlineData("son 7 gün", "2026-11-14", "2026-11-21", "Son 7 gün (14–20 Kasım 2026)")]
    [InlineData("son bir ayın giderleri", "2026-10-21", "2026-11-21", "Son 1 ay (21 Ekim – 20 Kasım 2026)")]
    [InlineData("son 3 ay", "2026-08-21", "2026-11-21", "Son 3 ay (21 Ağustos – 20 Kasım 2026)")]
    [InlineData("bu yıl ne kadar kazandık", "2026-01-01", "2027-01-01", "Bu yıl (2026)")]
    [InlineData("geçen sene ciro", "2025-01-01", "2026-01-01", "Geçen yıl (2025)")]
    [InlineData("2025 yılı geliri", "2025-01-01", "2026-01-01", "2025")]
    [InlineData("yılbaşından beri gelir", "2026-01-01", "2026-11-21", "Yılbaşından bugüne (1 Ocak – 20 Kasım 2026)")]
    [InlineData("geçen cuma kaç randevu vardı", "2026-11-13", "2026-11-14", "Cuma (13 Kasım 2026)")]
    [InlineData("salı günkü randevular", "2026-11-17", "2026-11-18", "Salı (17 Kasım 2026)")]
    public void Parses(string text, string from, string to, string title)
    {
        var range = P(text)!;
        Assert.NotNull(range);
        Assert.Equal(DateTime.Parse(from), range.From);
        Assert.Equal(DateTime.Parse(to), range.To);
        Assert.Equal(title, range.Title);
    }

    [Fact]
    public void FutureFriendly_MonthAndWeekday()
    {
        // Randevu gibi ileriye bakan sorularda yılsız ay bu yıla, gün adı en yakın geleceğe gider.
        Assert.Equal(new DateTime(2026, 12, 1), P("aralıkta kaç randevu var", ahead: true)!.From);
        Assert.Equal(new DateTime(2026, 11, 24), P("salı randevuları", ahead: true)!.From);
        Assert.Equal(new DateTime(2026, 11, 27), P("gelecek cuma", ahead: true)!.From);
    }

    [Theory]
    [InlineData("randevu nasıl oluşturulur")]
    [InlineData("kritik stoktaki ürünler")]
    [InlineData("müşteri ekle")]
    [InlineData("dünya")]
    public void NoPeriod_IsNull(string text) => Assert.Null(P(text));

    [Fact]
    public void Previous_IsSameLengthBefore()
    {
        var month = P("ocak")!;
        Assert.Equal((new DateTime(2025, 12, 1), new DateTime(2026, 1, 1)), month.Previous());
        var year = P("2025")!;
        Assert.Equal((new DateTime(2024, 1, 1), new DateTime(2025, 1, 1)), year.Previous());
        var week = P("bu hafta")!;
        Assert.Equal((new DateTime(2026, 11, 9), new DateTime(2026, 11, 16)), week.Previous());
    }
}
