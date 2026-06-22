using FluentValidation;
using GuzellikMerkezi.Application.Common;
using Microsoft.Extensions.DependencyInjection;

namespace GuzellikMerkezi.Api.Validation;

/// <summary>
/// Minimal API endpoint filter'ı — <typeparamref name="TRequest"/> için DI'da kayıtlı FluentValidation
/// validator'ını çalıştırır. Geçersiz veya çok uzun payload doğrudan 400 (uygulama zarfı) döner;
/// servise/DB'ye gidip 500 ÜRETMEZ. Validator yoksa veya request argümanı bulunamazsa zincir aynen devam eder.
/// </summary>
public sealed class ValidationFilter<TRequest> : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var validator = context.HttpContext.RequestServices.GetService<IValidator<TRequest>>();
        if (validator is null)
        {
            return await next(context);
        }

        var request = context.Arguments.OfType<TRequest>().FirstOrDefault();
        if (request is null)
        {
            return await next(context);
        }

        var result = await validator.ValidateAsync(request, context.HttpContext.RequestAborted);
        if (result.IsValid)
        {
            return await next(context);
        }

        // Uygulama zarfıyla aynı formatta 400 — frontend `error.message`'i okuyabilsin diye mesajlar birleştirilir.
        var message = string.Join(" ", result.Errors.Select(e => e.ErrorMessage).Distinct());
        var response = ApiResponse<object>.Fail("Validation", message, context.HttpContext.TraceIdentifier);
        return Results.BadRequest(response);
    }
}

/// <summary>Endpoint'lere validator filtresi eklemek için kısayol.</summary>
public static class ValidationFilterExtensions
{
    public static RouteHandlerBuilder ValidatesRequest<TRequest>(this RouteHandlerBuilder builder)
        => builder.AddEndpointFilter<ValidationFilter<TRequest>>();
}
