using System.Text.RegularExpressions;
using GuzellikMerkezi.Domain;
using GuzellikMerkezi.Domain.Assistant;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Tests.Assistant;

/// <summary>
/// Maydi yardım kataloğu: (1) her rota web panelinde gerçekten bir sayfa ve o portalın menüsünden ulaşılabilir,
/// (2) paket ve izin anahtarları gerçek, (3) metinler TR/EN eşli, (4) anahtar kelime eşleşmesi doğru portala gider.
/// Rota kaynağı: Frontend/app/**/page.tsx ve Frontend/app/{panel,ekip}/layout.tsx menüleri.
/// </summary>
public sealed class AssistantHelpCatalogTests
{
    /// <summary>Menüde değil ama portalın bir ekranından bağlantıyla açılan sayfalar.</summary>
    private static readonly Dictionary<string, string> LinkedFrom = new()
    {
        ["/panel/paket"] = "Ayarlar → Paketim bağlantısı (app/panel/ayarlar/page.tsx)",
        ["/randevu"] = "müşteri portalının kendisi",
    };

    private static string? FrontendRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "Frontend", "app"))) dir = dir.Parent;
        return dir is null ? null : Path.Combine(dir.FullName, "Frontend");
    }

    [Fact]
    public void EveryArticleRoute_IsARealPage_ReachableFromThatPortal()
    {
        var root = FrontendRoot();
        if (root is null) return; // yalnız backend kopyası (CI imajı) — kontrol atlanır

        var menu = new Dictionary<string, HashSet<string>>
        {
            [AssistantPortals.Owner] = Hrefs(Path.Combine(root, "app", "panel", "layout.tsx")),
            [AssistantPortals.Branch] = Hrefs(Path.Combine(root, "app", "panel", "layout.tsx")),
            [AssistantPortals.Staff] = Hrefs(Path.Combine(root, "app", "ekip", "layout.tsx")),
            [AssistantPortals.Customer] = [],
        };

        var problems = new List<string>();
        foreach (var article in AssistantHelpCatalog.Articles)
        {
            foreach (var (portal, route) in article.Routes)
            {
                if (!File.Exists(Path.Combine(root, "app", route.TrimStart('/'), "page.tsx")))
                {
                    problems.Add($"{article.Id}/{portal}: {route} sayfası yok");
                    continue;
                }
                if (!menu[portal].Contains(route) && !LinkedFrom.ContainsKey(route))
                    problems.Add($"{article.Id}/{portal}: {route} bu portalın menüsünde yok");
            }
        }
        Assert.True(problems.Count == 0, string.Join("\n", problems));
    }

    private static HashSet<string> Hrefs(string layout) =>
        Regex.Matches(File.ReadAllText(layout), @"href: '([^'?]+)")
            .Select(match => match.Groups[1].Value)
            .ToHashSet(StringComparer.Ordinal);

    [Fact]
    public void Catalog_IsWellFormed()
    {
        var articles = AssistantHelpCatalog.Articles;
        Assert.Equal(articles.Count, articles.Select(a => a.Id).Distinct().Count());
        foreach (var article in articles)
        {
            Assert.False(string.IsNullOrWhiteSpace(article.TitleTr), article.Id);
            Assert.False(string.IsNullOrWhiteSpace(article.TitleEn), article.Id);
            Assert.True(article.StepsTr.Count >= 2, article.Id);
            Assert.Equal(article.StepsTr.Count, article.StepsEn.Count);
            Assert.NotEmpty(article.Routes);
            Assert.All(article.Routes.Keys, portal => Assert.Contains(portal, AssistantPortals.All));
            // Anahtar kelimeler katlanmış biçimde olmalı (eşleşme katlanmış metinle yapılır).
            Assert.All(article.Keywords, keyword => Assert.Equal(AssistantText.Fold(keyword), keyword));
            Assert.Equal(article.Keywords.Count, article.Keywords.Distinct().Count());
            Assert.All(article.FeatureKeys, key => Assert.True(FeatureCatalog.Exists(key), $"{article.Id}: {key} paket kataloğunda yok"));
            if (article.StaffPermission is { } permission)
                Assert.True(Permissions.All.Any(p => p.Key == permission), $"{article.Id}: {permission} izin listesinde yok");
        }
    }

    [Fact]
    public void Approvals_And_Drafts_AreExplained_ForStaffArticles()
    {
        // Personelin kaydı taslak olur: personelin değiştirebildiği ekranların makaleleri bunu söylemeli.
        foreach (var id in new[] { "appointment-create", "customer-add", "service-define" })
        {
            var article = AssistantHelpCatalog.Articles.Single(a => a.Id == id);
            Assert.Contains(article.StepsTr, step => step.Contains("taslak", StringComparison.Ordinal));
        }
    }

    [Theory]
    [InlineData("randevu nasil olusturulur", AssistantPortals.Owner, "appointment-create", false)]
    [InlineData("yeni musteri nasil eklerim", AssistantPortals.Staff, "customer-add", false)]
    [InlineData("gun sonu kasa kapanisi nasil yapilir", AssistantPortals.Branch, "cash-closing", false)]
    [InlineData("musterinin once sonra fotografini nereye yuklerim", AssistantPortals.Staff, "treatment-log", false)]
    [InlineData("kontrendikasyon uyarisi nerede", AssistantPortals.Owner, "consultation", false)]
    [InlineData("toplu sms nasil gonderilir", AssistantPortals.Owner, "bulk-message", false)]
    [InlineData("indirim kampanyasi olusturmak istiyorum", AssistantPortals.Owner, "campaign", false)]
    [InlineData("randevumu nasil ertelerim", AssistantPortals.Customer, "customer-my-appointments", false)]
    [InlineData("sifremi nasil degistiririm", AssistantPortals.Staff, "staff-profile", false)]
    // Personel yönetici ekranını soruyor: makale var ama onun portalında değil.
    [InlineData("personel nasil eklenir", AssistantPortals.Staff, "staff-add", true)]
    public void Match_PrefersOwnPortal(string text, string portal, string expectedId, bool otherPortal)
    {
        var visible = AssistantHelpCatalog.VisibleTo(portal, RoleOf(portal), AllStaffPermissions, activeFeatures: null, storeBuild: false);
        var (article, other) = AssistantHelpCatalog.Match(text, portal, visible);
        Assert.Equal(expectedId, article?.Id);
        Assert.Equal(otherPortal, other);
    }

    [Fact]
    public void Match_CustomerIsNeverSentToBusinessPanel_AndViceVersa()
    {
        var customer = AssistantHelpCatalog.VisibleTo(AssistantPortals.Customer, UserRole.Customer, [], null, false);
        Assert.Equal((null, false), AssistantHelpCatalog.Match("kasa kapanisi nasil yapilir", AssistantPortals.Customer, customer));
    }

    [Fact]
    public void VisibleTo_AppliesPlanPermissionAndStoreGates()
    {
        // Paket: bekleme listesi özelliği yoksa makale görünmez (paket hiç yoksa = null → serbest).
        var withoutWaitlist = AssistantHelpCatalog.VisibleTo(AssistantPortals.Owner, UserRole.InstitutionOwner, [], [FeatureCatalog.AuditLogs], false);
        Assert.DoesNotContain(withoutWaitlist, a => a.Id == "waitlist");
        Assert.Contains(withoutWaitlist, a => a.Id == "logs");
        Assert.Contains(AssistantHelpCatalog.VisibleTo(AssistantPortals.Owner, UserRole.InstitutionOwner, [], null, false), a => a.Id == "waitlist");

        // İzin: kasa izni olmayan personel tahsilat makalesini görmez; yönetici izinsiz de görür.
        var staff = AssistantHelpCatalog.VisibleTo(AssistantPortals.Staff, UserRole.Staff, [Permissions.Appointments], null, false);
        Assert.Contains(staff, a => a.Id == "appointment-create");
        Assert.DoesNotContain(staff, a => a.Id == "cash-collect");
        Assert.Contains(AssistantHelpCatalog.VisibleTo(AssistantPortals.Branch, UserRole.BranchManager, [], null, false), a => a.Id == "cash-collect");

        // Mağaza sürümü: abonelik (satın alma yüzeyi) gösterilmez.
        Assert.Contains(AssistantHelpCatalog.VisibleTo(AssistantPortals.Owner, UserRole.InstitutionOwner, [], null, false), a => a.Id == "subscription");
        Assert.DoesNotContain(AssistantHelpCatalog.VisibleTo(AssistantPortals.Owner, UserRole.InstitutionOwner, [], null, true), a => a.Id == "subscription");
    }

    [Theory]
    [InlineData(UserRole.InstitutionOwner, AssistantPortals.Owner)]
    [InlineData(UserRole.BranchManager, AssistantPortals.Branch)]
    [InlineData(UserRole.Staff, AssistantPortals.Staff)]
    [InlineData(UserRole.Customer, AssistantPortals.Customer)]
    [InlineData(UserRole.PlatformAdmin, null)]
    public void Portals_FollowRoles(UserRole role, string? portal) => Assert.Equal(portal, AssistantPortals.Of(role));

    private static readonly string[] AllStaffPermissions = Permissions.All.Select(p => p.Key).ToArray();

    private static UserRole RoleOf(string portal) => portal switch
    {
        AssistantPortals.Owner => UserRole.InstitutionOwner,
        AssistantPortals.Branch => UserRole.BranchManager,
        AssistantPortals.Staff => UserRole.Staff,
        _ => UserRole.Customer,
    };
}
