namespace GuzellikMerkezi.Application.Features.Staff;

public sealed record StaffDto(
    Guid Id,
    Guid TenantId,
    Guid BranchId,
    Guid? TenantUserId,
    string FullName,
    string Title,
    string? Phone,
    string? Specialties,
    decimal? CommissionRate,
    bool IsActive,
    string? Email,
    IReadOnlyCollection<string> Permissions,
    string? PhotoUrl = null,
    decimal? AverageRating = null,
    int RatingCount = 0);

/// <summary>
/// Personel oluşturma — istek tarafı. Email yoksa sistem otomatik oluşturur (slug + ad).
/// </summary>
public sealed record CreateStaffRequest(
    Guid BranchId,
    string FullName,
    string Title,
    string? Phone,
    string? Specialties,
    decimal? CommissionRate,
    bool IsActive,
    string? Email,
    IReadOnlyCollection<string>? Permissions);

/// <summary>
/// Personel güncelleme — email/şifre değişmez, sadece HR alanları ve izinler.
/// </summary>
public sealed record UpdateStaffRequest(
    string FullName,
    string Title,
    string? Phone,
    string? Specialties,
    decimal? CommissionRate,
    bool IsActive,
    IReadOnlyCollection<string>? Permissions,
    string? PhotoUrl = null);

/// <summary>Personeli başka şubeye aktarma isteği (çok şubeli kurum).</summary>
public sealed record TransferStaffBranchRequest(Guid BranchId);

/// <summary>
/// Personel oluşturulduğunda credentials response'u (yalnızca bu tek sefer döner).
/// Plaintext password sadece bu response'ta görünür, sonra hash'lenir.
/// </summary>
public sealed record StaffCredentialsDto(
    Guid StaffId,
    string FullName,
    string Email,
    string InitialPassword,
    string TenantName,
    string? BranchName,
    DateTime CreatedAtUtc);

public sealed record StaffWithCredentialsDto(StaffDto Staff, StaffCredentialsDto? Credentials);
