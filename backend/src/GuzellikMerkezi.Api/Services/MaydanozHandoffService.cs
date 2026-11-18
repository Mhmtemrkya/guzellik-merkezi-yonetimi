using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Payments;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Services;

/// <summary>
/// MAYDANOZ'A OTURUMLU GEÇİŞ (kullanıcı isteği 18 Kas 2026: "Satın al'a basınca Maydanoz'un satın alma sayfasında form boş
/// oluyor; Maydanoz'da giriş yapmamış olabiliyor"). Panelden başlatılan bir Maydanoz ödemesinin yönlendirme adresine, o ödeme
/// kaydına bağlı tek kullanımlık bir jeton eklenir: <c>…/odeme/asist/beauty/{ref}#giris={jeton}</c>. Jeton adresin
/// <b>parça (#)</b> kısmındadır: sunucu günlüklerine ve Referer başlığına girmez; Maydanoz sayfası onu imzalı bağlayıcıyla
/// (<c>POST /accounts/handoff</c>) bozdurur ve kurumun hesabıyla oturum açar.
/// <para>
/// Yalnız KURUM YETKİLİSİNE verilir (Maydanoz hesabı kurum yetkilisinindir). Jeton sunucuda tek yerde, ödeme başlatan üç
/// uçta eklenir (paket, açık fatura, kredi): web, mobil ve eski mobil sürümler istemci değişikliği olmadan yararlanır.
/// Jeton eklenemezse yönlendirme olduğu gibi kalır; Maydanoz sayfası girişi ister (oturumsuz ödeme başlamaz).
/// </para>
/// </summary>
public sealed partial class MaydanozHandoffService(GuzellikDbContext db, IConfiguration configuration)
{
    /// <summary>Adres parçasındaki anahtar: <c>#giris=…</c>.</summary>
    public const string Fragment = "giris";

    [GeneratedRegex("^/odeme/asist/[a-z0-9-]{1,32}/(?<ref>[0-9a-f]{32})$", RegexOptions.CultureInvariant, 100)]
    private static partial Regex PagePath();

    public static string Hash(string token) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    /// <summary>
    /// Ödeme başarıyla başladıysa ve yönlendirme Maydanoz'un ödeme sayfasıysa, kurum yetkilisine jeton ekler; aksi hâlde sonucu
    /// olduğu gibi döner.
    /// </summary>
    public async Task<Result<CheckoutStartedDto>> AttachAsync(Result<CheckoutStartedDto> started, ICurrentUser user, Guid tenantId, CancellationToken ct)
    {
        if (started.IsFailure || started.Value!.RedirectUrl is not { } url
            || ReferenceOf(url, configuration[PaymentGatewayResolver.MaydanozSiteUrlKey]) is not { } reference
            || user.IsPlatformAdmin || user.Role != UserRole.InstitutionOwner || user.UserId is not { } userId)
        {
            return started;
        }

        // Ödeme kaydı bu kurumun olmalı; jeton alan kişi bu kurumun etkin yetkilisi olmalı (çoklu kurum yetkilisinde e-postayla).
        if (!await db.ExternalCheckouts.AsNoTracking().AnyAsync(c => c.PublicRef == reference && c.TenantId == tenantId, ct)
            || await OwnerAsync(userId, user.Email, tenantId, ct) is not { } ownerId)
        {
            return started;
        }

        var now = DateTime.UtcNow;
        await PurgeExpiredAsync(now, ct);
        var token = Base64Url(RandomNumberGenerator.GetBytes(32));
        db.MaydanozHandoffs.Add(new MaydanozHandoff(Hash(token), tenantId, ownerId, reference, now));
        await db.SaveChangesAsync(ct);
        return Result<CheckoutStartedDto>.Success(started.Value with { RedirectUrl = $"{url}#{Fragment}={token}" });
    }

    /// <summary>Adres, yapılandırılmış Maydanoz sitesinin Asist ödeme sayfasıysa ödeme anahtarını döner.</summary>
    public static string? ReferenceOf(string url, string? siteUrl) =>
        Uri.TryCreate(url, UriKind.Absolute, out var target)
        && Uri.TryCreate(siteUrl, UriKind.Absolute, out var site)
        && target.Scheme == site.Scheme
        && string.Equals(target.Authority, site.Authority, StringComparison.OrdinalIgnoreCase)
        && target.Query.Length == 0 && target.Fragment.Length == 0
        && PagePath().Match(target.AbsolutePath) is { Success: true } match
            ? match.Groups["ref"].Value
            : null;

    private async Task<Guid?> OwnerAsync(Guid userId, string? email, Guid tenantId, CancellationToken ct)
    {
        var owners = db.TenantUsers.IgnoreQueryFilters().AsNoTracking()
            .Where(u => u.TenantId == tenantId && u.IsActive && !u.IsDeleted && u.Role == UserRole.InstitutionOwner);
        if (await owners.Where(u => u.Id == userId).Select(u => (Guid?)u.Id).FirstOrDefaultAsync(ct) is { } own) return own;
        var normalized = TenantTextHelper.NormalizeEmail(email);
        return normalized.Length == 0
            ? null
            : await owners.Where(u => u.Email == normalized).Select(u => (Guid?)u.Id).FirstOrDefaultAsync(ct);
    }

    /// <summary>Bir günden eski jetonlar silinir (ham SQL + LIMIT: MariaDB takma adlı DELETE'i reddeder).</summary>
    private async Task PurgeExpiredAsync(DateTime now, CancellationToken ct)
    {
        if (!db.Database.IsRelational()) return;
        await db.Database.ExecuteSqlRawAsync(
            "DELETE FROM `maydanoz_handoffs` WHERE `ExpiresAtUtc` < {0} LIMIT 200", [now.AddDays(-1)], ct);
    }

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
