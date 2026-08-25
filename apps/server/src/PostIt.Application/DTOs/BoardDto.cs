namespace PostIt.Application.DTOs;

public record BoardDto(Guid Id, string Name, Guid CreatedBy, DateTime CreatedAt, DateTime UpdatedAt);
