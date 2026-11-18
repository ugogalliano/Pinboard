using System.Collections.Concurrent;
using System.Reflection;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpLogging;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Logging.Console;
using Microsoft.Extensions.Options;
using PostIt.Api.Logging;
using PostIt.Api.Middleware;

namespace PostIt.IntegrationTests;

public class LoggingTests : IClassFixture<LoggingCaptureFactory>
{
    private readonly LoggingCaptureFactory _factory;

    public LoggingTests(LoggingCaptureFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public void Formatter_WritesUtcTimestampCategoryAndRenderedStructuredMessage()
    {
        var output = FormatLog(
            LogLevel.Information,
            "PostIt.Application.Services.NoteService",
            "Note created | noteId=note-marker boardId=board-marker");

        Assert.Matches(
            @"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \+00:00 Information: \[PostIt\.Application\.Services\.NoteService\] Note created \| noteId=note-marker boardId=board-marker",
            output);
        Assert.False(output.Contains("\x1b[", StringComparison.Ordinal), $"output={output}");
    }

    [Fact]
    public void Formatter_IncludesFlattenedExceptionTypeMessageAndStackTrace()
    {
        var exception = CaptureException();
        var output = FormatLog(
            LogLevel.Error,
            "PostIt.Api.Controllers.BoardsController",
            "Unhandled exception | method=GET path=/api/boards",
            exception);

        Assert.Contains("InvalidOperationException: exception-marker", output);
        Assert.Contains(nameof(ThrowForLogging), output);
        var line = output.TrimEnd('\r', '\n');
        Assert.DoesNotContain('\n', line);
        Assert.DoesNotContain('\r', line);
    }

    [Theory]
    [InlineData(true, null, null, false, null, null, null, null, null, null, false)]
    [InlineData(false, "1", "xterm-256color", false, null, null, null, null, null, null, false)]
    [InlineData(false, null, null, false, null, null, null, null, null, null, false)]
    [InlineData(false, null, "", false, null, null, null, null, null, null, false)]
    [InlineData(false, null, "dumb", false, null, null, null, null, null, null, false)]
    [InlineData(false, null, "xterm-256color", false, null, null, null, null, null, null, true)]
    [InlineData(false, null, "xterm", true, null, null, null, null, null, null, true)]
    [InlineData(false, null, null, true, "1", null, null, null, null, null, true)]
    [InlineData(false, null, null, true, null, "1", null, null, null, null, true)]
    [InlineData(false, null, null, true, null, null, "ON", null, null, null, true)]
    [InlineData(false, null, null, true, null, null, null, "1234", null, null, true)]
    [InlineData(false, null, "dumb", true, "1", null, null, null, null, null, false)]
    [InlineData(true, null, null, false, null, null, null, null, "1", null, true)]
    [InlineData(true, null, null, false, null, null, null, null, null, "true", true)]
    [InlineData(true, "1", null, false, null, null, null, null, "1", "true", false)]
    [InlineData(false, null, "dumb", false, null, null, null, null, "1", null, true)]
    [InlineData(false, null, "xterm", false, null, null, null, null, "0", null, false)]
    public void Formatter_ColorDetectionHonorsRedirectAndNoColor(
        bool outputRedirected,
        string? noColorValue,
        string? term,
        bool isWindows,
        string? wtSession,
        string? ansicon,
        string? conEmuAnsi,
        string? vscodePid,
        string? forceColor,
        string? allowAnsiColorRedirection,
        bool expected)
    {
        var method = typeof(ColoredConsoleFormatter).GetMethod(
            "ShouldUseColors",
            BindingFlags.Static | BindingFlags.NonPublic,
            binder: null,
            types: new[]
            {
                typeof(bool), typeof(string), typeof(string), typeof(bool), typeof(string),
                typeof(string), typeof(string), typeof(string), typeof(string), typeof(string)
            },
            modifiers: null);
        Assert.NotNull(method);

        var actual = (bool)method!.Invoke(null, new object?[]
        {
            outputRedirected, noColorValue, term, isWindows, wtSession, ansicon, conEmuAnsi, vscodePid,
            forceColor, allowAnsiColorRedirection
        })!;
        Assert.Equal(expected, actual);
    }

    [Fact]
    public void Formatter_EmitsAnsiOnlyForLevelWhenColorsAreExplicitlyEnabled()
    {
        var formatter = CreateFormatter(GetColorOverrideConstructor(), true);
        var information = FormatLog(formatter, LogLevel.Information, "Test.Category", "information-marker");
        var warning = FormatLog(formatter, LogLevel.Warning, "Test.Category", "warning-marker");
        var error = FormatLog(formatter, LogLevel.Error, "Test.Category", "error-marker");
        var critical = FormatLog(formatter, LogLevel.Critical, "Test.Category", "critical-marker");

        Assert.Contains("\x1b[36mInformation\x1b[0m", information);
        Assert.DoesNotContain("\x1b[36mTest.Category", information);
        Assert.Contains("\x1b[33mWarning\x1b[0m", warning);
        Assert.DoesNotContain("\x1b[33mTest.Category", warning);
        Assert.Contains("\x1b[31mError\x1b[0m", error);
        Assert.Contains("\x1b[31mCritical\x1b[0m", critical);
    }

    [Fact]
    public async Task HttpLogging_DevelopmentLogsCompleteRequestAndResponseDetails()
    {
        var configuredFields = _factory.Services.GetRequiredService<IOptions<HttpLoggingOptions>>().Value.LoggingFields;
        var options = _factory.Services.GetRequiredService<IOptions<HttpLoggingOptions>>().Value;
        Assert.Equal(HttpLoggingFields.All, configuredFields);
        Assert.Equal(64 * 1024, options.RequestBodyLogLimit);
        Assert.Equal(64 * 1024, options.ResponseBodyLogLimit);
        Assert.True(options.CombineLogs);

        _factory.Logs.Clear();
        using var client = _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost:8443")
        });
        using var request = new HttpRequestMessage(HttpMethod.Post, "/logging-test/echo?trace_marker=query-secret-marker");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", "authorization-secret-marker");
        request.Headers.Add("X-Arbitrary-Marker", "header-secret-marker");
        request.Content = new StringContent("{\"marker\":\"request-body-secret-marker\"}", System.Text.Encoding.UTF8, "application/json");

        var response = await client.SendAsync(request);
        Assert.Equal(System.Net.HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("response-header-marker", response.Headers.GetValues("X-Response-Marker").Single());
        Assert.Equal("response-body-marker", await response.Content.ReadAsStringAsync());

        using var hubRequest = new HttpRequestMessage(HttpMethod.Get, "/hubs/board?access_token=signalr-access-token-marker");

        var hubResponse = await client.SendAsync(hubRequest);
        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, hubResponse.StatusCode);

        var logs = _factory.Logs.Snapshot();
        var output = string.Join(Environment.NewLine, logs);
        Assert.Contains("Protocol: HTTP/1.1", output);
        Assert.Contains("Method: POST", output);
        Assert.Contains("Path: /logging-test/echo", output);
        Assert.Contains("RequestUrl: https://localhost:8443/logging-test/echo?trace_marker=query-secret-marker", output);

        // With CombineLogs, each request produces a single consolidated HttpLoggingMiddleware
        // entry that carries every request/response marker. The interceptor adds RequestUrl
        // once (request phase only) and the framework's raw header sections are disabled via
        // TryDisable, so within the combined entry there are no [Redacted] duplicates and no
        // duplicated header/RequestUrl lines; raw header values come solely from the interceptor.
        var combinedEntries = logs
            .Where(log => log.Contains("HttpLoggingMiddleware", StringComparison.Ordinal))
            .ToList();
        Assert.Equal(2, combinedEntries.Count); // one per request: echo (200) + hub (401)
        var echoEntries = combinedEntries
            .Where(log => log.Contains("Path: /logging-test/echo", StringComparison.Ordinal))
            .ToList();
        Assert.Single(echoEntries);
        var echoEntry = echoEntries[0];
        Assert.Equal(1, echoEntry.Split("RequestUrl: https://localhost:8443/logging-test/echo?trace_marker=query-secret-marker",
            StringSplitOptions.None).Length - 1);
        Assert.DoesNotContain("[Redacted]", echoEntry);
        Assert.Contains("Method: POST", echoEntry);
        Assert.Contains("RequestUrl: https://localhost:8443/logging-test/echo?trace_marker=query-secret-marker", echoEntry);
        Assert.Contains("RequestQueryString: ?trace_marker=query-secret-marker", echoEntry);
        Assert.Contains("StatusCode: 200", echoEntry);
        Assert.Contains("Duration:", echoEntry);
        Assert.Contains("Authorization: Bearer authorization-secret-marker", echoEntry);
        Assert.Contains("X-Arbitrary-Marker: header-secret-marker", echoEntry);
        Assert.Contains("{\"marker\":\"request-body-secret-marker\"}", echoEntry);
        Assert.Contains("X-Response-Marker: response-header-marker", echoEntry);
        Assert.Contains("ResponseBody: response-body-marker", echoEntry);

        Assert.Contains("signalr-access-token-marker", output);
        Assert.Contains("StatusCode: 401", output);
    }

    [Fact]
    public async Task HttpLogging_DevelopmentLogsTextBodiesButSkipsUnsupportedMediaTypes()
    {
        using var client = _factory.CreateClient();
        using var formRequest = new HttpRequestMessage(HttpMethod.Post, "/logging-test/echo")
        {
            Content = new StringContent("field=form-body-marker", System.Text.Encoding.UTF8, "application/x-www-form-urlencoded")
        };

        _factory.Logs.Clear();
        await client.SendAsync(formRequest);
        var formOutput = string.Join(Environment.NewLine, _factory.Logs.Snapshot());
        Assert.Contains("form-body-marker", formOutput);

        using var binaryRequest = new HttpRequestMessage(HttpMethod.Post, "/logging-test/echo")
        {
            Content = new ByteArrayContent(System.Text.Encoding.UTF8.GetBytes("binary-body-secret-marker"))
        };
        binaryRequest.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");

        _factory.Logs.Clear();
        await client.SendAsync(binaryRequest);
        var binaryOutput = string.Join(Environment.NewLine, _factory.Logs.Snapshot());
        Assert.DoesNotContain("binary-body-secret-marker", binaryOutput);
    }

    [Fact]
    public async Task HttpLogging_DevelopmentTruncatesRequestAndResponseBodiesAtConfiguredLimit()
    {
        using var client = _factory.CreateClient();
        var requestContent = new string('r', 64 * 1024) + "request-tail-marker";
        using var request = new HttpRequestMessage(HttpMethod.Post, "/logging-test/echo?large-response=true")
        {
            Content = new StringContent(requestContent, System.Text.Encoding.UTF8, "text/plain")
        };

        _factory.Logs.Clear();
        using var response = await client.SendAsync(request);
        var output = string.Join(Environment.NewLine, _factory.Logs.Snapshot());

        Assert.Equal(System.Net.HttpStatusCode.OK, response.StatusCode);
        Assert.DoesNotContain("request-tail-marker", output);
        Assert.DoesNotContain("response-tail-marker", output);
        Assert.Contains("RequestBody:", output);
        Assert.Contains("ResponseBody:", output);
        Assert.Contains("RequestBody: " + new string('r', 1024), output);
        Assert.Contains("ResponseBody: " + new string('s', 1024), output);
        Assert.True(output.Length < 140 * 1024, $"Logged output exceeded the configured body limits: {output.Length} characters.");
    }

    [Fact]
    public async Task HttpLogging_ProductionDoesNotLogHttpRequestDetails()
    {
        var productionFactory = new LoggingCaptureFactory { EnvironmentName = "Production" };
        await productionFactory.InitializeAsync();
        try
        {
            using var client = productionFactory.CreateClient();
            using var request = new HttpRequestMessage(HttpMethod.Post, "/logging-test/echo?access_token=production-query-secret-marker")
            {
                Content = new StringContent("production-body-secret-marker", System.Text.Encoding.UTF8, "application/json")
            };
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", "production-header-secret-marker");

            productionFactory.Logs.Clear();
            using var response = await client.SendAsync(request);
            Assert.Equal(System.Net.HttpStatusCode.OK, response.StatusCode);

            using var hubRequest = new HttpRequestMessage(
                HttpMethod.Get,
                "/hubs/board?access_token=production-signalr-token-marker");
            using var hubResponse = await client.SendAsync(hubRequest);
            Assert.Equal(System.Net.HttpStatusCode.Unauthorized, hubResponse.StatusCode);

            var output = string.Join(Environment.NewLine, productionFactory.Logs.Snapshot());
            Assert.DoesNotContain("production-query-secret-marker", output);
            Assert.DoesNotContain("production-body-secret-marker", output);
            Assert.DoesNotContain("production-header-secret-marker", output);
            Assert.DoesNotContain("production-signalr-token-marker", output);
            Assert.DoesNotContain("RequestUrl:", output);
            Assert.DoesNotContain("response-header-marker", output);
            Assert.DoesNotContain("response-body-marker", output);
            Assert.DoesNotContain("Protocol: HTTP/", output);
            Assert.DoesNotContain("Method: POST", output);
            Assert.DoesNotContain("Path: /logging-test/echo", output);
            Assert.DoesNotContain("StatusCode:", output);
            Assert.DoesNotContain("Duration:", output);
            Assert.DoesNotContain("HttpLoggingMiddleware", output);
        }
        finally
        {
            await productionFactory.DisposeAsync();
        }
    }

    [Fact]
    public void HttpLogging_StatusCodeLoggerIsEnabledAtInformation()
    {
        var loggerFactory = _factory.Services.GetRequiredService<ILoggerFactory>();
        var logger = loggerFactory
            .CreateLogger("Microsoft.AspNetCore.HttpLogging.HttpLoggingMiddleware");
        var hostingDiagnosticsLogger = loggerFactory
            .CreateLogger("Microsoft.AspNetCore.Hosting.Diagnostics");

        Assert.True(logger.IsEnabled(LogLevel.Information));
        Assert.False(hostingDiagnosticsLogger.IsEnabled(LogLevel.Information));
    }

    [Fact]
    public void Formatter_ApplicationRegistersColoredConsoleFormatter()
    {
        var formatter = _factory.Services.GetRequiredService<ConsoleFormatter>();
        var consoleOptions = _factory.Services.GetRequiredService<IOptionsMonitor<ConsoleLoggerOptions>>().CurrentValue;

        Assert.IsType<ColoredConsoleFormatter>(formatter);
        Assert.Equal("colored", consoleOptions.FormatterName);
    }

    [Fact]
    public void Formatter_ApplicationUsesSingleLineUtcTimestampOptions()
    {
        var options = _factory.Services.GetRequiredService<IOptionsMonitor<SimpleConsoleFormatterOptions>>().CurrentValue;

        Assert.True(options.SingleLine);
        Assert.Equal("yyyy-MM-dd HH:mm:ss.fff zzz", options.TimestampFormat);
        Assert.True(options.UseUtcTimestamp);
    }

    [Fact]
    public async Task ExceptionMiddleware_LogsMethodAndPathWithoutQueryString()
    {
        _factory.Logs.Clear();
        var middleware = new ExceptionHandlingMiddleware(
            _ => throw new InvalidOperationException("middleware-exception-marker"),
            _factory.Services.GetRequiredService<ILogger<ExceptionHandlingMiddleware>>());
        var context = new DefaultHttpContext();
        context.Request.Method = "GET";
        context.Request.Path = "/diagnostic-path";
        context.Request.QueryString = new QueryString("?access_token=query-secret-marker");
        context.Response.Body = new MemoryStream();
        context.RequestServices = _factory.Services;

        await middleware.InvokeAsync(context);

        Assert.Equal(StatusCodes.Status500InternalServerError, context.Response.StatusCode);
        var output = string.Join(Environment.NewLine, _factory.Logs.Snapshot());
        Assert.Contains("Unhandled exception | method=GET path=/diagnostic-path", output);
        Assert.Contains("middleware-exception-marker", output);
        Assert.DoesNotContain("query-secret-marker", output);
    }

    private static string FormatLog(LogLevel level, string category, string message, Exception? exception = null)
    {
        return FormatLog(CreateFormatter(GetColorOverrideConstructor(), false), level, category, message, exception);
    }

    private static ColoredConsoleFormatter CreateFormatter(ConstructorInfo constructor, bool? enableColors)
    {
        return (ColoredConsoleFormatter)constructor.Invoke(new object?[] { CreateOptionsMonitor(), enableColors });
    }

    private static ConstructorInfo GetColorOverrideConstructor()
    {
        var constructor = typeof(ColoredConsoleFormatter).GetConstructor(
            BindingFlags.Instance | BindingFlags.NonPublic,
            binder: null,
            types: new[] { typeof(IOptionsMonitor<SimpleConsoleFormatterOptions>), typeof(bool?) },
            modifiers: null);
        Assert.NotNull(constructor);
        return constructor!;
    }

    private static string FormatLog(
        ColoredConsoleFormatter formatter,
        LogLevel level,
        string category,
        string message,
        Exception? exception = null)
    {
        using var writer = new StringWriter();
        var entry = new LogEntry<string>(level, category, new EventId(1), message, exception, (state, _) => state);
        formatter.Write(entry, null, writer);
        return writer.ToString();
    }

    private static IOptionsMonitor<SimpleConsoleFormatterOptions> CreateOptionsMonitor()
    {
        return new FixedOptionsMonitor<SimpleConsoleFormatterOptions>(new SimpleConsoleFormatterOptions
        {
            SingleLine = true,
            TimestampFormat = "yyyy-MM-dd HH:mm:ss.fff zzz",
            UseUtcTimestamp = true
        });
    }

    private static Exception CaptureException()
    {
        try
        {
            ThrowForLogging();
        }
        catch (Exception exception)
        {
            return exception;
        }

        throw new InvalidOperationException("Exception was not thrown.");
    }

    private static void ThrowForLogging()
    {
        throw new InvalidOperationException("exception-marker");
    }
}

public sealed class LoggingCaptureFactory : TestWebApplicationFactory
{
    public CapturingLoggerProvider Logs { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureServices(services =>
        {
            services.AddSingleton<ILoggerProvider>(Logs);
            services.AddTransient<IStartupFilter, LoggingTestStartupFilter>();
        });
    }
}

public sealed class LoggingTestStartupFilter : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
    {
        return app =>
        {
            next(app);

            app.MapWhen(context => context.Request.Path == "/logging-test/echo", branch =>
            {
                branch.Run(async context =>
                {
                    await context.Request.Body.CopyToAsync(Stream.Null, context.RequestAborted);
                    context.Response.Headers["X-Response-Marker"] = "response-header-marker";
                    context.Response.ContentType = "text/plain";
                    context.Response.StatusCode = StatusCodes.Status200OK;
                    var responseBody = context.Request.Query.ContainsKey("large-response")
                        ? new string('s', 64 * 1024) + "response-tail-marker"
                        : "response-body-marker";
                    await context.Response.WriteAsync(responseBody);
                });
            });
        };
    }
}

public sealed class CapturingLoggerProvider : ILoggerProvider
{
    private readonly ConcurrentQueue<string> _messages = new();

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(categoryName, _messages);

    public string[] Snapshot() => _messages.ToArray();

    public void Clear()
    {
        while (_messages.TryDequeue(out _))
        {
        }
    }

    public void Dispose()
    {
    }

    private sealed class CapturingLogger(string categoryName, ConcurrentQueue<string> messages) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel))
            {
                return;
            }

            var message = $"{categoryName} {logLevel}: {formatter(state, exception)}";
            if (exception != null)
            {
                message += $" {exception}";
            }

            messages.Enqueue(message);
        }
    }
}

internal sealed class FixedOptionsMonitor<TOptions>(TOptions value) : IOptionsMonitor<TOptions>
    where TOptions : class
{
    public TOptions CurrentValue => value;

    public TOptions Get(string? name) => value;

    public IDisposable? OnChange(Action<TOptions, string?> listener) => null;
}
