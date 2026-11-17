using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Platform admin'in tanımladığı satın alınabilir MESAJ KREDİSİ paketi. Kurum yöneticisi ana
/// aboneliğinin dışında bu paketlerden alarak cüzdanına kredi ekler. PriceTry ödenen tutar (₺),
/// GrantsCredits cüzdana eklenen kredi (bonus paketlerde birim fiyat düşer: 2.500 kredi ₺350).
/// </summary>
public sealed class WhatsAppCreditPackage : Entity
{
    private WhatsAppCreditPackage() { }

    public WhatsAppCreditPackage(string name, decimal priceTry, decimal grantsCredits, int displayOrder = 0, string? description = null)
    {
        Rename(name);
        SetAmounts(priceTry, grantsCredits);
        DisplayOrder = displayOrder;
        Description = Clean(description);
        IsActive = true;
    }

    public string Name { get; private set; } = string.Empty;
    public string? Description { get; private set; }

    /// <summary>Kurumun ödediği tutar (₺).</summary>
    public decimal PriceTry { get; private set; }

    /// <summary>Cüzdana eklenen kredi.</summary>
    public decimal GrantsCredits { get; private set; }

    /// <summary>
    /// ESKİ ₺ kontör hakkı (12 Kas 2026 kredi dönüşümü öncesi). Donmuş geçmiş — yeni paketlerde 0,
    /// faturalama bunu OKUMAZ.
    /// </summary>
    public decimal GrantsTry { get; private set; }

    public int DisplayOrder { get; private set; }
    public bool IsActive { get; private set; } = true;

    public void Rename(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) throw new DomainException("Paket adı boş olamaz.");
        if (name.Length > 80) throw new DomainException("Paket adı 80 karakteri aşamaz.");
        Name = name.Trim();
        Touch();
    }

    public void SetAmounts(decimal priceTry, decimal grantsCredits)
    {
        if (priceTry < 0) throw new DomainException("Fiyat negatif olamaz.");
        if (grantsCredits <= 0) throw new DomainException("Kredi miktarı pozitif olmalı.");
        PriceTry = decimal.Round(priceTry, 2);
        GrantsCredits = decimal.Round(grantsCredits, 2);
        Touch();
    }

    public void SetDescription(string? description) { Description = Clean(description); Touch(); }
    public void SetDisplayOrder(int order) { DisplayOrder = order; Touch(); }
    public void Activate() { IsActive = true; Touch(); }
    public void Deactivate() { IsActive = false; Touch(); }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
