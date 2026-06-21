using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Application.Features.Staff;

public interface IStaffService
{
    Task<Result<PagedResult<StaffDto>>> ListAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default, Guid? tenantUserId = null);
    Task<Result<StaffDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    Task<Result<StaffWithCredentialsDto>> CreateAsync(Guid tenantId, CreateStaffRequest request, CancellationToken cancellationToken = default);
    Task<Result<StaffDto>> UpdateAsync(Guid tenantId, Guid id, UpdateStaffRequest request, CancellationToken cancellationToken = default);
    Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    /// <summary>Personelin şifresini sıfırlar: yeni geçici şifre üretilir, ilk girişte değişim zorunlu olur, aktif oturumları düşer.</summary>
    Task<Result<StaffCredentialsDto>> ResetPasswordAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default);
    /// <summary>Personeli başka şubeye aktarır (çok şubeli kurum). Bağlı giriş hesabının şubesi de güncellenir.</summary>
    Task<Result<StaffDto>> TransferBranchAsync(Guid tenantId, Guid id, Guid branchId, CancellationToken cancellationToken = default);
}
