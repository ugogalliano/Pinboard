using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Logging.Console;
using Microsoft.Extensions.Options;

namespace PostIt.Api.Logging;

public class ColoredConsoleFormatter : ConsoleFormatter
{
    private readonly IOptionsMonitor<SimpleConsoleFormatterOptions> _options;
    private readonly bool? _enableColors;

    public ColoredConsoleFormatter(IOptionsMonitor<SimpleConsoleFormatterOptions> options)
        : this(options, null)
    {
    }

    internal ColoredConsoleFormatter(IOptionsMonitor<SimpleConsoleFormatterOptions> options, bool? enableColors)
        : base("colored")
    {
        _options = options;
        _enableColors = enableColors;
    }

    public override void Write<TState>(in LogEntry<TState> logEntry, IExternalScopeProvider? scopeProvider, TextWriter textWriter)
    {
        var options = _options.CurrentValue;
        var message = logEntry.Formatter?.Invoke(logEntry.State, logEntry.Exception);
        if (message is null)
        {
            return;
        }

        if (logEntry.Exception != null)
        {
            message = $"{message} | {logEntry.Exception}";
        }

        if (options.SingleLine)
        {
            message = message.Replace("\r\n", " ").Replace('\n', ' ').Replace('\r', ' ');
        }

        var color = (_enableColors ?? ShouldUseColors()) ? GetColorCode(logEntry.LogLevel) : string.Empty;
        if (!string.IsNullOrEmpty(options.TimestampFormat))
        {
            var timestamp = options.UseUtcTimestamp ? DateTime.UtcNow : DateTime.Now;
            textWriter.Write(timestamp.ToString(options.TimestampFormat));
            textWriter.Write(' ');
        }

        if (!string.IsNullOrEmpty(color))
        {
            textWriter.Write(color);
        }

        textWriter.Write(logEntry.LogLevel);
        if (!string.IsNullOrEmpty(color))
        {
            textWriter.Write("\x1b[0m");
        }

        textWriter.Write(": ");
        textWriter.Write('[');
        textWriter.Write(logEntry.Category);
        textWriter.Write("] ");
        textWriter.Write(message);
        textWriter.WriteLine();
    }

    private static bool ShouldUseColors() =>
        ShouldUseColors(
            Console.IsOutputRedirected,
            Environment.GetEnvironmentVariable("NO_COLOR"),
            Environment.GetEnvironmentVariable("TERM"),
            OperatingSystem.IsWindows(),
            Environment.GetEnvironmentVariable("WT_SESSION"),
            Environment.GetEnvironmentVariable("ANSICON"),
            Environment.GetEnvironmentVariable("ConEmuANSI"),
            Environment.GetEnvironmentVariable("VSCODE_PID"),
            Environment.GetEnvironmentVariable("FORCE_COLOR"),
            Environment.GetEnvironmentVariable("DOTNET_SYSTEM_CONSOLE_ALLOW_ANSI_COLOR_REDIRECTION"));

    internal static bool ShouldUseColors(
        bool outputRedirected,
        string? noColorValue,
        string? term,
        bool isWindows,
        string? wtSession,
        string? ansicon,
        string? conEmuAnsi,
        string? vscodePid,
        string? forceColor,
        string? allowAnsiColorRedirection)
    {
        if (!string.IsNullOrEmpty(noColorValue))
        {
            return false;
        }

        if (!string.IsNullOrWhiteSpace(forceColor))
        {
            return !string.Equals(forceColor.Trim(), "0", StringComparison.OrdinalIgnoreCase);
        }

        if (string.Equals(allowAnsiColorRedirection?.Trim(), "true", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (outputRedirected)
        {
            return false;
        }

        if (!string.IsNullOrWhiteSpace(term))
        {
            return !string.Equals(term.Trim(), "dumb", StringComparison.OrdinalIgnoreCase);
        }

        return isWindows &&
               (!string.IsNullOrEmpty(wtSession) ||
                !string.IsNullOrEmpty(ansicon) ||
                string.Equals(conEmuAnsi?.Trim(), "ON", StringComparison.OrdinalIgnoreCase) ||
                !string.IsNullOrEmpty(vscodePid));
    }

    private static string GetColorCode(LogLevel logLevel) => logLevel switch
    {
        LogLevel.Information => "\x1b[36m",
        LogLevel.Warning => "\x1b[33m",
        LogLevel.Error or LogLevel.Critical => "\x1b[31m",
        _ => string.Empty
    };
}
