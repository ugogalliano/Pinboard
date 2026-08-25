namespace PostIt.Application.DTOs;

/// <summary>
/// Response containing authentication tokens after login or refresh.
/// </summary>
/// <param name="AccessToken">JWT access token for API requests.</param>
/// <param name="RefreshToken">Token used to obtain a new access token.</param>
/// <param name="ExpiresAt">UTC date and time when the access token expires.</param>
public record LoginResponse(string AccessToken, string RefreshToken, DateTime ExpiresAt);
