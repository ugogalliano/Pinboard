using PostIt.Domain.Entities;

namespace PostIt.Application.Interfaces;

public interface INoteRepository
{
    Task<Note?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<Note>> GetNotesByBoardAsync(Guid boardId, CancellationToken cancellationToken = default);
    Task AddAsync(Note note, CancellationToken cancellationToken = default);
    Task DeleteAsync(Note note, CancellationToken cancellationToken = default);
    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
