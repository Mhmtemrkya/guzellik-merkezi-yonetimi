using System.Text.Json;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Application.Features.Appointments;
using GuzellikMerkezi.Application.Features.CustomerAccounts;
using GuzellikMerkezi.Application.Features.Customers;
using GuzellikMerkezi.Application.Features.Expenses;
using GuzellikMerkezi.Application.Features.PendingOperations;
using GuzellikMerkezi.Application.Features.Stock;
using GuzellikMerkezi.Domain.Enums;

namespace GuzellikMerkezi.Infrastructure.Services;

public sealed class ApprovalDispatcher : IApprovalDispatcher
{
    private readonly ICustomerService _customers;
    private readonly IAppointmentService _appointments;
    private readonly IExpenseService _expenses;
    private readonly ICustomerAccountService _accounts;
    private readonly IStockService _stock;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public ApprovalDispatcher(
        ICustomerService customers,
        IAppointmentService appointments,
        IExpenseService expenses,
        ICustomerAccountService accounts,
        IStockService stock)
    {
        _customers = customers;
        _appointments = appointments;
        _expenses = expenses;
        _accounts = accounts;
        _stock = stock;
    }

    public async Task<Result<Guid?>> DispatchAsync(Guid tenantId, PendingOperationType type, string payloadJson, CancellationToken cancellationToken = default)
    {
        try
        {
            switch (type)
            {
                case PendingOperationType.CreateCustomer:
                {
                    var req = JsonSerializer.Deserialize<UpsertCustomerRequest>(payloadJson, JsonOpts);
                    if (req is null) return Result<Guid?>.Failure(Error.Validation("Geçersiz payload."));
                    var r = await _customers.CreateAsync(tenantId, req, cancellationToken);
                    return r.IsSuccess ? Result<Guid?>.Success(r.Value?.Id) : Result<Guid?>.Failure(r.Error);
                }

                case PendingOperationType.CreateAppointment:
                {
                    var req = JsonSerializer.Deserialize<CreateAppointmentRequest>(payloadJson, JsonOpts);
                    if (req is null) return Result<Guid?>.Failure(Error.Validation("Geçersiz payload."));
                    var r = await _appointments.CreateAsync(tenantId, req, cancellationToken);
                    return r.IsSuccess ? Result<Guid?>.Success(r.Value?.Id) : Result<Guid?>.Failure(r.Error);
                }

                case PendingOperationType.CreateExpense:
                {
                    var req = JsonSerializer.Deserialize<CreateExpenseRequest>(payloadJson, JsonOpts);
                    if (req is null) return Result<Guid?>.Failure(Error.Validation("Geçersiz payload."));
                    var r = await _expenses.CreateAsync(tenantId, req, cancellationToken);
                    return r.IsSuccess ? Result<Guid?>.Success(r.Value?.Id) : Result<Guid?>.Failure(r.Error);
                }

                case PendingOperationType.CreateAccount:
                {
                    var req = JsonSerializer.Deserialize<CreateCustomerAccountRequest>(payloadJson, JsonOpts);
                    if (req is null) return Result<Guid?>.Failure(Error.Validation("Geçersiz payload."));
                    var r = await _accounts.CreateAsync(tenantId, req, cancellationToken);
                    return r.IsSuccess ? Result<Guid?>.Success(r.Value?.Id) : Result<Guid?>.Failure(r.Error);
                }

                case PendingOperationType.RegisterAccountPayment:
                {
                    var wrapper = JsonSerializer.Deserialize<AccountPaymentPayload>(payloadJson, JsonOpts);
                    if (wrapper is null || wrapper.Body is null) return Result<Guid?>.Failure(Error.Validation("Geçersiz payload."));
                    var r = await _accounts.RegisterPaymentAsync(tenantId, wrapper.AccountId, wrapper.Body, cancellationToken);
                    return r.IsSuccess ? Result<Guid?>.Success(r.Value?.Id) : Result<Guid?>.Failure(r.Error);
                }

                case PendingOperationType.CreateProduct:
                {
                    var req = JsonSerializer.Deserialize<CreateProductRequest>(payloadJson, JsonOpts);
                    if (req is null) return Result<Guid?>.Failure(Error.Validation("Geçersiz payload."));
                    var r = await _stock.CreateAsync(tenantId, req, cancellationToken);
                    return r.IsSuccess ? Result<Guid?>.Success(r.Value?.Id) : Result<Guid?>.Failure(r.Error);
                }

                case PendingOperationType.CreateStockMovement:
                {
                    var wrapper = JsonSerializer.Deserialize<StockMovementPayload>(payloadJson, JsonOpts);
                    if (wrapper is null || wrapper.Body is null) return Result<Guid?>.Failure(Error.Validation("Geçersiz payload."));
                    var r = await _stock.AddMovementAsync(tenantId, wrapper.ProductId, wrapper.Body, cancellationToken);
                    return r.IsSuccess ? Result<Guid?>.Success(r.Value?.Id) : Result<Guid?>.Failure(r.Error);
                }

                default:
                    return Result<Guid?>.Failure(Error.Validation($"Bu işlem tipi için onay dispatcher tanımlı değil: {type}"));
            }
        }
        catch (JsonException ex)
        {
            return Result<Guid?>.Failure(Error.Validation($"Payload deserialize edilemedi: {ex.Message}"));
        }
    }

    // Wrapper'lar — parent ID + body
    private sealed record AccountPaymentPayload(Guid AccountId, RegisterAccountPaymentRequest? Body);
    private sealed record StockMovementPayload(Guid ProductId, CreateStockMovementRequest? Body);
}
