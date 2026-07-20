using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Adisyonlar;
using GuzellikMerkezi.Application.Features.AppNotifications;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.Auth;
using GuzellikMerkezi.Application.Features.AuditLogs;
using GuzellikMerkezi.Application.Features.Branches;
using GuzellikMerkezi.Application.Features.Campaigns;
using GuzellikMerkezi.Application.Features.CashFlow;
using GuzellikMerkezi.Application.Features.Commissions;
using GuzellikMerkezi.Application.Features.Consultations;
using GuzellikMerkezi.Application.Features.Customers;
using GuzellikMerkezi.Application.Features.DataImport;
using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Application.Features.CustomerPortal;
using GuzellikMerkezi.Application.Features.Expenses;
using GuzellikMerkezi.Application.Features.Features;
using GuzellikMerkezi.Application.Features.CashClosing;
using GuzellikMerkezi.Application.Features.GiftCards;
using GuzellikMerkezi.Application.Features.Waitlist;
using GuzellikMerkezi.Application.Features.Loyalty;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Application.Features.PlatformMessaging;
using GuzellikMerkezi.Application.Features.Ratings;
using GuzellikMerkezi.Application.Features.Schedule;
using GuzellikMerkezi.Application.Features.ServiceCatalog;
using GuzellikMerkezi.Application.Features.Notifications;
using GuzellikMerkezi.Application.Features.ServicePackages;
using GuzellikMerkezi.Application.Features.Staff;
using GuzellikMerkezi.Application.Features.Stock;
using GuzellikMerkezi.Application.Features.SubscriptionPlans;
using GuzellikMerkezi.Application.Features.Tenants;
using GuzellikMerkezi.Application.Features.TreatmentPhotos;
using GuzellikMerkezi.Application.Features.Usage;
using GuzellikMerkezi.Application.Features.WhatsApp;
using GuzellikMerkezi.Infrastructure.Background;
using GuzellikMerkezi.Infrastructure.Multitenancy;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Push;
using GuzellikMerkezi.Infrastructure.Security;
using GuzellikMerkezi.Infrastructure.Services;
using GuzellikMerkezi.Infrastructure.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http.Resilience;

namespace GuzellikMerkezi.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddMemoryCache(); // feature-set gating önbelleği (hot read path) için
        services.AddScoped<ITenantContext, TenantContext>();
        services.AddSingleton<IDateTimeProvider, SystemDateTimeProvider>();
        services.AddScoped<IPasswordHasher, PasswordHasher>();
        services.AddScoped<ITokenService, JwtTokenService>();
        services.AddScoped<IAuditLogger, AuditLogger>();
        services.AddScoped<IAuditActivityScope, AuditActivityScope>();
        // Field-level encryption singleton — yalnızca ham anahtarı tutar (ucuz), thread-safe.
        // AesGcm thread-safe olmadığından örneği paylaşmaz, çağrı başına yerel olarak oluşturur.
        services.AddSingleton<IEncryptionService, AesGcmEncryptionService>();

        services.AddDbContext<GuzellikDbContext>(options =>
        {
            var useInMemory = (bool.TryParse(configuration["Database:UseInMemory"], out var inMemoryEnabled) && inMemoryEnabled)
                || string.Equals(configuration["Database:Provider"], "InMemory", StringComparison.OrdinalIgnoreCase);

            if (useInMemory)
            {
                var databaseName = configuration["Database:Name"] ?? "GuzellikMerkeziDev";
                options
                    .UseInMemoryDatabase(databaseName)
                    .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning));
                return;
            }

            var connectionString = configuration.GetConnectionString("DefaultConnection")
                ?? "server=localhost;port=3306;database=guzellik_merkezi_dev;user=root;password=change-me;";
            options.UseMySQL(connectionString);
        });

        services.AddScoped<IUnitOfWork>(sp => sp.GetRequiredService<GuzellikDbContext>());
        services.AddScoped<IAuthService, AuthService>();
        services.AddScoped<ITenantService, TenantService>();
        services.AddScoped<IBranchService, BranchService>();
        services.AddScoped<ICustomerService, CustomerService>();
        services.AddScoped<IDataImportService, DataImportService>();
        services.AddScoped<ICustomerPortalService, CustomerPortalService>();
        services.AddScoped<IStaffService, StaffService>();
        services.AddScoped<IServiceCatalogService, ServiceCatalogService>();
        services.AddScoped<ICustomServiceCategoryService, CustomServiceCategoryService>();
        services.AddScoped<IServicePackageService, ServicePackageService>();
        services.AddScoped<ICustomerAccountService, CustomerAccountService>();
        services.AddScoped<IAdisyonService, AdisyonService>();
        services.AddScoped<ICommissionService, CommissionService>();
        services.AddScoped<IScheduleService, ScheduleService>();
        services.AddScoped<ICampaignService, CampaignService>();
        services.AddScoped<IGiftCardService, GiftCardService>();
        services.AddScoped<IWaitlistService, WaitlistService>();
        services.AddScoped<ICashClosingService, CashClosingService>();
        services.AddScoped<ILoyaltyService, LoyaltyService>();
        services.AddScoped<IExpenseService, ExpenseService>();
        services.AddScoped<ICustomExpenseCategoryService, CustomExpenseCategoryService>();
        services.AddScoped<ICashFlowService, CashFlowService>();
        services.AddScoped<IStockService, StockService>();
        services.AddScoped<IApprovalDispatcher, ApprovalDispatcher>();
        services.AddScoped<IPendingOperationService, PendingOperationService>();
        services.AddScoped<INotificationService, NotificationService>();
        services.AddScoped<ISubscriptionPlanService, SubscriptionPlanService>();
        services.AddScoped<IUsageService, UsageService>();
        services.AddScoped<IFeatureService, FeatureService>();
        services.AddScoped<IAuditLogService, AuditLogService>();
        services.AddScoped<Application.Features.Devices.IDeviceService, DeviceService>();
        services.AddScoped<Application.Features.Security.ISecurityService, SecurityService>();
        services.AddScoped<Application.Features.PlatformOps.IPlatformOpsService, PlatformOpsService>();

        // Kalıcı (DB-outbox) iş kuyruğu: kayıp toleransı olmayan arka plan işleri buradan akar.
        // RabbitMQ açıksa iş sinyali broker'a da gider (anında işleme); kapalıysa no-op → salt poller.
        if (configuration.GetValue<bool>("RabbitMq:Enabled"))
            services.AddSingleton<Background.IJobSignalPublisher, Background.RabbitMqJobSignalPublisher>();
        else
            services.AddSingleton<Background.IJobSignalPublisher, Background.NoopJobSignalPublisher>();
        services.AddScoped<IDurableJobQueue, Background.DurableJobQueue>();
        services.AddScoped<IDurableJobHandler, Background.WaitlistOfferJobHandler>();
        services.AddScoped<IDurableJobHandler, Background.WaitlistActivatedJobHandler>();
        services.AddScoped<IDurableJobHandler, Background.PushSendJobHandler>();
        services.AddScoped<IDurableJobHandler, Background.RatingLinkJobHandler>();
        services.AddScoped<IAppointmentService, AppointmentService>();
        services.AddScoped<IRatingService, RatingService>();
        services.AddScoped<Application.Features.PublicSalons.IPublicSalonService, PublicSalonService>();
        services.AddScoped<Application.Features.PublicSalons.ITenantProfileService, TenantProfileService>();
        services.AddScoped<ITreatmentPhotoService, TreatmentPhotoService>();
        services.AddScoped<IConsultationService, ConsultationService>();
        services.AddScoped<IWhatsAppService, WhatsAppService>();
        // Dış gönderim HttpClient'ları Polly standart dayanıklılık boru hattıyla sarılır
        // (retry + timeout + circuit breaker + rate limiter) → tek deneme yerine geçici hatalara dayanıklı.
        services.AddHttpClient("WhatsApp").AddStandardResilienceHandler();
        services.AddScoped<IPlatformMessagingService, PlatformMessagingService>();
        services.AddHttpClient("Sms").AddStandardResilienceHandler();

        // Uygulama-içi bildirim (push + feed) + FCM göndericisi (yapılandırma yoksa simülasyon).
        services.AddScoped<IAppNotificationService, AppNotificationService>();
        services.AddSingleton<IPushSender, FcmPushSender>();
        services.AddHttpClient("Fcm").AddStandardResilienceHandler();

        // Süreç-içi arka plan iş kuyruğu (yavaş dış gönderimleri request-path dışına taşır).
        services.AddSingleton<IBackgroundTaskQueue>(_ => new BackgroundTaskQueue(capacity: 1000));
        return services;
    }
}
