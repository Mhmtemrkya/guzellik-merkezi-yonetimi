using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Billing;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Endpoints;

public static class HealthEndpoints
{
    public static IEndpointRouteBuilder MapHealthEndpoints(this IEndpointRouteBuilder app)
    {
        // Basit /health (liveness) — dış uptime kontrolleri çoğu zaman /health/live yerine /health'e bakar.
        app.MapGet("/health", (HttpContext http) => Results.Ok(ApiResponse<object>.Ok(new { status = "ok" }, http.TraceIdentifier))).WithTags("Health");
        app.MapGet("/health/live", (HttpContext http) => Results.Ok(ApiResponse<object>.Ok(new { status = "live" }, http.TraceIdentifier))).WithTags("Health");
        // HAZIRLIK = BAĞLANTI + ŞEMA PARİTESİ.
        //
        // Eskiden yalnız "veritabanına bağlanabiliyor muyum?" soruluyordu. Migration'lar canlıda
        // ELLE uygulandığı için yeni binary, eski şema üzerinde "hazır" diyip yük dengeleyiciden
        // TRAFİK ALABİLİYORDU: eksik kolona yazan uçlar 500 veriyor, beklenen kısıtlar bulunmuyordu.
        // Bekleyen migration varsa 503 döneriz — deploy otomasyonu bu örneği devreye almaz.
        // BU UÇ KİMLİK DOĞRULAMASI İSTEMEZ (yük dengeleyici yoklar) — dolayısıyla YANITI TEŞHİS
        // METNİ TAŞIMAZ. Migration adları, ham veritabanı hata metni ve ödeme sağlayıcı ayrıntısı
        // saldırgan için keşif bilgisidir: şemanın geride olduğunu, ödeme entegrasyonunun yarım
        // olduğunu ve hangi sağlayıcının hedefleneceğini söyler. Ayrıntı yalnız SUNUCU GÜNLÜĞÜNE
        // yazılır; istemci "hazır değil" ile bir kod alır.
        app.MapGet("/health/ready", async (
            GuzellikDbContext db,
            IPaymentGatewayResolver payments,
            ILoggerFactory loggerFactory,
            HttpContext http,
            CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger("Health.Ready");
            IResult NotReady(string code, string detail)
            {
                log.LogError("Hazırlık başarısız ({Code}): {Detail}", code, detail);
                return Results.Json(
                    ApiResponse<object>.Fail(code, "Bu örnek henüz trafiğe hazır değil.", http.TraceIdentifier),
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }

            // ÖDEME AYARI TUTARSIZSA HAZIR DEĞİLİZ.
            //
            // Ödeme AÇIKKEN eksik/çelişkili ayar hiçbir yerde yakalanmıyordu: örnek trafiğe
            // alınıyor, kusur ancak ilk gerçek tahsilat denemesinde — yani MÜŞTERİ ÖDERKEN —
            // ortaya çıkıyordu. Bu kontrol, hatayı deploy anına çeker.
            //
            // ÖDEME KAPALIYSA KAPI GEÇER: üretim `PaymentsEnabled=0` ile çalışıyor ve bu
            // GEÇERLİ bir yapılandırmadır; kapalı ödeme yüzünden trafik kesilmesi olmaz.
            var paymentIssue = await PaymentConfigGate.DescribeAsync(db, payments, ct);
            if (paymentIssue is not null) return NotReady("PaymentConfigInvalid", paymentIssue);

            if (db.Database.ProviderName?.Contains("InMemory", StringComparison.OrdinalIgnoreCase) == true)
                return Results.Ok(ApiResponse<object>.Ok(new { status = "ready" }, http.TraceIdentifier));

            if (!await db.Database.CanConnectAsync(ct))
                return NotReady("DatabaseUnavailable", "Veritabanı bağlantısı kurulamadı.");

            string[] pending;
            try
            {
                pending = (await db.Database.GetPendingMigrationsAsync(ct)).ToArray();
            }
            catch (Exception ex)
            {
                // Geçmiş tablosu okunamıyorsa şema durumu BİLİNMİYOR demektir → hazır sayma.
                // Ham hata metni (sunucu adı, tablo, sürücü ayrıntısı) İSTEMCİYE GİTMEZ.
                return NotReady("SchemaStateUnknown", $"Şema durumu doğrulanamadı: {ex.Message}");
            }

            // Migration ADLARI istemciye verilmez (hangi şema sürümünde olduğumuz keşif bilgisidir).
            if (pending.Length > 0)
                return NotReady("SchemaOutOfDate", $"Uygulanmamış {pending.Length} migration var (ilki: {pending[0]}).");

            return Results.Ok(ApiResponse<object>.Ok(new { status = "ready" }, http.TraceIdentifier));
        }).WithTags("Health");
        return app;
    }
}
