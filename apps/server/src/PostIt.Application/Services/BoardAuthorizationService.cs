using PostIt.Application.Interfaces;
using PostIt.Domain.Enums;

namespace PostIt.Application.Services;

public class BoardAuthorizationService : IBoardAuthorizationService
{
    private readonly IBoardMemberRepository _boardMemberRepository;

    public BoardAuthorizationService(IBoardMemberRepository boardMemberRepository)
    {
        _boardMemberRepository = boardMemberRepository;
    }

    public async Task<bool> CanReadBoardAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
    {
        var member = await _boardMemberRepository.GetByBoardAndUserAsync(boardId, userId, cancellationToken);
        return member != null;
    }

    public async Task<bool> CanEditBoardAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
    {
        var member = await _boardMemberRepository.GetByBoardAndUserAsync(boardId, userId, cancellationToken);
        return member?.Role == BoardRole.Owner;
    }

    public async Task<bool> CanDeleteBoardAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
    {
        var member = await _boardMemberRepository.GetByBoardAndUserAsync(boardId, userId, cancellationToken);
        return member?.Role == BoardRole.Owner;
    }

    public async Task<bool> CanManageMembersAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
    {
        var member = await _boardMemberRepository.GetByBoardAndUserAsync(boardId, userId, cancellationToken);
        return member?.Role == BoardRole.Owner;
    }

    public async Task<bool> CanCreateNoteAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
    {
        var member = await _boardMemberRepository.GetByBoardAndUserAsync(boardId, userId, cancellationToken);
        return member?.Role is BoardRole.Owner or BoardRole.Editor;
    }

    public async Task<bool> CanEditNoteAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
    {
        var member = await _boardMemberRepository.GetByBoardAndUserAsync(boardId, userId, cancellationToken);
        return member?.Role is BoardRole.Owner or BoardRole.Editor;
    }

    public async Task<bool> CanDeleteNoteAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
    {
        var member = await _boardMemberRepository.GetByBoardAndUserAsync(boardId, userId, cancellationToken);
        return member?.Role is BoardRole.Owner or BoardRole.Editor;
    }
}
