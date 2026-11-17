namespace GuzellikMerkezi.Application.Features.Branches;

/// <summary><see cref="StaffCount"/> elle girilen kapasite DEĞİL, şubeye kayıtlı aktif personel sayısıdır (canlı sayım).</summary>
public sealed record BranchDto(Guid Id, Guid TenantId, string Name, string City, bool IsDefault, int StaffCount);
/// <param name="ConfirmedChargeTRY">
/// Şube ücretliyse (şube başına paket + aktif ücretli dönem) kullanıcının teklif ekranında ONAYLADIĞI
/// KDV dahil tutar. Yoksa ya da güncel teklifle tutmazsa çekim yapılmaz, 409 BranchChargeRequired döner.
/// Güncellemede (PUT) yok sayılır.
/// </param>
public sealed record UpsertBranchRequest(string Name, string City, bool IsDefault, decimal? ConfirmedChargeTRY = null);
