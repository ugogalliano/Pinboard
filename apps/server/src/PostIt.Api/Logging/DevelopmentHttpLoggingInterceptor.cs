using Microsoft.AspNetCore.HttpLogging;

namespace PostIt.Api.Logging;

/// <summary>
/// Includes otherwise allowlisted HTTP details in Development-only request logs.
/// </summary>
internal sealed class DevelopmentHttpLoggingInterceptor : IHttpLoggingInterceptor
{
    public ValueTask OnRequestAsync(HttpLoggingInterceptorContext logContext)
    {
        // The framework's header sections render sensitive values as [Redacted]; the raw
        // copies added below replace them, so the framework sections are disabled here.
        logContext.TryDisable(HttpLoggingFields.RequestHeaders);

        var request = logContext.HttpContext.Request;
        logContext.AddParameter("RequestUrl", GetRequestUrl(request));
        logContext.AddParameter("RequestQueryString", request.QueryString.Value ?? string.Empty);

        foreach (var header in request.Headers)
        {
            logContext.AddParameter(header.Key, header.Value.ToString());
        }

        return ValueTask.CompletedTask;
    }

    public ValueTask OnResponseAsync(HttpLoggingInterceptorContext logContext)
    {
        // RequestUrl is already added in the request phase, which flows into the combined
        // log entry; response headers are only available here.
        logContext.TryDisable(HttpLoggingFields.ResponseHeaders);

        foreach (var header in logContext.HttpContext.Response.Headers)
        {
            logContext.AddParameter(header.Key, header.Value.ToString());
        }

        return ValueTask.CompletedTask;
    }

    private static string GetRequestUrl(HttpRequest request) =>
        $"{request.Scheme}://{request.Host}{request.PathBase}{request.Path}{request.QueryString}";
}
