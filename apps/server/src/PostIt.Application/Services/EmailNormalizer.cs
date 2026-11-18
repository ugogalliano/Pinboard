using System.Net.Mail;

namespace PostIt.Application.Services;

/// <summary>
/// Canonicalises email addresses for storage and lookups. Extracts the address
/// part via <see cref="MailAddress"/> (display-name syntax such as
/// "John Doe &lt;a@b.com&gt;" parses but must never be stored raw, or it would
/// escape duplicate detection) and lowercases/trims it.
/// Returns null when the value is not a parseable email address.
/// </summary>
internal static class EmailNormalizer
{
    public static string? TryNormalize(string? email)
    {
        if (string.IsNullOrWhiteSpace(email) || !MailAddress.TryCreate(email.Trim(), out var addr))
        {
            return null;
        }

        return addr.Address.Trim().ToLowerInvariant();
    }
}
