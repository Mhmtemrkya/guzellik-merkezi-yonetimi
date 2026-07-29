using GuzellikMerkezi.Api.Authorization;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Reports;
using GuzellikMerkezi.Domain;

namespace GuzellikMerkezi.Api.Endpoints;

/// <summary>
/// Raporlar sayfasının uçları. Hepsi aynı sorgu sözleşmesini paylaşır:
/// <c>?fromUtc=&amp;toUtc=&amp;compareFromUtc=&amp;compareToUtc=&amp;granularity=</c>
/// — böylece "1 Temmuz – 2 Eylül" aralığını "2 yıl önceki aynı aralık" ile kıyaslamak tek
/// parametre değişikliğidir. Karşılaştırma parametreleri boş bırakılırsa "önceki" değerler 0 döner.
/// </summary>
public static class ReportsEndpoints
{
    public static IEndpointRouteBuilder MapReportsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/admin/reports")
            .WithTags("Reports")
            .RequireAuthorization()
            .RequirePermission(Permissions.Reports);

        group.MapGet("/summary", (Guid? tenantId, DateTime? fromUtc, DateTime? toUtc, DateTime? compareFromUtc, DateTime? compareToUtc,
                string? granularity, ICurrentUser currentUser, IReportsService service, HttpContext http, CancellationToken ct) =>
            Run(currentUser, tenantId, http, (id, range) => service.GetSummaryAsync(id, range, ct),
                fromUtc, toUtc, compareFromUtc, compareToUtc, granularity));

        // Çoklu dönem karşılaştırması: ?periods=<fromIso>~<toIso>~<etiket> (tekrarlanabilir, 2–6 adet).
        // GET kullanılır — /api/admin yazma istekleri personelde StaffApprovalGate'e takılıp taslağa düşer.
        group.MapGet("/compare", async (Guid? tenantId, string[] periods, string? granularity,
            ICurrentUser currentUser, IReportsService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);

            var parsed = ParsePeriods(periods);
            if (parsed.Count == 0)
            {
                return Results.BadRequest(Application.Common.ApiResponse<object>.Fail(
                    "Validation",
                    "Geçerli dönem yok. Biçim: periods=<başlangıçISO>~<bitişISO>~<etiket>",
                    http.TraceIdentifier));
            }

            return (await service.GetCompareAsync(resolvedTenantId, parsed, granularity, ct)).ToHttpResult(http);
        });

        group.MapGet("/catalog", (Guid? tenantId, DateTime? fromUtc, DateTime? toUtc, DateTime? compareFromUtc, DateTime? compareToUtc,
                string? granularity, ICurrentUser currentUser, IReportsService service, HttpContext http, CancellationToken ct) =>
            Run(currentUser, tenantId, http, (id, range) => service.GetCatalogAsync(id, range, ct),
                fromUtc, toUtc, compareFromUtc, compareToUtc, granularity));

        group.MapGet("/staff", (Guid? tenantId, DateTime? fromUtc, DateTime? toUtc, DateTime? compareFromUtc, DateTime? compareToUtc,
                string? granularity, ICurrentUser currentUser, IReportsService service, HttpContext http, CancellationToken ct) =>
            Run(currentUser, tenantId, http, (id, range) => service.GetStaffAsync(id, range, ct),
                fromUtc, toUtc, compareFromUtc, compareToUtc, granularity));

        group.MapGet("/branches", (Guid? tenantId, DateTime? fromUtc, DateTime? toUtc, DateTime? compareFromUtc, DateTime? compareToUtc,
                string? granularity, ICurrentUser currentUser, IReportsService service, HttpContext http, CancellationToken ct) =>
            Run(currentUser, tenantId, http, (id, range) => service.GetBranchesAsync(id, range, ct),
                fromUtc, toUtc, compareFromUtc, compareToUtc, granularity));

        group.MapGet("/customers", (Guid? tenantId, DateTime? fromUtc, DateTime? toUtc, DateTime? compareFromUtc, DateTime? compareToUtc,
                string? granularity, ICurrentUser currentUser, IReportsService service, HttpContext http, CancellationToken ct) =>
            Run(currentUser, tenantId, http, (id, range) => service.GetCustomersAsync(id, range, ct),
                fromUtc, toUtc, compareFromUtc, compareToUtc, granularity));

        group.MapGet("/inventory", (Guid? tenantId, DateTime? fromUtc, DateTime? toUtc, DateTime? compareFromUtc, DateTime? compareToUtc,
                string? granularity, ICurrentUser currentUser, IReportsService service, HttpContext http, CancellationToken ct) =>
            Run(currentUser, tenantId, http, (id, range) => service.GetInventoryAsync(id, range, ct),
                fromUtc, toUtc, compareFromUtc, compareToUtc, granularity));

        return app;
    }

    /// <summary>
    /// "2026-01-01T00:00:00Z~2027-01-01T00:00:00Z~2026" biçimindeki dönem parametrelerini çözer.
    /// Etiket verilmezse tarih aralığından üretilir; bozuk satırlar sessizce atlanır.
    /// </summary>
    private static List<ComparePeriodRequest> ParsePeriods(string[]? periods)
    {
        var result = new List<ComparePeriodRequest>();
        foreach (var raw in periods ?? [])
        {
            if (string.IsNullOrWhiteSpace(raw)) continue;
            var parts = raw.Split('~', 3);
            if (parts.Length < 2) continue;
            if (!DateTime.TryParse(parts[0], null, System.Globalization.DateTimeStyles.RoundtripKind, out var from)) continue;
            if (!DateTime.TryParse(parts[1], null, System.Globalization.DateTimeStyles.RoundtripKind, out var to)) continue;

            var label = parts.Length > 2 && !string.IsNullOrWhiteSpace(parts[2])
                ? parts[2].Trim()
                : $"{from:dd.MM.yyyy} – {to.AddDays(-1):dd.MM.yyyy}";
            result.Add(new ComparePeriodRequest(label, from, to));
        }
        return result;
    }

    /// <summary>Ortak boru hattı: kiracı çözümü + dönem varsayılanı + Result → HTTP.</summary>
    private static async Task<IResult> Run<T>(
        ICurrentUser currentUser,
        Guid? tenantId,
        HttpContext http,
        Func<Guid, ReportRangeRequest, Task<Application.Common.Result<T>>> call,
        DateTime? fromUtc,
        DateTime? toUtc,
        DateTime? compareFromUtc,
        DateTime? compareToUtc,
        string? granularity)
    {
        var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
        if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);

        // Dönem verilmezse içinde bulunulan ay.
        var now = DateTime.UtcNow;
        var from = fromUtc ?? new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var to = toUtc ?? from.AddMonths(1);

        var range = new ReportRangeRequest(from, to, compareFromUtc, compareToUtc, granularity);
        return (await call(resolvedTenantId, range)).ToHttpResult(http);
    }
}
