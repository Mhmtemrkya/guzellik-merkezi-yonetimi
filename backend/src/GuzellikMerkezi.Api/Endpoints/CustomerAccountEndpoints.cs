using GuzellikMerkezi.Api.Authorization;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Domain;

namespace GuzellikMerkezi.Api.Endpoints;

public static class CustomerAccountEndpoints
{
    public static IEndpointRouteBuilder MapCustomerAccountEndpoints(this IEndpointRouteBuilder app)
    {
        // GÜVENLİK: cari/finansal veriler — personel yalnızca "Ön Muhasebe" (Accounting) SAYFA izniyle okuyabilir.
        // (Yazma işlemleri ayrıca onay kapısında Accounting.Accounts/Collect aksiyon iznine tabidir.)
        var group = app.MapGroup("/api/admin/accounts").WithTags("CustomerAccounts").RequireAuthorization().RequirePermission(Permissions.Accounting);

        // serviceDefinitionId / servicePackageId → katalog kartındaki satış paneli (sunucuda süzülür).
        group.MapGet("/", async (Guid? tenantId, int page, int pageSize, string? search, Guid? customerId, Guid? serviceDefinitionId, Guid? servicePackageId, string? category, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListAsync(resolvedTenantId, new PageRequest(page, pageSize, search), ct, customerId, serviceDefinitionId, servicePackageId, category)).ToHttpResult(http);
        });

        // Geçmiş satış: yazılıma geçmeden önce yapılmış paket/hizmet satışını sisteme işler.
        group.MapPost("/historical", async (CreateHistoricalSaleRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateHistoricalAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        // Satış iptali + gerekçe. Kayıt canlı tablolardan SİLİNİR ve tam kopyası cancelled_sales
        // arşivine taşınır (finansal iz kaybolmaz, yer değiştirir). request.RefundedAmount =
        // müşteriye geri ödenen kısım; kalan tutar gelirde sayılmaya devam eder.
        group.MapPost("/{id:guid}/cancel-sale", async (Guid id, CancelSaleRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CancelSaleAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        // CANLI + ARŞİV TEK İSTEKTE. İstemci ikisini ayrı ayrı çekiyordu; iki istek arasında bir
        // satış iptal edilirse aynı satış ÇİFT sayılabiliyor ya da tamamen KAYBOLABİLİYORDU.
        // Bu uç ikisini tek anlık görüntüden döndürür (bkz. ListWithArchiveAsync).
        group.MapGet("/with-archive", async (Guid? tenantId, int? page, int? pageSize, Guid? customerId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);
            var req = new PageRequest(page ?? 1, pageSize ?? 200);
            return (await service.ListWithArchiveAsync(resolvedTenantId, req, customerId, ct)).ToHttpResult(http);
        });

        // İptal arşivi — "İptal Edilenler" ekranının kaynağı. ":guid" kısıtı sayesinde
        // aşağıdaki "/{id:guid}" rotasıyla çakışmaz.
        group.MapGet("/cancelled", async (Guid? tenantId, Guid? customerId, Guid? servicePackageId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.ListCancelledAsync(resolvedTenantId, customerId, servicePackageId, ct)).ToHttpResult(http);
        });

        // id: arşiv kaydının Id'si ya da (eski istemciler için) silinen carinin Id'si olabilir.
        // Gövde OPSİYONELDİR (eski istemciler boş gönderiyor): voidRefund=true yalnızca "iade fiilen
        // yapılmamıştı" denildiğinde kasa çıkışı kaydını da geri alır.
        group.MapPost("/{id:guid}/restore-sale", async (Guid id, RestoreSaleRequest? request, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.RestoreSaleAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        group.MapGet("/{id:guid}", async (Guid id, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetAsync(resolvedTenantId, id, ct)).ToHttpResult(http);
        });

        group.MapPost("/", async (CreateCustomerAccountRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.CreateAsync(resolvedTenantId, request, ct)).ToHttpResult(http);
        });

        group.MapPut("/{id:guid}", async (Guid id, UpdateCustomerAccountRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.UpdateAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        group.MapPatch("/{id:guid}/reschedule", async (Guid id, RescheduleAccountRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.RescheduleAsync(resolvedTenantId, id, request, ct)).ToHttpResult(http);
        });

        group.MapPost("/{id:guid}/payments", async (Guid id, RegisterAccountPaymentRequest request, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            if (resolvedTenantId == Guid.Empty) return EndpointHelpers.MissingTenant(http);

            // KAYNAK BAĞI İSTEMCİDEN ALINMAZ. SourceAdisyonId, bir adisyon silinirken HANGİ
            // tahsilatların geri alınacağını belirler. İstemci bu alanı doldurabildiğinde, elle
            // girilmiş bağımsız bir tahsilata başka bir fişin kimliği yazılıp o fiş silindiğinde
            // gerçek para kasadan sessizce düşürülebilirdi. Alan yalnız İÇ çağrıda (adisyon onayı)
            // sunucu tarafından doldurulur.
            // SourceAppointmentId de AYNI SINIFTA. İstemci bunu doldurabilseydi kendi tahsilatını
            // BAŞKA bir randevunun üstüne yazabilir, o randevunun tamamlaması geri alınamaz hâle
            // gelir (hizmet reddi) ya da kendi randevusunun parası gizlenebilirdi. Provenance'ı
            // yalnız sunucu yazar (bkz. AppointmentService.CollectOnCompleteAsync).
            var sanitized = request with { SourceAdisyonId = null, SourceAppointmentId = null };
            return (await service.RegisterPaymentAsync(resolvedTenantId, id, sanitized, ct)).ToHttpResult(http);
        });

        // DÜZ SİLME UCU KALDIRILDI (bilerek). Yalnız parent cariyi soft-delete ediyordu:
        // tahsilatlar arşivlenmiyor, iade işlenmiyor, adisyon etkileri geri alınmıyor, paket
        // seansları kullanılabilir kalıyor ve iptal arşivi hiç oluşmuyordu. Kasa/rapor servisleri
        // cari metadata'sını bulamadığı için tahsilat gelirden de düşüyordu. Satışı sonlandırmanın
        // TEK güvenli yolu POST /{id}/cancel-sale (CancelSaleAsync) akışıdır.

        // Pano "Paket Raporu": paket satışı, yapılacak seans, ay ay taksit takvimi.
        // fromUtc/toUtc verilirse rapor o dönemde satılan paketlere göre süzülür (günlük/aylık/yıllık).
        // category/subCategory: rapor yalnızca o kategorideki paketlere daralır; dönemle birlikte çalışır.
        // servicePackageId/serviceDefinitionId: rapor TEK bir pakete ya da hizmete daralır
        // ("Satış Detayı > Müşteri Detayı" seçicisi); dönem + kategori ile birlikte uygulanır.
        group.MapGet("/report", async (Guid? tenantId, int? months, DateTime? fromUtc, DateTime? toUtc, string? category, string? subCategory, Guid? servicePackageId, Guid? serviceDefinitionId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetReportAsync(resolvedTenantId, months ?? 6, fromUtc, toUtc, category, subCategory, servicePackageId, serviceDefinitionId, ct)).ToHttpResult(http);
        });

        // Pano "Hizmet Raporu": paket raporundan AYRI — kategori hizmetin kategorisidir, paket sayılmaz.
        group.MapGet("/service-report", async (Guid? tenantId, DateTime? fromUtc, DateTime? toUtc, string? category, string? subCategory, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetServiceReportAsync(resolvedTenantId, fromUtc, toUtc, category, subCategory, ct)).ToHttpResult(http);
        });

        // Müşterinin paketlerindeki hizmet-bazlı kalan seans bakiyeleri
        group.MapGet("/sessions/{customerId:guid}", async (Guid customerId, Guid? tenantId, ICurrentUser currentUser, ICustomerAccountService service, HttpContext http, CancellationToken ct) =>
        {
            var resolvedTenantId = EndpointHelpers.ResolveTenantId(currentUser, tenantId);
            return resolvedTenantId == Guid.Empty ? EndpointHelpers.MissingTenant(http) : (await service.GetCustomerSessionsAsync(resolvedTenantId, customerId, ct)).ToHttpResult(http);
        });

        return app;
    }
}
