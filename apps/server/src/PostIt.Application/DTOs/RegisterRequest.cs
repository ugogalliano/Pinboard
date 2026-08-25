namespace PostIt.Application.DTOs;

/// <summary>
/// Request to register a new user account.
/// </summary>
/// <param name="Email">The user's email address.</param>
/// <param name="Password">The user's password.</param>
/// <param name="DisplayName">The display name for the user.</param>
public record RegisterRequest(string Email, string Password, string DisplayName);
