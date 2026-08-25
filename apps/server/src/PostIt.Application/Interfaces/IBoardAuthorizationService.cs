namespace PostIt.Application.Interfaces;

public interface IBoardAuthorizationService
{
    Task<bool> CanReadBoardAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default);
    Task<bool> CanEditBoardAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default);
    Task<bool> CanDeleteBoardAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default);
    Task<bool> CanManageMembersAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default);
    Task<bool> CanCreateNoteAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default);
    Task<bool> CanEditNoteAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default);
    Task<bool> CanDeleteNoteAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default);
}
