namespace PostIt.Application.DTOs;

/// <summary>
/// Request to create a new board.
/// </summary>
/// <param name="Name">The name of the board.</param>
public record CreateBoardRequest(string Name);
