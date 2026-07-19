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
    public static string FeedToken(IConfiguration config, Guid staffId)
    {
        var secret = config["Jwt:SigningKey"] ?? "development-only-signing-key-change-me-min-32-bytes";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes($"ics-feed:{staffId:N}"));
        return Convert.ToHexString(hash)[..32].ToLowerInvariant();
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
            var baseUrl = $"{http.Request.Scheme}://{http.Request.Host}";
            return Results.Ok(new { url = $"{baseUrl}/api/calendar/staff/{staffId}/{token}.ics" });
        }).RequireAuthorization();

        return app;
    }
}
