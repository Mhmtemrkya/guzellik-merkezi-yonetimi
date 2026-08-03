using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Kurumun abonelik tahsilatı için SAKLI KARTI (iyzico kart saklama servisi).
///
/// <para>
/// KART VERİSİ BURADA TUTULMAZ. Kartın kendisi (PAN, CVC, son kullanma) hiçbir zaman bizim
/// sistemimize girmez; kullanıcı kartı iyzico'nun 3D Secure formuna girer ve iyzico bize yalnızca
/// iki referans döner: <see cref="CardUserKeyEncrypted"/> (kurumun kart cüzdanı) ve
/// <see cref="CardTokenEncrypted"/> (o karta özel token). Sonraki tahsilatlar bu ikisiyle yapılır.
/// Böylece PCI-DSS kapsamı iyzico'da kalır. İki referans yine de at-rest şifrelenir: ele geçirilmiş
/// bir veritabanı yedeğiyle kurum adına çekim yapılabilmesin.
/// </para>
/// <para>
/// Kurum başına tek AKTİF kart tutulur; yeni kart eklendiğinde eskisi pasifleştirilir (satır
/// silinmez — geçmiş tahsilatların hangi kartla yapıldığı denetlenebilir kalsın).
/// </para>
/// </summary>
public sealed class TenantPaymentMethod : Entity
{
    private TenantPaymentMethod() { }

    public TenantPaymentMethod(
        Guid tenantId,
        string provider,
        string cardUserKeyEncrypted,
        string cardTokenEncrypted,
        string? maskedNumber,
        string? association,
        string? family,
        string? bankName)
    {
        if (tenantId == Guid.Empty) throw new DomainException("Kart için kurum zorunlu.");
        if (string.IsNullOrWhiteSpace(cardUserKeyEncrypted)) throw new DomainException("Kart cüzdan anahtarı zorunlu.");
        if (string.IsNullOrWhiteSpace(cardTokenEncrypted)) throw new DomainException("Kart token'ı zorunlu.");

        TenantId = tenantId;
        Provider = string.IsNullOrWhiteSpace(provider) ? "Iyzico" : provider.Trim();
        CardUserKeyEncrypted = cardUserKeyEncrypted;
        CardTokenEncrypted = cardTokenEncrypted;
        MaskedNumber = Clean(maskedNumber);
        Association = Clean(association);
        Family = Clean(family);
        BankName = Clean(bankName);
    }

    public Guid TenantId { get; private set; }
    public Tenant? Tenant { get; private set; }

    /// <summary>Iyzico | Simulation</summary>
    public string Provider { get; private set; } = "Iyzico";

    /// <summary>iyzico <c>cardUserKey</c> — kurumun kart cüzdanı anahtarı. At-rest şifreli.</summary>
    public string CardUserKeyEncrypted { get; private set; } = string.Empty;

    /// <summary>iyzico <c>cardToken</c> — bu karta özel referans. At-rest şifreli.</summary>
    public string CardTokenEncrypted { get; private set; } = string.Empty;

    /// <summary>Kullanıcıya gösterilen maskeli numara (ör. 552879******0004). PAN DEĞİLDİR.</summary>
    public string? MaskedNumber { get; private set; }

    /// <summary>VISA | MASTER_CARD | TROY …</summary>
    public string? Association { get; private set; }

    /// <summary>Kart ailesi (Bonus, World, Maximum …).</summary>
    public string? Family { get; private set; }

    public string? BankName { get; private set; }

    public bool IsActive { get; private set; } = true;
    public DateTime? LastChargedAtUtc { get; private set; }

    /// <summary>
    /// ARDIŞIK başarısız çekim sayısı. Dunning (tekrar deneme) kararı buna bakar; başarılı
    /// çekimde sıfırlanır. Limitsiz denemek hem kurumu hem bankayı gereksiz yorar.
    /// </summary>
    public int ConsecutiveFailureCount { get; private set; }

    public void MarkCharged(DateTime utcNow)
    {
        LastChargedAtUtc = utcNow;
        ConsecutiveFailureCount = 0;
        Touch(utcNow);
    }

    public void MarkChargeFailed()
    {
        ConsecutiveFailureCount++;
        Touch();
    }

    /// <summary>Kartı pasifleştirir (kullanıcı sildi ya da yerine yenisi eklendi). Satır korunur.</summary>
    public void Deactivate()
    {
        if (!IsActive) return;
        IsActive = false;
        Touch();
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
