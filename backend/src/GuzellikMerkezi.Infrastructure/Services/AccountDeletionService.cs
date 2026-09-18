using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.AccountDeletion;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// HESAP SİLME — "Hesabımı sil" (bkz. <see cref="IAccountDeletionService"/>).
///
/// <para>
/// <b>KURUM SİLME ANINDA OLMAZ.</b> Talep kaydedilir, bekleme süresi işler, süre dolunca arka
/// plan tarayıcısı kurumu gerçekten siler (<c>TenantDeletionBackgroundService</c> →
/// <see cref="TenantPurge"/>). Anında silmek şu üç şeyi aynı anda yok ederdi: kullanıcının
/// fikrini değiştirme hakkı, verisini dışa aktarma fırsatı ve yanlış tıklamadan dönüş yolu.
/// </para>
///
/// <para>
/// <b>MÜŞTERİ SİLME ANINDA OLUR</b> ama satır SİLİNMEZ, anonimleştirilir. Müşteri satırı
/// randevu, adisyon, cari hesap ve tahsilatın bağlandığı düğümdür; silinmesi kapanmış kasaları
/// ve tahsilat defterini dayanaksız bırakırdı (bkz. <see cref="Customer.Anonymize"/>).
/// </para>
///
/// <para>
/// <b>DENETİM KAYDI HER İKİ YOLDA DA ZORUNLUDUR</b> ve <c>audit_logs</c> TenantPurge'ün
/// koruduğu tablodur: kurum satırı silinse bile kaydın kendisi kalır. Bu yüzden özet metnine
/// kurum ADI ve KODU yazılır — okuyan kişi, artık var olmayan bir kurumun kaydına baktığında
/// hangi kurum olduğunu anlayabilsin.
/// </para>
/// </summary>
public sealed class AccountDeletionService : IAccountDeletionService
{
    /// <summary>
    /// Kurum silinmeden önceki bekleme süresi (gün). <c>AccountDeletion:TenantGraceDays</c>.
    /// </summary>
    /// <remarks>
    /// Varsayılan 30 gün: yasal saklama yükümlülüğü olan bir işletmenin muhasebe verisini
    /// dışa aktarması, mali müşavirine danışması ve kararından dönmesi için makul bir süre.
    /// Ekrandaki metin bu sabitten beslenir — elle yazılsaydı süre değiştiğinde ekran yalan
    /// söylerdi.
    /// </remarks>
    private const int DefaultGraceDays = 30;

    private readonly GuzellikDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;
    private readonly ILogger<AccountDeletionService> _logger;

    public int GraceDays { get; }

    public AccountDeletionService(
        GuzellikDbContext db,
        ICurrentUser currentUser,
        IPasswordHasher passwordHasher,
        IAuditLogger audit,
        IDateTimeProvider clock,
        IConfiguration configuration,
        ILogger<AccountDeletionService> logger)
    {
        _db = db;
        _currentUser = currentUser;
        _passwordHasher = passwordHasher;
        _audit = audit;
        _clock = clock;
        _logger = logger;
        GraceDays = int.TryParse(configuration["AccountDeletion:TenantGraceDays"], out var days) && days >= 0
            ? days
            : DefaultGraceDays;
    }

    // ================================================================= KURUM

    public async Task<Result<TenantDeletionStatusDto>> GetTenantStatusAsync(CancellationToken ct = default)
    {
        var (tenant, failure) = await LoadOwnTenantAsync(ct);
        return failure is not null
            ? Result<TenantDeletionStatusDto>.Failure(failure)
            : Result<TenantDeletionStatusDto>.Success(ToStatus(tenant!));
    }

    public async Task<Result<TenantDeletionStatusDto>> RequestTenantDeletionAsync(
        RequestTenantDeletionRequest request, CancellationToken ct = default)
    {
        var (tenant, failure) = await LoadOwnTenantAsync(ct);
        if (failure is not null) return Result<TenantDeletionStatusDto>.Failure(failure);

        // YENİDEN KİMLİK DOĞRULAMA. Panelde açık kalmış bir oturum, tek tıkla tüm kurumu
        // silebilmemeli; parola işlemi hesabın gerçek sahibine bağlar.
        var user = await _db.TenantUsers.IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.Id == _currentUser.UserId!.Value && u.IsActive, ct);
        if (user is null)
            return Result<TenantDeletionStatusDto>.Failure(Error.Unauthorized("Kullanıcı bulunamadı."));

        if (string.IsNullOrWhiteSpace(request.Password) || !_passwordHasher.Verify(request.Password, user.PasswordHash))
            return Result<TenantDeletionStatusDto>.Failure(Error.Unauthorized("Parola hatalı."));

        // ONAY METNİ. Kullanıcı kurum kodunu ELLE yazar; "emin misiniz?" diyen bir kutuya
        // refleksle basılabilir, ama kodun yazılması niyeti kanıtlar.
        var phrase = ConfirmationPhrase(tenant!);
        if (!string.Equals(request.Confirmation?.Trim(), phrase, StringComparison.OrdinalIgnoreCase))
        {
            return Result<TenantDeletionStatusDto>.Failure(Error.Validation(
                $"Onaylamak için kutuya \"{phrase}\" yazın."));
        }

        if (tenant!.IsDeletionPending)
        {
            // İDEMPOTENS: talep zaten var. Hata dönmek yerine mevcut durumu veririz — tarih
            // İLERİ ALINMAZ (bkz. Tenant.RequestDeletion), yoksa her tıklama silmeyi ötelerdi.
            return Result<TenantDeletionStatusDto>.Success(ToStatus(tenant));
        }

        var now = _clock.UtcNow;
        tenant.RequestDeletion(now, GraceDays, user.Id, request.Reason);
        await _db.SaveChangesAsync(ct);

        await LogTenantAsync(tenant, user, "TenantDeletionRequested",
            $"Kurum silme talebi oluşturuldu ({tenant.Code ?? "kodsuz"}); veri {tenant.DeletionScheduledAtUtc:dd.MM.yyyy} tarihinde silinecek.",
            request.Reason, ct);

        _logger.LogWarning(
            "Kurum silme talebi: {Code} — {Scheduled:u} tarihinde silinecek.",
            tenant.Code, tenant.DeletionScheduledAtUtc);

        return Result<TenantDeletionStatusDto>.Success(ToStatus(tenant));
    }

    public async Task<Result<TenantDeletionStatusDto>> CancelTenantDeletionAsync(CancellationToken ct = default)
    {
        var (tenant, failure) = await LoadOwnTenantAsync(ct);
        if (failure is not null) return Result<TenantDeletionStatusDto>.Failure(failure);

        if (!tenant!.IsDeletionPending)
            return Result<TenantDeletionStatusDto>.Success(ToStatus(tenant));

        tenant.CancelDeletion(_currentUser.UserId);
        await _db.SaveChangesAsync(ct);

        var user = await _db.TenantUsers.IgnoreQueryFilters().AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == _currentUser.UserId!.Value, ct);
        await LogTenantAsync(tenant, user, "TenantDeletionCancelled",
            $"Kurum silme talebi geri alındı ({tenant.Code ?? "kodsuz"}).", null, ct);

        return Result<TenantDeletionStatusDto>.Success(ToStatus(tenant));
    }

    /// <summary>
    /// Oturumdaki kurumu yükler ve yetkiyi doğrular.
    /// </summary>
    /// <remarks>
    /// <b>YALNIZ KURUM YÖNETİCİSİ.</b> Şube yöneticisi ve personel kurumu silemez: hesap
    /// onların değil, kurumundur. Platform yöneticisi de bu uçtan silemez — onun yolu platform
    /// panelidir ve orada farklı kontroller vardır (bu uç "kendi hesabım" içindir).
    /// </remarks>
    private async Task<(Tenant? Tenant, Error? Failure)> LoadOwnTenantAsync(CancellationToken ct)
    {
        if (_currentUser.UserId is null || _currentUser.TenantId is null)
            return (null, Error.Unauthorized("Oturum bulunamadı."));

        if (_currentUser.Role != UserRole.InstitutionOwner)
        {
            return (null, Error.Forbidden(
                "Kurum hesabını yalnızca kurum yöneticisi silebilir. Personel erişimini yöneticiniz kapatabilir."));
        }

        var tenant = await _db.Tenants.IgnoreQueryFilters()
            .FirstOrDefaultAsync(t => t.Id == _currentUser.TenantId!.Value, ct);
        return tenant is null ? (null, Error.NotFound("Kurum bulunamadı.")) : (tenant, null);
    }

    /// <summary>Onay kutusuna yazılacak metin: kurum kodu; kod yoksa kurum adı.</summary>
    private static string ConfirmationPhrase(Tenant tenant) =>
        string.IsNullOrWhiteSpace(tenant.Code) ? tenant.Name : tenant.Code!;

    private TenantDeletionStatusDto ToStatus(Tenant tenant) => new(
        tenant.IsDeletionPending,
        tenant.DeletionRequestedAtUtc,
        tenant.DeletionScheduledAtUtc,
        tenant.DeletionReason,
        GraceDays,
        ConfirmationPhrase(tenant));

    /// <summary>
    /// Kurum silme olayını denetim kaydına yazar.
    /// </summary>
    /// <remarks>
    /// Özet metnine kurum ADI ve KODU yazılır: <c>audit_logs</c> kurum silindikten sonra da
    /// yaşar (TenantPurge.KeepTables) ama kurum satırı yaşamaz — ad yazılmazsa geriye yalnız
    /// çözülemeyen bir kimlik kalırdı.
    /// </remarks>
    private Task LogTenantAsync(Tenant tenant, TenantUser? user, string action, string summary, string? reason, CancellationToken ct)
        => _audit.LogActorAsync(
            tenant.Id, _currentUser.BranchId, user?.Id, user?.Email, user?.Role.ToString(),
            action, "Tenant", tenant.Id,
            $"{summary} Kurum: {tenant.Name}.",
            new
            {
                tenantId = tenant.Id,
                tenantName = tenant.Name,
                tenantCode = tenant.Code,
                requestedAtUtc = tenant.DeletionRequestedAtUtc,
                scheduledAtUtc = tenant.DeletionScheduledAtUtc,
                graceDays = GraceDays,
                reason,
            },
            _currentUser.IpAddress, ct);

    // ================================================================= MÜŞTERİ

    /// <summary>Müşterinin onay kutusuna yazması gereken metin.</summary>
    public const string CustomerConfirmationPhrase = "SİL";

    public async Task<Result<CustomerDeletionResultDto>> DeleteMyCustomerAccountAsync(
        DeleteCustomerAccountRequest request, CancellationToken ct = default)
    {
        var customerId = _currentUser.CustomerId ?? Guid.Empty;
        if (customerId == Guid.Empty)
            return Result<CustomerDeletionResultDto>.Failure(Error.Unauthorized("Bu işlem yalnızca müşteri hesabıyla yapılabilir."));

        // ONAY METNİ — müşteride parola yok (giriş e-posta koduyla yapılır), o yüzden niyetin
        // tek kanıtı elle yazılan metindir. Refleksle basılan bir "Sil" düğmesiyle kişisel
        // verinin geri alınamaz biçimde silinmesi kabul edilemez.
        if (!string.Equals(request.Confirmation?.Trim(), CustomerConfirmationPhrase, StringComparison.OrdinalIgnoreCase))
        {
            return Result<CustomerDeletionResultDto>.Failure(Error.Validation(
                $"Onaylamak için kutuya \"{CustomerConfirmationPhrase}\" yazın."));
        }

        var customer = await _db.Customers.IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.Id == customerId, ct);
        if (customer is null)
            return Result<CustomerDeletionResultDto>.Failure(Error.NotFound("Hesap bulunamadı."));

        var now = _clock.UtcNow;

        // DENETİM KAYDI ANONİMLEŞTİRMEDEN ÖNCE HAZIRLANIR: sonrasında ad ve e-posta artık yok.
        // Kayda kişisel veri YAZILMAZ (silme talebinin kaydı, sildiğimiz veriyi geri getiren bir
        // kopya olmamalı) — yalnız maskeli bir iz bırakılır.
        var maskedEmail = string.IsNullOrWhiteSpace(customer.Email) ? null : TenantTextHelper.MaskEmail(customer.Email);
        var maskedPhone = PhoneMask.Mask(customer.Phone);
        var tenantId = customer.TenantId;
        var branchId = customer.BranchId;

        customer.Anonymize(now);

        // OTURUMLARI KAPAT: kimliği silinmiş bir hesabın elindeki refresh token yaşamaya devam
        // ederse, silme "görünürde" olur — kişi 30 gün daha girip kendi boş kartını görür.
        await RevokeCustomerSessionsAsync(customerId, now, ct);

        await _db.SaveChangesAsync(ct);

        await _audit.LogActorAsync(
            tenantId, branchId, null, maskedEmail ?? maskedPhone, UserRole.Customer.ToString(),
            "CustomerAccountDeleted", "Customer", customerId,
            "Müşteri kendi hesabını sildi; kimlik bilgileri anonimleştirildi ve oturumları kapatıldı.",
            new
            {
                customerId,
                tenantId,
                maskedEmail,
                maskedPhone,
                anonymizedAtUtc = now,
                reason = request.Reason,
            },
            _currentUser.IpAddress, ct);

        _logger.LogInformation("Müşteri hesabı silindi (anonimleştirildi): {CustomerId}.", customerId);

        return Result<CustomerDeletionResultDto>.Success(new CustomerDeletionResultDto(now));
    }

    /// <summary>
    /// Müşterinin tüm refresh token'larını iptal eder.
    /// </summary>
    /// <remarks>
    /// <see cref="Security.SessionRevocation"/> KULLANILAMAZ: o, <c>TenantUser</c> üzerinden
    /// çalışır ve oturum damgasını orada ileri alır. Müşteri oturumları
    /// <c>RefreshToken.CustomerId</c>'ye bağlıdır — ayrı bir yol gerekir.
    /// </remarks>
    private async Task RevokeCustomerSessionsAsync(Guid customerId, DateTime nowUtc, CancellationToken ct)
    {
        var tokens = await _db.RefreshTokens
            .Where(t => t.CustomerId == customerId && t.RevokedAtUtc == null)
            .ToListAsync(ct);
        foreach (var token in tokens) token.Revoke(nowUtc);
    }
}
