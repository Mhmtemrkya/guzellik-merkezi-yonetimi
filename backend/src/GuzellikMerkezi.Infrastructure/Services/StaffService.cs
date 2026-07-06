using System.Security.Cryptography;
using System.Text;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Staff;
using GuzellikMerkezi.Application.Features.Usage;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class StaffService : IStaffService
{
    private readonly GuzellikDbContext _db;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IUsageService _usage;
    private readonly IAuditLogger _audit;

    public StaffService(GuzellikDbContext db, IPasswordHasher passwordHasher, IUsageService usage, IAuditLogger audit)
    {
        _db = db;
        _passwordHasher = passwordHasher;
        _usage = usage;
        _audit = audit;
    }

    public async Task<Result<PagedResult<StaffDto>>> ListAsync(Guid tenantId, PageRequest request, CancellationToken cancellationToken = default, Guid? tenantUserId = null)
    {
        var baseQuery = _db.StaffMembers.AsNoTracking().Where(x => x.TenantId == tenantId);
        if (tenantUserId.HasValue)
        {
            baseQuery = baseQuery.Where(x => x.TenantUserId == tenantUserId.Value);
        }

        int total;
        List<StaffMember> rows;
        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            // ŞİFRELİ alanlarda (ad/ünvan/uzmanlık) SQL `.Contains()` çalışmaz (ciphertext) → bellekte filtrele +
            // alfabetik sırala. Personel sayısı plan limitiyle çok düşük olduğundan maliyetsizdir.
            var search = request.Search.Trim();
            var all = await baseQuery.ToListAsync(cancellationToken);
            var filtered = all
                .Where(x => x.FullName.Contains(search, StringComparison.OrdinalIgnoreCase)
                            || x.Title.Contains(search, StringComparison.OrdinalIgnoreCase)
                            || (x.Specialties != null && x.Specialties.Contains(search, StringComparison.OrdinalIgnoreCase)))
                .OrderBy(x => x.FullName, StringComparer.OrdinalIgnoreCase)
                .ToList();
            total = filtered.Count;
            rows = filtered.Skip(request.Skip).Take(request.SafePageSize).ToList();
        }
        else
        {
            // FullName şifreli → SQL ORDER BY deterministik ama alfabetik değil; sayfalama tutarlı kalır.
            var ordered = baseQuery.OrderBy(x => x.FullName);
            total = await ordered.CountAsync(cancellationToken);
            rows = await ordered.Skip(request.Skip).Take(request.SafePageSize).ToListAsync(cancellationToken);
        }

        // TenantUser bilgisini ayrı çek (email + permissions)
        var userIds = rows.Where(r => r.TenantUserId.HasValue).Select(r => r.TenantUserId!.Value).Distinct().ToList();
        var userMap = userIds.Count == 0
            ? new Dictionary<Guid, (string Email, string? Permissions)>()
            : (await _db.TenantUsers.AsNoTracking()
                .Where(u => u.TenantId == tenantId)
                .Select(u => new { u.Id, u.Email, u.Permissions })
                .ToListAsync(cancellationToken))
                .Where(u => userIds.Contains(u.Id))
                .ToDictionary(u => u.Id, u => (u.Email, u.Permissions));

        var staffIds = rows.Select(r => r.Id).ToList();
        var ratingMap = await LoadRatingMapAsync(tenantId, staffIds, cancellationToken);

        var items = rows.Select(r =>
        {
            var (email, perms) = r.TenantUserId.HasValue && userMap.TryGetValue(r.TenantUserId.Value, out var u)
                ? u
                : (null!, null);
            ratingMap.TryGetValue(r.Id, out var ra);
            return r.ToDto(email, ParsePermissions(perms), ra.Avg, ra.Count);
        }).ToArray();

        return Result<PagedResult<StaffDto>>.Success(new PagedResult<StaffDto>(items, total, request.SafePage, request.SafePageSize));
    }

    public async Task<Result<StaffDto>> GetAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var staff = await _db.StaffMembers.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (staff is null) return Result<StaffDto>.Failure(Error.NotFound("Personel bulunamadı."));
        var (email, perms) = await GetCredentialsMetaAsync(tenantId, staff.TenantUserId, cancellationToken);
        var ratingMap = await LoadRatingMapAsync(tenantId, new List<Guid> { staff.Id }, cancellationToken);
        ratingMap.TryGetValue(staff.Id, out var ra);
        return Result<StaffDto>.Success(staff.ToDto(email, ParsePermissions(perms), ra.Avg, ra.Count));
    }

    public async Task<Result<StaffWithCredentialsDto>> CreateAsync(Guid tenantId, CreateStaffRequest request, CancellationToken cancellationToken = default)
    {
        var limit = await _usage.CheckLimitAsync(tenantId, "staff", cancellationToken);
        if (limit.IsFailure) return Result<StaffWithCredentialsDto>.Failure(limit.Error);

        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == tenantId, cancellationToken);
        if (tenant is null) return Result<StaffWithCredentialsDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        var branch = await _db.Branches.FirstOrDefaultAsync(b => b.TenantId == tenantId && b.Id == request.BranchId, cancellationToken);
        if (branch is null) return Result<StaffWithCredentialsDto>.Failure(Error.NotFound("Şube bulunamadı."));

        // ----- Email üretimi -----
        var rawEmail = string.IsNullOrWhiteSpace(request.Email)
            ? GenerateEmail(request.FullName, tenant.Slug)
            : request.Email.Trim().ToLowerInvariant();

        // Aynı email + tenant + Staff role'da kayıt var mı?
        var emailExists = await _db.TenantUsers
            .AnyAsync(u => u.TenantId == tenantId && u.Email == rawEmail && u.IsActive, cancellationToken);
        if (emailExists)
            return Result<StaffWithCredentialsDto>.Failure(Error.Conflict($"'{rawEmail}' adresiyle aktif bir personel zaten var."));

        // ----- Geçici şifre -----
        var initialPassword = GenerateTempPassword();
        var passwordHash = _passwordHasher.Hash(initialPassword);

        // İki aşamalı kayıt: önce TenantUser (parent), sonra StaffMember (FK'lı child).
        // EF Core save ordering, StaffMember.TenantUser navigation atanmadığı için
        // dependency çıkartamıyor ve FK ihlali atıyor; bu yüzden explicit transaction.
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);

        // ----- TenantUser oluştur ve kaydet -----
        var tenantUser = tenant.GrantAccess(rawEmail, UserRole.Staff, request.BranchId, request.FullName);
        tenantUser.SetTemporaryPassword(passwordHash); // MustChangePassword=true
        tenantUser.SetPermissions(request.Permissions);
        // TenantUser domain tarafında Guid.CreateVersion7 ile anahtar alıyor.
        // Var olan tenant navigation'ına ekleyip SaveChanges'e bırakınca EF bunu yeni kayıt
        // yerine Modified kabul edip UPDATE dener; MySQL'de 0 affected row => concurrency 500.
        // Yeni personel hesabı her zaman explicit Added olmalı.
        _db.TenantUsers.Add(tenantUser);
        await _db.SaveChangesAsync(cancellationToken);

        // ----- StaffMember oluştur ve kaydet -----
        var staff = new StaffMember(tenantId, request.BranchId, request.FullName, request.Title, request.Phone);
        staff.UpdateProfile(request.FullName, request.Title, request.Phone, request.Specialties);
        staff.SetCommissionRate(request.CommissionRate);
        if (!string.IsNullOrWhiteSpace(request.PhotoUrl)) staff.SetPhoto(request.PhotoUrl);
        if (!request.IsActive) staff.Deactivate();
        staff.LinkTenantUser(tenantUser.Id);

        _db.StaffMembers.Add(staff);
        await _db.SaveChangesAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        await _audit.LogAsync(tenantId, staff.BranchId, "Create", "Staff", staff.Id,
            $"Personel eklendi: {staff.FullName} ({rawEmail})",
            new { staff.FullName, staff.Title, Email = rawEmail, request.Permissions }, cancellationToken);

        var dto = staff.ToDto(rawEmail, request.Permissions ?? Array.Empty<string>());
        var credentials = new StaffCredentialsDto(
            staff.Id,
            staff.FullName,
            rawEmail,
            initialPassword,
            tenant.Name,
            branch.Name,
            DateTime.UtcNow);

        return Result<StaffWithCredentialsDto>.Success(new StaffWithCredentialsDto(dto, credentials));
    }

    public async Task<Result<StaffDto>> UpdateAsync(Guid tenantId, Guid id, UpdateStaffRequest request, CancellationToken cancellationToken = default)
    {
        var staff = await _db.StaffMembers.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (staff is null) return Result<StaffDto>.Failure(Error.NotFound("Personel bulunamadı."));

        staff.UpdateProfile(request.FullName, request.Title, request.Phone, request.Specialties);
        staff.SetCommissionRate(request.CommissionRate);
        if (request.PhotoUrl is not null) staff.SetPhoto(request.PhotoUrl);
        if (request.IsActive) staff.Activate(); else staff.Deactivate();

        // İzinleri güncelle (TenantUser tarafında)
        if (staff.TenantUserId.HasValue)
        {
            var tu = await _db.TenantUsers.FirstOrDefaultAsync(u => u.Id == staff.TenantUserId.Value, cancellationToken);
            if (tu is not null) tu.SetPermissions(request.Permissions);
        }

        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, staff.BranchId, "Update", "Staff", staff.Id,
            $"Personel güncellendi: {staff.FullName}",
            new { staff.FullName, staff.Title, request.Permissions }, cancellationToken);
        var (email, perms) = await GetCredentialsMetaAsync(tenantId, staff.TenantUserId, cancellationToken);
        return Result<StaffDto>.Success(staff.ToDto(email, ParsePermissions(perms)));
    }

    public async Task<Result> DeleteAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var staff = await _db.StaffMembers.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (staff is null) return Result.Failure(Error.NotFound("Personel bulunamadı."));

        // Bağlı TenantUser'ı da pasifleştir
        if (staff.TenantUserId.HasValue)
        {
            var tu = await _db.TenantUsers.FirstOrDefaultAsync(u => u.Id == staff.TenantUserId.Value, cancellationToken);
            tu?.Disable();
        }

        var snapshot = new { staff.FullName, staff.Title };
        staff.SoftDelete();
        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, staff.BranchId, "Delete", "Staff", staff.Id,
            $"Personel silindi: {staff.FullName}", snapshot, cancellationToken);
        return Result.Success();
    }

    public async Task<Result<StaffCredentialsDto>> ResetPasswordAsync(Guid tenantId, Guid id, CancellationToken cancellationToken = default)
    {
        var staff = await _db.StaffMembers.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (staff is null) return Result<StaffCredentialsDto>.Failure(Error.NotFound("Personel bulunamadı."));
        if (!staff.TenantUserId.HasValue) return Result<StaffCredentialsDto>.Failure(Error.NotFound("Personelin giriş hesabı yok."));

        var user = await _db.TenantUsers.FirstOrDefaultAsync(u => u.TenantId == tenantId && u.Id == staff.TenantUserId.Value && u.IsActive, cancellationToken);
        if (user is null) return Result<StaffCredentialsDto>.Failure(Error.NotFound("Personelin aktif giriş hesabı bulunamadı."));

        var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, cancellationToken);
        var branchName = await _db.Branches.AsNoTracking()
            .Where(b => b.TenantId == tenantId && b.Id == staff.BranchId)
            .Select(b => b.Name)
            .FirstOrDefaultAsync(cancellationToken);

        var tempPassword = GenerateTempPassword();
        user.SetTemporaryPassword(_passwordHasher.Hash(tempPassword)); // MustChangePassword=true

        // Aktif oturumları düşür: tüm geçerli refresh token'lar iptal edilir.
        var now = DateTime.UtcNow;
        var tokens = await _db.RefreshTokens
            .Where(t => t.TenantUserId == user.Id && t.RevokedAtUtc == null && t.ExpiresAtUtc > now)
            .ToListAsync(cancellationToken);
        foreach (var token in tokens) token.Revoke(now);

        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, staff.BranchId, "ResetPassword", "Staff", staff.Id,
            $"Personel şifresi sıfırlandı: {staff.FullName} ({user.Email})",
            new { staff.FullName, user.Email }, cancellationToken);

        return Result<StaffCredentialsDto>.Success(new StaffCredentialsDto(
            staff.Id,
            staff.FullName,
            user.Email,
            tempPassword,
            tenant?.Name ?? "Kurum",
            branchName,
            now));
    }

    public async Task<Result<StaffDto>> TransferBranchAsync(Guid tenantId, Guid id, Guid branchId, CancellationToken cancellationToken = default)
    {
        var staff = await _db.StaffMembers.FirstOrDefaultAsync(x => x.TenantId == tenantId && x.Id == id, cancellationToken);
        if (staff is null) return Result<StaffDto>.Failure(Error.NotFound("Personel bulunamadı."));

        var branch = await _db.Branches.FirstOrDefaultAsync(b => b.TenantId == tenantId && b.Id == branchId, cancellationToken);
        if (branch is null) return Result<StaffDto>.Failure(Error.NotFound("Hedef şube bulunamadı."));
        if (staff.BranchId == branchId) return Result<StaffDto>.Failure(Error.Validation("Personel zaten bu şubede."));

        var fromBranchId = staff.BranchId;
        staff.TransferToBranch(branchId);

        // Giriş hesabının şubesini de taşı ki personel yeni şubenin verisini görsün.
        if (staff.TenantUserId.HasValue)
        {
            var tu = await _db.TenantUsers.FirstOrDefaultAsync(u => u.Id == staff.TenantUserId.Value, cancellationToken);
            if (tu is not null) tu.ChangeScope(tu.Role, branchId);
        }

        await _db.SaveChangesAsync(cancellationToken);
        await _audit.LogAsync(tenantId, branchId, "TransferBranch", "Staff", staff.Id,
            $"Personel şubesi değişti: {staff.FullName} → {branch.Name}",
            new { staff.FullName, FromBranchId = fromBranchId, ToBranchId = branchId, ToBranch = branch.Name }, cancellationToken);

        var (email, perms) = await GetCredentialsMetaAsync(tenantId, staff.TenantUserId, cancellationToken);
        var ratingMap = await LoadRatingMapAsync(tenantId, new List<Guid> { staff.Id }, cancellationToken);
        ratingMap.TryGetValue(staff.Id, out var ra);
        return Result<StaffDto>.Success(staff.ToDto(email, ParsePermissions(perms), ra.Avg, ra.Count));
    }

    // ---- Helpers ----

    private async Task<Dictionary<Guid, (decimal? Avg, int Count)>> LoadRatingMapAsync(Guid tenantId, List<Guid> staffIds, CancellationToken ct)
    {
        if (staffIds.Count == 0) return new Dictionary<Guid, (decimal? Avg, int Count)>();
        // NOT: MySql.EntityFrameworkCore Guid listesi için sunucu tarafı IN (...) çeviremiyor
        // ('@staffIds ... does not have a type mapping'). Bu yüzden tenant+status ile çekip
        // staffId eşleşmesini ve ortalamayı bellekte yapıyoruz (dosyadaki userIds deseniyle aynı).
        var staffIdSet = staffIds.ToHashSet();
        var rows = await _db.AppointmentRatings.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.Status == RatingStatus.Submitted)
            .Select(x => new { x.StaffMemberId, x.Stars })
            .ToListAsync(ct);
        return rows
            .Where(x => staffIdSet.Contains(x.StaffMemberId))
            .GroupBy(x => x.StaffMemberId)
            .ToDictionary(
                g => g.Key,
                g => ((decimal?)Math.Round((decimal)g.Average(r => r.Stars), 1), g.Count()));
    }

    private async Task<(string? Email, string? Permissions)> GetCredentialsMetaAsync(Guid tenantId, Guid? tenantUserId, CancellationToken ct)
    {
        if (!tenantUserId.HasValue) return (null, null);
        var u = await _db.TenantUsers.AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.Id == tenantUserId.Value)
            .Select(x => new { x.Email, x.Permissions })
            .FirstOrDefaultAsync(ct);
        return (u?.Email, u?.Permissions);
    }

    private static IReadOnlyCollection<string> ParsePermissions(string? csv)
    {
        if (string.IsNullOrWhiteSpace(csv)) return Array.Empty<string>();
        return csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }

    private static string GenerateEmail(string fullName, string tenantSlug)
    {
        var firstName = (fullName ?? string.Empty).Trim().Split(' ').FirstOrDefault() ?? "personel";
        var slug = SlugifyName(firstName);
        var domain = SlugifyDomain(tenantSlug);
        return $"{slug}@{domain}.com";
    }

    private static string SlugifyName(string text)
    {
        var lowered = text
            .ToLower(System.Globalization.CultureInfo.InvariantCulture)
            .Replace("ı", "i").Replace("ş", "s").Replace("ç", "c")
            .Replace("ğ", "g").Replace("ü", "u").Replace("ö", "o")
            .Replace("İ", "i").Replace("Ş", "s").Replace("Ç", "c")
            .Replace("Ğ", "g").Replace("Ü", "u").Replace("Ö", "o");
        var sb = new StringBuilder();
        foreach (var c in lowered)
        {
            if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) sb.Append(c);
        }
        var slug = sb.ToString();
        return string.IsNullOrEmpty(slug) ? "personel" : slug;
    }

    private static string SlugifyDomain(string tenantSlug)
    {
        // tenant.Slug zaten URL-safe ama yine de güvenli yap
        var s = SlugifyName(tenantSlug ?? "kurum");
        return string.IsNullOrEmpty(s) ? "kurum" : s;
    }

    private static string GenerateTempPassword()
    {
        // 10 karakter: en az 1 büyük harf + 1 küçük + 1 rakam + 1 özel karakter
        const string upper = "ABCDEFGHJKLMNPRSTUVYZ";  // O, I, Q kaldırıldı (karışıklık)
        const string lower = "abcdefghijkmnpqrstuvwxyz";
        const string digits = "23456789";
        const string special = "@#$!*";

        var chars = new char[10];
        chars[0] = upper[RandomNumberGenerator.GetInt32(upper.Length)];
        chars[1] = lower[RandomNumberGenerator.GetInt32(lower.Length)];
        chars[2] = digits[RandomNumberGenerator.GetInt32(digits.Length)];
        chars[3] = special[RandomNumberGenerator.GetInt32(special.Length)];
        var all = upper + lower + digits;
        for (var i = 4; i < chars.Length; i++)
        {
            chars[i] = all[RandomNumberGenerator.GetInt32(all.Length)];
        }
        // Karıştır
        for (var i = chars.Length - 1; i > 0; i--)
        {
            var j = RandomNumberGenerator.GetInt32(i + 1);
            (chars[i], chars[j]) = (chars[j], chars[i]);
        }
        return new string(chars);
    }
}
