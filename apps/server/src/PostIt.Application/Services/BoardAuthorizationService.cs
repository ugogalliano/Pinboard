using Microsoft.Extensions.Logging;
using PostIt.Application.Interfaces;
using PostIt.Domain.Enums;

namespace PostIt.Application.Services;

public class BoardAuthorizationService : IBoardAuthorizationService
{
    private readonly IBoardMemberRepository _boardMemberRepository;
    private readonly ILogger<BoardAuthorizationService> _logger;

    public BoardAuthorizationService(IBoardMemberRepository boardMemberRepository, ILogger<BoardAuthorizationService> logger)
    {
        _boardMemberRepository = boardMemberRepository;
        _logger = logger;
    }

    public async Task<bool> CanReadBoardAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
    {
        var member = await _boardMemberRepository.GetByBoardAndUserAsync(boardId, userId, cancellationToken);
        if (member == null)
        {
            _logger.LogWarning("Authorization denied | userId={UserId} boardId={BoardId} operation={Operation}", userId, boardId, "CanReadBoard");
            return false;
        }

        return true;
    }

    public async Task<bool> CanEditBoardAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
    {
        var member = await _boardMemberRepository.GetByBoardAndUserAsync(boardId, userId, cancellationToken);
        if (member?.Role != BoardRole.Owner)
        {
            _logger.LogWarning("Authorization denied | userId={UserId} boardId={BoardId} operation={Operation}", userId, boardId, "CanEditBoard");
            return false;
        }

        return true;
    }

    public async Task<bool> CanDeleteBoardAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
    {
        var member = await _boardMemberRepository.GetByBoardAndUserAsync(boardId, userId, cancellationToken);
        if (member?.Role != BoardRole.Owner)
        {
            _logger.LogWarning("Authorization denied | userId={UserId} boardId={BoardId} operation={Operation}", userId, boardId, "CanDeleteBoard");
            return false;
        }

        return true;
    }

    public async Task<bool> CanManageMembersAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
    {
        var member = await _boardMemberRepository.GetByBoardAndUserAsync(boardId, userId, cancellationToken);
        if (member?.Role != BoardRole.Owner)
        {
            _logger.LogWarning("Authorization denied | userId={UserId} boardId={BoardId} operation={Operation}", userId, boardId, "CanManageMembers");
            return false;
        }

        return true;
    }

    public async Task<bool> CanCreateNoteAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
    {
        var member = await _boardMemberRepository.GetByBoardAndUserAsync(boardId, userId, cancellationToken);
        if (member?.Role is not (BoardRole.Owner or BoardRole.Editor))
        {
            _logger.LogWarning("Authorization denied | userId={UserId} boardId={BoardId} operation={Operation}", userId, boardId, "CanCreateNote");
            return false;
        }

        return true;
    }

    public async Task<bool> CanEditNoteAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
    {
        var member = await _boardMemberRepository.GetByBoardAndUserAsync(boardId, userId, cancellationToken);
        if (member?.Role is not (BoardRole.Owner or BoardRole.Editor))
        {
            _logger.LogWarning("Authorization denied | userId={UserId} boardId={BoardId} operation={Operation}", userId, boardId, "CanEditNote");
            return false;
        }

        return true;
    }

    public async Task<bool> CanDeleteNoteAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
    {
        var member = await _boardMemberRepository.GetByBoardAndUserAsync(boardId, userId, cancellationToken);
        if (member?.Role is not (BoardRole.Owner or BoardRole.Editor))
        {
            _logger.LogWarning("Authorization denied | userId={UserId} boardId={BoardId} operation={Operation}", userId, boardId, "CanDeleteNote");
            return false;
        }

        return true;
    }
}
