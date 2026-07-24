using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Kurumun herkese açık vitrin (salon profili) bilgileri — /salonlar listesinde ve
/// salon detay sayfasında görünür. Tenant ile 1:1; kurum yöneticisi doldurur ve
/// <see cref="IsPublished"/> ile yayına alır. Yayında olmayan kurum public listede çıkmaz.
/// </summary>
public sealed class TenantPublicProfile : Entity
{
    private TenantPublicProfile() { }

    public TenantPublicProfile(Guid tenantId)
    {
        if (tenantId == Guid.Empty) throw new DomainException("Kurum kimliği boş olamaz.");
        TenantId = tenantId;
    }

    public Guid TenantId { get; private set; }

    /// <summary>Kurum yöneticisi "Yayınla" dediğinde true — public listede görünmenin tek anahtarı.</summary>
    public bool IsPublished { get; private set; }

    /// <summary>Platform admin'in verdiği "Premium / Öne Çıkan" etiketi — listede en üstte sıralanır.</summary>
    public bool IsFeatured { get; private set; }

    public void SetFeatured(bool featured)
    {
        IsFeatured = featured;
        Touch();
    }

    public string? Description { get; private set; }
    public string? Address { get; private set; }
    public string? City { get; private set; }
    public string? Instagram { get; private set; }
    public string? PublicEmail { get; private set; }
    public string? PublicPhone { get; private set; }
    /// <summary>Serbest metin çalışma saatleri (ör. "Pzt-Cmt 09:00 - 20:00").</summary>
    public string? WorkingHoursText { get; private set; }
    /// <summary>"Yol Tarifi Al" bağlantısı; boşsa şehir/adresten Google Maps araması üretilir.</summary>
    public string? MapUrl { get; private set; }

    /// <summary>Kurum logosu (base64 data-URL) — salon sayfasındaki kapak üstü logo karosunda görünür.</summary>
    public string? LogoData { get; private set; }

    public void SetLogo(string? logoData)
    {
        LogoData = string.IsNullOrWhiteSpace(logoData) ? null : logoData;
        Touch();
    }

    /// <summary>
    /// Kuruma özel KVKK aydınlatma / açık rıza metni. Boşsa panel yerleşik varsayılan metni gösterir;
    /// kurum yöneticisi Ayarlar sayfasından düzenleyebilir. Yeni müşteri ekleme modalında görüntülenir + PDF olarak indirilebilir.
    /// </summary>
    public string? KvkkConsentText { get; private set; }

    public void SetKvkkConsentText(string? text)
    {
        var trimmed = text?.Trim();
        KvkkConsentText = string.IsNullOrWhiteSpace(trimmed) ? null : trimmed;
        Touch();
    }

    public void Update(
        bool isPublished,
        string? description,
        string? address,
        string? city,
        string? instagram,
        string? publicEmail,
        string? publicPhone,
        string? workingHoursText,
        string? mapUrl)
    {
        IsPublished = isPublished;
        Description = Clean(description, 2000);
        Address = Clean(address, 500);
        City = Clean(city, 100);
        Instagram = Clean(instagram, 100)?.TrimStart('@');
        PublicEmail = Clean(publicEmail, 200);
        PublicPhone = Clean(publicPhone, 40);
        WorkingHoursText = Clean(workingHoursText, 200);
        MapUrl = Clean(mapUrl, 1000);
        Touch();
    }

    private static string? Clean(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        return trimmed.Length > maxLength ? trimmed[..maxLength] : trimmed;
    }
}
