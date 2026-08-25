namespace PostIt.Application.DTOs;

/// <summary>
/// Request to authenticate a user.
/// </summary>
/// <param name="Email">The user's email address.</param>
/// <param name="Password">The user's password.</param>
public record LoginRequest(string Email, string Password);
