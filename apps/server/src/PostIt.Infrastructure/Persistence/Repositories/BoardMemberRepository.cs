using Microsoft.EntityFrameworkCore;
using PostIt.Application.Interfaces;
using PostIt.Domain.Entities;
using PostIt.Infrastructure.Persistence;

namespace PostIt.Infrastructure.Persistence.Repositories;

public class BoardMemberRepository : IBoardMemberRepository
{
    private readonly PostItDbContext _context;

    public BoardMemberRepository(PostItDbContext context)
    {
        _context = context;
    }

    public async Task<BoardMember?> GetByBoardAndUserAsync(Guid boardId, Guid userId, CancellationToken cancellationToken = default)
    {
        return await _context.BoardMembers
            .AsNoTracking()
            .FirstOrDefaultAsync(m => m.BoardId == boardId && m.UserId == userId, cancellationToken);
    }

    public async Task<bool> IsMemberAsync(Guid boardId, Guid userId, CancellationToken cancellationToken = default)
    {
        return await _context.BoardMembers
            .AnyAsync(m => m.BoardId == boardId && m.UserId == userId, cancellationToken);
    }
}
