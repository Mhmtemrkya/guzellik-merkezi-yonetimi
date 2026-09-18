using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Features.Support;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Api.Endpoints;

/// <summary>
/// DESTEK TALEPLERİ uçları.
///
/// <para>
/// ÜÇ AYRI GRUP, ÜÇ AYRI YETKİ — bilinçli olarak ayrıdır. Tek bir uç grubu yapıp içinde rol
/// dallanması yapmak, yeni bir uç eklendiğinde kapsam kontrolünün atlanmasını kolaylaştırırdı:
/// <list type="bullet">
///   <item><c>/api/public/support</c> — anonim. Tanıtım sayfasındaki form + kod/jetonla takip.</item>
///   <item><c>/api/support</c> — oturumlu kurum kullanıcısı; YALNIZ kendi kurumunun talepleri.</item>
///   <item><c>/api/platform/support</c> — platform yöneticisi; tüm kuyruk.</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Anonim grup neden kendi hız sınırı kovasında?</b> Her talep bir E-POSTA gönderiyor, yani
/// para harcıyor; ayrıca oturumsuz bir yazma ucudur. "public-browse" kovasıyla paylaşmak,
/// vitrin gezinmesiyle aynı bütçeyi tüketmek demekti.
/// </para>
/// </summary>
public static class SupportEndpoints
{
    public static IEndpointRouteBuilder MapSupportEndpoints(this IEndpointRouteBuilder app)
    {
        // ---------------------------------------------------------------- anonim
        var pub = app.MapGroup("/api/public/support")
            .WithTags("Support")
            .RequireRateLimiting("support-public");

        // Oturum VARSA servis kimliği oturumdan alır ve formdaki ad/e-postayı yok sayar; bu uç
        // hem ziyaretçiye hem giriş yapmış kullanıcıya hizmet eder (bkz. SupportService.CreateAsync).
        pub.MapPost("/", async (CreateSupportTicketRequest request, ISupportService service, HttpContext http, CancellationToken ct) =>
            (await service.CreateAsync(request, ct)).ToHttpResult(http));

        // TAKİP: kod tek başına yetmez (sıralı ve tahmin edilebilir), jeton şarttır.
        pub.MapGet("/track", async (string code, string token, ISupportService service, HttpContext http, CancellationToken ct) =>
            (await service.GetByTokenAsync(code, token, ct)).ToHttpResult(http));

        pub.MapPost("/track/reply", async (TrackReplyRequest request, ISupportService service, HttpContext http, CancellationToken ct) =>
            (await service.ReplyByTokenAsync(request.Code, request.Token, new SupportReplyRequest(request.Message), ct)).ToHttpResult(http));

        // ---------------------------------------------------------------- kurum paneli
        var mine = app.MapGroup("/api/support")
            .WithTags("Support")
            .RequireAuthorization();

        mine.MapGet("/", async ([AsParameters] SupportListQuery q, ISupportService service, HttpContext http, CancellationToken ct) =>
            (await service.ListMineAsync(q.ToQuery(), ct)).ToHttpResult(http));

        mine.MapGet("/{id:guid}", async (Guid id, ISupportService service, HttpContext http, CancellationToken ct) =>
            (await service.GetMineAsync(id, ct)).ToHttpResult(http));

        mine.MapPost("/{id:guid}/reply", async (Guid id, SupportReplyRequest request, ISupportService service, HttpContext http, CancellationToken ct) =>
            (await service.ReplyMineAsync(id, request, ct)).ToHttpResult(http));

        // ---------------------------------------------------------------- platform
        var platform = app.MapGroup("/api/platform/support")
            .WithTags("Support")
            .RequireAuthorization("PlatformAdmin");

        platform.MapGet("/", async ([AsParameters] SupportListQuery q, ISupportService service, HttpContext http, CancellationToken ct) =>
            (await service.ListAllAsync(q.ToQuery(), ct)).ToHttpResult(http));

        platform.MapGet("/summary", async (ISupportService service, HttpContext http, CancellationToken ct) =>
            (await service.GetSummaryAsync(ct)).ToHttpResult(http));

        platform.MapGet("/{id:guid}", async (Guid id, ISupportService service, HttpContext http, CancellationToken ct) =>
            (await service.GetAsync(id, ct)).ToHttpResult(http));

        platform.MapPost("/{id:guid}/reply", async (Guid id, SupportReplyRequest request, ISupportService service, HttpContext http, CancellationToken ct) =>
            (await service.ReplyAsync(id, request, ct)).ToHttpResult(http));

        platform.MapPut("/{id:guid}", async (Guid id, UpdateSupportTicketRequest request, ISupportService service, HttpContext http, CancellationToken ct) =>
            (await service.UpdateAsync(id, request, ct)).ToHttpResult(http));

        return app;
    }
}

/// <summary>Oturumsuz yanıt — kod ve jeton gövdede taşınır (URL'de kalıcı iz bırakmasın).</summary>
public sealed record TrackReplyRequest(string Code, string Token, string Message);

/// <summary>
/// Liste sorgu parametreleri.
/// </summary>
/// <remarks>
/// Ayrı bir kayıt olmasının sebebi <c>[AsParameters]</c>: minimal API sorgu dizesini böyle
/// bağlar ve iki uç (kurum + platform) aynı sözleşmeyi paylaşır.
/// </remarks>
public sealed record SupportListQuery(
    string? Scope, string? Search,
    SupportTicketStatus? Status, SupportTicketPriority? Priority, SupportTicketCategory? Category,
    int? Page, int? PageSize)
{
    public SupportTicketQuery ToQuery() =>
        new(Scope, Search, Status, Priority, Category, Page ?? 1, PageSize ?? 25);
}
