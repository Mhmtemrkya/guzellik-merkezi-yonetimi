namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// MAYDANOZ'A OTURUMLU GEÇİŞ (kullanıcı isteği 18 Kas 2026: "Satın al'a basınca Maydanoz'un satın alma sayfasında form boş
/// oluyor; Maydanoz'da giriş yapmamış olabiliyor, buna dikkat etmek lazım"). Kurum yetkilisi panelden ödeme başlatınca
/// bu ödeme kaydına BAĞLI, tek kullanımlık, kısa ömürlü bir jeton üretilir; Maydanoz ödeme sayfası jetonu imzalı bağlayıcıyla
/// bozdurup kurumun hesabıyla oturum açar (form hesabın bilgileriyle dolu gelir). Yalnız jetonun özeti saklanır.
/// </summary>
public sealed class MaydanozHandoff
{
    /// <summary>Jeton bu süre içinde bozdurulmazsa geçersizdir (tarayıcı yönlenmesi saniyeler sürer).</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

    private MaydanozHandoff() { }

    public MaydanozHandoff(string tokenHash, Guid tenantId, Guid userId, string checkoutRef, DateTime nowUtc)
    {
        Id = Guid.CreateVersion7();
        TokenHash = tokenHash;
        TenantId = tenantId;
        UserId = userId;
        CheckoutRef = checkoutRef;
        CreatedAtUtc = nowUtc;
        ExpiresAtUtc = nowUtc.Add(Lifetime);
    }

    public Guid Id { get; private set; }

    /// <summary>Jetonun SHA-256 özeti (jetonun kendisi saklanmaz).</summary>
    public string TokenHash { get; private set; } = string.Empty;

    public Guid TenantId { get; private set; }

    /// <summary>Jetonu alan kurum yetkilisi.</summary>
    public Guid UserId { get; private set; }

    /// <summary>Jetonun bağlı olduğu ödeme kaydı (Maydanoz yalnız bu ödemenin sayfasında bozdurur).</summary>
    public string CheckoutRef { get; private set; } = string.Empty;

    public DateTime CreatedAtUtc { get; private set; }

    public DateTime ExpiresAtUtc { get; private set; }

    public DateTime? ConsumedAtUtc { get; private set; }

    /// <summary>Tek kullanım: süresi dolmamış ve bozdurulmamışsa bozdurur.</summary>
    public bool TryConsume(DateTime nowUtc)
    {
        if (ConsumedAtUtc is not null || ExpiresAtUtc <= nowUtc) return false;
        ConsumedAtUtc = nowUtc;
        return true;
    }
}
