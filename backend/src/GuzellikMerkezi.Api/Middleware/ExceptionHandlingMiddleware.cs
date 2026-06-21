using FluentValidation;
using GuzellikMerkezi.Application.Common;
using GuzellikMerkezi.Domain.Exceptions;
using Microsoft.AspNetCore.Mvc;

namespace GuzellikMerkezi.Api.Middleware;

public sealed class ExceptionHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;

    public ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (ValidationException ex)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsJsonAsync(ApiResponse<ProblemDetails>.Fail("Validation", string.Join(" ", ex.Errors.Select(x => x.ErrorMessage)), context.TraceIdentifier));
        }
        catch (DomainException ex)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsJsonAsync(ApiResponse<ProblemDetails>.Fail("Domain", ex.Message, context.TraceIdentifier));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled API exception. TraceId: {TraceId}", context.TraceIdentifier);
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            await context.Response.WriteAsJsonAsync(ApiResponse<ProblemDetails>.Fail("ServerError", "Beklenmeyen bir hata oluştu.", context.TraceIdentifier));
        }
    }
}
