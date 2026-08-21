namespace PostIt.Application.DTOs;

public record RegisterRequest(string Email, string Password, string DisplayName);
