namespace PostIt.Application.DTOs;

public record CreateNoteRequest(string Content, string Color, int PositionX, int PositionY);
