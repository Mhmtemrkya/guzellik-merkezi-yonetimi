using GuzellikMerkezi.Api.Background;
using GuzellikMerkezi.Api.Development;
using GuzellikMerkezi.Api.Endpoints;
using GuzellikMerkezi.Api.Extensions;
using GuzellikMerkezi.Api.Middleware;
using GuzellikMerkezi.Application;
using GuzellikMerkezi.Infrastructure;
using GuzellikMerkezi.Infrastructure.Payments;
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
// Müşteri OTP girişi — kodlar bellekte 5 dk tutulur (tek örnekli dağıtım).
builder.Services.AddMemoryCache();
builder.Services.AddScoped<GuzellikMerkezi.Api.Services.CustomerOtpService>();
builder.Services.AddHostedService<TrialExpirationBackgroundService>();
builder.Services.AddHostedService<NotificationDispatchBackgroundService>();
builder.Services.AddHostedService<MonthlyReportBackgroundService>();
builder.Services.AddHostedService<WhatsAppReservationSweepBackgroundService>();
builder.Services.AddHostedService<SubscriptionRenewalBackgroundService>();
// Arka plan iş kuyruğu tüketicisi (WhatsApp/SMS/FCM gönderimlerini request-path dışında yürütür).
builder.Services.AddHostedService<QueuedHostedService>();
// Kalıcı (DB-outbox) iş kuyruğu tüketicisi — restart'ta kaybolmaması gereken işler.
builder.Services.AddHostedService<DurableJobHostedService>();
// RabbitMQ açıksa iş sinyali tüketicisi de çalışır (anında işleme; poller güvenlik ağı olarak kalır).
if (builder.Configuration.GetValue<bool>("RabbitMq:Enabled"))
    builder.Services.AddHostedService<RabbitMqJobConsumerHostedService>();
// Anlık kanal nöbetçisi: iptal edilmiş oturumların AÇIK soketlerini koparır (yetki yalnız
// bağlanırken kontrol ediliyordu; WebSocket iptalden etkilenmiyordu).
builder.Services.AddSingleton<GuzellikMerkezi.Api.Realtime.RealtimeConnectionRegistry>();
builder.Services.AddHostedService<RealtimeSessionSentinel>();

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
    /// <summary>
    /// HIZ SINIRI BÖLÜMLEME ANAHTARI.
    ///
    /// <para>
    /// SOMUT AÇIK: BFF (Next.js proxy) varsayılan olarak <c>X-Forwarded-For</c>'u SİLER — istemci
    /// sahte IP göndererek sınırı aşmasın diye (doğru bir fail-closed tercih). Ama sonuç olarak
    /// backend TÜM kullanıcıları tek bir IP'de (proxy) görüyordu: tek bir istemci login/OTP
    /// kotasını doldurup SİTENİN TAMAMINI 429'a düşürebiliyordu.
    /// </para>
    /// <para>
    /// ÇÖZÜM: proxy, istemci başına sahtelenemez bir bölümleme anahtarı üretir (HttpOnly çerez →
    /// <c>X-Client-Partition</c>, proxy her istekte ÜZERİNE YAZAR). Bu başlığa yalnız GÜVENİLEN
    /// proxy'den (loopback) geldiğinde itibar edilir; doğrudan gelen isteklerde yok sayılır ve IP'ye
    /// düşülür. Böylece istemciler ayrışır, sahtecilik yolu açılmaz.
    /// </para>
    /// </summary>
    static string ClientIp(HttpContext http)
    {
        var ip = http.Connection.RemoteIpAddress;
        var partition = http.Request.Headers["X-Client-Partition"].ToString();
        if (partition.Length is > 0 and <= 64 && ip is not null && System.Net.IPAddress.IsLoopback(ip))
            return $"p:{partition}";
        return ip?.ToString() ?? "unknown";
    }

    /// <summary>Soket adresi — istemcinin DEĞİŞTİREMEYECEĞİ tek anahtar (çerez silmek etkilemez).</summary>
    static string SocketIp(HttpContext http) => http.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    // IP TAVANI — BÖLÜMLEME ANAHTARININ ÜSTÜNDE İKİNCİ KATMAN.
    //
    // SOMUT AÇIK: bölümleme anahtarı tarayıcı çerezinden gelir; kullanıcı çerezi silerek HER
    // SEFERİNDE yeni bir kova alabilir, yani login/OTP sınırı fiilen sınırsız hâle gelirdi.
    // (Kova anahtarı yine gerekli: onsuz TÜM kullanıcılar proxy IP'sinde tek kovada birleşiyor ve
    // tek istemci siteyi 429'a düşürebiliyordu.) İki katman birlikte doğru davranışı verir:
    // ince kova adil paylaşım sağlar, KABA TAVAN ise kaçışı engeller.
    //
    // Tavan yalnız kimlik doğrulama/OTP yollarına uygulanır: yönetici panelinin normal kullanımı
    // (aynı NAT arkasındaki bir salonun tüm personeli) yanlışlıkla kısılmasın.
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(http =>
    {
        var path = http.Request.Path.Value ?? string.Empty;
        var isAuthPath = path.StartsWith("/api/auth", StringComparison.OrdinalIgnoreCase);
        if (!isAuthPath) return RateLimitPartition.GetNoLimiter("none");

        return RateLimitPartition.GetFixedWindowLimiter($"ip:{SocketIp(http)}",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 60, Window = TimeSpan.FromMinutes(5), QueueLimit = 0 });
    });
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
    // Herkese açık salon vitrini (anonim gezinme): IP başına dakikada 60 istek.
    options.AddPolicy("public-browse", http => RateLimitPartition.GetFixedWindowLimiter(ClientIp(http),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 60, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    // ÖDEME DÖNÜŞÜ (anonim): sağlayıcı ya da kullanıcı tarayıcısı çağırır, oturum taşımaz. Her
    // istek sağlayıcıya bir SORGU (dış çağrı) tetikler; sınırsız bırakıldığında uydurma
    // anahtarlarla hem sağlayıcı kotası tüketilir hem sonuç deneme-yanılması yapılırdı. Meşru
    // dönüş tek bir istektir; IP başına dakikada 30 fazlasıyla yeter.
    options.AddPolicy("payment-callback", http => RateLimitPartition.GetFixedWindowLimiter(ClientIp(http),
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});

var app = builder.Build();

// ŞEMA GÜNCELLEME KOMUTU — CANLI DEPLOY'UN DESTEKLENEN YOLU.
//
// SOMUT AÇIK: canlıda migration'lar `dotnet ef database update` ya da boru hattına verilen bir
// SQL betiğiyle uygulanıyordu. Bu yolların hiçbiri uygulamanın kendi korumalarını kullanmıyor:
// veritabanına özel GET_LOCK (iki örneğin aynı anda migrate etmesini engeller) ve
// `__migration_attempt` izi (DDL uygulanıp geçmiş yazılmadan çökmeyi teşhis eder) devre dışı
// kalıyordu. Deploy betiği artık uygulamayı `--migrate-only` ile çağırır: aynı binary, aynı
// korumalar, sunucuda EF CLI gerekmez.
//
//   ./GuzellikMerkezi.Api --migrate-only      → migration'ları uygular, çıkar (0 = başarılı)
if (args.Contains("--migrate-only", StringComparer.OrdinalIgnoreCase))
{
    using var migrationScope = app.Services.CreateScope();
    var migrationDb = migrationScope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
    var migrationLogger = migrationScope.ServiceProvider.GetRequiredService<ILoggerFactory>()
        .CreateLogger("Migration");
    try
    {
        await DatabaseBootstrap.MigrateDatabaseAsync(migrationDb, migrationLogger);
        migrationLogger.LogInformation("Şema güncel. Uygulama başlatılmadı (--migrate-only).");
        return 0;
    }
    catch (Exception ex)
    {
        // Sıfırdan farklı çıkış kodu: deploy betiği burada DURMALI, servisi yeni sürüme almamalı.
        migrationLogger.LogError(ex, "Migration uygulanamadı; deploy durduruldu.");
        return 1;
    }
}

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

// Veritabanı bootstrap + seed — YALNIZ Development. Demo hesaplar bilinen bir parolayla gelir ve
// PlatformAdmin dahil ayrıcalıklı roller açar; bu yüzden başka hiçbir ortamda çalıştırılamaz.
// Seed IDEMPOTENT'tir: kurum zaten varsa hiçbir demo verisi eklemez ve mevcut şifrelere DOKUNMAZ.
// Yeni bir CANLI kurulumda şema migration'ları ELLE uygulanır; ilk yönetici hesabı platform
// tarafından oluşturulur (demo seeder ile değil).
var seedDemoData = bool.TryParse(app.Configuration["Database:SeedDemoData"], out var demoFlag) && demoFlag;
var recreateOnStartup = bool.TryParse(app.Configuration["Database:RecreateOnStartup"], out var recreateFlag) && recreateFlag;

// GÜVENLİK KAPISI: demo seed BİLİNEN parolalı PlatformAdmin/owner/staff hesapları açar,
// RecreateOnStartup ise EnsureDeleted ile TÜM veritabanını silebilir. İkisi de yalnız
// Development'ta anlamlıdır; yanlış bir ortam değişkeni production/staging'de ayrıcalıklı hesap
// yaratmamalı ya da veriyi silmemeli. DB'ye dokunmadan ÖNCE fail-fast.
if (!app.Environment.IsDevelopment() && (seedDemoData || recreateOnStartup))
{
    throw new InvalidOperationException(
        "Database:SeedDemoData ve Database:RecreateOnStartup yalnız Development ortamında kullanılabilir. " +
        $"Geçerli ortam: {app.Environment.EnvironmentName}. Bu bayrakları kaldırın.");
}

// GÜVENLİK KAPISI: canlıda sahte ödeme sağlayıcısını açan eski kaçış kapısı kalmışsa uygulama açılmaz.
// Ödeme akışı zaten fail-closed davranıyor; bu kontrol yanlış konfigürasyonu deploy anında görünür kılar.
PaymentGatewayResolver.EnsureProductionPaymentConfiguration(app.Configuration, app.Environment.EnvironmentName);

if (app.Environment.IsDevelopment())
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

// Şifreli ad/telefon/e-posta üzerinde arama yapabilmek için blind index'i doldur. Her ortamda çalışır:
// veri-only + idempotent (yalnızca SearchIndex NULL satırlara dokunur), DDL yapmaz. Kolon henüz yoksa
// (migration uygulanmamış) sessizce uyarı loglar. Bitene kadar arama tam-tarama moduna düşer, sonuç doğrudur.
await DatabaseBootstrap.BackfillCustomerSearchIndexAsync(app.Services);

// İptal arşivi bakımı: ham SQL migration'ının bıraktığı DÜZ METİN yedekleri şifreler ve iptal edilmiş
// satışların tahsilatlarını kalıcı deftere (archived_sale_payments) taşır. Yedek şifreli olduğundan
// bu iş SQL'de yapılamaz. Veri-only + idempotent → her ortamda, her açılışta güvenle çalışır.
await DatabaseBootstrap.BackfillCancelledSaleArchivesAsync(app.Services);

// Peşinatları gerçek tahsilat hareketine taşı. Cari onları "tahsil edilmiş" sayarken kasa/rapor
// hiç görmüyordu. İSTEK ALMADAN ÖNCE çalışması şart: PaidAmount artık peşinat kolonunu değil
// tahsilat satırlarını okuyor. Veri-only + idempotent.
await DatabaseBootstrap.BackfillDepositPaymentsAsync(app.Services);

// Eski paket kullanımlarına kesin seans bağı üret (yalnız tek aday varsa — bkz. metot notu).
// Veri-only + idempotent; bağ olmadan satış iptali tahminî yola düşer.
await DatabaseBootstrap.BackfillPackageSessionUsagesAsync(app.Services);

// Eski tahsilat/stok satırlarına kaynak adisyon bağı yaz. Reference ŞİFRELİ olduğu için
// eşleştirme SQL'de yapılamaz; çözülmüş değer uygulama içinde adisyon Id'siyle eşlenir.
await DatabaseBootstrap.BackfillAdisyonSourceLinksAsync(app.Services);

// Taksit planı cari toplamının gerisinde kalmış carileri hizalar. OPT-IN + HEDEFLİ — varsayılan
// KAPALI: para etkileyen bir veri düzeltmesi her açılışta, her kurumda kendiliğinden çalışmamalı.
// Bayrağın tek başına açılması YETMEZ; ...AccountIds listesi ve her cari için beklenen değerler
// (...Expected:<accountId>:TenantId/TotalAmount/DepositAmount/FinancedAmount/PlanTotal/InstallmentCount)
// zorunludur. Eksik ayar, uyuşmayan değer ya da onarılamayan hedef → açılış BAŞARISIZ (veri değişmez).
await DatabaseBootstrap.RepairInstallmentPlanDriftAsync(app.Services, app.Configuration);

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

// Anlık güncelleme kanalı — onay/adisyon/seans değişikliklerini açık ekranlara duyurur.
app.MapHub<GuzellikMerkezi.Api.Realtime.RealtimeHub>(GuzellikMerkezi.Api.Realtime.RealtimeHub.Path)
   .RequireCors(ApiServiceCollectionExtensions.FrontendCorsPolicyName);

app.MapHealthEndpoints();
app.MapAuthEndpoints();
app.MapTenantEndpoints();
app.MapBranchEndpoints();
app.MapCustomerEndpoints();
app.MapImportEndpoints();
app.MapCustomerPortalEndpoints();
app.MapTreatmentPhotoEndpoints();
app.MapConsultationEndpoints();
app.MapConsentEndpoints();
app.MapStaffEndpoints();
app.MapServiceDefinitionEndpoints();
app.MapServicePackageEndpoints();
app.MapCustomServiceCategoryEndpoints();
app.MapAppointmentEndpoints();
app.MapRatingEndpoints();
app.MapPublicSalonEndpoints();
app.MapWhatsAppEndpoints();
app.MapCustomerAccountEndpoints();
app.MapAdisyonEndpoints();
app.MapCommissionEndpoints();
app.MapScheduleEndpoints();
app.MapCalendarFeedEndpoints();
app.MapCampaignEndpoints();
app.MapGiftCardEndpoints();
app.MapWaitlistEndpoints();
app.MapCashClosingEndpoints();
app.MapLoyaltyEndpoints();
app.MapExpenseEndpoints();
app.MapCustomExpenseCategoryEndpoints();
app.MapCashFlowEndpoints();
app.MapReportsEndpoints();
app.MapStockEndpoints();
app.MapPendingOperationEndpoints();
app.MapNotificationEndpoints();
app.MapAppNotificationEndpoints();
app.MapSubscriptionPlanEndpoints();
app.MapBillingEndpoints();
app.MapAuditLogEndpoints();
app.MapDeviceEndpoints();
app.MapSecurityEndpoints();
app.MapFeatureEndpoints();
app.MapPlatformMessagingEndpoints();
app.MapPlatformWhatsAppEndpoints();
app.MapPlatformOpsEndpoints();

app.Run();
return 0;

public partial class Program { }
