using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.Notifications;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Exceptions;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace GuzellikMerkezi.Infrastructure.Services;

/// <summary>
/// Kurumun kendi SMS hesabı (Verimor / Netgsm) — kaydetme, test SMS'iyle doğrulama, kaldırma ve
/// gönderim anında kimlik bilgisinin çözülmesi. Ücret/yol kararı WhatsAppBillingService'tedir
/// (<c>IsOwnSmsAccountActiveAsync</c>); burada yalnız bağlantının kendisi yönetilir.
/// </summary>
public sealed class TenantSmsConnectionService : ITenantSmsConnectionService
{
    /// <summary>
    /// Aynı kurumdan iki test SMS'i arasındaki en kısa süre. Test kurumun KENDİ hesabından ücretlidir;
    /// çift tıklama ya da tekrar eden istek ikinci SMS'i göndermesin.
    /// </summary>
    internal static readonly TimeSpan TestCooldown = TimeSpan.FromSeconds(20);

    /// <summary>Tek parçaya (Unicode 70 karakter) sığan test metni.</summary>
    public const string TestMessage = "BeautyAsist: SMS hesabınız başarıyla bağlandı.";

    /// <summary>Sağlayıcı panelinde izin verilecek sunucu IP'si (Verimor OİM / Netgsm IP kısıtı).</summary>
    public const string ServerIpConfigKey = "Messaging:ServerOutboundIp";

    /// <summary>
    /// Paketinde SMS olmayan kuruma hesap bağlanamaz: bağlansa "Bağlı" görünür ama her gönderim
    /// "SMS paketinizde yok" ile reddedilirdi (gönderim yolundaki paket kapısı kendi hesapta da geçerli).
    /// </summary>
    public const string SmsFeatureMissingMessage =
        "Bu kurumun paketinde SMS yok. SMS hesabı bağlamak için önce SMS içeren bir pakete geçirin.";

    private readonly GuzellikDbContext _db;
    private readonly IPlatformMessagingService _messaging;
    private readonly IFeatureService _features;
    private readonly IConfiguration _config;
    private readonly ILogger<TenantSmsConnectionService> _logger;

    public TenantSmsConnectionService(GuzellikDbContext db, IPlatformMessagingService messaging, IFeatureService features,
        IConfiguration config, ILogger<TenantSmsConnectionService> logger)
    {
        _db = db;
        _messaging = messaging;
        _features = features;
        _config = config;
        _logger = logger;
    }

    public async Task<Result<SmsConnectionDto>> GetAsync(Guid tenantId, bool canManage, CancellationToken ct = default)
    {
        var row = await FindAsync(tenantId, track: false, ct);
        return Result<SmsConnectionDto>.Success(await BuildDtoAsync(tenantId, row, canManage, ct));
    }

    public async Task<Result<IReadOnlyList<PlatformSmsConnectionDto>>> ListAsync(CancellationToken ct = default)
    {
        // İKİ SORGU: kurumlar (+ paket) ve bağlantılar. Kurum başına özellik sorgusu yapılmaz;
        // paketin SMS içerip içermediği plan CSV'sinden okunur (FeatureService'in kuralıyla aynı).
        var tenants = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
            .Where(t => !t.IsDeleted)
            .Select(t => new
            {
                t.Id,
                t.Name,
                t.Phone,
                PlanName = t.SubscriptionPlan != null ? t.SubscriptionPlan.Name : null,
                PlanFeatures = t.SubscriptionPlan != null ? t.SubscriptionPlan.Features : null,
            })
            .ToListAsync(ct);

        var rows = await _db.TenantSmsConnections.IgnoreQueryFilters().AsNoTracking()
            .Where(x => !x.IsDeleted)
            .ToListAsync(ct);
        var byTenant = rows.ToDictionary(x => x.TenantId);
        var serverIp = ServerIp();

        var list = tenants.Select(t =>
        {
            byTenant.TryGetValue(t.Id, out var row);
            var smsAllowed = PlanHasSms(t.PlanFeatures);
            return new PlatformSmsConnectionDto(t.Id, t.Name, t.PlanName,
                ToDto(row, canManage: true, serverIp, t.Phone, smsAllowed));
        }).OrderBy(x => x.TenantName, StringComparer.Create(new System.Globalization.CultureInfo("tr-TR"), ignoreCase: true)).ToList();

        return Result<IReadOnlyList<PlatformSmsConnectionDto>>.Success(list);
    }

    public async Task<Result<SmsConnectionDto>> SaveAsync(Guid tenantId, SaveSmsConnectionRequest r, CancellationToken ct = default)
    {
        // Yanlış/silinmiş kurum kimliği yetim kimlik bilgisi satırı üretmesin.
        var tenantExists = await _db.Tenants.IgnoreQueryFilters().AsNoTracking().AnyAsync(t => t.Id == tenantId && !t.IsDeleted, ct);
        if (!tenantExists) return Result<SmsConnectionDto>.Failure(Error.NotFound("Kurum bulunamadı."));

        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.NotificationsSms, ct))
            return Result<SmsConnectionDto>.Failure(Error.Conflict(SmsFeatureMissingMessage));

        string provider;
        try { provider = TenantSmsConnection.CanonicalProvider(r.Provider); }
        catch (DomainException ex) { return Result<SmsConnectionDto>.Failure(Error.Validation(ex.Message)); }

        var username = string.IsNullOrWhiteSpace(r.Username) ? null : r.Username.Trim();
        var password = string.IsNullOrWhiteSpace(r.Password) ? null : r.Password.Trim();
        var sender = (r.Sender ?? string.Empty).Trim();

        var error = ValidateSender(sender)
                    ?? (username is null ? null : ValidateUsername(provider, username))
                    ?? (password is { Length: > 128 } ? "API parolası en fazla 128 karakter olabilir." : null);
        if (error is not null) return Result<SmsConnectionDto>.Failure(Error.Validation(error));

        var row = await FindAsync(tenantId, track: true, ct);
        if (row is null)
        {
            if (username is null)
                return Result<SmsConnectionDto>.Failure(Error.Validation(provider == TenantSmsConnection.Verimor
                    ? "Verimor abone numaranızı (kullanıcı adı) girin."
                    : "Netgsm kullanıcı kodunuzu girin."));
            if (password is null)
                return Result<SmsConnectionDto>.Failure(Error.Validation("SMS hesabınızın API parolasını girin."));
            row = new TenantSmsConnection(tenantId, provider, username, password, sender, r.Enabled);
            _db.TenantSmsConnections.Add(row);
        }
        else
        {
            row.Update(provider, username, password, sender, r.Enabled);
        }

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // İki sekmeden aynı anda ilk kayıt: benzersiz TenantId indeksi ikinciyi reddeder.
            return Result<SmsConnectionDto>.Failure(Error.Conflict(
                "SMS hesabı aynı anda başka bir yerden kaydedildi. Sayfayı yenileyip tekrar deneyin."));
        }
        return Result<SmsConnectionDto>.Success(await BuildDtoAsync(tenantId, row, canManage: true, ct));
    }

    public async Task<Result<SmsConnectionTestResultDto>> TestAsync(Guid tenantId, TestSmsConnectionRequest r, CancellationToken ct = default)
    {
        if (!await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.NotificationsSms, ct))
            return Result<SmsConnectionTestResultDto>.Failure(Error.Conflict(SmsFeatureMissingMessage));

        var row = await FindAsync(tenantId, track: true, ct);
        if (row is null)
            return Result<SmsConnectionTestResultDto>.Failure(Error.Validation("Önce SMS hesabı bilgilerinizi kaydedin."));

        var phone = new string((r.Phone ?? string.Empty).Where(char.IsDigit).ToArray());
        if (!IsTurkishMobile(phone))
            return Result<SmsConnectionTestResultDto>.Failure(Error.Validation("Test SMS'i için geçerli bir cep telefonu girin (5XX XXX XX XX)."));

        var now = DateTime.UtcNow;
        if (row.LastTestAtUtc is { } last && now - last < TestCooldown)
        {
            var wait = Math.Max(1, (int)Math.Ceiling((TestCooldown - (now - last)).TotalSeconds));
            return Result<SmsConnectionTestResultDto>.Failure(Error.Conflict($"Yeni test için {wait} saniye bekleyin."));
        }

        // Damga sağlayıcıdan ÖNCE yazılır: yanıt beklenirken gelen ikinci istek ikinci SMS'i göndermesin.
        row.RecordTestStarted(now);
        await _db.SaveChangesAsync(ct);

        var account = new SmsAccountCredentials(row.Provider, row.Username, row.Password, row.Sender);
        var result = await _messaging.SendSmsWithAccountAsync(account, phone, TestMessage, ct);
        var ok = result.Success && !result.Simulated;
        if (!ok)
            _logger.LogInformation("Kurum {TenantId} SMS hesabı testi başarısız ({Provider}): {Error}", tenantId, row.Provider, result.Error);

        // Sonuç, istemci bağlantıyı kopardıysa bile yazılır (SMS sağlayıcıya gitmiş olabilir).
        row.RecordTest(ok, ok ? null : result.Error, DateTime.UtcNow);
        await _db.SaveChangesAsync(CancellationToken.None);

        var dto = await BuildDtoAsync(tenantId, row, canManage: true, CancellationToken.None);
        return Result<SmsConnectionTestResultDto>.Success(new SmsConnectionTestResultDto(ok, ok ? null : row.LastError, dto));
    }

    public async Task<Result<SmsConnectionDto>> DisconnectAsync(Guid tenantId, CancellationToken ct = default)
    {
        var row = await FindAsync(tenantId, track: true, ct);
        if (row is not null)
        {
            // GERÇEK SİLME: şifreli kimlik bilgisi tabloda kalmasın; yeniden bağlamada benzersiz
            // TenantId indeksi silinmiş satırla çakışmasın.
            _db.HardDeleteEnabled = true;
            try
            {
                _db.TenantSmsConnections.Remove(row);
                await _db.SaveChangesAsync(ct);
            }
            finally
            {
                _db.HardDeleteEnabled = false;
            }
        }
        return Result<SmsConnectionDto>.Success(await BuildDtoAsync(tenantId, null, canManage: true, ct));
    }

    public async Task<SmsAccountCredentials?> ResolveActiveAsync(Guid tenantId, CancellationToken ct = default)
    {
        var row = await FindAsync(tenantId, track: false, ct);
        return row is { IsActive: true }
            ? new SmsAccountCredentials(row.Provider, row.Username, row.Password, row.Sender)
            : null;
    }

    /// <summary>
    /// FİLTRE AŞILIR, TenantId AÇIKÇA SÜZÜLÜR: gönderim arka plan işlerinden kurum kapsamı olmadan da
    /// çağrılır; filtreli DbSet orada satırı bulamaz ve SMS sessizce platformdan giderdi.
    /// </summary>
    private Task<TenantSmsConnection?> FindAsync(Guid tenantId, bool track, CancellationToken ct)
    {
        var query = _db.TenantSmsConnections.IgnoreQueryFilters().Where(x => x.TenantId == tenantId && !x.IsDeleted);
        if (!track) query = query.AsNoTracking();
        return query.FirstOrDefaultAsync(ct);
    }

    private async Task<SmsConnectionDto> BuildDtoAsync(Guid tenantId, TenantSmsConnection? row, bool canManage, CancellationToken ct)
    {
        // Önerilen test numarası (kurumun iletişim telefonu) yalnız yöneten kullanıcıya (platform) gider.
        string? suggestedPhone = null;
        if (canManage)
        {
            suggestedPhone = await _db.Tenants.IgnoreQueryFilters().AsNoTracking()
                .Where(t => t.Id == tenantId).Select(t => t.Phone).FirstOrDefaultAsync(ct);
        }

        var smsFeatureAllowed = await _features.IsFeatureAllowedAsync(tenantId, FeatureCatalog.NotificationsSms, ct);
        return ToDto(row, canManage, ServerIp(), suggestedPhone, smsFeatureAllowed);
    }

    private static SmsConnectionDto ToDto(TenantSmsConnection? row, bool canManage, string? serverIp, string? suggestedPhone, bool smsFeatureAllowed)
    {
        var status = row is null ? "NotConnected"
            : !row.Enabled ? "Disabled"
            : row.VerifiedAtUtc is not null ? "Connected"
            : row.LastError is not null ? "Failed"
            : "PendingTest";

        return new SmsConnectionDto(
            status,
            row?.IsActive == true,
            row?.Provider,
            row?.UsernameHint,
            !string.IsNullOrEmpty(row?.Password),
            row?.Sender,
            row?.Enabled ?? false,
            row?.VerifiedAtUtc,
            row?.LastTestAtUtc,
            row?.LastError,
            canManage,
            serverIp,
            canManage && !string.IsNullOrWhiteSpace(suggestedPhone) ? suggestedPhone : null,
            TenantSmsConnection.SupportedProviders,
            smsFeatureAllowed);
    }

    private string? ServerIp()
    {
        var ip = _config[ServerIpConfigKey];
        return string.IsNullOrWhiteSpace(ip) ? null : ip.Trim();
    }

    /// <summary>Plan CSV'sinde SMS özelliği var mı? (Paketsiz kurum = yok; canlıdaki fail-closed kural.)</summary>
    private static bool PlanHasSms(string? features) =>
        !string.IsNullOrWhiteSpace(features)
        && features.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(f => string.Equals(f, FeatureCatalog.NotificationsSms, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Gönderici: BTK'da kayıtlı alfasayısal başlık (çoğunlukla en çok 11 karakter) ya da numara.
    /// Kesin kuralı sağlayıcı uygular; burada yalnız bariz hatalar ve bozuk karakterler elenir.
    /// </summary>
    private static string? ValidateSender(string sender)
    {
        if (sender.Length < 2) return "Gönderici başlığını girin (sağlayıcınızda kayıtlı başlık ya da numara).";
        if (sender.Length > 16) return "Gönderici başlığı en fazla 16 karakter olabilir.";
        if (!sender.All(c => char.IsLetterOrDigit(c) || c is ' ' or '.' or '-' or '+'))
            return "Gönderici başlığında yalnız harf, rakam, boşluk, nokta ve tire kullanılabilir.";
        return null;
    }

    private static string? ValidateUsername(string provider, string username)
    {
        if (username.Length > 40 || username.Any(char.IsWhiteSpace)) return "Kullanıcı adı geçersiz.";
        if (provider == TenantSmsConnection.Verimor)
        {
            // Verimor kullanıcı adı abone numarasıdır (908501234567); 0850… ve +90… biçimleri gönderimde 90… yapılır.
            var digits = username.TrimStart('+');
            if (!digits.All(char.IsDigit) || digits.Length is < 10 or > 12)
                return "Verimor kullanıcı adı abone numaranızdır (ör. 908501234567).";
        }
        return null;
    }

    /// <summary>Türkiye cep numarası: 5XXXXXXXXX, 05XXXXXXXXX ya da 905XXXXXXXXX.</summary>
    private static bool IsTurkishMobile(string digits) =>
        (digits.Length == 10 && digits[0] == '5')
        || (digits.Length == 11 && digits.StartsWith("05", StringComparison.Ordinal))
        || (digits.Length == 12 && digits.StartsWith("905", StringComparison.Ordinal));
}
