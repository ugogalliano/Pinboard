namespace PostIt.Application.DTOs;

/// <summary>
/// Data transfer object representing a board.
/// </summary>
/// <param name="Id">The board's unique identifier.</param>
/// <param name="Name">The name of the board.</param>
/// <param name="CreatedBy">The identifier of the user who created the board.</param>
/// <param name="CreatedAt">UTC date and time when the board was created.</param>
/// <param name="UpdatedAt">UTC date and time when the board was last updated.</param>
public record BoardDto(Guid Id, string Name, Guid CreatedBy, DateTime CreatedAt, DateTime UpdatedAt);
