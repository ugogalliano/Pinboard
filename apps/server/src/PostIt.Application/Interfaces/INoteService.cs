using PostIt.Application.DTOs;

namespace PostIt.Application.Interfaces;

public interface INoteService
{
    Task<IReadOnlyList<NoteDto>> GetNotesAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default);
    Task<NoteDto> CreateNoteAsync(Guid userId, Guid boardId, CreateNoteRequest request, CancellationToken cancellationToken = default);
    Task<NoteDto> UpdateNoteAsync(Guid userId, Guid noteId, UpdateNoteRequest request, CancellationToken cancellationToken = default);
    Task DeleteNoteAsync(Guid userId, Guid noteId, CancellationToken cancellationToken = default);
}
