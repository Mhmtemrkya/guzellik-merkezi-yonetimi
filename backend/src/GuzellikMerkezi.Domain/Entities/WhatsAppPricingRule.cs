using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Kategori bazlı WhatsApp fiyat kuralı — platform admin yönetir, KOD İÇİNE SABİT YAZILMAZ.
/// Yürürlük tarihiyle (EffectiveFromUtc) tutulur: 1 Ekim 2026 gibi ileri tarihli fiyat değişikliği
/// önceden girilir; çözümleme "o an geçerli en yeni kural"ı seçer. MetaUsdPrice platformun Meta'ya
/// ödediği liste fiyatı (maliyet/mutabakat için), SellPriceTry kuruma yansıtılan birim fiyat (marj burada).
/// </summary>
public sealed class WhatsAppPricingRule : Entity
{
    private WhatsAppPricingRule() { }

    public WhatsAppPricingRule(
        WhatsAppMessageCategory category,
        decimal metaUsdPrice,
        decimal sellPriceTry,
        DateTime effectiveFromUtc,
        string? note = null)
    {
        Category = category;
        SetPrices(metaUsdPrice, sellPriceTry);
        EffectiveFromUtc = Normalize(effectiveFromUtc);
        Note = Clean(note);
        IsActive = true;
    }

    public WhatsAppMessageCategory Category { get; private set; }

    /// <summary>Meta'nın teslim edilen mesaj başına aldığı USD ücret (platform maliyeti).</summary>
    public decimal MetaUsdPrice { get; private set; }

    /// <summary>Kuruma yansıtılan birim satış fiyatı (₺) — kontör bu tutardan düşer.</summary>
    public decimal SellPriceTry { get; private set; }

    /// <summary>Bu fiyatın yürürlüğe girdiği an (UTC). Gelecekteki değişiklikler önceden girilir.</summary>
    public DateTime EffectiveFromUtc { get; private set; }

    public string? Note { get; private set; }
    public bool IsActive { get; private set; } = true;

    public void SetPrices(decimal metaUsdPrice, decimal sellPriceTry)
    {
        if (metaUsdPrice < 0) throw new DomainException("Meta fiyatı negatif olamaz.");
        if (sellPriceTry < 0) throw new DomainException("Satış fiyatı negatif olamaz.");
        MetaUsdPrice = decimal.Round(metaUsdPrice, 6);
        SellPriceTry = decimal.Round(sellPriceTry, 4);
        Touch();
    }

    public void SetEffectiveFrom(DateTime effectiveFromUtc) { EffectiveFromUtc = Normalize(effectiveFromUtc); Touch(); }
    public void SetNote(string? note) { Note = Clean(note); Touch(); }
    public void Activate() { IsActive = true; Touch(); }
    public void Deactivate() { IsActive = false; Touch(); }

    private static DateTime Normalize(DateTime dt) => dt.Kind == DateTimeKind.Unspecified
        ? DateTime.SpecifyKind(dt, DateTimeKind.Utc)
        : dt.ToUniversalTime();

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
