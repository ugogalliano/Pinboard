using PostIt.Domain.Entities;

namespace PostIt.Application.Interfaces;

public interface IBoardMemberRepository
{
    Task<BoardMember?> GetByBoardAndUserAsync(Guid boardId, Guid userId, CancellationToken cancellationToken = default);
    Task<bool> IsMemberAsync(Guid boardId, Guid userId, CancellationToken cancellationToken = default);
}
