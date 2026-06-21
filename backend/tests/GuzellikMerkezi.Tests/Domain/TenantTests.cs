using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Tests.Domain;

public sealed class TenantTests
{
    [Fact]
    public void AddBranch_FirstBranch_IsDefault()
    {
        var tenant = new Tenant("Kaya Beauty", "kaya-beauty", "Başlangıç");

        var branch = tenant.AddBranch("Merkez", "İstanbul");

        Assert.True(branch.IsDefault);
        Assert.Single(tenant.Branches);
    }

    [Fact]
    public void AddBranch_NewDefault_UnmarksPreviousDefault()
    {
        var tenant = new Tenant("Kaya Beauty", "kaya-beauty", "Başlangıç");
        var first = tenant.AddBranch("Merkez", "İstanbul");

        var second = tenant.AddBranch("Nişantaşı", "İstanbul", isDefault: true);

        Assert.False(first.IsDefault);
        Assert.True(second.IsDefault);
    }

    [Fact]
    public void TrialTenant_DoesNotStartCountdownBeforeOwnerLogin()
    {
        var tenant = new Tenant("Kaya Beauty", "kaya-beauty", "Başlangıç", TenantStatus.Trial);

        Assert.Equal(TenantStatus.Trial, tenant.Status);
        Assert.Null(tenant.TrialEndsAtUtc);
    }

    [Fact]
    public void StartTrial_SetsFourteenDayCountdown()
    {
        var tenant = new Tenant("Kaya Beauty", "kaya-beauty", "Başlangıç", TenantStatus.Trial);
        var now = new DateTime(2026, 6, 6, 12, 0, 0, DateTimeKind.Utc);

        tenant.StartTrial(now);

        Assert.Equal(TenantStatus.Trial, tenant.Status);
        Assert.Equal(now.AddDays(Tenant.DefaultTrialDays), tenant.TrialEndsAtUtc);
        Assert.False(tenant.IsTrialExpired(now.AddDays(Tenant.DefaultTrialDays).AddTicks(-1)));
        Assert.True(tenant.IsTrialExpired(now.AddDays(Tenant.DefaultTrialDays)));
    }

    [Fact]
    public void ResetTrialForNextOwnerLogin_ClearsPreviousCountdown()
    {
        var tenant = new Tenant("Kaya Beauty", "kaya-beauty", "Başlangıç", TenantStatus.Trial);
        tenant.StartTrial(new DateTime(2026, 6, 6, 12, 0, 0, DateTimeKind.Utc));
        tenant.Suspend();

        tenant.ResetTrialForNextOwnerLogin();

        Assert.Equal(TenantStatus.Trial, tenant.Status);
        Assert.Null(tenant.TrialEndsAtUtc);
    }

    [Fact]
    public void GrantAccess_DuplicateActiveScope_ThrowsBusinessRuleException()
    {
        var tenant = new Tenant("Kaya Beauty", "kaya-beauty", "Başlangıç");
        tenant.GrantAccess("OWNER@EXAMPLE.COM", UserRole.InstitutionOwner, fullName: "Owner");

        Assert.Throws<BusinessRuleException>(() => tenant.GrantAccess("owner@example.com", UserRole.InstitutionOwner));
    }
}
