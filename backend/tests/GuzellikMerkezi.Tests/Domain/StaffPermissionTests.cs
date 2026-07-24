using GuzellikMerkezi.Domain;

namespace GuzellikMerkezi.Tests.Domain;

/// <summary>
/// İki seviyeli personel yetkisi (sayfa + işlem). Bu kural backend'de gerçek güvenlik sınırıdır
/// (PermissionEndpointFilter buradan karar verir), üstelik geriye uyumluluk istisnası içerdiği için
/// yanlışlıkla gevşetilmeye açıktır — o yüzden her dalı ayrı ayrı sabitlenir.
/// </summary>
public sealed class StaffPermissionTests
{
    [Fact]
    public void ExplicitlyGrantedAction_IsAllowed()
    {
        string[] granted = [Permissions.Accounting, Permissions.AccountingCollect];
        Assert.True(Permissions.IsActionAllowed(granted, Permissions.AccountingCollect));
    }

    [Fact]
    public void WithoutPagePermission_ActionIsDenied()
    {
        string[] granted = [Permissions.Customers];
        Assert.False(Permissions.IsActionAllowed(granted, Permissions.AccountingCollect));
    }

    [Fact]
    public void LegacyRecord_WithOnlyPagePermission_KeepsFullAccess()
    {
        // Eski kayıtlarda işlem anahtarı yoktu; yönetici formu kaydedene kadar personelin işi durmamalı.
        string[] granted = [Permissions.Accounting];
        Assert.True(Permissions.IsActionAllowed(granted, Permissions.AccountingCollect));
    }

    [Fact]
    public void WhenAdminGrantsSomeActions_UnlistedActionIsDenied()
    {
        // Yönetici o sayfada en az bir işlem seçtiyse artık "yeni format"tır: seçilmeyen işlem YASAK.
        // ("Ön muhasebeyi görsün ama cari oluşturmasın" senaryosu.)
        string[] granted = [Permissions.Accounting, Permissions.AccountingExpenses];
        Assert.True(Permissions.IsActionAllowed(granted, Permissions.AccountingExpenses));
        Assert.False(Permissions.IsActionAllowed(granted, Permissions.AccountingAccounts));
    }

    [Fact]
    public void ActionKeysAreCaseInsensitive()
    {
        string[] granted = ["accounting", "accounting.collect"];
        Assert.True(Permissions.IsActionAllowed(granted, Permissions.AccountingCollect));
    }

    [Fact]
    public void OneSectionsActionsDoNotAffectAnother()
    {
        // Ön muhasebede kısıtlama var; müşteriler sayfası hâlâ eski formatta → etkilenmemeli.
        string[] granted = [Permissions.Accounting, Permissions.AccountingExpenses, Permissions.Customers];
        Assert.False(Permissions.IsActionAllowed(granted, Permissions.AccountingAccounts));
        Assert.True(Permissions.IsActionAllowed(granted, Permissions.CustomersManage));
    }
}
