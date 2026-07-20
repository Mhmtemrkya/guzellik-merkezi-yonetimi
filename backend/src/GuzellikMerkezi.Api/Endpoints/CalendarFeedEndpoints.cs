using System.Security.Cryptography;
using System.Text;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Endpoints;

/// <summary>
/// Personel takvim beslemesi (iCalendar/ICS): Google Takvim / Apple Takvim / Outlook
/// "URL ile abone ol" ile personelin randevularını canlı gösterir. Token, sunucu sırrından
/// (Jwt:SigningKey) HMAC ile türetilir — DB alanı/migration gerekmez, URL tahmin edilemez.
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

    private static string IcsEscape(string s) =>
        s.Replace("\\", "\\\\").Replace(";", "\\;").Replace(",", "\\,").Replace("\n", "\\n");

    public static IEndpointRouteBuilder MapCalendarFeedEndpoints(this IEndpointRouteBuilder app)
    {
        // ANONİM uç: takvim uygulamaları kimlik doğrulaması yapamaz; güvenlik token'dadır.
        app.MapGet("/api/calendar/staff/{staffId:guid}/{token}.ics", async (
            Guid staffId, string token, IConfiguration config, GuzellikDbContext db, HttpContext http, CancellationToken ct) =>
        {
            if (!string.Equals(token, FeedToken(config, staffId), StringComparison.OrdinalIgnoreCase))
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
                if (!string.IsNullOrWhiteSpace(a.Notes))
                    sb.AppendLine($"DESCRIPTION:{IcsEscape(a.Notes!)}");
                sb.AppendLine("END:VEVENT");
            }
            sb.AppendLine("END:VCALENDAR");
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
            var token = FeedToken(config, staffId);
            var baseUrl = PublicBaseUrl(config, http);
            return Results.Ok(new { url = $"{baseUrl}/api/calendar/staff/{staffId}/{token}.ics" });
        }).RequireAuthorization();

        // ---- Kurum geneli randevu takvim beslemesi (randevular sayfası "aynı şekilde") ----

        // ANONİM uç: kurumun tüm (aktif) randevularını ICS olarak verir. Güvenlik token'da.
        app.MapGet("/api/calendar/appointments/{tenantId:guid}/{token}.ics", async (
            Guid tenantId, string token, IConfiguration config, GuzellikDbContext db, HttpContext http, CancellationToken ct) =>
        {
            if (!string.Equals(token, AppointmentsFeedToken(config, tenantId), StringComparison.OrdinalIgnoreCase))
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
                if (!string.IsNullOrWhiteSpace(a.Notes))
                    sb.AppendLine($"DESCRIPTION:{IcsEscape(a.Notes!)}");
                sb.AppendLine("END:VEVENT");
            }
            sb.AppendLine("END:VCALENDAR");
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
            var token = AppointmentsFeedToken(config, resolvedTenantId);
            var baseUrl = PublicBaseUrl(config, http);
            return Results.Ok(new { url = $"{baseUrl}/api/calendar/appointments/{resolvedTenantId}/{token}.ics" });
        }).RequireAuthorization();

        return app;
    }
}
