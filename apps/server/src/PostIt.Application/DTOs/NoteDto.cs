namespace PostIt.Application.DTOs;

/// <summary>
/// Data transfer object representing a note.
/// </summary>
/// <param name="Id">The note's unique identifier.</param>
/// <param name="BoardId">The identifier of the board containing the note.</param>
/// <param name="CreatedBy">The identifier of the user who created the note.</param>
/// <param name="Content">The text content of the note.</param>
/// <param name="Color">The color of the note.</param>
/// <param name="PositionX">The X coordinate position on the board.</param>
/// <param name="PositionY">The Y coordinate position on the board.</param>
/// <param name="CreatedAt">UTC date and time when the note was created.</param>
/// <param name="UpdatedAt">UTC date and time when the note was last updated.</param>
public record NoteDto(Guid Id, Guid BoardId, Guid? CreatedBy, string Content, string Color, int PositionX, int PositionY, DateTime CreatedAt, DateTime UpdatedAt);
