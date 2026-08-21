namespace PostIt.Application.DTOs;

public record LoginResponse(string AccessToken, string RefreshToken, DateTime ExpiresAt);
