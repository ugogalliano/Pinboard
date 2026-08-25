namespace PostIt.Application.DTOs;

/// <summary>
/// Request to create a new note on a board.
/// </summary>
/// <param name="Content">The text content of the note.</param>
/// <param name="Color">The color of the note.</param>
/// <param name="PositionX">The X coordinate position on the board.</param>
/// <param name="PositionY">The Y coordinate position on the board.</param>
public record CreateNoteRequest(string Content, string Color, int PositionX, int PositionY);
