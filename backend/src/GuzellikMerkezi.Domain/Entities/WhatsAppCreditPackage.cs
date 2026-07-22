using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Platform admin'in tanımladığı satın alınabilir kontör paketi (ek bakiye). Kurum yöneticisi ana
/// aboneliğinin dışında bu paketlerden alarak cüzdanına ₺ kontör ekler. PriceTry ödenen tutar,
/// GrantsTry cüzdana eklenen tutar (bonus için farklı olabilir: 149 öde, 160 kazan).
/// EstimatedUtilityMessages sadece kurumun gördüğü tahmini gösterim (mevcut Utility fiyatından türetilir).
/// </summary>
public sealed class WhatsAppCreditPackage : Entity
{
    private WhatsAppCreditPackage() { }

    public WhatsAppCreditPackage(string name, decimal priceTry, decimal grantsTry, int displayOrder = 0, string? description = null)
    {
        Rename(name);
        SetAmounts(priceTry, grantsTry);
        DisplayOrder = displayOrder;
        Description = Clean(description);
        IsActive = true;
    }

    public string Name { get; private set; } = string.Empty;
    public string? Description { get; private set; }

    /// <summary>Kurumun ödediği tutar (₺).</summary>
    public decimal PriceTry { get; private set; }

    /// <summary>Cüzdana eklenen kontör tutarı (₺). Bonus için PriceTry'den büyük olabilir.</summary>
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

    public void SetAmounts(decimal priceTry, decimal grantsTry)
    {
        if (priceTry < 0) throw new DomainException("Fiyat negatif olamaz.");
        if (grantsTry <= 0) throw new DomainException("Kontör tutarı pozitif olmalı.");
        PriceTry = decimal.Round(priceTry, 2);
        GrantsTry = decimal.Round(grantsTry, 2);
        Touch();
    }

    public void SetDescription(string? description) { Description = Clean(description); Touch(); }
    public void SetDisplayOrder(int order) { DisplayOrder = order; Touch(); }
    public void Activate() { IsActive = true; Touch(); }
    public void Deactivate() { IsActive = false; Touch(); }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
