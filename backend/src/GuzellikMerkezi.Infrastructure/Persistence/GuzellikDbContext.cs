using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace GuzellikMerkezi.Infrastructure.Persistence;

public sealed class GuzellikDbContext : DbContext, IUnitOfWork
{
    private readonly ITenantContext? _tenantContext;
    private readonly ICurrentUser? _currentUser;
    private readonly IDateTimeProvider? _clock;
    private readonly IEncryptionService? _encryption;

    public GuzellikDbContext(DbContextOptions<GuzellikDbContext> options, ITenantContext? tenantContext = null, ICurrentUser? currentUser = null, IDateTimeProvider? clock = null, IEncryptionService? encryption = null)
        : base(options)
    {
        _tenantContext = tenantContext;
        _currentUser = currentUser;
        _clock = clock;
        _encryption = encryption;
    }

    private bool TenantFilterDisabled => _tenantContext is null || _tenantContext.IsPlatformAdmin || _tenantContext.TenantId is null;
    private Guid? TenantFilterId => _tenantContext?.TenantId;

    // Şube kapsamı: seçili şube yoksa (veya platform admin) devre dışı. Operasyonel entity'lere uygulanır;
    // şubesi null olan (kurum geneli) kayıtlar her şubede görünür ki veri kaybolmasın.
    private bool BranchFilterDisabled => _tenantContext is null || _tenantContext.IsPlatformAdmin || _tenantContext.BranchId is null;
    private Guid? BranchFilterId => _tenantContext?.BranchId;

    // MySql.EntityFrameworkCore 10.x DateOnly'yi native desteklemediği için
    // converter ile MySQL DATETIME üzerine map ediyoruz (time = 00:00:00).
    private static readonly ValueConverter<DateOnly, DateTime> DateOnlyConverter = new(
        v => v.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc),
        v => DateOnly.FromDateTime(v));

    private static readonly ValueConverter<DateOnly?, DateTime?> DateOnlyNullableConverter = new(
        v => v.HasValue ? v.Value.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc) : (DateTime?)null,
        v => v.HasValue ? DateOnly.FromDateTime(v.Value) : (DateOnly?)null);

    private static readonly ValueConverter<TimeOnly, TimeSpan> TimeOnlyConverter = new(
        v => v.ToTimeSpan(),
        v => TimeOnly.FromTimeSpan(v));

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<Branch> Branches => Set<Branch>();
    public DbSet<TenantUser> TenantUsers => Set<TenantUser>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<StaffMember> StaffMembers => Set<StaffMember>();
    public DbSet<ServiceDefinition> ServiceDefinitions => Set<ServiceDefinition>();
    public DbSet<ServicePackage> ServicePackages => Set<ServicePackage>();
    public DbSet<ServicePackageItem> ServicePackageItems => Set<ServicePackageItem>();
    public DbSet<Appointment> Appointments => Set<Appointment>();
    public DbSet<AppointmentRating> AppointmentRatings => Set<AppointmentRating>();
    public DbSet<CustomerAccount> CustomerAccounts => Set<CustomerAccount>();
    public DbSet<Installment> Installments => Set<Installment>();
    public DbSet<AccountPayment> AccountPayments => Set<AccountPayment>();
    public DbSet<CustomerPackageSession> CustomerPackageSessions => Set<CustomerPackageSession>();
    public DbSet<CustomerTreatmentPhoto> CustomerTreatmentPhotos => Set<CustomerTreatmentPhoto>();
    public DbSet<ConsultationForm> ConsultationForms => Set<ConsultationForm>();
    public DbSet<ConsultationCustomOption> ConsultationCustomOptions => Set<ConsultationCustomOption>();
    public DbSet<WhatsAppSettings> WhatsAppSettings => Set<WhatsAppSettings>();
    public DbSet<WhatsAppMessage> WhatsAppMessages => Set<WhatsAppMessage>();
    public DbSet<PlatformIntegrationSettings> PlatformIntegrationSettings => Set<PlatformIntegrationSettings>();
    public DbSet<PlatformSystemSettings> PlatformSystemSettings => Set<PlatformSystemSettings>();
    public DbSet<TenantInvoice> TenantInvoices => Set<TenantInvoice>();
    public DbSet<BackgroundJob> BackgroundJobs => Set<BackgroundJob>();
    public DbSet<ProcessedClientRequest> ProcessedClientRequests => Set<ProcessedClientRequest>();
    public DbSet<Adisyon> Adisyonlar => Set<Adisyon>();
    public DbSet<AdisyonItem> AdisyonItems => Set<AdisyonItem>();
    public DbSet<StaffCommission> StaffCommissions => Set<StaffCommission>();
    public DbSet<StaffTimeOff> StaffTimeOffs => Set<StaffTimeOff>();
    public DbSet<StaffWorkingHour> StaffWorkingHours => Set<StaffWorkingHour>();
    public DbSet<Campaign> Campaigns => Set<Campaign>();
    public DbSet<GiftCard> GiftCards => Set<GiftCard>();
    public DbSet<WaitlistEntry> WaitlistEntries => Set<WaitlistEntry>();
    public DbSet<CashRegisterClosing> CashRegisterClosings => Set<CashRegisterClosing>();
    public DbSet<LoyaltyTransaction> LoyaltyTransactions => Set<LoyaltyTransaction>();
    public DbSet<BusinessExpense> BusinessExpenses => Set<BusinessExpense>();
    public DbSet<CustomExpenseCategory> CustomExpenseCategories => Set<CustomExpenseCategory>();
    public DbSet<CustomServiceCategory> CustomServiceCategories => Set<CustomServiceCategory>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<StockMovement> StockMovements => Set<StockMovement>();
    public DbSet<PendingOperation> PendingOperations => Set<PendingOperation>();
    public DbSet<NotificationTemplate> NotificationTemplates => Set<NotificationTemplate>();
    public DbSet<NotificationLog> NotificationLogs => Set<NotificationLog>();
    public DbSet<SubscriptionPlan> SubscriptionPlans => Set<SubscriptionPlan>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<StaffDevice> StaffDevices => Set<StaffDevice>();
    public DbSet<AppNotification> AppNotifications => Set<AppNotification>();
    public DbSet<DeviceNotificationToken> DeviceNotificationTokens => Set<DeviceNotificationToken>();
    public DbSet<TenantPublicProfile> TenantPublicProfiles => Set<TenantPublicProfile>();
    public DbSet<TenantGalleryPhoto> TenantGalleryPhotos => Set<TenantGalleryPhoto>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        ConfigureTenant(modelBuilder);
        ConfigureBranch(modelBuilder);
        ConfigureTenantUser(modelBuilder);
        ConfigureCustomer(modelBuilder);
        ConfigureStaff(modelBuilder);
        ConfigureServiceDefinition(modelBuilder);
        ConfigureServicePackage(modelBuilder);
        ConfigureAppointment(modelBuilder);
        ConfigureAppointmentRating(modelBuilder);
        ConfigureCustomerAccount(modelBuilder);
        ConfigureCustomerTreatmentPhoto(modelBuilder);
        ConfigureConsultationForm(modelBuilder);
        ConfigureConsultationCustomOption(modelBuilder);
        ConfigureWhatsApp(modelBuilder);
        ConfigurePlatformIntegrationSettings(modelBuilder);
        ConfigureAdisyon(modelBuilder);
        ConfigureStaffCommission(modelBuilder);
        ConfigureCampaign(modelBuilder);
        ConfigureGiftCard(modelBuilder);
        ConfigureWaitlist(modelBuilder);
        ConfigureCashClosing(modelBuilder);
        ConfigureLoyalty(modelBuilder);
        ConfigureBusinessExpense(modelBuilder);
        ConfigureCustomExpenseCategory(modelBuilder);
        ConfigureCustomServiceCategory(modelBuilder);
        ConfigureProductAndStock(modelBuilder);
        ConfigurePendingOperation(modelBuilder);
        ConfigureNotification(modelBuilder);
        ConfigureSubscriptionPlan(modelBuilder);
        ConfigureRefreshToken(modelBuilder);
        ConfigureAuditLog(modelBuilder);
        ConfigureStaffDevice(modelBuilder);
        ConfigureAppNotification(modelBuilder);
        ConfigurePlatformOps(modelBuilder);
        ConfigureTenantPublicProfile(modelBuilder);
        ApplyEncryptionConverters(modelBuilder);
    }

    /// <summary>
    /// Tüm hassas metin alanlarını AES-GCM şifreleyici converter'a bağlar.
    /// Login lookup için kullanılan kolonlar (Email/Slug/PasswordHash/TokenHash) burada YER ALMAZ.
    /// </summary>
    private void ApplyEncryptionConverters(ModelBuilder modelBuilder)
    {
        // Şifreli değer "ENC:v1:base64(nonce|cipher|tag)" formatındadır ve düz metinden belirgin biçimde
        // (yaklaşık +%85) daha uzundur. Bu yüzden şifrelenen kolonlar dar VARCHAR(N)'e map edilemez; aksi halde
        // production'ın strict SQL modunda "Data too long for column" hatası alınır (kurum/personel/müşteri
        // oluşturmada telefon/ad alanları). Çözüm:
        //  - Varsayılan: LONGTEXT (indekslenmeyen kolonlar — sınırsız uzunluk).
        //  - İndeksli kolonlar: TEXT/LONGTEXT MySQL'de prefix'siz indekslenemez → ciphertext'i taşıyacak kadar
        //    geniş ama indekslenebilir VARCHAR(512).
        // ÖNEMLİ: Kolon TİPİNİ genişletmek encryption'dan BAĞIMSIZ yapılır (design-time'da _encryption null olsa
        // bile migration doğru tipi görsün). Converter yalnızca encryption aktifken bağlanır.
        const string EncryptedColumnType = "longtext";
        const string EncryptedIndexedColumnType = "varchar(512)";

        var required = _encryption is null ? null : new EncryptedStringConverter(_encryption);
        var optional = _encryption is null ? null : new NullableEncryptedStringConverter(_encryption);

        void Req(Type t, params string[] props)
        {
            var b = modelBuilder.Entity(t);
            foreach (var p in props)
            {
                var pb = b.Property<string>(p).HasColumnType(EncryptedColumnType);
                if (required is not null) pb.HasConversion(required);
            }
        }
        void Opt(Type t, params string[] props)
        {
            var b = modelBuilder.Entity(t);
            foreach (var p in props)
            {
                var pb = b.Property<string?>(p).HasColumnType(EncryptedColumnType);
                if (optional is not null) pb.HasConversion(optional);
            }
        }
        // İndekse giren şifreli (required) kolonlar — indekslenebilir geniş VARCHAR.
        void ReqIndexed(Type t, params string[] props)
        {
            var b = modelBuilder.Entity(t);
            foreach (var p in props)
            {
                var pb = b.Property<string>(p).HasColumnType(EncryptedIndexedColumnType);
                if (required is not null) pb.HasConversion(required);
            }
        }

        Req(typeof(Tenant), nameof(Tenant.Name));
        Opt(typeof(Tenant), nameof(Tenant.OwnerName), nameof(Tenant.Domain), nameof(Tenant.Phone), nameof(Tenant.TaxNumber), nameof(Tenant.LegalName), nameof(Tenant.TaxOffice), nameof(Tenant.Email));

        ReqIndexed(typeof(Branch), nameof(Branch.Name)); // indeks: { TenantId, Name }
        Req(typeof(Branch), nameof(Branch.City));

        Opt(typeof(TenantUser), nameof(TenantUser.FullName), nameof(TenantUser.Permissions));

        Req(typeof(Customer), nameof(Customer.FullName));
        ReqIndexed(typeof(Customer), nameof(Customer.Phone)); // indeks: { TenantId, BranchId, Phone }
        Opt(typeof(Customer), nameof(Customer.Email), nameof(Customer.Notes));

        Req(typeof(StaffMember), nameof(StaffMember.FullName), nameof(StaffMember.Title));
        Opt(typeof(StaffMember), nameof(StaffMember.Phone), nameof(StaffMember.Specialties));

        Req(typeof(ServiceDefinition), nameof(ServiceDefinition.Name));
        Opt(typeof(ServiceDefinition), nameof(ServiceDefinition.Category), nameof(ServiceDefinition.SubCategory));

        ReqIndexed(typeof(ServicePackage), nameof(ServicePackage.Name)); // indeks: { TenantId, Name }
        Opt(typeof(ServicePackage), nameof(ServicePackage.Description), nameof(ServicePackage.Category), nameof(ServicePackage.SubCategory));

        Opt(typeof(Appointment), nameof(Appointment.Notes), nameof(Appointment.CancellationReason));

        Req(typeof(AppointmentRating), nameof(AppointmentRating.CustomerPhone), nameof(AppointmentRating.StaffName));
        Opt(typeof(AppointmentRating), nameof(AppointmentRating.ServiceName), nameof(AppointmentRating.BusinessName), nameof(AppointmentRating.Comment));

        Req(typeof(CustomerAccount), nameof(CustomerAccount.Name));
        Opt(typeof(CustomerAccount), nameof(CustomerAccount.Notes));

        Opt(typeof(AccountPayment), nameof(AccountPayment.Method), nameof(AccountPayment.Reference));

        Opt(typeof(BusinessExpense), nameof(BusinessExpense.Description), nameof(BusinessExpense.Reference), nameof(BusinessExpense.PeriodLabel));

        ReqIndexed(typeof(CustomExpenseCategory), nameof(CustomExpenseCategory.Name)); // indeks: { TenantId, Name }
        ReqIndexed(typeof(CustomServiceCategory), nameof(CustomServiceCategory.Name)); // indeks: { TenantId, Name }

        Req(typeof(Product), nameof(Product.Name), nameof(Product.Unit));
        Opt(typeof(Product), nameof(Product.Supplier), nameof(Product.Location));

        Opt(typeof(StockMovement), nameof(StockMovement.Reference), nameof(StockMovement.Notes));

        Req(typeof(PendingOperation),
            nameof(PendingOperation.RequestedByName),
            nameof(PendingOperation.Title),
            nameof(PendingOperation.PayloadJson));
        Opt(typeof(PendingOperation),
            nameof(PendingOperation.Summary),
            nameof(PendingOperation.RejectionReason));

        Req(typeof(NotificationTemplate),
            nameof(NotificationTemplate.Name),
            nameof(NotificationTemplate.Body));

        Req(typeof(NotificationLog),
            nameof(NotificationLog.Recipient),
            nameof(NotificationLog.Body));
        Opt(typeof(NotificationLog), nameof(NotificationLog.ErrorMessage));

        // Audit log şifrelemesi — kullanıcı adı + özet + payload PII içerebilir.
        Opt(typeof(AuditLog), nameof(AuditLog.ActorName), nameof(AuditLog.Summary), nameof(AuditLog.DataJson));

        // Uygulama-içi bildirim: başlık/gövde müşteri adı vb. PII içerebilir → şifreli.
        // DedupeKey ŞİFRELENMEZ (AES-GCM rastgele nonce → eşitlikle sorgulanamaz; dedupe düz metin ister).
        Req(typeof(AppNotification), nameof(AppNotification.Title), nameof(AppNotification.Body));
        Opt(typeof(AppNotification), nameof(AppNotification.DataJson));
    }

    private void ConfigureSubscriptionPlan(ModelBuilder modelBuilder)
    {
        var plan = modelBuilder.Entity<SubscriptionPlan>();
        plan.ToTable("subscription_plans");
        plan.HasKey(x => x.Id);
        plan.Property(x => x.PlanKey).HasMaxLength(40).IsRequired();
        plan.Property(x => x.Name).HasMaxLength(80).IsRequired();
        plan.Property(x => x.Description).HasMaxLength(500);
        // Features CSV — katalog büyüdükçe uzayabilir (35+ özellik). VARCHAR(500) taşıyordu.
        plan.Property(x => x.Features).HasColumnType("LONGTEXT");
        plan.Property(x => x.MonthlyPriceTRY).HasPrecision(18, 2);
        plan.Property(x => x.YearlyPriceTRY).HasPrecision(18, 2);
        plan.HasIndex(x => x.PlanKey).IsUnique();
        plan.HasQueryFilter(x => !x.IsDeleted);
    }

    private void ConfigureNotification(ModelBuilder modelBuilder)
    {
        var tpl = modelBuilder.Entity<NotificationTemplate>();
        tpl.ToTable("notification_templates");
        tpl.HasKey(x => x.Id);
        tpl.Property(x => x.Name).IsRequired();
        tpl.Property(x => x.Body).IsRequired();
        tpl.Property(x => x.Channel).HasConversion<string>().HasMaxLength(20).IsRequired();
        tpl.Property(x => x.Trigger).HasConversion<string>().HasMaxLength(40).IsRequired();
        tpl.Property(x => x.Status).HasConversion<string>().HasMaxLength(24).IsRequired();
        tpl.HasIndex(x => new { x.TenantId, x.Status });
        tpl.HasOne(x => x.Branch).WithMany().HasForeignKey(x => x.BranchId).OnDelete(DeleteBehavior.Restrict);
        tpl.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));

        var log = modelBuilder.Entity<NotificationLog>();
        log.ToTable("notification_logs");
        log.HasKey(x => x.Id);
        log.Property(x => x.Recipient).IsRequired();
        log.Property(x => x.Body).IsRequired();
        log.Property(x => x.Channel).HasConversion<string>().HasMaxLength(20).IsRequired();
        log.Property(x => x.Status).HasConversion<string>().HasMaxLength(20).IsRequired();
        log.HasIndex(x => new { x.TenantId, x.CreatedAtUtc });
        log.HasIndex(x => x.TemplateId);
        log.HasOne(x => x.Branch).WithMany().HasForeignKey(x => x.BranchId).OnDelete(DeleteBehavior.Restrict);
        log.HasOne(x => x.Template).WithMany().HasForeignKey(x => x.TemplateId).OnDelete(DeleteBehavior.SetNull);
        log.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.SetNull);
        log.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));
    }

    private void ConfigureAppNotification(ModelBuilder modelBuilder)
    {
        var n = modelBuilder.Entity<AppNotification>();
        n.ToTable("app_notifications");
        n.HasKey(x => x.Id);
        n.Property(x => x.Type).HasConversion<string>().HasMaxLength(40).IsRequired();
        n.Property(x => x.Severity).HasConversion<string>().HasMaxLength(20).IsRequired();
        n.Property(x => x.DedupeKey).HasMaxLength(200); // düz metin — dedupe eşitlik sorgusu için
        // Feed sorgusu: (TenantId, RecipientUserId, CreatedAtUtc DESC). Dedupe: DedupeKey.
        n.HasIndex(x => new { x.TenantId, x.RecipientUserId, x.CreatedAtUtc });
        n.HasIndex(x => new { x.TenantId, x.DedupeKey });
        n.HasOne(x => x.Branch).WithMany().HasForeignKey(x => x.BranchId).OnDelete(DeleteBehavior.Restrict);
        n.HasOne(x => x.Recipient).WithMany().HasForeignKey(x => x.RecipientUserId).OnDelete(DeleteBehavior.Cascade);
        n.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));

        var d = modelBuilder.Entity<DeviceNotificationToken>();
        d.ToTable("device_notification_tokens");
        d.HasKey(x => x.Id);
        d.Property(x => x.DeviceId).HasMaxLength(64).IsRequired();
        d.Property(x => x.Token).HasMaxLength(512).IsRequired(); // FCM token ~163 char, opak, şifresiz
        d.Property(x => x.Platform).HasMaxLength(16).IsRequired();
        d.HasIndex(x => new { x.TenantUserId, x.DeviceId }).IsUnique();
        d.HasIndex(x => x.TenantId);
        d.HasOne(x => x.TenantUser).WithMany().HasForeignKey(x => x.TenantUserId).OnDelete(DeleteBehavior.Cascade);
        d.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        ApplyAuditInfo();
        return base.SaveChangesAsync(cancellationToken);
    }

    private void ApplyAuditInfo()
    {
        var utcNow = _clock?.UtcNow ?? DateTime.UtcNow;
        var userId = _currentUser?.UserId;

        foreach (var entry in ChangeTracker.Entries<Entity>())
        {
            switch (entry.State)
            {
                case EntityState.Added:
                    entry.Entity.MarkCreated(utcNow, userId);
                    break;
                case EntityState.Modified:
                    entry.Entity.Touch(utcNow, userId);
                    break;
                case EntityState.Deleted:
                    entry.State = EntityState.Modified;
                    entry.Entity.SoftDelete(utcNow, userId);
                    break;
            }
        }
    }

    private void ConfigureTenant(ModelBuilder modelBuilder)
    {
        var builder = modelBuilder.Entity<Tenant>();
        builder.ToTable("tenants");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Name).HasMaxLength(160).IsRequired();
        builder.Property(x => x.Slug).HasMaxLength(120).IsRequired();
        builder.Property(x => x.Plan).HasMaxLength(80).IsRequired();
        builder.Property(x => x.Status).HasConversion<string>().HasMaxLength(32).IsRequired();
        builder.Property(x => x.SubscriptionPeriod).HasConversion<string>().HasMaxLength(16);
        builder.Property(x => x.Domain).HasMaxLength(180);
        builder.Property(x => x.OwnerName).HasMaxLength(160);
        builder.Property(x => x.Phone).HasMaxLength(40);
        builder.Property(x => x.TaxNumber).HasMaxLength(40);
        builder.Property(x => x.Currency).HasMaxLength(8).IsRequired();
        builder.HasIndex(x => x.Slug).IsUnique();
        builder.HasQueryFilter(x => !x.IsDeleted);
        builder.HasMany(x => x.Branches).WithOne(x => x.Tenant).HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(x => x.Users).WithOne(x => x.Tenant).HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(x => x.SubscriptionPlan).WithMany().HasForeignKey(x => x.SubscriptionPlanId).OnDelete(DeleteBehavior.SetNull);
    }

    private void ConfigureBranch(ModelBuilder modelBuilder)
    {
        var builder = modelBuilder.Entity<Branch>();
        builder.ToTable("branches");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Name).HasMaxLength(140).IsRequired();
        builder.Property(x => x.City).HasMaxLength(80).IsRequired();
        builder.Property(x => x.OpenTime).HasConversion(TimeOnlyConverter).HasColumnType("time");
        builder.Property(x => x.CloseTime).HasConversion(TimeOnlyConverter).HasColumnType("time");
        builder.HasIndex(x => new { x.TenantId, x.Name });
        builder.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));
    }

    private void ConfigureTenantUser(ModelBuilder modelBuilder)
    {
        var builder = modelBuilder.Entity<TenantUser>();
        builder.ToTable("tenant_users");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Email).HasMaxLength(180).IsRequired();
        builder.Property(x => x.FullName).HasMaxLength(160);
        builder.Property(x => x.PasswordHash).HasMaxLength(512).IsRequired();
        builder.Property(x => x.Role).HasConversion<string>().HasMaxLength(48).IsRequired();
        builder.Property(x => x.Permissions).HasMaxLength(500);
        builder.HasIndex(x => new { x.TenantId, x.Email, x.Role, x.BranchId });
        builder.HasOne(x => x.Branch).WithMany().HasForeignKey(x => x.BranchId).OnDelete(DeleteBehavior.Restrict);
        builder.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));
    }

    private void ConfigureCustomer(ModelBuilder modelBuilder)
    {
        var builder = modelBuilder.Entity<Customer>();
        builder.ToTable("customers");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.FullName).HasMaxLength(160).IsRequired();
        builder.Property(x => x.Phone).HasMaxLength(32).IsRequired();
        builder.Property(x => x.Email).HasMaxLength(180);
        builder.Property(x => x.Gender).HasConversion<string>().HasMaxLength(32).IsRequired();
        builder.Property(x => x.Notes).HasMaxLength(1000);
        builder.Property(x => x.PhotoUrl).HasColumnType("LONGTEXT");
        builder.Property(x => x.BlacklistReason).HasMaxLength(500);
        builder.Property(x => x.BirthDate).HasConversion(DateOnlyNullableConverter).HasColumnType("date");
        builder.HasIndex(x => new { x.TenantId, x.BranchId, x.Phone });
        // Online portal girişi doğum tarihi + telefon + ad eşleşmesiyle yapılır; doğum tarihi ön-filtresi için index.
        builder.HasIndex(x => x.BirthDate);
        builder.HasOne(x => x.Branch).WithMany().HasForeignKey(x => x.BranchId).OnDelete(DeleteBehavior.Restrict);
        builder.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId) && (BranchFilterDisabled || x.BranchId == BranchFilterId));
    }

    private void ConfigureStaff(ModelBuilder modelBuilder)
    {
        var builder = modelBuilder.Entity<StaffMember>();
        builder.ToTable("staff_members");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.FullName).HasMaxLength(160).IsRequired();
        builder.Property(x => x.Title).HasMaxLength(100).IsRequired();
        builder.Property(x => x.Phone).HasMaxLength(32);
        builder.Property(x => x.Specialties).HasMaxLength(500);
        builder.Property(x => x.CommissionRate).HasPrecision(5, 2);
        builder.Property(x => x.PhotoUrl).HasColumnType("LONGTEXT");
        builder.HasOne(x => x.Branch).WithMany().HasForeignKey(x => x.BranchId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(x => x.TenantUser).WithMany().HasForeignKey(x => x.TenantUserId).OnDelete(DeleteBehavior.SetNull);
        builder.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId) && (BranchFilterDisabled || x.BranchId == BranchFilterId));

        var timeOff = modelBuilder.Entity<StaffTimeOff>();
        timeOff.ToTable("staff_time_offs");
        timeOff.HasKey(x => x.Id);
        timeOff.Property(x => x.Date).HasConversion(DateOnlyConverter).HasColumnType("date");
        timeOff.Property(x => x.Reason).HasMaxLength(300);
        timeOff.HasIndex(x => new { x.TenantId, x.Date });
        timeOff.HasIndex(x => new { x.StaffMemberId, x.Date }).IsUnique();
        timeOff.HasOne(x => x.StaffMember).WithMany().HasForeignKey(x => x.StaffMemberId).OnDelete(DeleteBehavior.Cascade);
        timeOff.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));

        var workingHour = modelBuilder.Entity<StaffWorkingHour>();
        workingHour.ToTable("staff_working_hours");
        workingHour.HasKey(x => x.Id);
        workingHour.HasIndex(x => new { x.StaffMemberId, x.DayOfWeek }).IsUnique();
        workingHour.HasIndex(x => x.TenantId);
        workingHour.HasOne(x => x.StaffMember).WithMany().HasForeignKey(x => x.StaffMemberId).OnDelete(DeleteBehavior.Cascade);
        workingHour.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));
    }

    private void ConfigureServiceDefinition(ModelBuilder modelBuilder)
    {
        var builder = modelBuilder.Entity<ServiceDefinition>();
        builder.ToTable("service_definitions");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Name).HasMaxLength(160).IsRequired();
        builder.Property(x => x.Category).HasMaxLength(100);
        builder.Property(x => x.IconKey).HasMaxLength(64);
        builder.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
        builder.Property(x => x.Price).HasPrecision(18, 2);
        builder.HasOne(x => x.Branch).WithMany().HasForeignKey(x => x.BranchId).OnDelete(DeleteBehavior.Restrict);
        builder.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));
    }

    private void ConfigureServicePackage(ModelBuilder modelBuilder)
    {
        var packageBuilder = modelBuilder.Entity<ServicePackage>();
        packageBuilder.ToTable("service_packages");
        packageBuilder.HasKey(x => x.Id);
        packageBuilder.Property(x => x.Name).HasMaxLength(180).IsRequired();
        packageBuilder.Property(x => x.Description).HasMaxLength(1000);
        packageBuilder.Property(x => x.IconKey).HasMaxLength(64);
        packageBuilder.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
        packageBuilder.Property(x => x.TotalPrice).HasPrecision(18, 2);
        packageBuilder.Property(x => x.DepositAmount).HasPrecision(18, 2);
        packageBuilder.HasIndex(x => new { x.TenantId, x.Name });
        packageBuilder.HasOne(x => x.Branch).WithMany().HasForeignKey(x => x.BranchId).OnDelete(DeleteBehavior.Restrict);
        packageBuilder.HasMany(x => x.Items).WithOne(x => x.Package!).HasForeignKey(x => x.ServicePackageId).OnDelete(DeleteBehavior.Cascade);
        packageBuilder.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));

        var itemBuilder = modelBuilder.Entity<ServicePackageItem>();
        itemBuilder.ToTable("service_package_items");
        itemBuilder.HasKey(x => x.Id);
        itemBuilder.Property(x => x.UnitPrice).HasPrecision(18, 2);
        itemBuilder.HasOne(x => x.ServiceDefinition).WithMany().HasForeignKey(x => x.ServiceDefinitionId).OnDelete(DeleteBehavior.Restrict);
        itemBuilder.HasQueryFilter(x => !x.IsDeleted);
    }

    private void ConfigureAppointment(ModelBuilder modelBuilder)
    {
        var builder = modelBuilder.Entity<Appointment>();
        builder.ToTable("appointments");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Status).HasConversion<string>().HasMaxLength(32).IsRequired();
        builder.Property(x => x.CustomerConfirmation).HasConversion<string>().HasMaxLength(24).IsRequired();
        builder.Property(x => x.Price).HasPrecision(18, 2);
        builder.Property(x => x.Notes).HasMaxLength(1000);
        builder.Property(x => x.CancellationReason).HasMaxLength(500);
        builder.Property(x => x.IsOnline).HasDefaultValue(false);
        builder.HasIndex(x => new { x.TenantId, x.BranchId, x.StartUtc });
        builder.HasIndex(x => new { x.TenantId, x.StaffMemberId, x.StartUtc, x.EndUtc });
        builder.HasOne(x => x.Branch).WithMany().HasForeignKey(x => x.BranchId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(x => x.StaffMember).WithMany().HasForeignKey(x => x.StaffMemberId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(x => x.ServiceDefinition).WithMany().HasForeignKey(x => x.ServiceDefinitionId).OnDelete(DeleteBehavior.Restrict);
        builder.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId) && (BranchFilterDisabled || x.BranchId == BranchFilterId));
    }

    private void ConfigureAppointmentRating(ModelBuilder modelBuilder)
    {
        var b = modelBuilder.Entity<AppointmentRating>();
        b.ToTable("appointment_ratings");
        b.HasKey(x => x.Id);
        b.Property(x => x.Status).HasConversion<string>().HasMaxLength(16).IsRequired();
        // Şifreli alanlar — ciphertext base64'e yer açmak için TEXT.
        b.Property(x => x.CustomerPhone).HasColumnType("TEXT").IsRequired();
        b.Property(x => x.StaffName).HasColumnType("TEXT").IsRequired();
        b.Property(x => x.ServiceName).HasColumnType("TEXT");
        b.Property(x => x.BusinessName).HasColumnType("TEXT");
        b.Property(x => x.Comment).HasColumnType("TEXT");
        b.HasIndex(x => x.Token).IsUnique();
        b.HasIndex(x => new { x.TenantId, x.StaffMemberId, x.Status });
        b.HasIndex(x => x.AppointmentId);
        b.HasOne<StaffMember>().WithMany().HasForeignKey(x => x.StaffMemberId).OnDelete(DeleteBehavior.Cascade);
        b.HasOne<Appointment>().WithMany().HasForeignKey(x => x.AppointmentId).OnDelete(DeleteBehavior.Cascade);
        // Şube filtresi uygulanmaz: public puanlama IgnoreQueryFilters ile token üzerinden okunur.
        b.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));
    }

    private void ConfigureCustomerAccount(ModelBuilder modelBuilder)
    {
        var accBuilder = modelBuilder.Entity<CustomerAccount>();
        accBuilder.ToTable("customer_accounts");
        accBuilder.HasKey(x => x.Id);
        accBuilder.Property(x => x.Name).HasMaxLength(200).IsRequired();
        accBuilder.Property(x => x.Notes).HasMaxLength(1000);
        accBuilder.Property(x => x.TotalAmount).HasPrecision(18, 2);
        accBuilder.Property(x => x.DepositAmount).HasPrecision(18, 2);
        accBuilder.HasIndex(x => new { x.TenantId, x.CustomerId });
        accBuilder.HasOne(x => x.Branch).WithMany().HasForeignKey(x => x.BranchId).OnDelete(DeleteBehavior.Restrict);
        accBuilder.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Restrict);
        accBuilder.HasOne(x => x.ServicePackage).WithMany().HasForeignKey(x => x.ServicePackageId).OnDelete(DeleteBehavior.SetNull);
        accBuilder.HasMany(x => x.Installments).WithOne(x => x.Account!).HasForeignKey(x => x.CustomerAccountId).OnDelete(DeleteBehavior.Cascade);
        accBuilder.HasMany(x => x.Payments).WithOne(x => x.Account!).HasForeignKey(x => x.CustomerAccountId).OnDelete(DeleteBehavior.Cascade);
        accBuilder.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId) && (BranchFilterDisabled || x.BranchId == null || x.BranchId == BranchFilterId));

        var instBuilder = modelBuilder.Entity<Installment>();
        instBuilder.ToTable("account_installments");
        instBuilder.HasKey(x => x.Id);
        instBuilder.Property(x => x.Amount).HasPrecision(18, 2);
        instBuilder.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
        instBuilder.Property(x => x.DueDate).HasConversion(DateOnlyConverter).HasColumnType("date");
        instBuilder.HasIndex(x => new { x.CustomerAccountId, x.No });
        instBuilder.HasQueryFilter(x => !x.IsDeleted);

        var payBuilder = modelBuilder.Entity<AccountPayment>();
        payBuilder.ToTable("account_payments");
        payBuilder.HasKey(x => x.Id);
        payBuilder.Property(x => x.Amount).HasPrecision(18, 2);
        payBuilder.Property(x => x.Method).HasMaxLength(40);
        payBuilder.Property(x => x.Reference).HasMaxLength(120);
        payBuilder.HasIndex(x => x.CustomerAccountId);
        payBuilder.HasQueryFilter(x => !x.IsDeleted);

        var sessionBuilder = modelBuilder.Entity<CustomerPackageSession>();
        sessionBuilder.ToTable("customer_package_sessions");
        sessionBuilder.HasKey(x => x.Id);
        sessionBuilder.HasIndex(x => new { x.TenantId, x.CustomerId, x.ServiceDefinitionId });
        sessionBuilder.HasOne(x => x.CustomerAccount).WithMany().HasForeignKey(x => x.CustomerAccountId).OnDelete(DeleteBehavior.Cascade);
        sessionBuilder.HasOne(x => x.ServiceDefinition).WithMany().HasForeignKey(x => x.ServiceDefinitionId).OnDelete(DeleteBehavior.Restrict);
        sessionBuilder.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));
    }

    private void ConfigureCustomerTreatmentPhoto(ModelBuilder modelBuilder)
    {
        var b = modelBuilder.Entity<CustomerTreatmentPhoto>();
        b.ToTable("customer_treatment_photos");
        b.HasKey(x => x.Id);
        b.Property(x => x.Kind).HasConversion<string>().HasMaxLength(16).IsRequired();
        // base64 data-URL — uzun metin
        b.Property(x => x.ImageUrl).HasColumnType("LONGTEXT").IsRequired();
        b.Property(x => x.Note).HasMaxLength(500);
        b.HasIndex(x => new { x.TenantId, x.CustomerId, x.TakenAtUtc });
        b.HasOne(x => x.ServiceDefinition).WithMany().HasForeignKey(x => x.ServiceDefinitionId).OnDelete(DeleteBehavior.SetNull);
        // Kuruma + şubeye özel: BranchId müşterinin şubesinden gelir; diğer operasyonel tablolarla aynı null-safe desen.
        b.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId) && (BranchFilterDisabled || x.BranchId == null || x.BranchId == BranchFilterId));
    }

    private void ConfigureTenantPublicProfile(ModelBuilder modelBuilder)
    {
        var p = modelBuilder.Entity<TenantPublicProfile>();
        p.ToTable("tenant_public_profiles");
        p.HasKey(x => x.Id);
        p.Property(x => x.Description).HasMaxLength(2000);
        p.Property(x => x.Address).HasMaxLength(500);
        p.Property(x => x.City).HasMaxLength(100);
        p.Property(x => x.Instagram).HasMaxLength(100);
        p.Property(x => x.PublicEmail).HasMaxLength(200);
        p.Property(x => x.PublicPhone).HasMaxLength(40);
        p.Property(x => x.WorkingHoursText).HasMaxLength(200);
        p.Property(x => x.MapUrl).HasMaxLength(1000);
        // base64 logo — proje görsel deseni
        p.Property(x => x.LogoData).HasColumnType("LONGTEXT");
        p.HasIndex(x => x.TenantId).IsUnique();
        p.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Cascade);
        // Public vitrin: tenant filtresine takılmadan slug üzerinden okunur (IgnoreQueryFilters gerekmesin diye yalnızca soft-delete filtresi).
        p.HasQueryFilter(x => !x.IsDeleted);

        var g = modelBuilder.Entity<TenantGalleryPhoto>();
        g.ToTable("tenant_gallery_photos");
        g.HasKey(x => x.Id);
        g.Property(x => x.Kind).HasConversion<string>().HasMaxLength(16).IsRequired();
        // base64 data-URL — uzun metin (proje görsel deseni)
        g.Property(x => x.ImageData).HasColumnType("LONGTEXT").IsRequired();
        g.Property(x => x.Caption).HasMaxLength(300);
        g.HasIndex(x => new { x.TenantId, x.Kind, x.SortOrder });
        g.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Cascade);
        g.HasQueryFilter(x => !x.IsDeleted);
    }

    private void ConfigurePlatformIntegrationSettings(ModelBuilder modelBuilder)
    {
        var p = modelBuilder.Entity<PlatformIntegrationSettings>();
        p.ToTable("platform_integration_settings");
        p.HasKey(x => x.Id);
        p.Property(x => x.SmsProvider).HasMaxLength(32).IsRequired();
        // Kısa sağlayıcı adı — varchar. longtext'e DEFAULT verilemediğinden (MySQL) migration için de zorunlu.
        p.Property(x => x.WhatsAppProvider).HasMaxLength(32).IsRequired();
        p.Property(x => x.SmsApiKeyEncrypted).HasColumnType("TEXT");
        p.Property(x => x.SmsApiSecretEncrypted).HasColumnType("TEXT");
        p.Property(x => x.SmsSender).HasMaxLength(64);
        p.Property(x => x.SmsApiUrl).HasMaxLength(256);
        p.Property(x => x.EmailFromAddress).HasMaxLength(256);
        p.Property(x => x.EmailFromName).HasMaxLength(128);
        p.Property(x => x.SmtpHost).HasMaxLength(256);
        p.Property(x => x.SmtpUsername).HasMaxLength(256);
        p.Property(x => x.SmtpPasswordEncrypted).HasColumnType("TEXT");
        // Platform geneli (tenant'sız) — query filter yok.
    }

    private void ConfigurePlatformOps(ModelBuilder modelBuilder)
    {
        var s = modelBuilder.Entity<PlatformSystemSettings>();
        s.ToTable("platform_system_settings");
        s.HasKey(x => x.Id);
        s.Property(x => x.PlanLimitsJson).HasColumnType("LONGTEXT");
        s.Property(x => x.SecurityJson).HasColumnType("LONGTEXT");
        s.Property(x => x.IntegrationsJson).HasColumnType("LONGTEXT");
        s.Property(x => x.MaintenanceJson).HasColumnType("LONGTEXT");
        s.Property(x => x.DataRetentionJson).HasColumnType("LONGTEXT");
        // Platform geneli (tenant'sız) singleton — query filter yok.

        var i = modelBuilder.Entity<TenantInvoice>();
        i.ToTable("tenant_invoices");
        i.HasKey(x => x.Id);
        i.Property(x => x.Number).HasMaxLength(32).IsRequired();
        i.Property(x => x.Status).HasMaxLength(16).IsRequired();
        i.Property(x => x.AmountTRY).HasPrecision(18, 2);
        i.Property(x => x.Notes).HasMaxLength(512);
        i.HasIndex(x => x.Number).IsUnique();
        i.HasIndex(x => new { x.TenantId, x.PeriodStartUtc });
        i.HasOne(x => x.Tenant).WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.Cascade);
        // Platform faturası tenant kapsam filtresine girmez; yalnızca soft-delete süzülür.
        i.HasQueryFilter(x => !x.IsDeleted);

        var j = modelBuilder.Entity<BackgroundJob>();
        j.ToTable("background_jobs");
        j.HasKey(x => x.Id);
        j.Property(x => x.Type).HasMaxLength(100).IsRequired();
        j.Property(x => x.Status).HasMaxLength(16).IsRequired();
        j.Property(x => x.PayloadJson).HasColumnType("LONGTEXT");
        j.Property(x => x.LastError).HasMaxLength(1024);
        // Worker poll sorgusu bu üçlüyü tarar.
        j.HasIndex(x => new { x.Status, x.NextAttemptUtc });
        j.HasQueryFilter(x => !x.IsDeleted);

        // Idempotent istek kayıtları — masaüstü çevrimdışı kuyruğunun tekrar oynatma güvencesi.
        var pcr = modelBuilder.Entity<ProcessedClientRequest>();
        pcr.ToTable("processed_client_requests");
        pcr.HasKey(x => x.Id);
        pcr.Property(x => x.IdempotencyKey).HasMaxLength(64).IsRequired();
        pcr.Property(x => x.Method).HasMaxLength(8).IsRequired();
        pcr.Property(x => x.Path).HasMaxLength(512).IsRequired();
        pcr.Property(x => x.ContentType).HasMaxLength(128);
        pcr.Property(x => x.ResponseBody).HasColumnType("LONGTEXT");
        // Aynı kullanıcı + anahtar bir kez işlenir; yarış durumunda ikinci insert unique'e takılır.
        pcr.HasIndex(x => new { x.TenantId, x.UserId, x.IdempotencyKey }).IsUnique();
        pcr.HasQueryFilter(x => !x.IsDeleted);
    }

    private void ConfigureWhatsApp(ModelBuilder modelBuilder)
    {
        var s = modelBuilder.Entity<WhatsAppSettings>();
        s.ToTable("whatsapp_settings");
        s.HasKey(x => x.Id);
        s.Property(x => x.PhoneNumberId).HasMaxLength(64);
        s.Property(x => x.AccessTokenEncrypted).HasColumnType("TEXT");
        s.Property(x => x.BusinessAccountId).HasMaxLength(64);
        s.Property(x => x.VerifyToken).HasMaxLength(128);
        s.Property(x => x.ReminderTemplate).HasMaxLength(1000);
        s.Property(x => x.Provider).HasMaxLength(32).IsRequired();
        s.HasIndex(x => x.TenantId).IsUnique();
        s.HasIndex(x => x.PhoneNumberId); // webhook tenant çözümü
        // Kuruma özel (tek satır). Webhook'ta IgnoreQueryFilters ile aşılır.
        s.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));

        var m = modelBuilder.Entity<WhatsAppMessage>();
        m.ToTable("whatsapp_messages");
        m.HasKey(x => x.Id);
        m.Property(x => x.Direction).HasConversion<string>().HasMaxLength(16).IsRequired();
        m.Property(x => x.Status).HasConversion<string>().HasMaxLength(16).IsRequired();
        m.Property(x => x.Intent).HasConversion<string>().HasMaxLength(16).IsRequired();
        m.Property(x => x.Phone).HasMaxLength(32).IsRequired();
        m.Property(x => x.Body).HasColumnType("TEXT");
        m.Property(x => x.TemplateName).HasMaxLength(128);
        m.Property(x => x.ProviderMessageId).HasMaxLength(128);
        m.Property(x => x.ErrorMessage).HasMaxLength(500);
        m.HasIndex(x => new { x.TenantId, x.AppointmentId });
        m.HasIndex(x => new { x.TenantId, x.Direction, x.CreatedAtUtc });
        m.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId) && (BranchFilterDisabled || x.BranchId == null || x.BranchId == BranchFilterId));
    }

    private void ConfigureConsultationForm(ModelBuilder modelBuilder)
    {
        var b = modelBuilder.Entity<ConsultationForm>();
        b.ToTable("consultation_forms");
        b.HasKey(x => x.Id);
        b.Property(x => x.SkinType).HasConversion<string>().HasMaxLength(16).IsRequired();
        b.Property(x => x.Allergies).HasMaxLength(1000);
        b.Property(x => x.Medications).HasMaxLength(1000);
        b.Property(x => x.ChronicConditions).HasMaxLength(1000);
        b.Property(x => x.Complaint).HasMaxLength(1000);
        b.Property(x => x.Notes).HasMaxLength(2000);
        b.Property(x => x.FilledByName).HasMaxLength(160);
        // "Özel" bölümünde işaretlenen seçenek etiketlerinin JSON dizisi — uzun olabildiğinden LONGTEXT.
        b.Property(x => x.CustomSelectionsJson).HasColumnType("LONGTEXT");
        // Müşteri başına tek form
        b.HasIndex(x => new { x.TenantId, x.CustomerId }).IsUnique();
        // Kuruma + şubeye özel: BranchId müşterinin şubesinden gelir; null-safe şube filtresi.
        b.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId) && (BranchFilterDisabled || x.BranchId == null || x.BranchId == BranchFilterId));
    }

    private void ConfigureConsultationCustomOption(ModelBuilder modelBuilder)
    {
        var b = modelBuilder.Entity<ConsultationCustomOption>();
        b.ToTable("consultation_custom_options");
        b.HasKey(x => x.Id);
        b.Property(x => x.Label).HasMaxLength(80).IsRequired();
        b.HasIndex(x => new { x.TenantId, x.BranchId, x.Label });
        // Kuruma + şubeye özel: BranchId null → kurum geneli; dolu → şubeye özel. Null-safe şube filtresi.
        b.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId) && (BranchFilterDisabled || x.BranchId == null || x.BranchId == BranchFilterId));
    }

    private void ConfigureAdisyon(ModelBuilder modelBuilder)
    {
        var adisyon = modelBuilder.Entity<Adisyon>();
        adisyon.ToTable("adisyonlar");
        adisyon.HasKey(x => x.Id);
        adisyon.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
        adisyon.Property(x => x.Notes).HasMaxLength(1000);
        adisyon.Property(x => x.PlannedFirstDueDate).HasConversion(DateOnlyNullableConverter).HasColumnType("date");
        adisyon.HasIndex(x => new { x.TenantId, x.CustomerId, x.Status });
        adisyon.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Restrict);
        adisyon.HasOne(x => x.CustomerAccount).WithMany().HasForeignKey(x => x.CustomerAccountId).OnDelete(DeleteBehavior.SetNull);
        adisyon.HasMany(x => x.Items).WithOne(x => x.Adisyon!).HasForeignKey(x => x.AdisyonId).OnDelete(DeleteBehavior.Cascade);
        adisyon.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId) && (BranchFilterDisabled || x.BranchId == null || x.BranchId == BranchFilterId));

        var item = modelBuilder.Entity<AdisyonItem>();
        item.ToTable("adisyon_items");
        item.HasKey(x => x.Id);
        item.Property(x => x.Type).HasConversion<string>().HasMaxLength(32);
        item.Property(x => x.Description).HasMaxLength(300).IsRequired();
        item.Property(x => x.Quantity).HasPrecision(18, 2);
        item.Property(x => x.UnitPrice).HasPrecision(18, 2);
        item.HasIndex(x => x.AdisyonId);
        item.HasQueryFilter(x => !x.IsDeleted);
    }

    private void ConfigureStaffCommission(ModelBuilder modelBuilder)
    {
        var c = modelBuilder.Entity<StaffCommission>();
        c.ToTable("staff_commissions");
        c.HasKey(x => x.Id);
        c.Property(x => x.SourceType).HasMaxLength(32).IsRequired();
        c.Property(x => x.Description).HasMaxLength(300).IsRequired();
        c.Property(x => x.BaseAmount).HasPrecision(18, 2);
        c.Property(x => x.RatePercent).HasPrecision(9, 2);
        c.Property(x => x.Amount).HasPrecision(18, 2);
        c.HasIndex(x => new { x.TenantId, x.StaffMemberId, x.EarnedAtUtc });
        c.HasIndex(x => x.SourceItemId);
        c.HasOne(x => x.StaffMember).WithMany().HasForeignKey(x => x.StaffMemberId).OnDelete(DeleteBehavior.Restrict);
        c.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId) && (BranchFilterDisabled || x.BranchId == null || x.BranchId == BranchFilterId));
    }

    private void ConfigureCampaign(ModelBuilder modelBuilder)
    {
        var c = modelBuilder.Entity<Campaign>();
        c.ToTable("campaigns");
        c.HasKey(x => x.Id);
        c.Property(x => x.Name).HasMaxLength(160).IsRequired();
        c.Property(x => x.DiscountType).HasConversion<string>().HasMaxLength(16);
        c.Property(x => x.Target).HasConversion<string>().HasMaxLength(16);
        c.Property(x => x.DiscountValue).HasPrecision(18, 2);
        c.Property(x => x.StartDate).HasConversion(DateOnlyConverter).HasColumnType("date");
        c.Property(x => x.EndDate).HasConversion(DateOnlyConverter).HasColumnType("date");
        c.HasIndex(x => new { x.TenantId, x.IsActive });
        c.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));
    }

    private void ConfigureGiftCard(ModelBuilder modelBuilder)
    {
        var g = modelBuilder.Entity<GiftCard>();
        g.ToTable("gift_cards");
        g.HasKey(x => x.Id);
        // Code lookup için kullanılır → şifrelenMEZ (Email/Slug/Token gibi).
        g.Property(x => x.Code).HasMaxLength(40).IsRequired();
        g.Property(x => x.Kind).HasConversion<string>().HasMaxLength(16).IsRequired();
        g.Property(x => x.Value).HasPrecision(18, 2);
        g.Property(x => x.Balance).HasPrecision(18, 2);
        g.Property(x => x.Note).HasMaxLength(300);
        g.HasIndex(x => new { x.TenantId, x.Code }).IsUnique();
        // Kurum + şube: şube seçiliyse o şubeye özel; "Tüm şubeler"de (BranchId null) kurum geneli görünür.
        g.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId) && (BranchFilterDisabled || x.BranchId == null || x.BranchId == BranchFilterId));
    }

    private void ConfigureWaitlist(ModelBuilder modelBuilder)
    {
        var w = modelBuilder.Entity<WaitlistEntry>();
        w.ToTable("waitlist_entries");
        w.HasKey(x => x.Id);
        w.Property(x => x.Status).HasConversion<string>().HasMaxLength(16).IsRequired();
        w.Property(x => x.PreferredDate).HasConversion(DateOnlyConverter).HasColumnType("date");
        w.Property(x => x.Note).HasMaxLength(500);
        w.HasIndex(x => new { x.TenantId, x.Status, x.PreferredDate });
        w.HasOne<Customer>().WithMany().HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Cascade);
        w.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId) && (BranchFilterDisabled || x.BranchId == null || x.BranchId == BranchFilterId));
    }

    private void ConfigureCashClosing(ModelBuilder modelBuilder)
    {
        var c = modelBuilder.Entity<CashRegisterClosing>();
        c.ToTable("cash_register_closings");
        c.HasKey(x => x.Id);
        c.Property(x => x.BusinessDate).HasConversion(DateOnlyConverter).HasColumnType("date");
        c.Property(x => x.OpeningBalance).HasPrecision(18, 2);
        c.Property(x => x.CashIncome).HasPrecision(18, 2);
        c.Property(x => x.CashExpense).HasPrecision(18, 2);
        c.Property(x => x.CountedCash).HasPrecision(18, 2);
        c.Property(x => x.Note).HasMaxLength(500);
        // SystemCash / Difference türetilmiş — DB'ye yazılmaz.
        c.Ignore(x => x.SystemCash);
        c.Ignore(x => x.Difference);
        c.HasIndex(x => new { x.TenantId, x.BusinessDate });
        c.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId) && (BranchFilterDisabled || x.BranchId == null || x.BranchId == BranchFilterId));
    }

    private void ConfigureLoyalty(ModelBuilder modelBuilder)
    {
        var l = modelBuilder.Entity<LoyaltyTransaction>();
        l.ToTable("loyalty_transactions");
        l.HasKey(x => x.Id);
        l.Property(x => x.SourceType).HasMaxLength(32).IsRequired();
        l.Property(x => x.Description).HasMaxLength(300);
        l.HasIndex(x => new { x.TenantId, x.CustomerId, x.OccurredAtUtc });
        l.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Cascade);
        l.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));
    }

    private void ConfigureBusinessExpense(ModelBuilder modelBuilder)
    {
        var builder = modelBuilder.Entity<BusinessExpense>();
        builder.ToTable("business_expenses");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Category).HasConversion<string>().HasMaxLength(40).IsRequired();
        builder.Property(x => x.PaymentMethod).HasConversion<string>().HasMaxLength(32).IsRequired();
        builder.Property(x => x.Amount).HasPrecision(18, 2);
        builder.Property(x => x.PeriodLabel).HasMaxLength(40);
        builder.Property(x => x.Description).HasMaxLength(500);
        builder.Property(x => x.Reference).HasMaxLength(120);
        builder.HasIndex(x => new { x.TenantId, x.OccurredAtUtc });
        builder.HasIndex(x => new { x.TenantId, x.Category });
        builder.HasOne(x => x.Branch).WithMany().HasForeignKey(x => x.BranchId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(x => x.StaffMember).WithMany().HasForeignKey(x => x.StaffMemberId).OnDelete(DeleteBehavior.SetNull);
        builder.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId) && (BranchFilterDisabled || x.BranchId == null || x.BranchId == BranchFilterId));
    }

    private void ConfigureCustomExpenseCategory(ModelBuilder modelBuilder)
    {
        var builder = modelBuilder.Entity<CustomExpenseCategory>();
        builder.ToTable("custom_expense_categories");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Name).HasMaxLength(80).IsRequired();
        builder.HasIndex(x => new { x.TenantId, x.Name });
        builder.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));
    }

    private void ConfigureCustomServiceCategory(ModelBuilder modelBuilder)
    {
        var builder = modelBuilder.Entity<CustomServiceCategory>();
        builder.ToTable("custom_service_categories");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Name).HasMaxLength(80).IsRequired();
        builder.HasIndex(x => new { x.TenantId, x.Name });
        builder.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));
    }

    private void ConfigureProductAndStock(ModelBuilder modelBuilder)
    {
        var product = modelBuilder.Entity<Product>();
        product.ToTable("products");
        product.HasKey(x => x.Id);
        product.Property(x => x.Name).HasMaxLength(160).IsRequired();
        product.Property(x => x.Sku).HasMaxLength(64).IsRequired();
        product.Property(x => x.Category).HasConversion<string>().HasMaxLength(40).IsRequired();
        product.Property(x => x.Unit).HasMaxLength(24).IsRequired();
        product.Property(x => x.Supplier).HasMaxLength(160);
        product.Property(x => x.Location).HasMaxLength(120);
        product.Property(x => x.Barcode).HasMaxLength(64);
        // ImageUrl base64/data-URL olabildiğinden uzun metin.
        product.Property(x => x.ImageUrl).HasColumnType("LONGTEXT");
        product.Property(x => x.Brand).HasMaxLength(120);
        product.Property(x => x.TaxRatePercent).HasPrecision(5, 2);
        product.Property(x => x.ExpiryDate).HasConversion(DateOnlyNullableConverter).HasColumnType("date");
        product.Property(x => x.LotNumber).HasMaxLength(80);
        product.Property(x => x.PendingInbound).HasPrecision(18, 3);
        product.Property(x => x.Cost).HasPrecision(18, 2);
        product.Property(x => x.SalePrice).HasPrecision(18, 2);
        product.Property(x => x.CurrentStock).HasPrecision(18, 3);
        product.Property(x => x.MinStockLevel).HasPrecision(18, 3);
        product.HasIndex(x => new { x.TenantId, x.Sku });
        product.HasIndex(x => new { x.TenantId, x.Category });
        product.HasOne(x => x.Branch).WithMany().HasForeignKey(x => x.BranchId).OnDelete(DeleteBehavior.Restrict);
        product.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId) && (BranchFilterDisabled || x.BranchId == null || x.BranchId == BranchFilterId));

        var movement = modelBuilder.Entity<StockMovement>();
        movement.ToTable("stock_movements");
        movement.HasKey(x => x.Id);
        movement.Property(x => x.Type).HasConversion<string>().HasMaxLength(32).IsRequired();
        movement.Property(x => x.Quantity).HasPrecision(18, 3);
        movement.Property(x => x.UnitCost).HasPrecision(18, 2);
        movement.Property(x => x.Reference).HasMaxLength(120);
        movement.Property(x => x.Notes).HasMaxLength(500);
        movement.HasIndex(x => new { x.TenantId, x.ProductId, x.OccurredAtUtc });
        movement.HasOne(x => x.Product).WithMany().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Cascade);
        movement.HasOne(x => x.StaffMember).WithMany().HasForeignKey(x => x.StaffMemberId).OnDelete(DeleteBehavior.SetNull);
        movement.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));
    }

    private void ConfigurePendingOperation(ModelBuilder modelBuilder)
    {
        var builder = modelBuilder.Entity<PendingOperation>();
        builder.ToTable("pending_operations");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.RequestedByName).HasMaxLength(160).IsRequired();
        builder.Property(x => x.OperationType).HasConversion<string>().HasMaxLength(40).IsRequired();
        builder.Property(x => x.Title).HasMaxLength(200).IsRequired();
        builder.Property(x => x.Summary).HasMaxLength(500);
        // At-rest encryption uygulandığı için artık JSON validation yok — şifreli payload string olarak saklanır.
        builder.Property(x => x.PayloadJson).HasColumnType("longtext").IsRequired();
        builder.Property(x => x.Status).HasConversion<string>().HasMaxLength(20).IsRequired();
        builder.Property(x => x.RejectionReason).HasMaxLength(500);
        builder.HasIndex(x => new { x.TenantId, x.Status, x.RequestedAtUtc });
        builder.HasIndex(x => x.RequestedByUserId);
        builder.HasOne(x => x.Branch).WithMany().HasForeignKey(x => x.BranchId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(x => x.RequestedBy).WithMany().HasForeignKey(x => x.RequestedByUserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(x => x.DecidedBy).WithMany().HasForeignKey(x => x.DecidedByUserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));
    }

    private static void ConfigureRefreshToken(ModelBuilder modelBuilder)
    {
        var builder = modelBuilder.Entity<RefreshToken>();
        builder.ToTable("refresh_tokens");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.TokenHash).HasMaxLength(128).IsRequired();
        builder.Property(x => x.ReplacedByTokenHash).HasMaxLength(128);
        builder.HasIndex(x => x.TokenHash).IsUnique();
        builder.HasOne(x => x.TenantUser).WithMany(x => x.RefreshTokens).HasForeignKey(x => x.TenantUserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Cascade);
    }

    private void ConfigureAuditLog(ModelBuilder modelBuilder)
    {
        var builder = modelBuilder.Entity<AuditLog>();
        builder.ToTable("audit_logs");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.Action).HasMaxLength(120).IsRequired();
        builder.Property(x => x.EntityName).HasMaxLength(160).IsRequired();
        // Şifreli alanlar LONGTEXT'e taşınıyor — fiziksel kolon tipini ALTER COLUMN ile genişletiyoruz.
        builder.Property(x => x.DataJson).HasColumnType("longtext");
        builder.Property(x => x.Summary).HasMaxLength(500);
        builder.Property(x => x.ActorName).HasMaxLength(200);
        builder.Property(x => x.ActorRole).HasMaxLength(40);
        builder.Property(x => x.IpAddress).HasMaxLength(64);
        builder.Property(x => x.DeviceId).HasMaxLength(100);
        builder.Property(x => x.DeviceInfoJson).HasColumnType("longtext");
        builder.HasIndex(x => new { x.TenantId, x.Action });
        builder.HasIndex(x => new { x.TenantId, x.EntityName, x.EntityId });
        builder.HasIndex(x => new { x.TenantId, x.CreatedAtUtc });
        builder.HasIndex(x => new { x.TenantId, x.ActorUserId });
        builder.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == null || x.TenantId == TenantFilterId));
    }

    private void ConfigureStaffDevice(ModelBuilder modelBuilder)
    {
        var builder = modelBuilder.Entity<StaffDevice>();
        builder.ToTable("staff_devices");
        builder.HasKey(x => x.Id);
        builder.Property(x => x.DeviceId).HasMaxLength(100).IsRequired();
        builder.Property(x => x.Name).HasMaxLength(120).IsRequired();
        builder.Property(x => x.DeviceType).HasMaxLength(40);
        builder.Property(x => x.UserAgent).HasMaxLength(512);
        builder.Property(x => x.NetworkInfoJson).HasColumnType("longtext");
        builder.Property(x => x.LastIpAddress).HasMaxLength(64);
        builder.HasIndex(x => new { x.TenantUserId, x.DeviceId }).IsUnique();
        builder.HasIndex(x => x.TenantId);
        builder.HasOne(x => x.TenantUser).WithMany().HasForeignKey(x => x.TenantUserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasQueryFilter(x => !x.IsDeleted && (TenantFilterDisabled || x.TenantId == TenantFilterId));
    }
}
