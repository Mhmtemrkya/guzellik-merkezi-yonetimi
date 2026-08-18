using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// SELF-SERVİS KAYITTA E-POSTA/TELEFON TEKİLLİĞİNİN <b>VERİTABANI</b> GARANTİSİ.
///
/// <para>
/// <b>Neden ayrı tablo?</b> Uygulama içindeki "önce sor, sonra yaz" kontrolü eşzamanlı iki isteği
/// birlikte geçirebiliyordu: ikisi de "kayıtlı değil" görüp iki kurum açıyordu. Son söz
/// veritabanında olmalı — tıpkı kurum kodunda (<c>Tenant.Code</c>) olduğu gibi.
/// </para>
///
/// <para>
/// <b>Neden <c>tenant_users.Email</c>'e UNIQUE konmadı?</b> Aynı e-postanın BİRDEN ÇOK kurumda
/// bulunması bu sistemde desteklenen ve test edilen bir özelliktir (çoklu kurum yöneticisi;
/// bkz. MultiTenantLoginTests). Oraya global bir UNIQUE koymak çalışan bir özelliği kırardı.
/// Kısıt bu yüzden YALNIZCA self-servis kayıt yoluna özel bu tabloda durur; platform panelinden
/// kurum açma yolu etkilenmez.
/// </para>
///
/// <para>
/// Kurum silinince satır da silinir (<c>TenantId</c> taşıdığı için TenantPurge kapsamındadır) ve
/// e-posta/telefon yeniden kullanılabilir hâle gelir.
/// </para>
/// </summary>
public sealed class TenantSignupReservation : Entity
{
    private TenantSignupReservation() { }

    public TenantSignupReservation(Guid tenantId, string emailKey, string phoneKey)
    {
        if (tenantId == Guid.Empty) throw new DomainException("Rezervasyon için kurum zorunlu.");
        if (string.IsNullOrWhiteSpace(emailKey)) throw new DomainException("E-posta anahtarı zorunlu.");
        if (string.IsNullOrWhiteSpace(phoneKey)) throw new DomainException("Telefon anahtarı zorunlu.");
        TenantId = tenantId;
        EmailKey = emailKey.Trim().ToLowerInvariant();
        PhoneKey = phoneKey.Trim();
    }

    public Guid TenantId { get; private set; }

    /// <summary>Normalize edilmiş e-posta (küçük harf). ŞİFRELENMEZ — UNIQUE indeks gerekiyor.</summary>
    public string EmailKey { get; private set; } = string.Empty;

    /// <summary>
    /// Telefonun blind index'i (HMAC) — ham numara DEĞİL.
    /// Tekillik kontrolü için eşitlik yeterli; numaranın kendisi burada tutulmaz.
    /// </summary>
    public string PhoneKey { get; private set; } = string.Empty;
}
