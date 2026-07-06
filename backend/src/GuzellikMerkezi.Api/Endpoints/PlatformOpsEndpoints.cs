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

        var invoices = app.MapGroup("/api/platform/invoices").WithTags("Platform Invoices").RequireAuthorization("PlatformAdmin");

        invoices.MapGet("/", async (string? status, string? search, IPlatformOpsService svc, HttpContext http, CancellationToken ct) =>
            (await svc.ListInvoicesAsync(status, search, ct)).ToHttpResult(http));

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
