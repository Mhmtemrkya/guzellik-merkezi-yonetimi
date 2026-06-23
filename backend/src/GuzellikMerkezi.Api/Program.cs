using GuzellikMerkezi.Api.Background;
using GuzellikMerkezi.Api.Development;
using GuzellikMerkezi.Api.Endpoints;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Api.Middleware;
using GuzellikMerkezi.Application;
using GuzellikMerkezi.Infrastructure;
using GuzellikMerkezi.Infrastructure.Persistence;
using Scalar.AspNetCore;

// Launch profili kullanılmadığında (ör. `dotnet run --no-launch-profile`) ASPNETCORE_ENVIRONMENT
// gelmez ve ASP.NET varsayılan olarak Production'a düşer. Bu da yanlış appsettings (change-me şifresi)
// + atlanan DB bootstrap/seed demektir → "boş/saçma DB". Bu proje yerelde her zaman Development
// çalışmalı: ortam açıkça verilmediyse Development'a sabitle.
Environment.SetEnvironmentVariable(
    "ASPNETCORE_ENVIRONMENT",
    Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT")
        ?? Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT")
        ?? "Development");

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddApiServices(builder.Configuration);
builder.Services.AddHostedService<TrialExpirationBackgroundService>();
builder.Services.AddHostedService<NotificationDispatchBackgroundService>();

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

app.UseResponseCompression();
app.UseMiddleware<ExceptionHandlingMiddleware>();
app.UseCors(ApiServiceCollectionExtensions.FrontendCorsPolicyName);
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<TenantResolutionMiddleware>();
app.UseMiddleware<TrialAccessMiddleware>();
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
app.MapSubscriptionPlanEndpoints();
app.MapAuditLogEndpoints();
app.MapFeatureEndpoints();
app.MapPlatformMessagingEndpoints();

app.Run();

public partial class Program { }
