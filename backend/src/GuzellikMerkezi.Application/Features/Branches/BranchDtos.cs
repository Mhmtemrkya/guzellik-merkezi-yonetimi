namespace GuzellikMerkezi.Application.Features.Branches;

/// <summary><see cref="StaffCount"/> elle girilen kapasite DEĞİL, şubeye kayıtlı aktif personel sayısıdır (canlı sayım).</summary>
public sealed record BranchDto(Guid Id, Guid TenantId, string Name, string City, bool IsDefault, int StaffCount);
/// <param name="ConfirmedChargeTRY">
/// Şube ücretliyse (şube başına paket + aktif ücretli dönem) kullanıcının teklif ekranında ONAYLADIĞI
/// KDV dahil tutar. Yoksa ya da güncel teklifle tutmazsa çekim yapılmaz, 409 BranchChargeRequired döner.
/// Güncellemede (PUT) yok sayılır.
/// </param>
public sealed record UpsertBranchRequest(string Name, string City, bool IsDefault, decimal? ConfirmedChargeTRY = null);

/// <summary>
/// Şube silinmeden önce (18 Kas 2026): şubenin kayıtları (silinmez, seçilen şubeye aktarılır) ve paket tutarına etkisi.
/// <paramref name="Blocker"/> doluysa silinemez (varsayılan ya da tek şube).
/// </summary>
public sealed record BranchDeletePreviewDto(
    Guid Id,
    string Name,
    bool CanDelete,
    string? Blocker,
    int Customers,
    int Staff,
    int Users,
    int Appointments,
    int UpcomingAppointments,
    int Sales,
    GuzellikMerkezi.Application.Features.Billing.BranchImpactDto? Impact);

/// <summary>Şube silme: kayıtların aktarılacağı şube (aynı kurumun silinmeyen başka bir şubesi).</summary>
public sealed record DeleteBranchRequest(Guid TargetBranchId);

/// <summary>Silinen şube, kayıtların aktarıldığı şube ve aktarılan satır sayısı.</summary>
public sealed record BranchDeleteResultDto(Guid DeletedBranchId, Guid TargetBranchId, int MovedRecords);
