using PostIt.Application.DTOs;

namespace PostIt.Application.Interfaces;

public interface IBoardNotificationService
{
    Task PostItCreated(Guid boardId, NoteDto note, CancellationToken cancellationToken = default);
    Task PostItUpdated(Guid boardId, NoteDto note, CancellationToken cancellationToken = default);
    Task PostItDeleted(Guid boardId, Guid noteId, CancellationToken cancellationToken = default);
}
