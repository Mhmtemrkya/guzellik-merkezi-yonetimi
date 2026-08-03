using System.IO.Compression;
using System.Security.Claims;
using System.Text;
using System.Text.Json.Serialization;
using System.IdentityModel.Tokens.Jwt;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Api.Approval;
using GuzellikMerkezi.Api.Realtime;
using GuzellikMerkezi.Api.Security;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.IdentityModel.Tokens;

namespace GuzellikMerkezi.Api.Extensions;

public static class ApiServiceCollectionExtensions
{
    public const string FrontendCorsPolicyName = "Frontend";

    public static IServiceCollection AddApiServices(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddHttpContextAccessor();

        // Yanıt sıkıştırma (Brotli/Gzip) — büyük JSON liste payload'ları %70-90 küçülür.
        services.AddResponseCompression(options =>
        {
            options.EnableForHttps = true;
            options.Providers.Add<BrotliCompressionProvider>();
            options.Providers.Add<GzipCompressionProvider>();
        });
        services.Configure<BrotliCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);
        services.Configure<GzipCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);

        services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
        });
        services.AddScoped<ICurrentUser, HttpCurrentUser>();

        // ---- Anlık güncelleme (SignalR) ----
        // Kalıcılık DEĞİL, yalnız "hemen tazele" kanalı: durum her zaman DB'dedir, mesaj kaybolursa
        // istemci yeniden bağlanınca doğru veriyi okur. Redis YALNIZCA yapılandırıldıysa devreye girer:
        // tek instance'ta gereksizdir, çok instance'ta bir sunucudaki olayın diğerine bağlı istemcilere
        // de ulaşmasını sağlar (backplane). Yapılandırılmazsa in-memory ile çalışmaya devam eder.
        var signalR = services.AddSignalR(o => o.EnableDetailedErrors = false);
        var redisConnection = configuration["Redis:ConnectionString"];
        if (!string.IsNullOrWhiteSpace(redisConnection))
        {
            signalR.AddStackExchangeRedis(redisConnection, o =>
                o.Configuration.ChannelPrefix = StackExchange.Redis.RedisChannel.Literal(
                    configuration["Redis:ChannelPrefix"] ?? "beautyasist"));
        }
        services.AddSingleton<IRealtimeNotifier, SignalRRealtimeNotifier>();

        // Evrensel personel onay kapısı: onaylanan isteği localhost'a replay eden servis.
        services.AddHttpClient("ApprovalReplay");
        services.AddScoped<IApprovalReplayer, HttpApprovalReplayer>();
        services.AddCors(options =>
        {
            options.AddPolicy(FrontendCorsPolicyName, policy =>
            {
                var origins = configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
                    ?? ["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000", "http://127.0.0.1:5173"];
                policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().AllowCredentials();
            });
        });

        var issuer = configuration["Jwt:Issuer"] ?? "GuzellikMerkezi";
        var audience = configuration["Jwt:Audience"] ?? "GuzellikMerkezi.Client";
        var signingKey = configuration["Jwt:SigningKey"] ?? "development-only-signing-key-change-me-min-32-bytes";
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidateAudience = true,
                    ValidateIssuerSigningKey = true,
                    ValidateLifetime = true,
                    ValidIssuer = issuer,
                    ValidAudience = audience,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
                    ClockSkew = TimeSpan.FromMinutes(1)
                };

                // OTURUM DAMGASI DOĞRULAMASI.
                //
                // Parola değişimi/sıfırlama refresh token'ları DB'de iptal ediyordu ama ELDEKİ access
                // token 60 dakikaya kadar geçerli kalıyordu: ele geçirilmiş bir oturum, kullanıcı
                // parolasını değiştirdikten sonra da bir saat boyunca çalışmaya devam edebiliyordu.
                // TenantUser.SecurityStampUtc alanı ve InvalidateSessions() zaten vardı; eksik olan
                // yalnızca KONTROLDÜ. Token'ın üretim anı damgadan eskiyse istek reddedilir.
                options.Events = new JwtBearerEvents
                {
                    // SignalR: tarayıcı WebSocket/SSE isteklerine header ekleyemez, token
                    // ?access_token= ile gelir. YALNIZ /hubs yolunda kabul edilir ki normal
                    // API uçlarında token'ın URL'e (ve sunucu loglarına) düşmesine izin verilmesin.
                    OnMessageReceived = ctx =>
                    {
                        if (string.IsNullOrEmpty(ctx.Token))
                        {
                            var accessToken = ctx.Request.Query["access_token"].ToString();
                            if (!string.IsNullOrEmpty(accessToken)
                                && ctx.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                            {
                                ctx.Token = accessToken;
                            }
                        }
                        return Task.CompletedTask;
                    },
                    OnTokenValidated = async ctx =>
                    {
                        var principal = ctx.Principal;
                        if (principal is null) return;

                        // Müşteri token'ının TenantUser karşılığı yoktur → bu kontrol uygulanmaz.
                        if (principal.FindFirst("customer_id") is not null) return;
                        if (!Guid.TryParse(principal.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId)) return;

                        // iat yoksa token bu değişiklikten ÖNCE üretilmiştir → eski davranış (kabul).
                        // Deploy anında kimse zorla çıkarılmasın diye bilinçli olarak fail-open.
                        if (!long.TryParse(principal.FindFirst(JwtRegisteredClaimNames.Iat)?.Value, out var issuedUnix)) return;
                        var issuedAtUtc = DateTimeOffset.FromUnixTimeSeconds(issuedUnix).UtcDateTime;

                        // Damga kısa süreli önbellekten okunur: her istekte DB'ye gitmek pahalı olurdu.
                        // Bedeli, parola değişiminin en fazla bu süre kadar gecikmesidir.
                        var cache = ctx.HttpContext.RequestServices.GetRequiredService<IMemoryCache>();
                        var cacheKey = $"secstamp:{userId}";
                        if (!cache.TryGetValue<DateTime?>(cacheKey, out var stamp))
                        {
                            var db = ctx.HttpContext.RequestServices.GetRequiredService<GuzellikDbContext>();
                            // IgnoreQueryFilters: tenant kapsamı bu noktada henüz kurulmadı, aksi hâlde
                            // kullanıcı bulunamaz ve kontrol sessizce atlanırdı.
                            stamp = await db.TenantUsers.AsNoTracking().IgnoreQueryFilters()
                                .Where(u => u.Id == userId)
                                .Select(u => u.SecurityStampUtc)
                                .FirstOrDefaultAsync(ctx.HttpContext.RequestAborted);
                            cache.Set(cacheKey, stamp, TimeSpan.FromSeconds(30));
                        }

                        if (stamp is { } invalidatedAt
                            && issuedAtUtc < DateTime.SpecifyKind(invalidatedAt, DateTimeKind.Utc))
                        {
                            ctx.Fail("Oturum sonlandırıldı; lütfen yeniden giriş yapın.");
                        }
                    },
                };
            });

        services.AddAuthorization(options =>
        {
            // /api/platform/* uçları yalnızca platform yöneticisine açık (kurum/personel erişemez).
            options.AddPolicy("PlatformAdmin", policy => policy.RequireRole(nameof(GuzellikMerkezi.Domain.Enums.UserRole.PlatformAdmin)));
        });
        return services;
    }
}
