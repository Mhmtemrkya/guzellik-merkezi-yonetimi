using GuzellikMerkezi.Application.Common;
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
        app.MapGet("/health/ready", async (GuzellikDbContext db, IWebHostEnvironment env, HttpContext http, CancellationToken ct) =>
        {
            // ÖDEME AYARI TUTARSIZSA HAZIR DEĞİLİZ.
            //
            // Ödeme AÇIKKEN eksik/çelişkili ayar hiçbir yerde yakalanmıyordu: örnek trafiğe
            // alınıyor, kusur ancak ilk gerçek tahsilat denemesinde — yani MÜŞTERİ ÖDERKEN —
            // ortaya çıkıyordu. Bu kontrol, hatayı deploy anına çeker.
            //
            // ÖDEME KAPALIYSA KAPI GEÇER: üretim `PaymentsEnabled=0` ile çalışıyor ve bu
            // GEÇERLİ bir yapılandırmadır; kapalı ödeme yüzünden trafik kesilmesi olmaz.
            var paymentIssue = await PaymentConfigGate.DescribeAsync(db, env.IsProduction(), ct);
            if (paymentIssue is not null)
            {
                return Results.Json(
                    ApiResponse<object>.Fail("PaymentConfigInvalid", paymentIssue, http.TraceIdentifier),
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }

            if (db.Database.ProviderName?.Contains("InMemory", StringComparison.OrdinalIgnoreCase) == true)
                return Results.Ok(ApiResponse<object>.Ok(new { status = "ready" }, http.TraceIdentifier));

            if (!await db.Database.CanConnectAsync(ct))
            {
                return Results.Json(
                    ApiResponse<object>.Fail("DatabaseUnavailable", "Veritabanı bağlantısı kurulamadı.", http.TraceIdentifier),
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }

            string[] pending;
            try
            {
                pending = (await db.Database.GetPendingMigrationsAsync(ct)).ToArray();
            }
            catch (Exception ex)
            {
                // Geçmiş tablosu okunamıyorsa şema durumu BİLİNMİYOR demektir → hazır sayma.
                return Results.Json(
                    ApiResponse<object>.Fail("SchemaStateUnknown", $"Şema durumu doğrulanamadı: {ex.Message}", http.TraceIdentifier),
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }

            if (pending.Length > 0)
            {
                return Results.Json(
                    ApiResponse<object>.Fail("SchemaOutOfDate",
                        $"Uygulanmamış {pending.Length} migration var (ilki: {pending[0]}). " +
                        "Şema güncellenene kadar bu örnek trafiğe alınmamalıdır.", http.TraceIdentifier),
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }

            return Results.Ok(ApiResponse<object>.Ok(new { status = "ready" }, http.TraceIdentifier));
        }).WithTags("Health");
        return app;
    }
}
