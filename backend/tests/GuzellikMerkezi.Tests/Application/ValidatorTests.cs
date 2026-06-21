using FluentValidation.TestHelper;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.Tenants;
using GuzellikMerkezi.Application.Validation;

namespace GuzellikMerkezi.Tests.Application;

public sealed class ValidatorTests
{
    [Fact]
    public void CreateTenantRequestValidator_InvalidSlug_Fails()
    {
        var validator = new CreateTenantRequestValidator();
        var request = new CreateTenantRequest("Kaya Beauty", "KAYA Beauty", "Başlangıç", null, null, null, null, null, null);

        var result = validator.TestValidate(request);

        result.ShouldHaveValidationErrorFor(x => x.Slug);
    }

    [Fact]
    public void CreateAppointmentRequestValidator_EndBeforeStart_Fails()
    {
        var validator = new CreateAppointmentRequestValidator();
        var start = DateTime.UtcNow.Date.AddHours(10);
        var request = new CreateAppointmentRequest(Guid.CreateVersion7(), Guid.CreateVersion7(), Guid.CreateVersion7(), Guid.CreateVersion7(), start, start.AddMinutes(-30), 100, null);

        var result = validator.TestValidate(request);

        Assert.False(result.IsValid);
    }
}
