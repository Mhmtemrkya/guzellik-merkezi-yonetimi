using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.Branches;
using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Application.Features.Customers;
using GuzellikMerkezi.Application.Features.Expenses;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Application.Features.ServiceCatalog;
using GuzellikMerkezi.Application.Features.ServicePackages;
using GuzellikMerkezi.Application.Features.Staff;
using GuzellikMerkezi.Application.Features.Stock;
using GuzellikMerkezi.Application.Features.Tenants;
using GuzellikMerkezi.Domain.Entities;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Infrastructure.Services;

internal static class Mapping
{
    public static TenantDto ToDto(this Tenant tenant) => new(
        tenant.Id, tenant.Name, tenant.Slug, tenant.Plan, tenant.Status,
        tenant.Domain, tenant.OwnerName, tenant.Phone, tenant.TaxNumber,
        tenant.Currency, tenant.MaxInstallments, tenant.OverdueGraceDays,
        tenant.Branches.Count,
        tenant.SubscriptionPlanId,
        tenant.SubscriptionPlan?.PlanKey,
        tenant.SubscriptionPlan?.Name,
        tenant.SubscriptionPlan?.MonthlyPriceTRY ?? 0m,
        tenant.TrialEndsAtUtc,
        tenant.LegalName,
        tenant.TaxOffice,
        tenant.Email,
        tenant.SubscriptionPeriod?.ToString(),
        tenant.SubscriptionEndsAtUtc,
        tenant.SubscriptionPlan?.YearlyPriceTRY ?? 0m);
    public static BranchDto ToDto(this Branch branch) => new(branch.Id, branch.TenantId, branch.Name, branch.City, branch.IsDefault, branch.StaffCount, branch.RoomCount);
    public static CustomerDto ToDto(this Customer customer) => new(customer.Id, customer.TenantId, customer.BranchId, customer.FullName, customer.Phone, customer.Email, customer.BirthDate, customer.Gender, customer.KvkkConsent, customer.Notes, customer.PhotoUrl, customer.IsBlacklisted, customer.BlacklistReason, customer.CreatedAtUtc);
    public static StaffDto ToDto(this StaffMember staff, string? email = null, IReadOnlyCollection<string>? permissions = null, decimal? averageRating = null, int ratingCount = 0) =>
        new(staff.Id, staff.TenantId, staff.BranchId, staff.TenantUserId, staff.FullName, staff.Title, staff.Phone, staff.Specialties, staff.CommissionRate, staff.IsActive, email, permissions ?? Array.Empty<string>(), staff.PhotoUrl, averageRating, ratingCount);
    public static ServiceDefinitionDto ToDto(this ServiceDefinition service) => new(service.Id, service.TenantId, service.BranchId, service.Name, service.Category, service.DurationMinutes, service.Price, service.IsActive, service.IconKey, service.Status, service.DefaultSessionCount, service.LoyaltyPointCost);

    public static CustomServiceCategoryDto ToDto(this CustomServiceCategory category) => new(
        category.Id,
        category.TenantId,
        category.Name,
        category.IsActive,
        category.CreatedAtUtc);

    public static ProductDto ToDto(this Product product) => new(
        product.Id,
        product.TenantId,
        product.BranchId,
        product.Name,
        product.Sku,
        product.Category,
        product.Unit,
        product.Supplier,
        product.Location,
        product.Cost,
        product.SalePrice,
        product.CurrentStock,
        product.MinStockLevel,
        product.IsActive,
        product.IsOutOfStock,
        product.IsCritical,
        product.Barcode,
        product.ImageUrl,
        product.CreatedAtUtc,
        product.UpdatedAtUtc,
        product.Brand,
        product.TaxRatePercent,
        product.ExpiryDate,
        product.LotNumber,
        product.PendingInbound,
        product.LeadTimeDays);

    public static StockMovementDto ToDto(this StockMovement movement, string? productName = null, string? productSku = null, string? staffName = null) => new(
        movement.Id,
        movement.TenantId,
        movement.ProductId,
        productName,
        productSku,
        movement.Type,
        movement.Quantity,
        movement.UnitCost,
        movement.TotalCost,
        movement.OccurredAtUtc,
        movement.Reference,
        movement.Notes,
        movement.StaffMemberId,
        staffName);
    public static AppointmentDto ToDto(this Appointment appointment) => new(
        appointment.Id,
        appointment.TenantId,
        appointment.BranchId,
        appointment.CustomerId,
        appointment.StaffMemberId,
        appointment.ServiceDefinitionId,
        appointment.StartUtc,
        appointment.EndUtc,
        appointment.Status,
        appointment.Price,
        appointment.Notes,
        appointment.CancellationReason,
        appointment.Customer?.FullName,
        appointment.StaffMember?.FullName,
        appointment.ServiceDefinition?.Name);

    public static CustomExpenseCategoryDto ToDto(this CustomExpenseCategory category) => new(
        category.Id,
        category.TenantId,
        category.Name,
        category.IsActive,
        category.CreatedAtUtc);

    public static BusinessExpenseDto ToDto(this BusinessExpense expense) => expense.ToDtoWithStaff(expense.StaffMember?.FullName);

    public static PendingOperationDto ToDto(this PendingOperation op) => new(
        op.Id,
        op.TenantId,
        op.BranchId,
        op.RequestedByUserId,
        op.RequestedByName,
        op.OperationType,
        op.Title,
        op.Summary,
        op.PayloadJson,
        op.Status,
        op.RequestedAtUtc,
        op.DecidedAtUtc,
        op.DecidedByUserId,
        op.RejectionReason,
        op.ResultEntityId);

    public static BusinessExpenseDto ToDtoWithStaff(this BusinessExpense expense, string? staffName) => new(
        expense.Id,
        expense.TenantId,
        expense.BranchId,
        expense.Category,
        expense.Amount,
        expense.PaymentMethod,
        expense.OccurredAtUtc,
        expense.StaffMemberId,
        staffName,
        expense.PeriodLabel,
        expense.Description,
        expense.Reference,
        expense.IsApproved,
        expense.ApprovedAtUtc,
        expense.CreatedAtUtc);

    public static CustomerAccountDto ToDto(this CustomerAccount account, decimal appointmentRevenue = 0m, int completedCount = 0)
    {
        // Ödenen tutar taksitte değil tahsilatlarda tutulur; vade sırasına göre dağıtılır.
        var allocation = account.AllocatePayments();
        var installments = account.Installments
            .OrderBy(i => i.No)
            .Select(i =>
            {
                var paid = allocation.TryGetValue(i.Id, out var p) ? p : 0m;
                var status = i.Status == InstallmentStatus.Cancelled
                    ? InstallmentStatus.Cancelled
                    : (i.Amount <= 0 || paid >= i.Amount - 0.005m) ? InstallmentStatus.Paid : InstallmentStatus.Planned;
                return new InstallmentDto(i.Id, i.No, i.DueDate, i.Amount, paid, status, i.PaidAtUtc);
            })
            .ToArray();
        var payments = account.Payments
            .OrderByDescending(p => p.OccurredAtUtc)
            .Select(p => new AccountPaymentDto(p.Id, p.Amount, p.Method, p.Reference, p.OccurredAtUtc))
            .ToArray();
        return new CustomerAccountDto(
            account.Id,
            account.TenantId,
            account.BranchId,
            account.CustomerId,
            account.Customer?.FullName,
            account.Customer?.Phone,
            account.ServicePackageId,
            account.ServicePackage?.Name,
            account.Name,
            account.TotalAmount,
            account.DepositAmount,
            account.PaidAmount,
            account.RemainingAmount,
            account.CreditBalance,
            account.IsActive,
            account.Notes,
            installments,
            payments,
            appointmentRevenue,
            completedCount,
            account.CreatedAtUtc);
    }

    public static ServicePackageDto ToDto(this ServicePackage package)
    {
        var items = package.Items
            .Select(item => new ServicePackageItemDto(
                item.ServiceDefinitionId,
                item.ServiceDefinition?.Name,
                item.SessionCount,
                item.UnitPrice))
            .ToArray();
        var totalDuration = package.Items.Sum(i => (i.ServiceDefinition?.DurationMinutes ?? 0) * i.SessionCount);
        var totalSessions = package.Items.Sum(i => i.SessionCount);
        return new ServicePackageDto(
            package.Id,
            package.TenantId,
            package.BranchId,
            package.Name,
            package.Description,
            package.Category,
            package.TotalPrice,
            package.DepositAmount,
            package.InstallmentCount,
            package.IsActive,
            items,
            totalDuration,
            totalSessions,
            package.IconKey,
            package.Status,
            package.UpdatedAtUtc ?? package.CreatedAtUtc,
            package.LoyaltyPointCost);
    }
}
