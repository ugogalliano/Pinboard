namespace PostIt.Application.DTOs;

/// <summary>
/// Data transfer object representing a board member.
/// </summary>
/// <param name="UserId">The member's user identifier.</param>
/// <param name="Email">The member's email address.</param>
/// <param name="DisplayName">The member's display name.</param>
/// <param name="Role">The member's role on the board (Owner, Editor, Viewer).</param>
/// <param name="CreatedAt">UTC date and time when the member was added.</param>
public record BoardMemberDto(Guid UserId, string Email, string DisplayName, string Role, DateTime CreatedAt);
