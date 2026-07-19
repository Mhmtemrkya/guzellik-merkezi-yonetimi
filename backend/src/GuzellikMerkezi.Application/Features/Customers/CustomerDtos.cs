using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Customers;

public sealed record CustomerDto(Guid Id, Guid TenantId, Guid BranchId, string FullName, string Phone, string? Email, DateOnly? BirthDate, Gender Gender, bool KvkkConsent, string? Notes, string? PhotoUrl = null, bool IsBlacklisted = false, string? BlacklistReason = null, DateTime CreatedAtUtc = default, bool IsVip = false);
public sealed record UpsertCustomerRequest(Guid BranchId, string FullName, string Phone, string? Email, DateOnly? BirthDate, Gender Gender, bool KvkkConsent, string? Notes, string? PhotoUrl = null);

public sealed record SetBlacklistRequest(bool Blacklisted, string? Reason);

public sealed record SetVipRequest(bool Vip);

/// <summary>Pasif müşteri — uzun süredir randevu/paket işlemi olmayan.</summary>
public sealed record PassiveCustomerDto(Guid Id, Guid BranchId, string FullName, string Phone, string? Email, DateTime? LastActivityUtc, int DaysSinceActivity);
public sealed record PassiveCustomerListDto(int ThresholdDays, IReadOnlyCollection<PassiveCustomerDto> Items);

public sealed record SetPassiveThresholdRequest(int Days);
public sealed record PassiveThresholdDto(int Days);

/// <summary>
/// Arama (tel:) başlatmak için ham telefon. Personel numarayı ekranda maskeli görür ama
/// cihazdan arayabilsin diye bu uç ham numarayı döner; her çağrı audit log'a yazılır.
/// </summary>
public sealed record CustomerDialDto(Guid Id, string FullName, string Phone);

/// <summary>Gün bazında yeni müşteri sayısı (dashboard "Yeni Danışanlar" trendleri).</summary>
public sealed record CustomerDailyCountDto(string Date, int Count);

/// <summary>
/// Dashboard müşteri istatistikleri — tüm müşteri listesini istemciye çekmeden
/// (sınırsız ölçek) sayaç ve trend verir.
/// </summary>
public sealed record CustomerStatsDto(
    int Total,
    int BirthdayThisMonth,
    int KvkkPending,
    int Blacklisted,
    IReadOnlyCollection<CustomerDailyCountDto> NewByDay);
