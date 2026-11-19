using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Features.PlatformOps;

namespace GuzellikMerkezi.Api.Endpoints;

/// <summary>Platform admin: sistem ayarları + kurum faturalama.</summary>
public static class PlatformOpsEndpoints
{
    public static IEndpointRouteBuilder MapPlatformOpsEndpoints(this IEndpointRouteBuilder app)
    {
        var system = app.MapGroup("/api/platform/system").WithTags("Platform System").RequireAuthorization("PlatformAdmin");

        system.MapGet("/settings", async (IPlatformOpsService svc, HttpContext http, CancellationToken ct) =>
            (await svc.GetSystemSettingsAsync(ct)).ToHttpResult(http));

        system.MapPut("/settings", async (SaveSystemSectionRequest request, IPlatformOpsService svc, HttpContext http, CancellationToken ct) =>
            (await svc.SaveSystemSectionAsync(request, ct)).ToHttpResult(http));

        system.MapGet("/queue", async (IPlatformOpsService svc, HttpContext http, CancellationToken ct) =>
            (await svc.GetQueueStatusAsync(ct)).ToHttpResult(http));

        system.MapPost("/queue/{id:guid}/requeue", async (Guid id, IPlatformOpsService svc, HttpContext http, CancellationToken ct) =>
            (await svc.RequeueJobAsync(id, ct)).ToHttpResult(http));

        // VERİTABANI İZLEME (salt okunur, satır verisiz): ölçümler + yedek dosyaları; şema ayrı (büyük, istenince okunur).
        system.MapGet("/database", async (IDatabaseMonitor monitor, HttpContext http, CancellationToken ct) =>
            Results.Json(GuzellikMerkezi.Application.Common.ApiResponse<DatabaseSnapshotDto>.Ok(await monitor.SnapshotAsync(ct), http.TraceIdentifier)));

        system.MapGet("/database/schema", async (IDatabaseMonitor monitor, HttpContext http, CancellationToken ct) =>
            Results.Json(GuzellikMerkezi.Application.Common.ApiResponse<DatabaseSchemaDto>.Ok(await monitor.SchemaAsync(ct), http.TraceIdentifier)));

        var invoices = app.MapGroup("/api/platform/invoices").WithTags("Platform Invoices").RequireAuthorization("PlatformAdmin");

        invoices.MapGet("/", async (string? status, string? search, IPlatformOpsService svc, HttpContext http, CancellationToken ct) =>
            (await svc.ListInvoicesAsync(status, search, ct)).ToHttpResult(http));

        // Faturalama ekranı özeti: KPI'lar + abonelikler (sonraki yenileme teklifi) + tahsilat denemeleri.
        invoices.MapGet("/overview", async (IPlatformOpsService svc, HttpContext http, CancellationToken ct) =>
            (await svc.GetBillingOverviewAsync(ct)).ToHttpResult(http));

        // Sonucu bekleyen ek şube ödemelerini ŞİMDİ sağlayıcıya sor (arka plan taramasını beklemeden).
        invoices.MapPost("/resolve-pending", async (GuzellikMerkezi.Application.Features.Billing.IBillingService billing, HttpContext http, CancellationToken ct) =>
        {
            var opened = await billing.ResolvePendingBranchChargesAsync(ct);
            return Results.Json(GuzellikMerkezi.Application.Common.ApiResponse<object>.Ok(new { opened }, http.TraceIdentifier));
        });

        invoices.MapPost("/", async (CreateInvoiceRequest request, IPlatformOpsService svc, HttpContext http, CancellationToken ct) =>
            (await svc.CreateInvoiceAsync(request, ct)).ToHttpResult(http));

        invoices.MapPost("/generate", async (IPlatformOpsService svc, HttpContext http, CancellationToken ct) =>
            (await svc.GenerateCurrentPeriodInvoicesAsync(ct)).ToHttpResult(http));

        invoices.MapPut("/{id:guid}/status", async (Guid id, UpdateInvoiceStatusRequest request, IPlatformOpsService svc, HttpContext http, CancellationToken ct) =>
            (await svc.UpdateInvoiceStatusAsync(id, request, ct)).ToHttpResult(http));

        invoices.MapDelete("/{id:guid}", async (Guid id, IPlatformOpsService svc, HttpContext http, CancellationToken ct) =>
            (await svc.DeleteInvoiceAsync(id, ct)).ToHttpResult(http));

        return app;
    }
}
