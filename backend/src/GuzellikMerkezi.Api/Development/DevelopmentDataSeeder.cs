using GuzellikMerkezi.Application.Abstractions;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace GuzellikMerkezi.Api.Development;

public static class DevelopmentDataSeeder
{
    public static async Task SeedDevelopmentDataAsync(this WebApplication app)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<GuzellikDbContext>();
        var passwordHasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher>();

        // Geliştirme: "Database:RecreateOnStartup=true" set edip restart yap;
        // mevcut DB silinip migration'larla yeniden oluşur, seed devreye girer. Kullandıktan sonra false'a al.
        var recreate = bool.TryParse(app.Configuration["Database:RecreateOnStartup"], out var r) && r;
        if (recreate)
        {
            await db.Database.EnsureDeletedAsync();
        }

        // Şema EF migration'larıyla kurulur/güncellenir; eski (EnsureCreated/SQL bootstrap) DB'ler baseline alınır.
        var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("DatabaseBootstrap");
        await DatabaseBootstrap.MigrateDatabaseAsync(db, logger);

        // Demo operasyonel veri (kurum/personel/müşteri/randevu/ürün...) ASLA otomatik eklenmez.
        // Canlı veri ile çalışma kuralı: yalnızca açıkça Database:SeedDemoData=true verilirse devreye girer.
        var seedDemo = bool.TryParse(app.Configuration["Database:SeedDemoData"], out var demoFlag) && demoFlag;
        if (!seedDemo) return;

        // Idempotent: mevcut kurum varsa demo verisi yeniden eklenmez ve mevcut kullanıcı şifrelerine DOKUNULMAZ.
        if (await db.Tenants.IgnoreQueryFilters().AnyAsync()) return;

        const string password = "Guzellik123!";

        var tenant = new Tenant("BeautyAsist Demo Güzellik Merkezi", "beautyasist-demo", "Premium", TenantStatus.Active);
        tenant.SetProfile("demo.beautyasist.app", "Deniz Kaya");
        var nisantasi = tenant.AddBranch("Nişantaşı", "İstanbul", true);
        nisantasi.UpdateCapacity(staffCount: 6, roomCount: 5);
        var kadikoy = tenant.AddBranch("Kadıköy", "İstanbul", false);
        kadikoy.UpdateCapacity(staffCount: 4, roomCount: 3);

        var platformAdmin = tenant.GrantAccess("platform@beautyasist.test", UserRole.PlatformAdmin, null, "Platform Admin");
        platformAdmin.SetPasswordHash(passwordHasher.Hash(password));
        var owner = tenant.GrantAccess("admin@beautyasist.test", UserRole.InstitutionOwner, null, "Deniz Kaya");
        owner.SetPasswordHash(passwordHasher.Hash(password));
        var staffUser = tenant.GrantAccess("personel@beautyasist.test", UserRole.Staff, nisantasi.Id, "Elif Aydın");
        staffUser.SetPasswordHash(passwordHasher.Hash(password));

        var secondTenant = new Tenant("Lotus Klinik", "lotus-klinik", "Başlangıç", TenantStatus.Trial);
        secondTenant.SetProfile("lotus.beautyasist.app", "Selin Demir");
        var lotusBranch = secondTenant.AddBranch("Merkez", "Ankara", true);
        lotusBranch.UpdateCapacity(staffCount: 2, roomCount: 2);
        var secondOwner = secondTenant.GrantAccess("lotus@beautyasist.test", UserRole.InstitutionOwner, null, "Selin Demir");
        secondOwner.SetPasswordHash(passwordHasher.Hash(password));

        var laser = new ServiceDefinition(tenant.Id, nisantasi.Id, "Buz Lazer Epilasyon", 45, 1250, "Epilasyon");
        var cilt = new ServiceDefinition(tenant.Id, nisantasi.Id, "Hydrafacial Cilt Bakımı", 60, 1800, "Cilt Bakımı");
        var lenf = new ServiceDefinition(tenant.Id, kadikoy.Id, "Lenf Drenaj Masajı", 50, 950, "Masaj");

        var elif = new StaffMember(tenant.Id, nisantasi.Id, "Elif Aydın", "Uzman Estetisyen", "+90 532 100 10 10");
        elif.UpdateProfile("Elif Aydın", "Uzman Estetisyen", "+90 532 100 10 10", "Epilasyon, cilt bakımı");
        elif.SetCommissionRate(12);
        elif.LinkTenantUser(staffUser.Id);
        var zeynep = new StaffMember(tenant.Id, nisantasi.Id, "Zeynep Karaca", "Cilt Bakım Uzmanı", "+90 532 200 20 20");
        zeynep.UpdateProfile("Zeynep Karaca", "Cilt Bakım Uzmanı", "+90 532 200 20 20", "Hydrafacial, bakım protokolleri");
        zeynep.SetCommissionRate(10);
        var ayse = new StaffMember(tenant.Id, kadikoy.Id, "Ayşe Nur", "Masaj Terapisti", "+90 532 300 30 30");
        ayse.UpdateProfile("Ayşe Nur", "Masaj Terapisti", "+90 532 300 30 30", "Masaj, lenf drenaj");
        ayse.SetCommissionRate(8);

        var müşteri1 = new Customer(tenant.Id, nisantasi.Id, "Merve Yılmaz", "+90 555 111 22 33", "merve@example.com");
        müşteri1.UpdateProfile(new DateOnly(1993, 4, 12), Gender.Female, true, "şehir: İstanbul\nHassas cilt; pudra tonlarını seviyor.");
        // Online portal demo girişi: ad "Merve Yılmaz" + telefon 0555 111 22 33 + doğum 12.04.1993 ile giriş yapılır.
        var müşteri2 = new Customer(tenant.Id, nisantasi.Id, "İpek Şahin", "+90 555 222 33 44", "ipek@example.com");
        müşteri2.UpdateProfile(new DateOnly(1988, 9, 3), Gender.Female, true, "şehir: İstanbul\nLazer paket görüşmesi yapıldı.");
        var müşteri3 = new Customer(tenant.Id, kadikoy.Id, "Derya Aksoy", "+90 555 333 44 55", null);
        müşteri3.UpdateProfile(null, Gender.Unspecified, false, "şehir: İstanbul\nKVKK onayı randevuda alınacak.");

        var now = DateTime.UtcNow;
        var today = now.Date;
        var appointment1 = new Appointment(tenant.Id, nisantasi.Id, müşteri1.Id, elif.Id, laser.Id, today.AddHours(9), today.AddHours(9).AddMinutes(45), 1250, "İlk seans kontrol edildi.");
        appointment1.Confirm();
        var appointment2 = new Appointment(tenant.Id, nisantasi.Id, müşteri2.Id, zeynep.Id, cilt.Id, today.AddHours(13), today.AddHours(14), 1800, "Nem terapisi eklenecek.");
        var appointment3 = new Appointment(tenant.Id, kadikoy.Id, müşteri3.Id, ayse.Id, lenf.Id, today.AddDays(1).AddHours(11), today.AddDays(1).AddHours(11).AddMinutes(50), 950, "Kadıköy şube deneme randevusu.");
        appointment3.Complete();

        db.Tenants.AddRange(tenant, secondTenant);
        db.ServiceDefinitions.AddRange(laser, cilt, lenf);
        db.StaffMembers.AddRange(elif, zeynep, ayse);
        db.Customers.AddRange(müşteri1, müşteri2, müşteri3);
        db.Appointments.AddRange(appointment1, appointment2, appointment3);

        var laserCiltPaketi = new ServicePackage(
            tenant.Id,
            nisantasi.Id,
            "Lazer + Cilt Bakım Paketi",
            22500m,
            9000m,
            5,
            "5 seans buz lazer + 3 seans hydrafacial paketi.");
        laserCiltPaketi.ReplaceItems(new[]
        {
            (ServiceDefinitionId: laser.Id, SessionCount: 5, UnitPrice: 1250m),
            (ServiceDefinitionId: cilt.Id, SessionCount: 3, UnitPrice: 1800m),
        });

        var masajPaketi = new ServicePackage(
            tenant.Id,
            kadikoy.Id,
            "Detoks Masaj Paketi",
            4500m,
            2000m,
            3,
            "6 seans lenf drenaj paketi.");
        masajPaketi.ReplaceItems(new[]
        {
            (ServiceDefinitionId: lenf.Id, SessionCount: 6, UnitPrice: 750m),
        });

        db.ServicePackages.AddRange(laserCiltPaketi, masajPaketi);

        var account1 = new CustomerAccount(tenant.Id, nisantasi.Id, müşteri1.Id, laserCiltPaketi.Id, "Lazer + Cilt Bakım Paketi", 22500m, 9000m);
        account1.SetNotes("İlk seansta peşinat alındı, kalan 4 ay taksit.");
        account1.RebuildInstallments(4, DateOnly.FromDateTime(today.AddDays(15)));

        var account2 = new CustomerAccount(tenant.Id, nisantasi.Id, müşteri2.Id, null, "Hydrafacial 5'li seans", 9000m, 3000m);
        account2.SetNotes("Müşteri kart ile peşinat ödedi.");
        account2.RebuildInstallments(3, DateOnly.FromDateTime(today.AddDays(10)));

        db.CustomerAccounts.AddRange(account1, account2);

        // --- Örnek giderler (Mayıs 2026 dönemi) ---
        var monthStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var periodLabel = monthStart.ToString("yyyy-MM");

        var expElifSalary = new BusinessExpense(tenant.Id, nisantasi.Id, ExpenseCategory.Salary, 32000m, monthStart.AddDays(2), ExpensePaymentMethod.BankTransfer, "Elif Aydın - Mayıs maaşı", elif.Id, periodLabel, "MAAS-2026-05-01");
        expElifSalary.Approve();
        var expZeynepSalary = new BusinessExpense(tenant.Id, nisantasi.Id, ExpenseCategory.Salary, 28000m, monthStart.AddDays(2), ExpensePaymentMethod.BankTransfer, "Zeynep Karaca - Mayıs maaşı", zeynep.Id, periodLabel, "MAAS-2026-05-02");
        expZeynepSalary.Approve();
        var expAyseSalary = new BusinessExpense(tenant.Id, kadikoy.Id, ExpenseCategory.Salary, 24000m, monthStart.AddDays(2), ExpensePaymentMethod.BankTransfer, "Ayşe Nur - Mayıs maaşı", ayse.Id, periodLabel, "MAAS-2026-05-03");
        expAyseSalary.Approve();

        var expRent = new BusinessExpense(tenant.Id, nisantasi.Id, ExpenseCategory.Rent, 35000m, monthStart.AddDays(4), ExpensePaymentMethod.BankTransfer, "Nişantaşı şube kirası - Mayıs", null, periodLabel, "KIRA-2026-05");
        expRent.Approve();
        var expElectric = new BusinessExpense(tenant.Id, nisantasi.Id, ExpenseCategory.Utilities, 2850m, monthStart.AddDays(10), ExpensePaymentMethod.Card, "Elektrik faturası - Nisan tüketimi", null, "2026-04", "FAT-EL-04");
        expElectric.Approve();
        var expSupplies = new BusinessExpense(tenant.Id, nisantasi.Id, ExpenseCategory.Supplies, 4200m, monthStart.AddDays(7), ExpensePaymentMethod.Card, "Sarf malzeme: eldiven, dezenfektan, kağıt havlu", null, null, "TED-2026-05-01");
        var expInventory = new BusinessExpense(tenant.Id, nisantasi.Id, ExpenseCategory.Inventory, 12500m, monthStart.AddDays(12), ExpensePaymentMethod.BankTransfer, "BeautyLab cilt bakım ürün siparişi", null, null, "FAT-BL-2026-05");
        expInventory.Approve();
        var expMarketing = new BusinessExpense(tenant.Id, nisantasi.Id, ExpenseCategory.Marketing, 1500m, monthStart.AddDays(15), ExpensePaymentMethod.Card, "Instagram reklam bütçesi", null, periodLabel, null);
        var expAccountant = new BusinessExpense(tenant.Id, null, ExpenseCategory.Professional, 4500m, monthStart.AddDays(20), ExpensePaymentMethod.BankTransfer, "Muhasebeci aylık ücreti", null, periodLabel, "MUHB-05");

        db.BusinessExpenses.AddRange(
            expElifSalary, expZeynepSalary, expAyseSalary,
            expRent, expElectric, expSupplies, expInventory, expMarketing, expAccountant);

        // --- Örnek ürünler ---
        var hydrafacialSerum = new Product(tenant.Id, nisantasi.Id, "BeautyLab Vit-C Serum", "BL-SRM-001", ProductCategory.SkinCare, "adet", 380m, 750m, 24m, 8m, "BeautyLab", "Depo A · Raf 1");
        var hydrafacialMaske = new Product(tenant.Id, nisantasi.Id, "Hydrafacial Hidrasyon Maskesi", "BL-MSK-002", ProductCategory.SkinCare, "adet", 220m, 480m, 6m, 10m, "BeautyLab", "Depo A · Raf 1");
        var eldiven = new Product(tenant.Id, nisantasi.Id, "Nitril Eldiven (100'lü)", "SRF-ELD-001", ProductCategory.Consumable, "kutu", 95m, 0m, 18m, 6m, "MediKit", "Depo B · Raf 3");
        var dezenfektan = new Product(tenant.Id, nisantasi.Id, "Yüzey Dezenfektanı 5L", "SRF-DZN-001", ProductCategory.Consumable, "bidon", 145m, 0m, 4m, 3m, "CleanLine", "Depo B · Raf 4");
        var kagit = new Product(tenant.Id, nisantasi.Id, "Kağıt Havlu (12 rulo)", "SRF-KGT-001", ProductCategory.Consumable, "paket", 85m, 0m, 2m, 4m, "PaperCo", "Depo B · Raf 4");
        var satisKrem = new Product(tenant.Id, nisantasi.Id, "Anti-Aging Krem 50ml", "STS-AAG-001", ProductCategory.Sale, "adet", 320m, 690m, 15m, 5m, "BeautyLab", "Vitrin");
        var satisGunesKremi = new Product(tenant.Id, kadikoy.Id, "Güneş Koruyucu SPF50 100ml", "STS-SPF-002", ProductCategory.Sale, "adet", 180m, 380m, 22m, 6m, "BeautyLab", "Vitrin");
        var sacBakim = new Product(tenant.Id, nisantasi.Id, "Argan Yağı Saç Bakım Yağı", "HC-ARG-001", ProductCategory.HairCare, "adet", 240m, 520m, 8m, 4m, "HairLab", "Depo A · Raf 2");

        db.Products.AddRange(hydrafacialSerum, hydrafacialMaske, eldiven, dezenfektan, kagit, satisKrem, satisGunesKremi, sacBakim);

        // Örnek stok hareketleri (geçen aydan)
        var lastMonth = monthStart.AddMonths(-1);
        db.StockMovements.AddRange(
            new StockMovement(tenant.Id, hydrafacialSerum.Id, StockMovementType.Inbound, 24m, lastMonth.AddDays(2), 380m, "FAT-BL-2026-04", "Aylık BeautyLab siparişi", elif.Id),
            new StockMovement(tenant.Id, hydrafacialMaske.Id, StockMovementType.Inbound, 12m, lastMonth.AddDays(2), 220m, "FAT-BL-2026-04", "Aylık BeautyLab siparişi", elif.Id),
            new StockMovement(tenant.Id, hydrafacialMaske.Id, StockMovementType.Outbound, 6m, monthStart.AddDays(3), null, null, "Hydrafacial seansları kullanımı", elif.Id),
            new StockMovement(tenant.Id, eldiven.Id, StockMovementType.Inbound, 24m, lastMonth.AddDays(5), 95m, "MK-2026-04-02", "MediKit sipariş", null),
            new StockMovement(tenant.Id, eldiven.Id, StockMovementType.Outbound, 6m, monthStart.AddDays(10), null, null, "Aylık tüketim", null),
            new StockMovement(tenant.Id, satisKrem.Id, StockMovementType.Inbound, 18m, lastMonth.AddDays(8), 320m, "FAT-BL-2026-04", "Vitrine stok", null),
            new StockMovement(tenant.Id, satisKrem.Id, StockMovementType.Sale, 3m, monthStart.AddDays(12), null, "POS-001", "Müşteriye satış", zeynep.Id),
            new StockMovement(tenant.Id, kagit.Id, StockMovementType.Outbound, 1m, monthStart.AddDays(20), null, null, "Genel kullanım", null),
            new StockMovement(tenant.Id, satisGunesKremi.Id, StockMovementType.Sale, 2m, monthStart.AddDays(15), null, "POS-002", "Müşteriye satış", ayse.Id)
        );

        await db.SaveChangesAsync();
    }
}
