using GuzellikMerkezi.Application.Common;

namespace GuzellikMerkezi.Api.Extensions;

public static class ResultExtensions
{
    public static IResult ToHttpResult<T>(this Result<T> result, HttpContext httpContext)
    {
        if (result.IsSuccess) return Results.Ok(ApiResponse<T>.Ok(result.Value!, httpContext.TraceIdentifier));
        return ToProblem(result.Error, httpContext);
    }

    public static IResult ToHttpResult(this Result result, HttpContext httpContext)
    {
        if (result.IsSuccess) return Results.Ok(ApiResponse<object>.Ok(new { }, httpContext.TraceIdentifier));
        return ToProblem(result.Error, httpContext);
    }

    private static IResult ToProblem(Error error, HttpContext httpContext)
    {
        var response = ApiResponse<object>.Fail(error.Code, error.Message, httpContext.TraceIdentifier);
        return error.Code switch
        {
            "NotFound" => Results.NotFound(response),
            "Unauthorized" => Results.Json(response, statusCode: StatusCodes.Status401Unauthorized),
            "Conflict" => Results.Conflict(response),
            "SlotFull" => Results.Conflict(response),
            "Validation" => Results.BadRequest(response),
            _ => Results.BadRequest(response)
        };
    }
}
