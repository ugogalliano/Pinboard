namespace PostIt.Application.DTOs;

/// <summary>
/// Request to update a board's name.
/// </summary>
/// <param name="Name">The new name for the board.</param>
public record UpdateBoardRequest(string Name);
