using Microsoft.EntityFrameworkCore;
using PostIt.Application.DTOs;
using PostIt.Application.Interfaces;
using PostIt.Domain.Entities;
using PostIt.Infrastructure.Persistence;

namespace PostIt.Infrastructure.Persistence.Repositories;

public class BoardRepository : IBoardRepository
{
    private readonly PostItDbContext _context;

    public BoardRepository(PostItDbContext context)
    {
        _context = context;
    }

    public async Task<Board?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        return await _context.Boards
            .FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
    }

    public async Task<IReadOnlyList<Board>> GetBoardsForUserAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        return await _context.Boards
            .AsNoTracking()
            .Where(b => b.Members.Any(m => m.UserId == userId))
            .OrderBy(b => b.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<BoardWithMemberCount?> GetByIdWithMemberCountAsync(Guid boardId, CancellationToken cancellationToken = default)
    {
        return await _context.Boards
            .AsNoTracking()
            .Where(b => b.Id == boardId)
            .Select(b => new BoardWithMemberCount(b, b.Members.Count()))
            .FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<BoardWithMemberCount>> GetBoardsWithMemberCountForUserAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        return await _context.Boards
            .AsNoTracking()
            .Where(b => b.Members.Any(m => m.UserId == userId))
            .OrderBy(b => b.Name)
            .Select(b => new BoardWithMemberCount(b, b.Members.Count()))
            .ToListAsync(cancellationToken);
    }

    public async Task<int> GetMemberCountAsync(Guid boardId, CancellationToken cancellationToken = default)
    {
        return await _context.BoardMembers
            .CountAsync(member => member.BoardId == boardId, cancellationToken);
    }

    public async Task AddAsync(Board board, CancellationToken cancellationToken = default)
    {
        await _context.Boards.AddAsync(board, cancellationToken);
    }

    public Task DeleteAsync(Board board, CancellationToken cancellationToken = default)
    {
        _context.Boards.Remove(board);
        return Task.CompletedTask;
    }

    public async Task SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        await _context.SaveChangesAsync(cancellationToken);
    }
}
