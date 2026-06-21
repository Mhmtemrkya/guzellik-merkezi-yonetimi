using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;
using GuzellikMerkezi.Domain.Exceptions;

namespace GuzellikMerkezi.Tests.Domain;

public sealed class AppointmentTests
{
    [Fact]
    public void Constructor_NonUtcDates_ThrowsDomainException()
    {
        var tenantId = Guid.CreateVersion7();
        var branchId = Guid.CreateVersion7();

        Assert.Throws<DomainException>(() => new Appointment(
            tenantId,
            branchId,
            Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            DateTime.Now,
            DateTime.Now.AddHours(1),
            100));
    }

    [Fact]
    public void Overlaps_WhenTimeRangesIntersect_ReturnsTrue()
    {
        var appointment = CreateAppointment(DateTime.UtcNow.Date.AddHours(9), DateTime.UtcNow.Date.AddHours(10));

        var overlaps = appointment.Overlaps(DateTime.UtcNow.Date.AddHours(9).AddMinutes(30), DateTime.UtcNow.Date.AddHours(10).AddMinutes(30));

        Assert.True(overlaps);
    }

    [Fact]
    public void Complete_ThenCancel_ThrowsBusinessRuleException()
    {
        var appointment = CreateAppointment(DateTime.UtcNow.Date.AddHours(9), DateTime.UtcNow.Date.AddHours(10));
        appointment.Complete();

        Assert.Equal(AppointmentStatus.Completed, appointment.Status);
        Assert.Throws<BusinessRuleException>(() => appointment.Cancel("Vazgeçti"));
    }

    private static Appointment CreateAppointment(DateTime startUtc, DateTime endUtc)
    {
        return new Appointment(
            Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            DateTime.SpecifyKind(startUtc, DateTimeKind.Utc),
            DateTime.SpecifyKind(endUtc, DateTimeKind.Utc),
            100);
    }
}
