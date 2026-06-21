using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Features.PlatformMessaging;

namespace GuzellikMerkezi.Api.Endpoints;

public static class PlatformMessagingEndpoints
{
    public static IEndpointRouteBuilder MapPlatformMessagingEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/platform/messaging").WithTags("Platform Messaging").RequireAuthorization("PlatformAdmin");

        group.MapGet("/settings", async (IPlatformMessagingService service, HttpContext http, CancellationToken ct) =>
            (await service.GetSettingsAsync(ct)).ToHttpResult(http));

        group.MapPut("/settings", async (SavePlatformMessagingRequest request, IPlatformMessagingService service, HttpContext http, CancellationToken ct) =>
            (await service.SaveSettingsAsync(request, ct)).ToHttpResult(http));

        group.MapPost("/test-sms", async (MessagingTestRequest request, IPlatformMessagingService service, HttpContext http, CancellationToken ct) =>
            (await service.SendTestSmsAsync(request.Target, ct)).ToHttpResult(http));

        group.MapPost("/test-email", async (MessagingTestRequest request, IPlatformMessagingService service, HttpContext http, CancellationToken ct) =>
            (await service.SendTestEmailAsync(request.Target, ct)).ToHttpResult(http));

        return app;
    }
}
