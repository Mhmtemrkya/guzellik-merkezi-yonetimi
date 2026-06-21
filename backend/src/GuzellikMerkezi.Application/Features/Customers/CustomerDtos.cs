using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Application.Features.Customers;

public sealed record CustomerDto(Guid Id, Guid TenantId, Guid BranchId, string FullName, string Phone, string? Email, DateOnly? BirthDate, Gender Gender, bool KvkkConsent, string? Notes, string? PhotoUrl = null, bool IsBlacklisted = false, string? BlacklistReason = null, DateTime CreatedAtUtc = default);
public sealed record UpsertCustomerRequest(Guid BranchId, string FullName, string Phone, string? Email, DateOnly? BirthDate, Gender Gender, bool KvkkConsent, string? Notes, string? PhotoUrl = null);

public sealed record SetBlacklistRequest(bool Blacklisted, string? Reason);

/// <summary>Pasif müşteri — uzun süredir randevu/paket işlemi olmayan.</summary>
public sealed record PassiveCustomerDto(Guid Id, Guid BranchId, string FullName, string Phone, string? Email, DateTime? LastActivityUtc, int DaysSinceActivity);
public sealed record PassiveCustomerListDto(int ThresholdDays, IReadOnlyCollection<PassiveCustomerDto> Items);

public sealed record SetPassiveThresholdRequest(int Days);
public sealed record PassiveThresholdDto(int Days);
