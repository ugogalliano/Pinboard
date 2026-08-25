namespace PostIt.Application.DTOs;

/// <summary>
/// Request to add a member to a board.
/// </summary>
/// <param name="Email">The email address of the user to add.</param>
/// <param name="Role">The role to assign (Editor or Viewer).</param>
public record AddMemberRequest(string Email, string Role);
