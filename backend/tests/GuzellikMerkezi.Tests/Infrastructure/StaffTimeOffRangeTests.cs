using GuzellikMerkezi.Application.Features.Schedule;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Infrastructure.Persistence;
using GuzellikMerkezi.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;

namespace GuzellikMerkezi.Tests.Infrastructure;

/// <summary>
/// "Gün Kapat": personelin bir gündeki belirli SAAT ARALIĞI randevuya kapatılabilir.
/// Aralık verilmezse eski davranış (tüm gün izinli) korunur.
/// </summary>
public sealed class StaffTimeOffRangeTests
{
    private static readonly DateOnly Day = new(2026, 8, 10);

    private static DbContextOptions<GuzellikDbContext> NewOptions() =>
        new DbContextOptionsBuilder<GuzellikDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString(), new InMemoryDatabaseRoot())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

    private static async Task<(Guid tenantId, Guid staffId)> SeedAsync(DbContextOptions<GuzellikDbContext> options)
    {
        await using var db = new GuzellikDbContext(options);
        var tenant = new Tenant("QA Kapali Saat", "qa-kapali-saat", "Premium", TenantStatus.Active);
        var branch = tenant.AddBranch("Merkez", "İstanbul", true);
        db.Tenants.Add(tenant);
        await db.SaveChangesAsync();

        var staff = new StaffMember(tenant.Id, branch.Id, "Kapalı Saat Personeli", "Estetisyen");
        db.StaffMembers.Add(staff);
        await db.SaveChangesAsync();
        return (tenant.Id, staff.Id);
    }

    /// <summary>UTC girdisi üretir: guard TR yerel saatine (UTC+3) çevirdiği için 3 saat geri alınır.</summary>
    private static DateTime LocalToUtc(int hour, int minute = 0) =>
        new DateTime(Day.Year, Day.Month, Day.Day, hour, minute, 0, DateTimeKind.Utc).AddHours(-3);

    [Fact]
    public async Task AddTimeOff_WithoutRange_ClosesWholeDay()
    {
        var options = NewOptions();
        var (tenantId, staffId) = await SeedAsync(options);

        await using var db = new GuzellikDbContext(options);
        var service = new ScheduleService(db, new NoopAuditLogger());

        var result = await service.AddTimeOffAsync(tenantId, new CreateTimeOffRequest(staffId, Day, null));

        Assert.True(result.IsSuccess);
        Assert.True(result.Value!.IsFullDay);
        Assert.Equal(0, result.Value.StartMinute);
        Assert.Equal(1440, result.Value.EndMinute);
    }

    [Fact]
    public async Task AddTimeOff_WithRange_StoresRangeAndIsNotFullDay()
    {
        var options = NewOptions();
        var (tenantId, staffId) = await SeedAsync(options);

        await using var db = new GuzellikDbContext(options);
        var service = new ScheduleService(db, new NoopAuditLogger());

        var result = await service.AddTimeOffAsync(tenantId, new CreateTimeOffRequest(staffId, Day, "Eğitim", 720, 780));

        Assert.True(result.IsSuccess);
        Assert.False(result.Value!.IsFullDay);
        Assert.Equal(720, result.Value.StartMinute);
        Assert.Equal(780, result.Value.EndMinute);
    }

    [Fact]
    public async Task AddTimeOff_AllowsMultipleNonOverlappingRangesInSameDay()
    {
        var options = NewOptions();
        var (tenantId, staffId) = await SeedAsync(options);

        await using var db = new GuzellikDbContext(options);
        var service = new ScheduleService(db, new NoopAuditLogger());

        Assert.True((await service.AddTimeOffAsync(tenantId, new CreateTimeOffRequest(staffId, Day, null, 600, 660))).IsSuccess);
        Assert.True((await service.AddTimeOffAsync(tenantId, new CreateTimeOffRequest(staffId, Day, null, 900, 960))).IsSuccess);

        var list = await service.ListTimeOffAsync(tenantId, Day, Day);
        Assert.Equal(2, list.Value!.Count);
    }

    [Fact]
    public async Task AddTimeOff_OverlappingRange_ReturnsConflict()
    {
        var options = NewOptions();
        var (tenantId, staffId) = await SeedAsync(options);

        await using var db = new GuzellikDbContext(options);
        var service = new ScheduleService(db, new NoopAuditLogger());

        await service.AddTimeOffAsync(tenantId, new CreateTimeOffRequest(staffId, Day, null, 720, 840));
        var clash = await service.AddTimeOffAsync(tenantId, new CreateTimeOffRequest(staffId, Day, null, 780, 900));

        Assert.True(clash.IsFailure);
        Assert.Contains("çakış", clash.Error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task AddTimeOff_FullDay_AbsorbsExistingRanges()
    {
        var options = NewOptions();
        var (tenantId, staffId) = await SeedAsync(options);

        await using var db = new GuzellikDbContext(options);
        var service = new ScheduleService(db, new NoopAuditLogger());

        await service.AddTimeOffAsync(tenantId, new CreateTimeOffRequest(staffId, Day, null, 600, 660));
        var fullDay = await service.AddTimeOffAsync(tenantId, new CreateTimeOffRequest(staffId, Day, null));

        Assert.True(fullDay.IsSuccess);
        var list = await service.ListTimeOffAsync(tenantId, Day, Day);
        var only = Assert.Single(list.Value!);
        Assert.True(only.IsFullDay);
    }

    [Fact]
    public async Task AddTimeOff_InvalidRange_ReturnsValidationError()
    {
        var options = NewOptions();
        var (tenantId, staffId) = await SeedAsync(options);

        await using var db = new GuzellikDbContext(options);
        var service = new ScheduleService(db, new NoopAuditLogger());

        var result = await service.AddTimeOffAsync(tenantId, new CreateTimeOffRequest(staffId, Day, null, 780, 720));

        Assert.True(result.IsFailure);
    }

    [Fact]
    public async Task WorkingHoursGuard_BlocksAppointmentInsideClosedRange_AndAllowsOutside()
    {
        var options = NewOptions();
        var (tenantId, staffId) = await SeedAsync(options);

        await using var db = new GuzellikDbContext(options);
        var service = new ScheduleService(db, new NoopAuditLogger());
        // 12:00–13:00 kapalı.
        await service.AddTimeOffAsync(tenantId, new CreateTimeOffRequest(staffId, Day, "Öğle arası", 720, 780));

        var inside = await WorkingHoursGuard.BlockReasonAsync(db, tenantId, staffId, LocalToUtc(12, 30), LocalToUtc(13, 0), default);
        var outside = await WorkingHoursGuard.BlockReasonAsync(db, tenantId, staffId, LocalToUtc(14, 0), LocalToUtc(15, 0), default);
        // Aralığın ucundan taşan randevu da engellenir (11:30–12:30).
        var straddling = await WorkingHoursGuard.BlockReasonAsync(db, tenantId, staffId, LocalToUtc(11, 30), LocalToUtc(12, 30), default);

        Assert.NotNull(inside);
        Assert.Contains("12:00", inside);
        Assert.Null(outside);
        Assert.NotNull(straddling);
    }

    [Fact]
    public async Task WorkingHoursGuard_BlocksFullDayLeave()
    {
        var options = NewOptions();
        var (tenantId, staffId) = await SeedAsync(options);

        await using var db = new GuzellikDbContext(options);
        var service = new ScheduleService(db, new NoopAuditLogger());
        await service.AddTimeOffAsync(tenantId, new CreateTimeOffRequest(staffId, Day, null));

        var blocked = await WorkingHoursGuard.BlockReasonAsync(db, tenantId, staffId, LocalToUtc(10, 0), LocalToUtc(11, 0), default);

        Assert.NotNull(blocked);
        Assert.Contains("izinli", blocked, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task RemoveTimeOff_ReopensClosedRange()
    {
        var options = NewOptions();
        var (tenantId, staffId) = await SeedAsync(options);

        await using var db = new GuzellikDbContext(options);
        var service = new ScheduleService(db, new NoopAuditLogger());
        var created = await service.AddTimeOffAsync(tenantId, new CreateTimeOffRequest(staffId, Day, null, 720, 780));

        Assert.NotNull(await WorkingHoursGuard.BlockReasonAsync(db, tenantId, staffId, LocalToUtc(12, 15), LocalToUtc(12, 45), default));

        Assert.True((await service.RemoveTimeOffAsync(tenantId, created.Value!.Id)).IsSuccess);

        Assert.Null(await WorkingHoursGuard.BlockReasonAsync(db, tenantId, staffId, LocalToUtc(12, 15), LocalToUtc(12, 45), default));
    }
}
