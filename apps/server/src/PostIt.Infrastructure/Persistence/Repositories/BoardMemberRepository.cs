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
            .Include(m => m.User)
            .FirstOrDefaultAsync(m => m.BoardId == boardId && m.UserId == userId, cancellationToken);
    }

    public async Task<bool> IsMemberAsync(Guid boardId, Guid userId, CancellationToken cancellationToken = default)
    {
        return await _context.BoardMembers
            .AnyAsync(m => m.BoardId == boardId && m.UserId == userId, cancellationToken);
    }

    public async Task<IReadOnlyList<BoardMember>> GetMembersByBoardAsync(Guid boardId, CancellationToken cancellationToken = default)
    {
        return await _context.BoardMembers
            .AsNoTracking()
            .Include(m => m.User)
            .Where(m => m.BoardId == boardId)
            .OrderBy(m => m.User.DisplayName)
            .ToListAsync(cancellationToken);
    }

    public async Task AddAsync(BoardMember member, CancellationToken cancellationToken = default)
    {
        await _context.BoardMembers.AddAsync(member, cancellationToken);
    }

    public Task DeleteAsync(BoardMember member, CancellationToken cancellationToken = default)
    {
        _context.BoardMembers.Remove(member);
        return Task.CompletedTask;
    }

    public async Task SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        await _context.SaveChangesAsync(cancellationToken);
    }
}
