namespace PostIt.Application.DTOs;

public record BoardMemberDto(Guid UserId, string Email, string DisplayName, string Role, DateTime CreatedAt);
