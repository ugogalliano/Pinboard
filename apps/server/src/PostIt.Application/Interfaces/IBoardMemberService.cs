using PostIt.Application.DTOs;

namespace PostIt.Application.Interfaces;

public interface IBoardMemberService
{
    Task<IReadOnlyList<BoardMemberDto>> GetMembersAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default);
    Task<BoardMemberDto> AddMemberAsync(Guid userId, Guid boardId, AddMemberRequest request, CancellationToken cancellationToken = default);
    Task<BoardMemberDto> UpdateMemberAsync(Guid userId, Guid boardId, Guid memberUserId, UpdateMemberRequest request, CancellationToken cancellationToken = default);
    Task DeleteMemberAsync(Guid userId, Guid boardId, Guid memberUserId, CancellationToken cancellationToken = default);
}
