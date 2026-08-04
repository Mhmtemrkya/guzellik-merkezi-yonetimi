namespace GuzellikMerkezi.Application.Features.Branches;

/// <summary><see cref="StaffCount"/> elle girilen kapasite DEĞİL, şubeye kayıtlı aktif personel sayısıdır (canlı sayım).</summary>
public sealed record BranchDto(Guid Id, Guid TenantId, string Name, string City, bool IsDefault, int StaffCount);
public sealed record UpsertBranchRequest(string Name, string City, bool IsDefault);
