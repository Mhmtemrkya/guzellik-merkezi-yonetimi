namespace GuzellikMerkezi.Application.Features.Branches;

public sealed record BranchDto(Guid Id, Guid TenantId, string Name, string City, bool IsDefault, int StaffCount, int RoomCount);
public sealed record UpsertBranchRequest(string Name, string City, bool IsDefault, int StaffCount, int RoomCount);
