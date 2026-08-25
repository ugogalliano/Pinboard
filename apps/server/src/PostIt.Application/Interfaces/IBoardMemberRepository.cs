using PostIt.Domain.Entities;

namespace PostIt.Application.Interfaces;

public interface IBoardMemberRepository
{
    Task<BoardMember?> GetByBoardAndUserAsync(Guid boardId, Guid userId, CancellationToken cancellationToken = default);
    Task<bool> IsMemberAsync(Guid boardId, Guid userId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<BoardMember>> GetMembersByBoardAsync(Guid boardId, CancellationToken cancellationToken = default);
    Task AddAsync(BoardMember member, CancellationToken cancellationToken = default);
    Task DeleteAsync(BoardMember member, CancellationToken cancellationToken = default);
    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
