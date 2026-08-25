namespace PostIt.Application.DTOs;

/// <summary>
/// Response containing the current authenticated user's profile.
/// </summary>
/// <param name="Id">The user's unique identifier.</param>
/// <param name="Email">The user's email address.</param>
/// <param name="DisplayName">The user's display name.</param>
public record MeResponse(Guid Id, string Email, string DisplayName);
