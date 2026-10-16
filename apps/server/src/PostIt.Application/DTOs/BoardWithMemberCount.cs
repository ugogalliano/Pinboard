using PostIt.Domain.Entities;

namespace PostIt.Application.DTOs;

/// <summary>
/// A board and its aggregate member count.
/// </summary>
/// <param name="Board">The board entity.</param>
/// <param name="MemberCount">The total number of members, including the owner.</param>
public sealed record BoardWithMemberCount(Board Board, int MemberCount);
