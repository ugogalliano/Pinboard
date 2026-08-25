namespace PostIt.Application.DTOs;

/// <summary>
/// Request to update an existing note.
/// </summary>
/// <param name="Content">The updated text content.</param>
/// <param name="Color">The updated color.</param>
/// <param name="PositionX">The updated X coordinate.</param>
/// <param name="PositionY">The updated Y coordinate.</param>
public record UpdateNoteRequest(string Content, string Color, int PositionX, int PositionY);
