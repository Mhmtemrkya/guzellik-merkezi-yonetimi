using System.Security.Cryptography;
using System.Text;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Endpoints;

/// <summary>
/// Personel/kurum takvim beslemesi (iCalendar/ICS): Google, Apple ve Outlook "URL ile abone ol"
/// ile randevuları canlı gösterir.
///
/// <para>
/// GÜVENLİK: token artık global <c>Jwt:SigningKey</c>'den TÜRETİLMİYOR. Her besleme için 256 bit
/// rastgele token üretilir, DB'de yalnız SHA-256 özeti durur; süresi vardır, iptal ve rotasyon
/// edilebilir, son kullanım damgası tutulur (bkz. <see cref="CalendarFeedToken"/>). Eski türetilmiş
/// tokenlar mevcut abonelikler kırılmasın diye GEÇİCİ olarak kabul edilir —
/// <c>Calendar:AllowLegacyTokens=false</c> ile kapatılır (herkes bağlantısını yeniledikten sonra).
/// </para>
/// </summary>
public static class CalendarFeedEndpoints
{
    public static string FeedToken(IConfiguration config, Guid staffId) => HmacToken(config, $"ics-feed:{staffId:N}");
    public static string AppointmentsFeedToken(IConfiguration config, Guid tenantId) => HmacToken(config, $"ics-appts:{tenantId:N}");

    private static string HmacToken(IConfiguration config, string payload)
    {
        var secret = config["Jwt:SigningKey"] ?? "development-only-signing-key-change-me-min-32-bytes";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(payload));
        return Convert.ToHexString(hash)[..32].ToLowerInvariant();
    }

    /// <summary>
    /// ICS beslemesinin public URL tabanı. Öncelik: yapılandırılmış public domain
    /// (<c>Calendar:PublicBaseUrl</c> → <c>WhatsApp:PublicBaseUrl</c>) → ters proxy
    /// <c>X-Forwarded-Host</c>/<c>Proto</c> → istek host'u. Frontend proxy'si backend'e
    /// localhost ile ulaştığından ham istek host'u localhost olur; bu yüzden üretimde
    /// public domain yapılandırması gerekir (takvim uygulamaları yalnızca public URL'e erişir).
    /// </summary>
    public static string PublicBaseUrl(IConfiguration config, HttpContext http)
    {
        var configured = config["Calendar:PublicBaseUrl"] ?? config["WhatsApp:PublicBaseUrl"];
        if (!string.IsNullOrWhiteSpace(configured)) return configured.TrimEnd('/');

        if (http.Request.Headers.TryGetValue("X-Forwarded-Host", out var fwdHostValues))
        {
            var fwdHost = fwdHostValues.ToString().Split(',')[0].Trim();
            if (!string.IsNullOrWhiteSpace(fwdHost))
            {
                var proto = http.Request.Headers.TryGetValue("X-Forwarded-Proto", out var p) && !string.IsNullOrWhiteSpace(p)
                    ? p.ToString().Split(',')[0].Trim()
                    : http.Request.Scheme;
                return $"{proto}://{fwdHost}".TrimEnd('/');
            }
        }
        return $"{http.Request.Scheme}://{http.Request.Host}";
    }

    /// <summary>Eski (türetilmiş) tokenlar hâlâ kabul edilsin mi? Geçiş bitince false yapılmalı.</summary>
    private static bool LegacyTokensAllowed(IConfiguration config) =>
        !bool.TryParse(config["Calendar:AllowLegacyTokens"], out var allowed) || allowed;

    /// <summary>
    /// Gelen token'ı doğrular. Önce yeni model (özet eşleşmesi + süre + iptal), sonra —izin
    /// veriliyorsa— eski türetilmiş değer. Geçerliyse kullanım damgasını tazeler.
    /// </summary>
    private static async Task<bool> IsFeedTokenValidAsync(
        GuzellikDbContext db, IConfiguration config, string token, Guid tenantOrOwnerScopeId,
        CalendarFeedKind kind, Guid? staffMemberId, string legacyExpected, CancellationToken ct)
    {
        var hash = CalendarFeedToken.Hash(token);
        var row = await db.CalendarFeedTokens
            .FirstOrDefaultAsync(x => x.TokenHash == hash, ct);

        if (row is not null)
        {
            var now = DateTime.UtcNow;
            if (!row.IsUsable(now)) return false;
            // Token doğru kapsamda mı (başka personelin/kurumun beslemesine takılmasın)?
            if (row.Kind != kind || row.StaffMemberId != staffMemberId) return false;
            if (kind == CalendarFeedKind.Appointments && row.TenantId != tenantOrOwnerScopeId) return false;

            if (row.TouchUsage(now)) await db.SaveChangesAsync(ct);
            return true;
        }

        return LegacyTokensAllowed(config)
            && string.Equals(token, legacyExpected, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Kurum/personel için aktif token varsa döner (ham değeri bilinmez, yalnız üst veri).</summary>
    private static Task<CalendarFeedToken?> ActiveTokenAsync(
        GuzellikDbContext db, Guid tenantId, CalendarFeedKind kind, Guid? staffMemberId, CancellationToken ct) =>
        db.CalendarFeedTokens
            .Where(x => x.TenantId == tenantId && x.Kind == kind && x.StaffMemberId == staffMemberId
                        && x.RevokedAtUtc == null && x.ExpiresAtUtc > DateTime.UtcNow)
            .OrderByDescending(x => x.CreatedAtUtc)
            .FirstOrDefaultAsync(ct);

    /// <summary>Mevcut aktif tokenları iptal edip yenisini üretir; ham değeri döner.</summary>
    private static async Task<string> RotateAsync(
        GuzellikDbContext db, Guid tenantId, CalendarFeedKind kind, Guid? staffMemberId, Guid? actorId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var existing = await db.CalendarFeedTokens
            .Where(x => x.TenantId == tenantId && x.Kind == kind && x.StaffMemberId == staffMemberId && x.RevokedAtUtc == null)
            .ToListAsync(ct);
        foreach (var row in existing) row.Revoke(now);

        var (entity, raw) = CalendarFeedToken.Issue(tenantId, kind, staffMemberId, now, actorId);
        db.CalendarFeedTokens.Add(entity);
        await db.SaveChangesAsync(ct);
        return raw;
    }

    private static string IcsEscape(string s) =>
        s.Replace("\\", "\\\\").Replace(";", "\\;").Replace(",", "\\,").Replace("\n", "\\n");

    public static IEndpointRouteBuilder MapCalendarFeedEndpoints(this IEndpointRouteBuilder app)
    {
        // ANONİM uç: takvim uygulamaları kimlik doğrulaması yapamaz; güvenlik token'dadır.
        app.MapGet("/api/calendar/staff/{staffId:guid}/{token}.ics", async (
            Guid staffId, string token, IConfiguration config, GuzellikDbContext db, HttpContext http, CancellationToken ct) =>
        {
            var staffScope = await db.StaffMembers.IgnoreQueryFilters().AsNoTracking()
                .Where(s => s.Id == staffId && !s.IsDeleted).Select(s => s.TenantId).FirstOrDefaultAsync(ct);
            if (!await IsFeedTokenValidAsync(db, config, token, staffScope, CalendarFeedKind.Staff, staffId, FeedToken(config, staffId), ct))
                return Results.NotFound();

            var staff = await db.StaffMembers.IgnoreQueryFilters().AsNoTracking()
                .Where(s => s.Id == staffId && !s.IsDeleted)
                .Select(s => new { s.TenantId, s.FullName })
                .FirstOrDefaultAsync(ct);
            if (staff is null) return Results.NotFound();

            var fromUtc = DateTime.UtcNow.AddDays(-7);
            var toUtc = DateTime.UtcNow.AddDays(60);
            var appts = await db.Appointments.IgnoreQueryFilters().AsNoTracking()
                .Where(a => !a.IsDeleted && a.TenantId == staff.TenantId && a.StaffMemberId == staffId
                         && a.StartUtc >= fromUtc && a.StartUtc <= toUtc
                         && a.Status != AppointmentStatus.Cancelled
                         && a.Status != AppointmentStatus.NoShow
                         && a.Status != AppointmentStatus.Draft)
                .Select(a => new
                {
                    a.Id,
                    a.StartUtc,
                    a.EndUtc,
                    CustomerName = a.Customer != null ? a.Customer.FullName : "Müşteri",
                    ServiceName = a.ServiceDefinition != null ? a.ServiceDefinition.Name : "Hizmet",
                    a.Notes,
                })
                .OrderBy(a => a.StartUtc)
                .ToListAsync(ct);

            var sb = new StringBuilder();
            sb.AppendLine("BEGIN:VCALENDAR");
            sb.AppendLine("VERSION:2.0");
            sb.AppendLine("PRODID:-//BeautyAsist//Randevu Takvimi//TR");
            sb.AppendLine("CALSCALE:GREGORIAN");
            sb.AppendLine("METHOD:PUBLISH");
            sb.AppendLine($"X-WR-CALNAME:{IcsEscape($"BeautyAsist · {staff.FullName}")}");
            sb.AppendLine("X-WR-TIMEZONE:Europe/Istanbul");
            foreach (var a in appts)
            {
                sb.AppendLine("BEGIN:VEVENT");
                sb.AppendLine($"UID:{a.Id:N}@beautyasist");
                sb.AppendLine($"DTSTAMP:{DateTime.UtcNow:yyyyMMdd'T'HHmmss'Z'}");
                sb.AppendLine($"DTSTART:{DateTime.SpecifyKind(a.StartUtc, DateTimeKind.Utc):yyyyMMdd'T'HHmmss'Z'}");
                sb.AppendLine($"DTEND:{DateTime.SpecifyKind(a.EndUtc, DateTimeKind.Utc):yyyyMMdd'T'HHmmss'Z'}");
                sb.AppendLine($"SUMMARY:{IcsEscape($"{a.CustomerName} · {a.ServiceName}")}");
                // Randevu NOTU yazılmaz: anonim bir URL'e klinik/serbest metin taşımak veri
                // minimizasyonuna aykırı (link sızarsa not da sızar).
                sb.AppendLine("END:VEVENT");
            }
            sb.AppendLine("END:VCALENDAR");
            // Ara sunucular/tarayıcılar müşteri verisini saklamasın.
            http.Response.Headers.CacheControl = "private, no-store";
            return Results.Text(sb.ToString(), "text/calendar", Encoding.UTF8);
        }).AllowAnonymous();

        // Yönetici tarafı: personelin abonelik linkini üretir (web/mobil kopyalasın diye).
        app.MapGet("/api/admin/schedule/calendar-link/{staffId:guid}", async (
            Guid staffId, Guid? tenantId, ICurrentUser currentUser, IConfiguration config, GuzellikDbContext db, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            var exists = await db.StaffMembers.AsNoTracking()
                .AnyAsync(s => s.TenantId == resolvedTenantId && s.Id == staffId, ct);
            if (!exists) return Results.NotFound();

            var baseUrl = PublicBaseUrl(config, http);
            var active = await ActiveTokenAsync(db, resolvedTenantId, CalendarFeedKind.Staff, staffId, ct);
            if (active is not null)
            {
                // Ham token saklanmadığı için mevcut URL yeniden üretilemez — yalnız "yenile" sunulur.
                return Results.Ok(new { url = (string?)null, hasActiveLink = true, active.ExpiresAtUtc, active.LastUsedAtUtc });
            }

            var raw = await RotateAsync(db, resolvedTenantId, CalendarFeedKind.Staff, staffId, currentUser.UserId, ct);
            return Results.Ok(new
            {
                url = $"{baseUrl}/api/calendar/staff/{staffId}/{raw}.ics",
                hasActiveLink = true,
                ExpiresAtUtc = DateTime.UtcNow.Add(CalendarFeedToken.DefaultLifetime),
            });
        }).RequireAuthorization();

        // Bağlantıyı YENİLE: eski URL anında ölür, yeni URL bir kez döner.
        app.MapPost("/api/admin/schedule/calendar-link/{staffId:guid}/rotate", async (
            Guid staffId, Guid? tenantId, ICurrentUser currentUser, IConfiguration config, GuzellikDbContext db, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            var exists = await db.StaffMembers.AsNoTracking()
                .AnyAsync(s => s.TenantId == resolvedTenantId && s.Id == staffId, ct);
            if (!exists) return Results.NotFound();

            var raw = await RotateAsync(db, resolvedTenantId, CalendarFeedKind.Staff, staffId, currentUser.UserId, ct);
            var baseUrl = PublicBaseUrl(config, http);
            return Results.Ok(new
            {
                url = $"{baseUrl}/api/calendar/staff/{staffId}/{raw}.ics",
                hasActiveLink = true,
                ExpiresAtUtc = DateTime.UtcNow.Add(CalendarFeedToken.DefaultLifetime),
            });
        }).RequireAuthorization();

        // Bağlantıyı KAPAT: paylaşılan URL sızdıysa erişim anında kesilir.
        app.MapDelete("/api/admin/schedule/calendar-link/{staffId:guid}", async (
            Guid staffId, Guid? tenantId, ICurrentUser currentUser, GuzellikDbContext db, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            var rows = await db.CalendarFeedTokens
                .Where(x => x.TenantId == resolvedTenantId && x.Kind == CalendarFeedKind.Staff
                            && x.StaffMemberId == staffId && x.RevokedAtUtc == null)
                .ToListAsync(ct);
            foreach (var row in rows) row.Revoke(DateTime.UtcNow);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { revoked = rows.Count });
        }).RequireAuthorization();

        // ---- Kurum geneli randevu takvim beslemesi (randevular sayfası "aynı şekilde") ----

        // ANONİM uç: kurumun tüm (aktif) randevularını ICS olarak verir. Güvenlik token'da.
        app.MapGet("/api/calendar/appointments/{tenantId:guid}/{token}.ics", async (
            Guid tenantId, string token, IConfiguration config, GuzellikDbContext db, HttpContext http, CancellationToken ct) =>
        {
            if (!await IsFeedTokenValidAsync(db, config, token, tenantId, CalendarFeedKind.Appointments, null, AppointmentsFeedToken(config, tenantId), ct))
                return Results.NotFound();

            var tenant = await db.Tenants.IgnoreQueryFilters().AsNoTracking()
                .Where(t => t.Id == tenantId && !t.IsDeleted)
                .Select(t => new { t.Name })
                .FirstOrDefaultAsync(ct);
            if (tenant is null) return Results.NotFound();

            var fromUtc = DateTime.UtcNow.AddDays(-7);
            var toUtc = DateTime.UtcNow.AddDays(60);
            var appts = await db.Appointments.IgnoreQueryFilters().AsNoTracking()
                .Where(a => !a.IsDeleted && a.TenantId == tenantId
                         && a.StartUtc >= fromUtc && a.StartUtc <= toUtc
                         && a.Status != AppointmentStatus.Cancelled
                         && a.Status != AppointmentStatus.NoShow
                         && a.Status != AppointmentStatus.Draft)
                .Select(a => new
                {
                    a.Id,
                    a.StartUtc,
                    a.EndUtc,
                    CustomerName = a.Customer != null ? a.Customer.FullName : "Müşteri",
                    ServiceName = a.ServiceDefinition != null ? a.ServiceDefinition.Name : "Hizmet",
                    StaffName = a.StaffMember != null ? a.StaffMember.FullName : null,
                    a.Notes,
                })
                .OrderBy(a => a.StartUtc)
                .ToListAsync(ct);

            var sb = new StringBuilder();
            sb.AppendLine("BEGIN:VCALENDAR");
            sb.AppendLine("VERSION:2.0");
            sb.AppendLine("PRODID:-//BeautyAsist//Randevu Takvimi//TR");
            sb.AppendLine("CALSCALE:GREGORIAN");
            sb.AppendLine("METHOD:PUBLISH");
            sb.AppendLine($"X-WR-CALNAME:{IcsEscape($"BeautyAsist · {tenant.Name} · Randevular")}");
            sb.AppendLine("X-WR-TIMEZONE:Europe/Istanbul");
            foreach (var a in appts)
            {
                sb.AppendLine("BEGIN:VEVENT");
                sb.AppendLine($"UID:{a.Id:N}@beautyasist");
                sb.AppendLine($"DTSTAMP:{DateTime.UtcNow:yyyyMMdd'T'HHmmss'Z'}");
                sb.AppendLine($"DTSTART:{DateTime.SpecifyKind(a.StartUtc, DateTimeKind.Utc):yyyyMMdd'T'HHmmss'Z'}");
                sb.AppendLine($"DTEND:{DateTime.SpecifyKind(a.EndUtc, DateTimeKind.Utc):yyyyMMdd'T'HHmmss'Z'}");
                var summary = string.IsNullOrWhiteSpace(a.StaffName)
                    ? $"{a.CustomerName} · {a.ServiceName}"
                    : $"{a.CustomerName} · {a.ServiceName} ({a.StaffName})";
                sb.AppendLine($"SUMMARY:{IcsEscape(summary)}");
                // Randevu notu bilerek dışarıda bırakılır (bkz. yukarıdaki not).
                sb.AppendLine("END:VEVENT");
            }
            sb.AppendLine("END:VCALENDAR");
            // Ara sunucular/tarayıcılar müşteri verisini saklamasın.
            http.Response.Headers.CacheControl = "private, no-store";
            return Results.Text(sb.ToString(), "text/calendar", Encoding.UTF8);
        }).AllowAnonymous();

        // Yönetici tarafı: kurumun randevu abonelik linkini üretir (web/mobil kopyalasın diye).
        app.MapGet("/api/admin/schedule/appointments-calendar-link", async (
            Guid? tenantId, ICurrentUser currentUser, IConfiguration config, GuzellikDbContext db, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            var exists = await db.Tenants.IgnoreQueryFilters().AsNoTracking().AnyAsync(t => t.Id == resolvedTenantId && !t.IsDeleted, ct);
            if (!exists) return Results.NotFound();

            var baseUrl = PublicBaseUrl(config, http);
            var active = await ActiveTokenAsync(db, resolvedTenantId, CalendarFeedKind.Appointments, null, ct);
            if (active is not null)
                return Results.Ok(new { url = (string?)null, hasActiveLink = true, active.ExpiresAtUtc, active.LastUsedAtUtc });

            var raw = await RotateAsync(db, resolvedTenantId, CalendarFeedKind.Appointments, null, currentUser.UserId, ct);
            return Results.Ok(new
            {
                url = $"{baseUrl}/api/calendar/appointments/{resolvedTenantId}/{raw}.ics",
                hasActiveLink = true,
                ExpiresAtUtc = DateTime.UtcNow.Add(CalendarFeedToken.DefaultLifetime),
            });
        }).RequireAuthorization();

        app.MapPost("/api/admin/schedule/appointments-calendar-link/rotate", async (
            Guid? tenantId, ICurrentUser currentUser, IConfiguration config, GuzellikDbContext db, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            var raw = await RotateAsync(db, resolvedTenantId, CalendarFeedKind.Appointments, null, currentUser.UserId, ct);
            var baseUrl = PublicBaseUrl(config, http);
            return Results.Ok(new
            {
                url = $"{baseUrl}/api/calendar/appointments/{resolvedTenantId}/{raw}.ics",
                hasActiveLink = true,
                ExpiresAtUtc = DateTime.UtcNow.Add(CalendarFeedToken.DefaultLifetime),
            });
        }).RequireAuthorization();

        app.MapDelete("/api/admin/schedule/appointments-calendar-link", async (
            Guid? tenantId, ICurrentUser currentUser, GuzellikDbContext db, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            var rows = await db.CalendarFeedTokens
                .Where(x => x.TenantId == resolvedTenantId && x.Kind == CalendarFeedKind.Appointments
                            && x.StaffMemberId == null && x.RevokedAtUtc == null)
                .ToListAsync(ct);
            foreach (var row in rows) row.Revoke(DateTime.UtcNow);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { revoked = rows.Count });
        }).RequireAuthorization();

        return app;
    }
}
