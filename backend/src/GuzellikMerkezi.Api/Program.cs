using GuzellikMerkezi.Api.Background;
using GuzellikMerkezi.Api.Development;
using GuzellikMerkezi.Api.Endpoints;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Api.Middleware;
using GuzellikMerkezi.Application;
using GuzellikMerkezi.Infrastructure;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Scalar.AspNetCore;
using System.Threading.RateLimiting;

// Launch profili kullanılmadığında (ör. `dotnet run --no-launch-profile`) ASPNETCORE_ENVIRONMENT
// gelmez. YEREL GELİŞTİRME (yalnız DEBUG build) için Development'a sabitleriz — böylece doğru appsettings
// + DB bootstrap/seed çalışır.
// GÜVENLİK: ÜRETİM (Release build) için bu zorlama YAPILMAZ. Ortam açıkça verilmezse ASP.NET'in güvenli
// varsayılanı (Production) devreye girer → zayıf JWT/şifreleme anahtarı fail-fast guard'ı AKTİF kalır,
// demo seed + Swagger/Scalar KAPALI olur. Böylece canlı sunucuda env unutulsa bile yanlışlıkla
// Development'a (bilinen anahtar + demo parola) düşme riski ortadan kalkar.
#if DEBUG
Environment.SetEnvironmentVariable(
    "ASPNETCORE_ENVIRONMENT",
    Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT")
        ?? Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT")
        ?? "Development");
#endif

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddApiServices(builder.Configuration);
builder.Services.AddHostedService<TrialExpirationBackgroundService>();
builder.Services.AddHostedService<NotificationDispatchBackgroundService>();
builder.Services.AddHostedService<MonthlyReportBackgroundService>();
// Arka plan iş kuyruğu tüketicisi (WhatsApp/SMS/FCM gönderimlerini request-path dışında yürütür).
builder.Services.AddHostedService<QueuedHostedService>();
// Kalıcı (DB-outbox) iş kuyruğu tüketicisi — restart'ta kaybolmaması gereken işler.
builder.Services.AddHostedService<DurableJobHostedService>();
// RabbitMQ açıksa iş sinyali tüketicisi de çalışır (anında işleme; poller güvenlik ağı olarak kalır).
if (builder.Configuration.GetValue<bool>("RabbitMq:Enabled"))
    builder.Services.AddHostedService<RabbitMqJobConsumerHostedService>();

// GÜVENLİK: Herkese açık müşteri uçları için IP bazlı hız sınırı.
// Şifresiz müşteri girişi (ad+telefon+doğum tarihi) brute-force denemesine ve
// seri sahte kayıt/randevu spam'ine karşı ilk savunma hattıdır.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (context, ct) =>
    {
        context.HttpContext.Response.ContentType = "application/json; charset=utf-8";
        await context.HttpContext.Response.WriteAsync(
            """{"success":false,"data":null,"error":{"code":"TooManyRequests","message":"Çok fazla deneme yapıldı. Lütfen birkaç dakika bekleyip tekrar deneyin."}}""", ct);
    };
    static string ClientIp(HttpContext http) => http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    // Müşteri giriş/kayıt: 5 dakikada en fazla 10 deneme (IP başına).
    options.AddPolicy("customer-auth", http => RateLimitPartition.GetFixedWindowLimiter(ClientIp(http),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(5), QueueLimit = 0 }));
    // Müşteri randevu oluşturma: saatte en fazla 15 istek (IP başına).
    options.AddPolicy("customer-portal-write", http => RateLimitPartition.GetFixedWindowLimiter(ClientIp(http),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 15, Window = TimeSpan.FromHours(1), QueueLimit = 0 }));
    // GÜVENLİK: Personel/kurum/platform girişi + kapsam sorgusu (parolalı). IP başına 5 dakikada 15 deneme.
    // Parola brute-force / spraying ve e-posta enumerasyonunu frenler. Gerçek istemci IP'si için reverse
    // proxy arkasında ForwardedHeaders etkin olmalı (Program pipeline'ının başında yapılandırıldı).
    options.AddPolicy("auth-login", http => RateLimitPartition.GetFixedWindowLimiter(ClientIp(http),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 15, Window = TimeSpan.FromMinutes(5), QueueLimit = 0 }));
});

var app = builder.Build();

// GÜVENLİK: Varsayılan/zayıf JWT imzalama ve şifreleme anahtarları üretimde KESİNLİKLE reddedilir
// (kaynak koddaki bu değerlerle token sahteciliği / PII çözme mümkün olurdu). Üretim dışında uyarı verilir.
// NOT: Bu kontrol, herhangi bir seed/şifreleme adımından ÖNCE çalışır — böylece production'da zayıf
// anahtarla demo PII şifrelenip, sonradan gerçek anahtar verilince okunamaz hale gelmez (fail-fast).
{
    const string defaultJwtKey = "development-only-signing-key-change-me-min-32-bytes";
    const string defaultEncKey = "ZGV2X0FSTU9ORVNTQV9NQVNURVJfS0VZX0FFUzI1Nl9HQ01fOA==";
    var jwtKey = app.Configuration["Jwt:SigningKey"];
    var encKey = app.Configuration["Encryption:MasterKeyBase64"];
    var weakJwt = string.IsNullOrWhiteSpace(jwtKey) || jwtKey == defaultJwtKey || jwtKey!.Length < 32;
    var weakEnc = string.IsNullOrWhiteSpace(encKey) || encKey == defaultEncKey;
    if (!app.Environment.IsDevelopment() && (weakJwt || weakEnc))
    {
        throw new InvalidOperationException(
            "Üretim ortamında varsayılan/zayıf Jwt:SigningKey veya Encryption:MasterKeyBase64 kullanılamaz. " +
            "Güçlü, gizli değerleri ortam değişkeni / secret store ile geçirin.");
    }
    if (weakJwt || weakEnc)
    {
        app.Logger.LogWarning(
            "GÜVENLİK UYARISI: Varsayılan JWT/şifreleme anahtarı kullanılıyor. Üretime çıkmadan ÖNCE " +
            "Jwt:SigningKey ve Encryption:MasterKeyBase64 değerlerini güçlü, gizli değerlerle değiştirin.");
    }
}

// Veritabanı bootstrap + seed. Development'ta HER ZAMAN; başka cihaz/sunucu veya CANLI'da ise
// AÇIK opt-in ile: Database:SeedDemoData=true  (ör. ortam değişkeni: Database__SeedDemoData=true).
// Bu yol yeni bir kuruluma tek hamlede: DB oluşturma + EF migration + demo seed sağlar.
// Seed IDEMPOTENT'tir: kurum zaten varsa hiçbir demo verisi eklemez ve mevcut şifrelere DOKUNMAZ.
// GÜVENLİK: Demo hesaplar bilinen "Guzellik123!" parolasıyla gelir — canlıda kullandıktan sonra bu
// parolaları DERHAL değiştirin; bu bayrağı yalnızca ilk kurulum/staging için açık tutmak en güvenlisidir.
var seedDemoData = bool.TryParse(app.Configuration["Database:SeedDemoData"], out var demoFlag) && demoFlag;

if (app.Environment.IsDevelopment() || seedDemoData)
{
    // DB yoksa otomatik oluştur (MySQL için)
    await DatabaseBootstrap.EnsureDatabaseAsync(app.Services, app.Configuration);
    // Şema EF migration'larıyla uygulanır + seed (sadece DB boşsa seed eder, dolusa skip eder)
    await app.SeedDevelopmentDataAsync();
    // Referans veriler: collation hizalama (eski kurulumlar) + varsayılan abonelik planları
    await DatabaseBootstrap.EnsureReferenceDataAsync(app.Services, app.Configuration);
    // At-rest encryption: hassas alanları (ENC:v1: prefix'siz olanları) AES-GCM ile şifrele.
    // Idempotent — her başlangıçta çalıştırılabilir, zaten şifreli satırları atlar.
    await DatabaseBootstrap.EncryptExistingDataAsync(app.Services, app.Configuration);
}
else if (bool.TryParse(app.Configuration["Database:SeedReferenceData"], out var seedReferenceData) && seedReferenceData)
{
    // Production'da ŞEMA migration'ları ELLE uygulanır (otomatik DEĞİL). Bu opsiyonel adım yalnızca
    // GÜVENLİ + idempotent referans verisini (varsayılan abonelik planları) ekler — DDL/şema değişikliği
    // yapmaz, demo verisi eklemez, mevcut kayıtlara/şifrelere dokunmaz. Opt-in: Database:SeedReferenceData=true.
    await DatabaseBootstrap.EnsureDefaultSubscriptionPlansAsync(app.Services, app.Configuration);
}

// GÜVENLİK: reverse proxy arkasında gerçek istemci IP'sini X-Forwarded-For / -Proto'dan çöz — böylece
// rate-limit ve audit/güvenlik logları proxy IP'sini değil GERÇEK istemciyi görür. En başta çalışmalı.
// Varsayılan: yalnız loopback proxy güvenilir (aynı sunucudaki nginx/IIS için doğru çalışır). Cloud LB için:
//   ForwardedHeaders__TrustAll=true              (LB dış XFF'i ezmeli/eklemeli — aksi halde spoof riski)
//   ForwardedHeaders__KnownProxies__0=<lb-ip>    (güvenilen proxy IP'lerini tek tek listele)
{
    var fh = new ForwardedHeadersOptions
    {
        ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
        ForwardLimit = int.TryParse(app.Configuration["ForwardedHeaders:ForwardLimit"], out var fl) && fl > 0 ? fl : 1,
    };
    if (bool.TryParse(app.Configuration["ForwardedHeaders:TrustAll"], out var trustAll) && trustAll)
    {
        fh.KnownProxies.Clear();
        fh.KnownIPNetworks.Clear();
    }
    else
    {
        foreach (var ip in app.Configuration.GetSection("ForwardedHeaders:KnownProxies").Get<string[]>() ?? Array.Empty<string>())
            if (System.Net.IPAddress.TryParse(ip, out var proxy)) fh.KnownProxies.Add(proxy);
    }
    app.UseForwardedHeaders(fh);
}

app.UseResponseCompression();
app.UseRateLimiter();
app.UseMiddleware<ExceptionHandlingMiddleware>();
app.UseCors(ApiServiceCollectionExtensions.FrontendCorsPolicyName);
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<TenantResolutionMiddleware>();
// Müşteri rolünü /api/customer (+/api/auth) ile sınırla; diğer rolleri portaldan uzak tut.
app.UseMiddleware<CustomerScopeMiddleware>();
app.UseMiddleware<TrialAccessMiddleware>();
// Idempotent yazma: Idempotency-Key taşıyan isteklerin tekrarı ilk yanıtı döndürür (çevrimdışı
// kuyruk tekrar oynatması). Audit + onay kapısını dıştan sarar ki tekrar mükerrer iz üretmesin.
app.UseMiddleware<IdempotencyMiddleware>();
// Aktivite audit'i onay kapısını dıştan sarmalıdır. Böylece Staff isteği endpoint'e
// ulaşmadan PendingOperation olarak kısa devre edilse bile işlem audit kapsamındadır.
app.UseMiddleware<ActivityAuditMiddleware>();
// Evrensel personel onay kapısı — Staff yazma istekleri taslağa düşer (TenantResolution'dan sonra olmalı).
app.UseMiddleware<StaffApprovalGateMiddleware>();

if (app.Environment.IsDevelopment())
{
    // .NET 10 built-in OpenAPI dokümanı: /openapi/v1.json
    app.MapOpenApi();

    // Klasik Swagger UI — /swagger (built-in OpenAPI doc'u tüketiyor)
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/openapi/v1.json", "Güzellik Merkezi API v1");
        c.DocumentTitle = "Güzellik Merkezi API — Swagger";
        c.RoutePrefix = "swagger";
    });

    // Scalar UI (modern alternatif) — /scalar/v1
    app.MapScalarApiReference(options =>
    {
        options.Title = "Güzellik Merkezi API";
        options.WithTheme(ScalarTheme.BluePlanet);
    });
}

app.MapHealthEndpoints();
app.MapAuthEndpoints();
app.MapTenantEndpoints();
app.MapBranchEndpoints();
app.MapCustomerEndpoints();
app.MapCustomerPortalEndpoints();
app.MapTreatmentPhotoEndpoints();
app.MapConsultationEndpoints();
app.MapStaffEndpoints();
app.MapServiceDefinitionEndpoints();
app.MapServicePackageEndpoints();
app.MapCustomServiceCategoryEndpoints();
app.MapAppointmentEndpoints();
app.MapRatingEndpoints();
app.MapWhatsAppEndpoints();
app.MapCustomerAccountEndpoints();
app.MapAdisyonEndpoints();
app.MapCommissionEndpoints();
app.MapScheduleEndpoints();
app.MapCampaignEndpoints();
app.MapGiftCardEndpoints();
app.MapWaitlistEndpoints();
app.MapCashClosingEndpoints();
app.MapLoyaltyEndpoints();
app.MapExpenseEndpoints();
app.MapCustomExpenseCategoryEndpoints();
app.MapCashFlowEndpoints();
app.MapStockEndpoints();
app.MapPendingOperationEndpoints();
app.MapNotificationEndpoints();
app.MapAppNotificationEndpoints();
app.MapSubscriptionPlanEndpoints();
app.MapAuditLogEndpoints();
app.MapDeviceEndpoints();
app.MapSecurityEndpoints();
app.MapFeatureEndpoints();
app.MapPlatformMessagingEndpoints();
app.MapPlatformOpsEndpoints();

app.Run();

public partial class Program { }
