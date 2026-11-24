using GuzellikMerkezi.Application.Features.Assistant;
using GuzellikMerkezi.Application.Features.Customers;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Assistant;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using GuzellikMerkezi.Infrastructure.Services.Assistant;
using GuzellikMerkezi.Tests.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace GuzellikMerkezi.Tests.Assistant;

/// <summary>
/// Maydi'nin HER veri niyeti gerçek MySQL/MariaDB'de çalışır: MySql.EntityFrameworkCore bazı LINQ biçimlerini
/// (yerel koleksiyon Contains vb.) çeviremez ve bu hata InMemory testlerinde görünmez. Burada her soru kurum
/// sahibi (tüm kurum) ve şube yöneticisi (tek şube) olarak sorulur; hiçbiri "error" dönmemelidir.
/// </summary>
public sealed class AssistantDataMySqlTests
{
    private static readonly string[] OwnerQuestions =
    [
        "bugün kaç randevu var", "yarınki randevular", "ocakta kaç randevu vardı", "bu haftaki program", "bugün boş saat var mı",
        "yarın boş saat var mı", "onay bekleyenler", "bugünün geliri ne", "ocak ayı gelirlerini göster", "2026 yılı geliri",
        "geçen ayın giderleri", "bu ayın kârı ne kadar", "dün ne kadar satış yaptık", "ödeme yöntemlerine göre dağılım",
        "geciken taksitler", "müşterilerin toplam borcu", "kritik stoktaki ürünler", "stok durumu", "bekleme listesi",
        "bu ay en çok çalışan personel", "en çok satan hizmetler", "şubeleri karşılaştır", "bu ay kaç yeni müşteri geldi",
        "toplam kaç müşterimiz var", "en çok harcayan müşteriler", "uzun süredir gelmeyen müşteriler", "bu ay doğum günü olanlar",
        "gelmeyen müşteriler", "bu ay iptal edilen randevular", "en yoğun saatler",
        // Adıyla ve durum soruları
        "Deniz yarın çalışıyor mu", "cilt bakımı kaç TL", "fiyat listesi", "Serum kaç tane kaldı", "kadıköyün borcu ne kadar",
        "aboneliğim ne zaman bitiyor", "whatsapp kredim ne kadar", "bugün kasa kapanışı yapıldı mı", "bugün kim izinli",
        "aktif kampanyalar neler", "kvkk onayı olmayan müşteriler", "kaç aktif hediye çeki var", "salonun adresi ne",
    ];

    private static readonly string[] StaffQuestions =
    [
        "bugünkü randevularım", "yarınki randevularım", "sıradaki müşterim kim", "bu haftaki programım", "bu ay kaç işlem yaptım",
        "yıldız puanım kaç", "paketli müşterilerimin kalan seansı", "Deniz yarın çalışıyor mu", "kadıköyün kalan seansı", "cilt bakımı kaç TL",
        "bugünün geliri ne", "kritik stoktaki ürünler", "salonun adresi ne",
    ];

    private static readonly string[] CustomerQuestions =
    [
        "yaklaşan randevum ne zaman", "yarın randevum var mı", "kalan seansım kaç", "randevu geçmişim", "borcum ne kadar", "sadakat puanım kaç",
        "hediye çekim var mı", "fiyat listesi", "cilt bakımı kaç TL", "salonun adresi ne", "kaçta açılıyorsunuz",
    ];

    [MySqlFact]
    public async Task EveryDataIntent_RunsOnRealDatabase()
    {
        await using var database = await MySqlTestDatabase.CreateAsync();
        BranchDeleteTests.Seed seed;
        await using (var db = database.NewContext())
        {
            seed = BranchDeleteTests.Populate(db);
            await db.SaveChangesAsync();
        }

        var staffUserId = seed.User; // FK: personel mevcut bir kullanıcıya bağlanır
        await using (var db = database.NewContext())
        {
            var staffMember = await db.StaffMembers.IgnoreQueryFilters().SingleAsync(x => x.Id == seed.Staff);
            staffMember.LinkTenantUser(staffUserId);
            db.Products.Add(new GuzellikMerkezi.Domain.Entities.Product(seed.TenantId, seed.Kadikoy, "Serum", ProductCategory.SkinCare, "adet", 10m, 20m, 1m, 5m));
            await db.SaveChangesAsync();
        }

        var everyPermission = typeof(Permissions).GetFields().Where(f => f.IsLiteral && f.FieldType == typeof(string)).Select(f => (string)f.GetRawConstantValue()!).ToArray();
        var askers = new (TestCurrentUser User, Guid? Branch, string[] Questions)[]
        {
            (new TestCurrentUser(UserRole.InstitutionOwner, seed.TenantId), null, OwnerQuestions),
            (new TestCurrentUser(UserRole.BranchManager, seed.TenantId, seed.Kadikoy), seed.Kadikoy, OwnerQuestions),
            (new TestCurrentUser(UserRole.Staff, seed.TenantId, seed.Kadikoy, everyPermission) { UserId = staffUserId }, seed.Kadikoy, StaffQuestions),
            (new TestCurrentUser(UserRole.Customer, seed.TenantId) { CustomerId = seed.Customer }, null, CustomerQuestions),
        };
        var covered = new HashSet<AssistantIntent>();
        foreach (var (user, branch, questions) in askers)
        {
            var role = user.Role;
            var tenant = new TestTenantContext(seed.TenantId, branch);
            foreach (var question in questions)
            {
                await using var db = new GuzellikDbContext(
                    new DbContextOptionsBuilder<GuzellikDbContext>().UseMySQL(database.ConnectionString).Options,
                    tenant, user, null, null, TestSearchIndex.Create());
                var service = new AssistantService(db, user, tenant, new AllowAllFeatureService(), new NoHelp(), new NoAi(),
                    new ReportsService(db, user), Customers(), new AssistantEntityFinder(db, TestSearchIndex.Create()),
                    new ConfigurationBuilder().Build(), NullLogger<AssistantService>.Instance);
                var result = await service.SendAsync(new AssistantSendRequest(null, question, null, null), CancellationToken.None);
                Assert.True(result.IsSuccess, $"{role}: '{question}' → {(result.IsFailure ? result.Error.Message : "")}");
                var reply = result.Value!;
                Assert.True(reply.Outcome != "error", $"{role}: '{question}' MySQL'de hata verdi: {reply.Text}");
                if (Enum.TryParse<AssistantIntent>(reply.Intent, out var intent)) covered.Add(intent);
            }
        }

        // Bütün veri niyetleri (her portalda) en az bir kez gerçekten çalıştı.
        Assert.Empty(AssistantIntentCatalog.DataRules.Select(rule => rule.Intent).Except(covered));
    }

    private static ICustomerService Customers()
    {
        var customers = Substitute.For<ICustomerService>();
        customers.GetPassiveCustomersAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>())
            .Returns(GuzellikMerkezi.Application.Common.Result<PassiveCustomerListDto>.Success(new PassiveCustomerListDto(60, [])));
        return customers;
    }

    private sealed class NoHelp : IAssistantHelpService
    {
        public Task<AssistantHelpAnswer> AnswerAsync(string question, AssistantHelpOptions options, CancellationToken cancellationToken) =>
            Task.FromResult(AssistantHelpAnswer.None("owner"));
    }

    private sealed class NoAi : IAssistantHelpMatcher
    {
        public bool IsEnabled => false;
        public int DailyLimit => 0;
        public Task<string?> PickArticleAsync(string maskedQuestion, IReadOnlyList<(string Id, string Title)> articles, CancellationToken cancellationToken) =>
            Task.FromResult<string?>(null);
    }
}
