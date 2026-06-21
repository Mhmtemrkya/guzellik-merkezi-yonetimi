using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Endpoints;

public static class HealthEndpoints
{
    public static IEndpointRouteBuilder MapHealthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/health/live", (HttpContext http) => Results.Ok(ApiResponse<object>.Ok(new { status = "live" }, http.TraceIdentifier))).WithTags("Health");
        app.MapGet("/health/ready", async (GuzellikDbContext db, HttpContext http, CancellationToken ct) =>
        {
            var canConnect = db.Database.ProviderName?.Contains("InMemory", StringComparison.OrdinalIgnoreCase) == true
                || await db.Database.CanConnectAsync(ct);
            return canConnect
                ? Results.Ok(ApiResponse<object>.Ok(new { status = "ready" }, http.TraceIdentifier))
                : Results.Json(ApiResponse<object>.Fail("DatabaseUnavailable", "Veritabanı bağlantısı kurulamadı.", http.TraceIdentifier), statusCode: StatusCodes.Status503ServiceUnavailable);
        }).WithTags("Health");
        return app;
    }
}
