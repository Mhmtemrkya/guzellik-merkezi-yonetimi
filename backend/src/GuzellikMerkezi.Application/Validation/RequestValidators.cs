using FluentValidation;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.Auth;
using GuzellikMerkezi.Application.Features.Branches;
using GuzellikMerkezi.Application.Features.Customers;
using GuzellikMerkezi.Application.Features.ServiceCatalog;
using GuzellikMerkezi.Application.Features.Staff;
using GuzellikMerkezi.Application.Features.Tenants;

namespace GuzellikMerkezi.Application.Validation;

public sealed class LoginScopeRequestValidator : AbstractValidator<LoginScopeRequest>
{
    public LoginScopeRequestValidator() => RuleFor(x => x.Email).NotEmpty().EmailAddress();
}

public sealed class LoginRequestValidator : AbstractValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress();
        RuleFor(x => x.Password).NotEmpty().MinimumLength(6);
    }
}

public sealed class CreateTenantRequestValidator : AbstractValidator<CreateTenantRequest>
{
    public CreateTenantRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(160);
        RuleFor(x => x.Slug).NotEmpty().MaximumLength(120).Matches("^[a-z0-9-]+$");
        RuleFor(x => x.Plan).NotEmpty().MaximumLength(80);
        RuleFor(x => x.Domain).MaximumLength(256);
        RuleFor(x => x.OwnerName).MaximumLength(160);
        // Telefon DB'de şifrelenip saklanır; çok uzun değer 500 yerine 400 dönmeli (frontend limiti 40).
        RuleFor(x => x.Phone).MaximumLength(40);
        RuleFor(x => x.OwnerEmail).EmailAddress().MaximumLength(256).When(x => !string.IsNullOrWhiteSpace(x.OwnerEmail));
        RuleFor(x => x.Email).EmailAddress().MaximumLength(256).When(x => !string.IsNullOrWhiteSpace(x.Email));
        RuleForEach(x => x.AdditionalOwners).ChildRules(owner =>
        {
            owner.RuleFor(o => o.Name).MaximumLength(160);
            owner.RuleFor(o => o.Email).EmailAddress().MaximumLength(256).When(o => !string.IsNullOrWhiteSpace(o.Email));
        }).When(x => x.AdditionalOwners is not null);
    }
}

public sealed class UpdateTenantRequestValidator : AbstractValidator<UpdateTenantRequest>
{
    public UpdateTenantRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(160);
        RuleFor(x => x.Plan).NotEmpty().MaximumLength(80);
        RuleFor(x => x.Status).IsInEnum();
        RuleFor(x => x.Domain).MaximumLength(256);
        RuleFor(x => x.OwnerName).MaximumLength(160);
        RuleFor(x => x.Phone).MaximumLength(40);
        RuleFor(x => x.TaxNumber).MaximumLength(64);
        RuleFor(x => x.LegalName).MaximumLength(256);
        RuleFor(x => x.TaxOffice).MaximumLength(128);
        RuleFor(x => x.Email).EmailAddress().MaximumLength(256).When(x => !string.IsNullOrWhiteSpace(x.Email));
        RuleFor(x => x.Currency).MaximumLength(6).When(x => !string.IsNullOrWhiteSpace(x.Currency));
        RuleFor(x => x.MaxInstallments).InclusiveBetween(1, 36).When(x => x.MaxInstallments.HasValue);
        RuleFor(x => x.OverdueGraceDays).InclusiveBetween(0, 60).When(x => x.OverdueGraceDays.HasValue);
    }
}

public sealed class GrantTenantAccessRequestValidator : AbstractValidator<GrantTenantAccessRequest>
{
    public GrantTenantAccessRequestValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress().MaximumLength(256);
        RuleFor(x => x.FullName).MaximumLength(160);
        RuleFor(x => x.Role).IsInEnum();
        RuleFor(x => x.InitialPassword).MinimumLength(6).When(x => !string.IsNullOrWhiteSpace(x.InitialPassword));
    }
}

public sealed class UpsertBranchRequestValidator : AbstractValidator<UpsertBranchRequest>
{
    public UpsertBranchRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(140);
        RuleFor(x => x.City).NotEmpty().MaximumLength(80);
        RuleFor(x => x.StaffCount).GreaterThanOrEqualTo(0);
        RuleFor(x => x.RoomCount).GreaterThanOrEqualTo(0);
    }
}

public sealed class UpsertCustomerRequestValidator : AbstractValidator<UpsertCustomerRequest>
{
    public UpsertCustomerRequestValidator()
    {
        RuleFor(x => x.BranchId).NotEmpty();
        RuleFor(x => x.FullName).NotEmpty().MaximumLength(160);
        RuleFor(x => x.Phone).NotEmpty().MaximumLength(32);
        RuleFor(x => x.Email).EmailAddress().When(x => !string.IsNullOrWhiteSpace(x.Email));
    }
}

public sealed class CreateStaffRequestValidator : AbstractValidator<CreateStaffRequest>
{
    public CreateStaffRequestValidator()
    {
        RuleFor(x => x.BranchId).NotEmpty();
        RuleFor(x => x.FullName).NotEmpty().MaximumLength(160);
        RuleFor(x => x.Title).NotEmpty().MaximumLength(100);
        RuleFor(x => x.CommissionRate).InclusiveBetween(0, 100).When(x => x.CommissionRate.HasValue);
    }
}

public sealed class UpdateStaffRequestValidator : AbstractValidator<UpdateStaffRequest>
{
    public UpdateStaffRequestValidator()
    {
        RuleFor(x => x.FullName).NotEmpty().MaximumLength(160);
        RuleFor(x => x.Title).NotEmpty().MaximumLength(100);
        RuleFor(x => x.CommissionRate).InclusiveBetween(0, 100).When(x => x.CommissionRate.HasValue);
    }
}

public sealed class UpsertServiceDefinitionRequestValidator : AbstractValidator<UpsertServiceDefinitionRequest>
{
    public UpsertServiceDefinitionRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(160);
        RuleFor(x => x.DurationMinutes).GreaterThan(0);
        RuleFor(x => x.Price).GreaterThanOrEqualTo(0);
    }
}

public sealed class CreateAppointmentRequestValidator : AbstractValidator<CreateAppointmentRequest>
{
    public CreateAppointmentRequestValidator()
    {
        RuleFor(x => x.BranchId).NotEmpty();
        RuleFor(x => x.CustomerId).NotEmpty();
        RuleFor(x => x.StaffMemberId).NotEmpty();
        RuleFor(x => x.ServiceDefinitionId).NotEmpty();
        RuleFor(x => x.StartUtc.Kind).Equal(DateTimeKind.Utc).WithMessage("Başlangıç UTC olmalı.");
        RuleFor(x => x.EndUtc.Kind).Equal(DateTimeKind.Utc).WithMessage("Bitiş UTC olmalı.");
        RuleFor(x => x).Must(x => x.EndUtc > x.StartUtc).WithMessage("Bitiş başlangıçtan sonra olmalı.");
        RuleFor(x => x.Price).GreaterThanOrEqualTo(0);
    }
}
