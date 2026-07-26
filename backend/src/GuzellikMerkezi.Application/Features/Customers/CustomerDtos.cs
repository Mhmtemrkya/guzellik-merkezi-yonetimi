using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Customers;

/// <summary>
/// Müşteri kartı. Liste uçlarında son 5 alan (Debt…AppointmentCount) SUNUCUDA, yalnızca o sayfanın
/// satırları için hesaplanır — istemci artık tüm cari/randevu listesini çekmez (1M müşteri ölçeği).
/// Tekil uçlarda bu alanlar 0/null kalır.
/// </summary>
public sealed record CustomerDto(
    Guid Id, Guid TenantId, Guid BranchId, string FullName, string Phone, string? Email, DateOnly? BirthDate,
    Gender Gender, bool KvkkConsent, string? Notes, string? PhotoUrl = null, bool IsBlacklisted = false,
    string? BlacklistReason = null, DateTime CreatedAtUtc = default, bool IsVip = false,
    decimal Debt = 0m, decimal TotalSpent = 0m, DateTime? LastVisitUtc = null,
    string? LastServiceName = null, int AppointmentCount = 0);

/// <summary>Müşteri listesi sekmesi (sunucu tarafı filtre).</summary>
public enum CustomerListFilter { All = 0, Vip, KvkkApproved, KvkkPending, Debt, Recent, Blacklist }

/// <summary>Müşteri listesi sıralaması. Ad ŞİFRELİ olduğundan alfabetik sıralama sunucuda yapılamaz.</summary>
public enum CustomerListSort { Recent = 0, Oldest, Debt, Spent, LastVisit }

/// <summary>Müşteri liste sorgusu — arama + sekme + sıralama + sayfalama.</summary>
public sealed record CustomerListQuery(
    int Page = 1,
    int PageSize = 20,
    string? Search = null,
    CustomerListFilter Filter = CustomerListFilter.All,
    CustomerListSort Sort = CustomerListSort.Recent);
public sealed record UpsertCustomerRequest(Guid BranchId, string FullName, string Phone, string? Email, DateOnly? BirthDate, Gender Gender, bool KvkkConsent, string? Notes, string? PhotoUrl = null);

public sealed record SetBlacklistRequest(bool Blacklisted, string? Reason);

/// <summary>Seçili müşterilere KVKK açık rıza mesajı gönderme isteği (toplu).</summary>
public sealed record SendKvkkRequestRequest(IReadOnlyCollection<Guid> CustomerIds);

/// <summary>
/// KVKK mesaj gönderim sonucu. Gönderim kalıcı kuyruğa yazıldığı için "Queued" istek anında
/// kesinleşir; zaten onaylı ya da telefonsuz kayıtlar sessizce atlanır ve burada raporlanır.
/// </summary>
public sealed record KvkkRequestResultDto(int Queued, int AlreadyApproved, int NoPhone);

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
    IReadOnlyCollection<CustomerDailyCountDto> NewByDay,
    // --- liste sayfası kartları (istemci tüm listeyi çekmeden) ---
    int Vip = 0,
    int NewLast90 = 0,
    int NewThisMonth = 0,
    int NewPrevMonth = 0,
    decimal TotalDebt = 0m,
    int DebtorCount = 0,
    decimal AvgSpent = 0m,
    string? TopAgeSegment = null,
    int TopAgeSegmentPercent = 0,
    /// <summary>Ortalama harcamanın hesaplandığı müşteri sayısı (harcaması olanlar) — kartın dayanağı.</summary>
    int SpenderCount = 0,
    /// <summary>Yaş segmentinin hesaplandığı müşteri sayısı (doğum tarihi girilmiş olanlar) — kartın dayanağı.</summary>
    int AgeKnownCount = 0);
