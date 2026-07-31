using System.Security.Cryptography;
using System.Text;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>Beslemenin kapsamı: tek personelin takvimi mi, kurumun tüm randevuları mı.</summary>
public enum CalendarFeedKind
{
    Staff = 0,
    Appointments = 1,
}

/// <summary>
/// ANONİM ICS TAKVİM BESLEMESİ İÇİN TOKEN.
///
/// <para>
/// Eski model: token, global <c>Jwt:SigningKey</c>'den sabit bir payload üzerinden HMAC ile
/// TÜRETİLİYORDU. Sonuç: süre yok, iptal yok, rotasyon yok, kullanım izi yok. URL bir kez sızarsa
/// (tarayıcı geçmişi, sunucu access log'u, takvim sağlayıcısı, paylaşım) global anahtar
/// değişene kadar geçerli kalıyor ve müşteri adı/hizmet/randevu saatlerini anonim veriyordu.
/// </para>
///
/// <para>
/// Yeni model: her besleme için 256 bit RASTGELE token üretilir; DB'de yalnız <b>SHA-256 özeti</b>
/// saklanır (sızan bir yedek tokenları vermez). Ham değer sadece oluşturma/rotasyon yanıtında
/// döner. Süre dolabilir, iptal edilebilir, rotasyonda eski URL anında ölür.
/// </para>
/// </summary>
public sealed class CalendarFeedToken : Entity
{
    private CalendarFeedToken() { }

    private CalendarFeedToken(Guid tenantId, CalendarFeedKind kind, Guid? staffMemberId, string tokenHash, DateTime expiresAtUtc, Guid? createdBy)
    {
        TenantId = tenantId;
        Kind = kind;
        StaffMemberId = staffMemberId;
        TokenHash = tokenHash;
        ExpiresAtUtc = expiresAtUtc;
        CreatedBy = createdBy;
    }

    public Guid TenantId { get; private set; }
    public CalendarFeedKind Kind { get; private set; }

    /// <summary>Personel beslemesinde ilgili personel; kurum geneli beslemede null.</summary>
    public Guid? StaffMemberId { get; private set; }

    /// <summary>Ham token'ın SHA-256 özeti (hex). Ham değer HİÇBİR zaman saklanmaz.</summary>
    public string TokenHash { get; private set; } = string.Empty;

    public DateTime ExpiresAtUtc { get; private set; }
    public DateTime? RevokedAtUtc { get; private set; }

    /// <summary>Son kullanım — sızıntı şüphesinde "bu bağlantı hâlâ çekiliyor mu" sorusunu yanıtlar.</summary>
    public DateTime? LastUsedAtUtc { get; private set; }

    public bool IsUsable(DateTime utcNow) => RevokedAtUtc is null && ExpiresAtUtc > utcNow;

    /// <summary>Varsayılan ömür: takvim abonelikleri uzun yaşar, ama sonsuz değil.</summary>
    public static readonly TimeSpan DefaultLifetime = TimeSpan.FromDays(180);

    /// <summary>
    /// Yeni token üretir. Dönen ham değeri ÇAĞIRAN kullanıcıya bir kez gösterir; kayıtta yalnız özet durur.
    /// </summary>
    public static (CalendarFeedToken Entity, string RawToken) Issue(
        Guid tenantId, CalendarFeedKind kind, Guid? staffMemberId, DateTime utcNow, Guid? createdBy)
    {
        var raw = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var entity = new CalendarFeedToken(tenantId, kind, staffMemberId, Hash(raw), utcNow.Add(DefaultLifetime), createdBy);
        return (entity, raw);
    }

    public static string Hash(string rawToken) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(rawToken.Trim().ToLowerInvariant()))).ToLowerInvariant();

    public void Revoke(DateTime utcNow)
    {
        if (RevokedAtUtc is not null) return;
        RevokedAtUtc = utcNow;
        Touch(utcNow);
    }

    /// <summary>Kullanım damgası — her istekte değil, saatte bir güncellenir (gereksiz yazma olmasın).</summary>
    public bool TouchUsage(DateTime utcNow)
    {
        if (LastUsedAtUtc is { } last && utcNow - last < TimeSpan.FromHours(1)) return false;
        LastUsedAtUtc = utcNow;
        return true;
    }
}
