namespace PostIt.Application.DTOs;

public record NoteDto(
    Guid Id,
    Guid BoardId,
    Guid? CreatedBy,
    string Content,
    string Color,
    int PositionX,
    int PositionY,
    DateTime CreatedAt,
    DateTime UpdatedAt);
