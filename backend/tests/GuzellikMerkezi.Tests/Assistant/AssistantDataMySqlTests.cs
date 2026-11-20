using GuzellikMerkezi.Application.Features.Assistant;
using GuzellikMerkezi.Application.Features.Customers;
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

        var covered = new HashSet<AssistantIntent>();
        foreach (var (role, branch) in new[] { (UserRole.InstitutionOwner, (Guid?)null), (UserRole.BranchManager, (Guid?)seed.Kadikoy) })
        {
            var user = new TestCurrentUser(role, seed.TenantId, branch);
            var tenant = new TestTenantContext(seed.TenantId, branch);
            foreach (var question in OwnerQuestions)
            {
                await using var db = new GuzellikDbContext(
                    new DbContextOptionsBuilder<GuzellikDbContext>().UseMySQL(database.ConnectionString).Options,
                    tenant, user, null, null, TestSearchIndex.Create());
                var service = new AssistantService(db, user, tenant, new AllowAllFeatureService(), new NoHelp(), new NoAi(),
                    new ReportsService(db, user), Customers(),
                    new ConfigurationBuilder().Build(), NullLogger<AssistantService>.Instance);
                var result = await service.SendAsync(new AssistantSendRequest(null, question, null, null), CancellationToken.None);
                Assert.True(result.IsSuccess, $"{role}: '{question}' → {(result.IsFailure ? result.Error.Message : "")}");
                var reply = result.Value!;
                Assert.True(reply.Outcome != "error", $"{role}: '{question}' MySQL'de hata verdi: {reply.Text}");
                if (Enum.TryParse<AssistantIntent>(reply.Intent, out var intent)) covered.Add(intent);
            }
        }

        // Yönetici portalındaki bütün veri niyetleri en az bir kez gerçekten çalıştı.
        var managerIntents = AssistantIntentCatalog.DataRules.Where(rule => rule.Portals.Contains(AssistantPortals.Owner)).Select(rule => rule.Intent);
        Assert.Empty(managerIntents.Except(covered));
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
