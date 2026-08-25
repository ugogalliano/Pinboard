namespace PostIt.Application.DTOs;

/// <summary>
/// Request to update a board member's role.
/// </summary>
/// <param name="Role">The new role to assign (Editor or Viewer).</param>
public record UpdateMemberRequest(string Role);
