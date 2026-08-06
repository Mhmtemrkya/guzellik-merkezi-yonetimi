using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Auth;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <inheritdoc />
public sealed class ApprovalRequesterScope : IApprovalRequesterScope
{
    private readonly GuzellikDbContext _db;
    private readonly ITokenService _tokens;

    /// <summary>
    /// Kapsam token'ının ömrü. Replay aynı istek içinde loopback üzerinden hemen yapılır; token'ın
    /// bundan uzun yaşaması için hiçbir sebep yok — kaçarsa kullanılabileceği pencere dar kalsın.
    /// </summary>
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(2);

    public ApprovalRequesterScope(GuzellikDbContext db, ITokenService tokens)
    {
        _db = db;
        _tokens = tokens;
    }

    public async Task<Result<string>> CreateAccessTokenAsync(
        Guid tenantId, Guid requesterUserId, Guid? operationBranchId, Guid operationId, CancellationToken cancellationToken = default)
    {
        // Global süzgeçler atlanır: onay anında aktif şube kapsamı onaylayanınkidir, istek sahibinin
        // kaydı başka şubede olabilir ve "yok" sayılması sessiz bir başarısızlık üretirdi.
        var requester = await _db.TenantUsers.AsNoTracking().IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Id == requesterUserId && u.TenantId == tenantId && !u.IsDeleted, cancellationToken);

        // İSTEK SAHİBİ ARTIK YOKSA/PASİFSE ONAY UYGULANMAZ. Eskiden replay onaylayanın yetkisiyle
        // çalıştığı için, işten ayrılmış ya da erişimi kapatılmış personelin bekleyen isteği bile
        // uygulanabiliyordu.
        if (requester is null)
            return Result<string>.Failure(Error.Conflict("İsteği gönderen kullanıcı bulunamadı; onay uygulanamaz."));
        if (!requester.IsActive)
            return Result<string>.Failure(Error.Conflict("İsteği gönderen kullanıcının erişimi kapatılmış; onay uygulanamaz."));

        // ŞUBE KAPSAMI DEĞİŞMİŞSE UYGULANMAZ: istek hangi şubede açıldıysa orada geçerlidir.
        // Personel başka şubeye alındıysa bekleyen istek yeni şubede uygulanmamalı.
        if (operationBranchId is { } branchId && requester.BranchId != branchId)
        {
            return Result<string>.Failure(Error.Conflict(
                "İsteği gönderen kullanıcının şubesi değişmiş; onay uygulanamaz. İstek yeniden oluşturulmalı."));
        }

        // Profil GÜNCEL durumdan kurulur: izinler onay anındaki hâliyle uygulanır (izin geri
        // alındıysa replay uçtaki/servisteki kontrollere takılır — kimlik doğru olduğu için).
        var profile = UserProfileFactory.Build(requester, operationBranchId ?? requester.BranchId);
        var token = _tokens.CreateAccessToken(profile, DateTime.UtcNow.Add(Lifetime),
            new Dictionary<string, string> { [IApprovalReplayer.ReplayClaimType] = operationId.ToString() });

        return Result<string>.Success(token);
    }
}
