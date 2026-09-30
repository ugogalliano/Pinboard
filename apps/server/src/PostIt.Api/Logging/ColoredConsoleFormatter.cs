using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Logging.Console;
using Microsoft.Extensions.Options;

namespace PostIt.Api.Logging;

public class ColoredConsoleFormatter : ConsoleFormatter
{
    private readonly IOptionsMonitor<SimpleConsoleFormatterOptions> _options;

    public ColoredConsoleFormatter(IOptionsMonitor<SimpleConsoleFormatterOptions> options)
        : base("colored")
    {
        _options = options;
    }

    public override void Write<TState>(in LogEntry<TState> logEntry, IExternalScopeProvider? scopeProvider, TextWriter textWriter)
    {
        var options = _options.CurrentValue;
        var message = logEntry.Formatter?.Invoke(logEntry.State, logEntry.Exception);
        if (message is null)
        {
            return;
        }

        if (options.SingleLine)
        {
            message = message.Replace(Environment.NewLine, " ").Replace('\n', ' ').Replace('\r', ' ');
        }

        var color = GetColorCode(logEntry.LogLevel);
        if (!string.IsNullOrEmpty(color))
        {
            textWriter.Write(color);
        }

        if (!string.IsNullOrEmpty(options.TimestampFormat))
        {
            var timestamp = options.UseUtcTimestamp ? DateTime.UtcNow : DateTime.Now;
            textWriter.Write(timestamp.ToString(options.TimestampFormat));
            textWriter.Write(' ');
        }

        textWriter.Write(logEntry.LogLevel.ToString());
        textWriter.Write(": ");
        textWriter.Write(message);
        textWriter.WriteLine("\x1b[0m");
    }

    private static string GetColorCode(LogLevel logLevel) => logLevel switch
    {
        LogLevel.Information => "\x1b[37m",
        LogLevel.Warning => "\x1b[33m",
        LogLevel.Error or LogLevel.Critical => "\x1b[31m",
        _ => string.Empty
    };
}
