using System.IO.Compression;
using System.Text;
using System.Text.Json.Serialization;
using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Api.Approval;
using GuzellikMerkezi.Api.Security;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.ResponseCompression;
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
            });

        services.AddAuthorization(options =>
        {
            // /api/platform/* uçları yalnızca platform yöneticisine açık (kurum/personel erişemez).
            options.AddPolicy("PlatformAdmin", policy => policy.RequireRole(nameof(GuzellikMerkezi.Domain.Enums.UserRole.PlatformAdmin)));
        });
        return services;
    }
}
