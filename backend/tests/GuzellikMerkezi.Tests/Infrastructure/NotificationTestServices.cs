using GuzellikMerkezi.Application.Features.Notifications;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// NotificationService'in çalışma anında çözdüğü bağımlılıklar.
///
/// <para>
/// SMS kanalı mesaj kredisi/kota kararını <see cref="IWhatsAppBillingService"/>'ten alır ve o servis
/// bildirim kaydını AYNI DbContext üzerinden yazar (rezervasyon ile kayıt aynı transaction'da).
/// Bu yüzden testler sahte değil GERÇEK faturalama servisini, test edilen servisle aynı bağlamla verir.
/// </para>
/// </summary>
internal static class NotificationTestServices
{
    public static IServiceProvider WithBilling(GuzellikDbContext db)
    {
        var services = new ServiceCollection();
        services.AddSingleton<IWhatsAppBillingService>(new WhatsAppBillingService(
            db, NullLogger<WhatsAppBillingService>.Instance, new PaymentTestDoubles.SimulationResolver(),
            new NoopAuditLogger(), new TestCurrentUser(UserRole.InstitutionOwner)));
        // Kurumun kendi SMS hesabı: NotificationService gönderim anında kimlik bilgisini buradan çözer.
        // (Gönderimin kendisi test edilen servise verilen IPlatformMessagingService'ten yapılır.)
        services.AddSingleton<ITenantSmsConnectionService>(new TenantSmsConnectionService(
            db, NSubstitute.Substitute.For<IPlatformMessagingService>(), new AllowAllFeatureService(),
            new Microsoft.Extensions.Configuration.ConfigurationBuilder().Build(),
            NullLogger<TenantSmsConnectionService>.Instance));
        return services.BuildServiceProvider();
    }
}
