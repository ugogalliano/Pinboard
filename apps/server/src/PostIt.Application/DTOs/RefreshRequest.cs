namespace PostIt.Application.DTOs;

/// <summary>
/// Request to refresh an access token using a refresh token.
/// </summary>
/// <param name="RefreshToken">The refresh token.</param>
public record RefreshRequest(string RefreshToken);
