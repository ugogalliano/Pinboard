using Microsoft.EntityFrameworkCore;
using PostIt.Application.Interfaces;
using PostIt.Domain.Entities;

namespace PostIt.Infrastructure.Persistence.Repositories;

public class NoteRepository : INoteRepository
{
    private readonly PostItDbContext _context;

    public NoteRepository(PostItDbContext context)
    {
        _context = context;
    }

    public async Task<Note?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
    {
        return await _context.Notes
            .FirstOrDefaultAsync(n => n.Id == id, cancellationToken);
    }

    public async Task<IReadOnlyList<Note>> GetNotesByBoardAsync(Guid boardId, CancellationToken cancellationToken = default)
    {
        return await _context.Notes
            .AsNoTracking()
            .Where(n => n.BoardId == boardId)
            .OrderBy(n => n.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public async Task AddAsync(Note note, CancellationToken cancellationToken = default)
    {
        await _context.Notes.AddAsync(note, cancellationToken);
    }

    public Task DeleteAsync(Note note, CancellationToken cancellationToken = default)
    {
        _context.Notes.Remove(note);
        return Task.CompletedTask;
    }

    public async Task SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        await _context.SaveChangesAsync(cancellationToken);
    }
}
