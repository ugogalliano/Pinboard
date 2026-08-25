namespace PostIt.Application.DTOs;

public record UpdateNoteRequest(string Content, string Color, int PositionX, int PositionY);
