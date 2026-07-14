using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Domain.Entities;

/// <summary>
/// Müşteri memnuniyet yıldızı. Randevu "tamamlandı" olarak işaretlenince üretilir ve QR ile müşteriye açılır.
/// Token <see cref="LinkLifetimeMinutes"/> dakika geçerlidir; müşteri tam telefonunu girip randevudaki numarayla
/// eşleşirse yıldız kaydedilir (Submitted) ve personel ortalamasına katılır. Süre dolarsa Expired olur.
/// Hile engeli: personel telefonu yalnızca maskeli görür; tam numarayı yalnızca müşteri bilir.
/// </summary>
public sealed class AppointmentRating : Entity
{
    public const int LinkLifetimeMinutes = 15;
    /// <summary>WhatsApp ile gönderilen otomatik değerlendirme linkinin ömrü (müşteri evde de puanlayabilsin).</summary>
    public const int WhatsAppLinkLifetimeMinutes = 24 * 60;

    private AppointmentRating() { }

    public AppointmentRating(
        Guid tenantId,
        Guid branchId,
        Guid appointmentId,
        Guid staffMemberId,
        Guid customerId,
        string customerPhone,
        string staffName,
        string? serviceName,
        string? businessName,
        DateTime nowUtc,
        int lifetimeMinutes = LinkLifetimeMinutes)
    {
        if (lifetimeMinutes < 1) throw new DomainException("Bağlantı süresi geçersiz.");
        if (nowUtc.Kind != DateTimeKind.Utc) throw new DomainException("Zaman UTC olmalı.");
        TenantId = tenantId;
        BranchId = branchId;
        AppointmentId = appointmentId;
        StaffMemberId = staffMemberId;
        CustomerId = customerId;
        CustomerPhone = NormalizePhone(customerPhone);
        StaffName = string.IsNullOrWhiteSpace(staffName) ? "Personel" : staffName.Trim();
        ServiceName = string.IsNullOrWhiteSpace(serviceName) ? null : serviceName.Trim();
        BusinessName = string.IsNullOrWhiteSpace(businessName) ? null : businessName.Trim();
        Token = Guid.NewGuid();
        Status = RatingStatus.Pending;
        ExpiresAtUtc = nowUtc.AddMinutes(lifetimeMinutes);
    }

    public Guid TenantId { get; private set; }
    public Guid BranchId { get; private set; }
    public Guid AppointmentId { get; private set; }
    public Guid StaffMemberId { get; private set; }
    public Guid CustomerId { get; private set; }

    /// <summary>Public puanlama linkinde kullanılan tahmin edilemez token.</summary>
    public Guid Token { get; private set; }

    /// <summary>Eşleştirme için normalize edilmiş (son 10 hane) müşteri telefonu. PII — şifreli saklanır.</summary>
    public string CustomerPhone { get; private set; } = string.Empty;
    public string StaffName { get; private set; } = string.Empty;
    public string? ServiceName { get; private set; }
    public string? BusinessName { get; private set; }

    public int Stars { get; private set; }
    /// <summary>Kurum (salon) yıldızı — eski kayıtlarda yoktur (null).</summary>
    public int? SalonStars { get; private set; }
    public string? Comment { get; private set; }
    public RatingStatus Status { get; private set; }
    public DateTime ExpiresAtUtc { get; private set; }
    public DateTime? SubmittedAtUtc { get; private set; }

    public bool IsExpiredAt(DateTime nowUtc) => Status == RatingStatus.Pending && nowUtc > ExpiresAtUtc;

    public bool PhoneMatches(string? enteredPhone)
    {
        var entered = NormalizePhone(enteredPhone);
        return CustomerPhone.Length > 0 && entered == CustomerPhone;
    }

    /// <summary>Telefon eşleşmesi doğrulandıktan sonra yıldızı kaydeder.</summary>
    public void Submit(int stars, int? salonStars, string? comment, DateTime nowUtc)
    {
        if (Status == RatingStatus.Submitted) throw new BusinessRuleException("Bu randevu için zaten puan verilmiş.");
        if (nowUtc > ExpiresAtUtc)
        {
            Status = RatingStatus.Expired;
            throw new BusinessRuleException("Puanlama bağlantısının süresi dolmuştur.");
        }
        if (stars is < 1 or > 5) throw new DomainException("Yıldız 1-5 aralığında olmalı.");
        if (salonStars is < 1 or > 5) throw new DomainException("Salon yıldızı 1-5 aralığında olmalı.");
        Stars = stars;
        SalonStars = salonStars;
        Comment = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim();
        Status = RatingStatus.Submitted;
        SubmittedAtUtc = nowUtc;
        Touch();
    }

    /// <summary>Süre dolduysa beklemedeki kaydı Expired'a çeker (public okuma sırasında çağrılır).</summary>
    public void MarkExpired()
    {
        if (Status == RatingStatus.Pending)
        {
            Status = RatingStatus.Expired;
            Touch();
        }
    }

    /// <summary>Son 2 hane görünür, gerisi maskeli (personel ekranı için).</summary>
    public string MaskedPhone()
    {
        var p = CustomerPhone;
        if (p.Length < 4) return "•••• •• ••";
        return $"0{new string('•', p.Length - 2)} {p[^2..]}";
    }

    /// <summary>Sadece rakamlar; son 10 haneyi alır (0 / +90 / ülke kodu farklarını eler).</summary>
    private static string NormalizePhone(string? phone)
    {
        if (string.IsNullOrWhiteSpace(phone)) return string.Empty;
        var digits = new string(phone.Where(char.IsDigit).ToArray());
        return digits.Length > 10 ? digits[^10..] : digits;
    }
}
