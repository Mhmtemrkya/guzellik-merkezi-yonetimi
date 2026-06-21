using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Application.Features.Adisyonlar;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.Auth;
using GuzellikMerkezi.Application.Features.AuditLogs;
using GuzellikMerkezi.Application.Features.Branches;
using GuzellikMerkezi.Application.Features.Campaigns;
using GuzellikMerkezi.Application.Features.CashFlow;
using GuzellikMerkezi.Application.Features.Commissions;
using GuzellikMerkezi.Application.Features.Consultations;
using GuzellikMerkezi.Application.Features.Customers;
using GuzellikMerkezi.Application.Features.CustomerAccounts;
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
using GuzellikMerkezi.Infrastructure.Multitenancy;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Security;
using GuzellikMerkezi.Infrastructure.Services;
using GuzellikMerkezi.Infrastructure.Time;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace GuzellikMerkezi.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddScoped<ITenantContext, TenantContext>();
        services.AddSingleton<IDateTimeProvider, SystemDateTimeProvider>();
        services.AddScoped<IPasswordHasher, PasswordHasher>();
        services.AddScoped<ITokenService, JwtTokenService>();
        services.AddScoped<IAuditLogger, AuditLogger>();
        services.AddScoped<IAuditActivityScope, AuditActivityScope>();
        // Field-level encryption singleton — AesGcm instance pahalı, paylaşılan.
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
        services.AddScoped<IAppointmentService, AppointmentService>();
        services.AddScoped<IRatingService, RatingService>();
        services.AddScoped<ITreatmentPhotoService, TreatmentPhotoService>();
        services.AddScoped<IConsultationService, ConsultationService>();
        services.AddScoped<IWhatsAppService, WhatsAppService>();
        services.AddHttpClient("WhatsApp");
        services.AddScoped<IPlatformMessagingService, PlatformMessagingService>();
        services.AddHttpClient("Sms");
        return services;
    }
}
