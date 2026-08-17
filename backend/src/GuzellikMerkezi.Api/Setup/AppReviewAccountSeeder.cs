using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Setup;

/// <summary>
/// MAĞAZA İNCELEME HESABI KURUCUSU — App Store / Play Store denetçileri için.
///
/// <para>
/// <b>Neden var?</b> Apple 2.1 ("Information Needed") reddi: App Store Connect'e girilen demo hesabı
/// (<c>admin@beautyasist.test</c>) yalnızca <see cref="Development.DevelopmentDataSeeder"/> içinde
/// vardı. O seeder Development dışında bilinçli olarak hata atar; yani canlı API'de o hesap HİÇ
/// olmadı ve denetçi giriş yapamadı. Bu kurucu, canlıda denetçinin görebileceği gerçek bir kurum +
/// yönetici + demo müşteri üretir.
/// </para>
///
/// <para>
/// <b>Development seeder'ından farkı:</b> o seeder bilinen SABİT parolalı hesaplar açar ve
/// <c>EnsureDeleted</c> ile veritabanını silebilir; bu yüzden Development dışında çalışması
/// yasaklanmıştır ve o kapı KALDIRILMADI. Buradaki kurucunun parolası config'ten gelir (kodda
/// gömülü parola yoktur), yalnızca kendi kurumuna dokunur, şema değiştirmez ve idempotenttir.
/// </para>
///
/// <para>
/// <b>Yaşam döngüsü:</b> opt-in (<c>AppReview:Enabled=true</c>). İnceleme bittiğinde bayrağı
/// kaldırın ve kurumu platform panelinden silin/askıya alın. Açıkken her başlangıçta uyarı loglar.
/// </para>
/// </summary>
public static class AppReviewAccountSeeder
{
    private const string DefaultSlug = "beautyasist-app-review";
    private const string DefaultTenantName = "BeautyAsist Demo Merkezi";

    /// <summary>Denetçi hiçbir özellikte "paketiniz izin vermiyor" duvarına çarpmasın: tüm özellikleri açan plan.</summary>
    private const string PreferredPlanKey = "Enterprise";

    public static async Task SeedAppReviewAccountAsync(this WebApplication app)
    {
        if (!bool.TryParse(app.Configuration["AppReview:Enabled"], out var enabled) || !enabled) return;

        var logger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("AppReviewAccount");

        var ownerEmail = app.Configuration["AppReview:OwnerEmail"]?.Trim();
        var ownerPassword = app.Configuration["AppReview:OwnerPassword"];
        // FAIL-FAST: yarım yapılandırma "hesap açıldı" sanılıp mağazaya yanlış bilgi verilmesine yol açar.
        if (string.IsNullOrWhiteSpace(ownerEmail) || string.IsNullOrWhiteSpace(ownerPassword))
        {
            throw new InvalidOperationException(
                "AppReview:Enabled=true verildi ama AppReview:OwnerEmail / AppReview:OwnerPassword eksik. " +
                "İnceleme hesabı için ikisi de zorunludur.");
        }
        if (ownerPassword.Length < 8)
        {
            throw new InvalidOperationException("AppReview:OwnerPassword en az 8 karakter olmalı.");
        }

        var slug = Slugify(app.Configuration["AppReview:TenantSlug"], DefaultSlug);
        var tenantName = Fallback(app.Configuration["AppReview:TenantName"], DefaultTenantName);
        var ownerName = Fallback(app.Configuration["AppReview:OwnerName"], "Demo Yönetici");
        var customerName = Fallback(app.Configuration["AppReview:CustomerFullName"], "Demo Müşteri");
        var customerPhone = app.Configuration["AppReview:CustomerPhone"]?.Trim();
        var customerEmail = app.Configuration["AppReview:CustomerEmail"]?.Trim();

        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher>();

        // Kurum kaydı: Slug ŞİFRELİ DEĞİL (ad şifrelidir) — SQL'de eşitlikle aranabilir.
        var tenant = await db.Tenants.IgnoreQueryFilters()
            .Include(t => t.Branches)
            .Include(t => t.Users)
            .FirstOrDefaultAsync(t => t.Slug == slug);

        var created = tenant is null;
        if (tenant is null)
        {
            tenant = new Tenant(tenantName, slug, PreferredPlanKey, TenantStatus.Active);
            tenant.SetProfile(null, ownerName);
            tenant.AddBranch("Merkez", "İstanbul", isDefault: true);
            db.Tenants.Add(tenant);
            await db.SaveChangesAsync();
        }

        // Paket: özellik kapıları canlıda fail-CLOSED çalışır (plan yoksa her özellik reddedilir).
        // Denetçinin uygulamanın TAMAMINI görmesi gerektiği için tüm özellikleri açan plan atanır.
        if (tenant.SubscriptionPlanId is null)
        {
            var plan = await db.SubscriptionPlans.FirstOrDefaultAsync(p => p.PlanKey == PreferredPlanKey)
                ?? await db.SubscriptionPlans.OrderByDescending(p => p.DisplayOrder).FirstOrDefaultAsync();
            if (plan is not null)
            {
                tenant.AssignSubscriptionPlan(plan);
                await db.SaveChangesAsync();
            }
            else
            {
                logger.LogWarning(
                    "İnceleme kurumuna atanacak abonelik planı bulunamadı. Database:SeedReferenceData=true ile " +
                    "varsayılan planları oluşturun; aksi hâlde denetçi özellik kapılarına takılır.");
            }
        }

        var branch = tenant.Branches.FirstOrDefault()
            ?? tenant.AddBranch("Merkez", "İstanbul", isDefault: true);

        // Yönetici hesabı: varsa PAROLASI TAZELENİR (mağaza panelindeki parolayı değiştirmek isteyince
        // config'i güncellemek yeterli olsun). MustChangePassword kurulmaz — denetçi parola değiştirme
        // ekranına düşmemeli.
        var normalizedOwnerEmail = TenantUser.NormalizeEmail(ownerEmail);
        var owner = tenant.Users.FirstOrDefault(u => u.Email == normalizedOwnerEmail)
            ?? tenant.GrantAccess(ownerEmail, UserRole.InstitutionOwner, null, ownerName);
        owner.SetPasswordHash(hasher.Hash(ownerPassword));
        await db.SaveChangesAsync();

        // Demo müşteri: müşteri girişinin (ad soyad + telefon + sabit doğrulama kodu) karşılığı.
        // Kod gönderimi CustomerOtpService içindeki mağaza-inceleme kısayolundan gelir; o kısayol
        // KAYIT VAR olmadan çalışmaz, bu yüzden müşteri satırı burada garanti edilir.
        if (!string.IsNullOrWhiteSpace(customerPhone))
        {
            var phoneKey = Infrastructure.Services.PhoneMask.LoginKey(customerPhone);
            var existing = await db.Customers.IgnoreQueryFilters()
                .Where(c => c.TenantId == tenant.Id && !c.IsDeleted)
                .ToListAsync();
            var demoCustomer = existing.FirstOrDefault(
                c => Infrastructure.Services.PhoneMask.LoginKey(c.Phone) == phoneKey);

            if (demoCustomer is null)
            {
                demoCustomer = new Customer(tenant.Id, branch.Id, customerName, customerPhone, customerEmail);
                // Doğum tarihi BİLEREK boş: girişte sorulmuyor (App Store 5.1.1(v)).
                demoCustomer.UpdateProfile(null, Gender.Unspecified, kvkkConsent: true, notes: "App Store / Play Store inceleme hesabı.");
                db.Customers.Add(demoCustomer);
                await db.SaveChangesAsync();
            }

            if (created) await SeedContentAsync(db, tenant, branch, demoCustomer);
        }
        else
        {
            logger.LogWarning(
                "AppReview:CustomerPhone verilmedi — denetçi MÜŞTERİ girişini test edemez. " +
                "AppReview:CustomerPhone + AppReview:CustomerOtpCode ayarlarını doldurun.");
        }

        await WarnIfWhatsAppIsTheOnlyChannelAsync(db, logger);

        logger.LogWarning(
            "MAĞAZA İNCELEME HESABI {State}: kurum '{Slug}', yönetici {Email}. İnceleme bitince " +
            "AppReview:* ayarlarını kaldırın ve kurumu askıya alın.",
            created ? "OLUŞTURULDU" : "GÜNCELLENDİ", slug, normalizedOwnerEmail);
    }

    /// <summary>
    /// APP STORE 3.2.2(v) KAPISI: doğrulama kodunun gidebileceği TEK kanal WhatsApp ise uygulama
    /// hâlâ "müşteri kullanıcılarını WhatsApp kullanıcılarıyla sınırlıyor" demektir ve aynı gerekçeyle
    /// yine reddedilir.
    /// </summary>
    /// <remarks>
    /// Bu bir yapılandırma hatasıdır, kod hatası değil — uygulamayı açılışta düşürmek canlı
    /// kurumların girişini de keserdi. Bu yüzden HATA SEVİYESİNDE loglanır: mağazaya yükleme
    /// yapılmadan önce görünür olması yeterlidir.
    /// </remarks>
    private static async Task WarnIfWhatsAppIsTheOnlyChannelAsync(GuzellikDbContext db, ILogger logger)
    {
        var s = await db.PlatformIntegrationSettings.AsNoTracking().FirstOrDefaultAsync();
        var sms = s?.SmsEnabled == true && s.SmsConfigured;
        var email = s?.EmailEnabled == true && s.EmailConfigured;
        if (sms || email) return;

        logger.LogError(
            "APP STORE 3.2.2(v) RİSKİ: doğrulama kodu için kurulu SMS ya da e-posta kanalı YOK. " +
            "Müşteri girişi yine yalnız WhatsApp'a kalır ve uygulama aynı gerekçeyle reddedilir. " +
            "Platform → Sistem Ayarları → Mesajlaşma'dan SMTP (e-posta) ya da SMS sağlayıcısını " +
            "etkinleştirip test edin.");
    }

    /// <summary>
    /// Denetçi boş ekranlar görmesin diye asgari işletme verisi: personel, hizmet, paket ve randevular.
    /// Yalnızca kurum İLK kez oluşturulduğunda çalışır — sonraki açılışlarda veri çoğaltmaz.
    /// </summary>
    private static async Task SeedContentAsync(GuzellikDbContext db, Tenant tenant, Branch branch, Customer customer)
    {
        var lazer = new ServiceDefinition(tenant.Id, branch.Id, "Buz Lazer Epilasyon", 45, 1250, "Epilasyon");
        var cilt = new ServiceDefinition(tenant.Id, branch.Id, "Hydrafacial Cilt Bakımı", 60, 1800, "Cilt Bakımı");
        var masaj = new ServiceDefinition(tenant.Id, branch.Id, "Lenf Drenaj Masajı", 50, 950, "Masaj");
        db.ServiceDefinitions.AddRange(lazer, cilt, masaj);

        var uzman = new StaffMember(tenant.Id, branch.Id, "Elif Demir", "Uzman Estetisyen", "+90 500 000 00 01");
        uzman.SetCommissionRate(10);
        var terapist = new StaffMember(tenant.Id, branch.Id, "Selin Ak", "Cilt Bakım Uzmanı", "+90 500 000 00 02");
        terapist.SetCommissionRate(8);
        db.StaffMembers.AddRange(uzman, terapist);

        var paket = new ServicePackage(tenant.Id, branch.Id, "Lazer + Cilt Bakım Paketi", 22500m, 9000m, 5,
            "5 seans buz lazer + 3 seans hydrafacial.");
        paket.ReplaceItems(new[]
        {
            (ServiceDefinitionId: lazer.Id, SessionCount: 5, UnitPrice: 1250m),
            (ServiceDefinitionId: cilt.Id, SessionCount: 3, UnitPrice: 1800m),
        });
        db.ServicePackages.Add(paket);

        var today = DateTime.UtcNow.Date;
        var gecmis = new Appointment(tenant.Id, branch.Id, customer.Id, uzman.Id, lazer.Id,
            today.AddDays(-3).AddHours(11), today.AddDays(-3).AddHours(11).AddMinutes(45), 1250, "İlk seans tamamlandı.");
        gecmis.Complete();
        var bugun = new Appointment(tenant.Id, branch.Id, customer.Id, terapist.Id, cilt.Id,
            today.AddHours(14), today.AddHours(15), 1800, "Nem terapisi eklenecek.");
        bugun.Confirm();
        var yarin = new Appointment(tenant.Id, branch.Id, customer.Id, uzman.Id, masaj.Id,
            today.AddDays(1).AddHours(10), today.AddDays(1).AddHours(10).AddMinutes(50), 950, null);
        db.Appointments.AddRange(gecmis, bugun, yarin);

        await db.SaveChangesAsync();
    }

    private static string Fallback(string? value, string fallback) =>
        string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();

    /// <summary>Slug ham SQL'de eşitlikle aranır; harf/rakam/tire dışını temizle.</summary>
    private static string Slugify(string? value, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        var cleaned = new string(value.Trim().ToLowerInvariant()
            .Select(c => char.IsLetterOrDigit(c) && c < 128 ? c : '-').ToArray())
            .Trim('-');
        return cleaned.Length == 0 ? fallback : cleaned;
    }
}
