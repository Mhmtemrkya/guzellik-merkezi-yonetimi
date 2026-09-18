using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Features.AccountDeletion;

namespace GuzellikMerkezi.Api.Endpoints;

/// <summary>
/// HESAP SİLME uçları — "Hesabımı sil".
///
/// <para>
/// İKİ AYRI ALAN, İKİ AYRI YETKİ:
/// <list type="bullet">
///   <item><c>/api/account/tenant/*</c> — kurum yöneticisi; kurumu ve tüm verisini siler
///   (bekleme süreli, geri alınabilir).</item>
///   <item><c>/api/account/customer</c> — online portal müşterisi; kendi kişisel verisini siler
///   (anında, geri alınamaz).</item>
/// </list>
/// Yetki kontrolü servistedir (bkz. <see cref="IAccountDeletionService"/>): rol kararını uç
/// listesine dağıtmak, yeni bir uç eklendiğinde kontrolün unutulması demekti.
/// </para>
///
/// <para>
/// <b>Neden ayrı hız sınırı kovası?</b> Silme talebi parola/onay metni doğrulaması içerir;
/// frensiz bırakılırsa parola deneme yüzeyi olur. "auth-login" kovasıyla paylaşmak ise
/// kullanıcının giriş bütçesini tüketirdi.
/// </para>
/// </summary>
public static class AccountDeletionEndpoints
{
    public static IEndpointRouteBuilder MapAccountDeletionEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/account")
            .WithTags("AccountDeletion")
            .RequireAuthorization()
            .RequireRateLimiting("account-deletion");

        // --- KURUM ---------------------------------------------------------------------
        group.MapGet("/tenant/deletion", async (IAccountDeletionService service, HttpContext http, CancellationToken ct) =>
            (await service.GetTenantStatusAsync(ct)).ToHttpResult(http));

        group.MapPost("/tenant/deletion", async (RequestTenantDeletionRequest request, IAccountDeletionService service, HttpContext http, CancellationToken ct) =>
            (await service.RequestTenantDeletionAsync(request, ct)).ToHttpResult(http));

        // Talebi geri alma: bekleme süresinin VAR OLMA SEBEBİ budur.
        group.MapDelete("/tenant/deletion", async (IAccountDeletionService service, HttpContext http, CancellationToken ct) =>
            (await service.CancelTenantDeletionAsync(ct)).ToHttpResult(http));

        // --- MÜŞTERİ -------------------------------------------------------------------
        group.MapPost("/customer/deletion", async (DeleteCustomerAccountRequest request, IAccountDeletionService service, HttpContext http, CancellationToken ct) =>
            (await service.DeleteMyCustomerAccountAsync(request, ct)).ToHttpResult(http));

        return app;
    }
}
