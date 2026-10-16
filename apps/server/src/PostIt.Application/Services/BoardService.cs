using Microsoft.Extensions.Logging;
using PostIt.Application.DTOs;
using PostIt.Application.Interfaces;
using PostIt.Domain.Entities;
using PostIt.Domain.Enums;

namespace PostIt.Application.Services;

public class BoardService : IBoardService
{
    private readonly IBoardRepository _boardRepository;
    private readonly IBoardAuthorizationService _authorizationService;
    private readonly ILogger<BoardService> _logger;

    public BoardService(IBoardRepository boardRepository, IBoardAuthorizationService authorizationService, ILogger<BoardService> logger)
    {
        _boardRepository = boardRepository;
        _authorizationService = authorizationService;
        _logger = logger;
    }

    public async Task<BoardDto> CreateBoardAsync(Guid userId, CreateBoardRequest request, CancellationToken cancellationToken = default)
    {
        ValidateName(request.Name);

        _logger.LogInformation("Validation completed");

        var board = new Board(request.Name, userId);
        board.Members.Add(new BoardMember(board.Id, userId, BoardRole.Owner));

        await _boardRepository.AddAsync(board, cancellationToken);
        await _boardRepository.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Board created | boardId={BoardId}", board.Id);

        return MapToDto(board, 1);
    }

    public async Task<IReadOnlyList<BoardDto>> GetBoardsForUserAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var boards = await _boardRepository.GetBoardsWithMemberCountForUserAsync(userId, cancellationToken);
        return boards.Select(board => MapToDto(board.Board, board.MemberCount)).ToList();
    }

    public async Task<BoardDto> GetBoardAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
    {
        var boardWithMemberCount = await _boardRepository.GetByIdWithMemberCountAsync(boardId, cancellationToken);
        if (boardWithMemberCount == null)
        {
            throw new KeyNotFoundException($"Board with id {boardId} not found.");
        }

        if (!await _authorizationService.CanReadBoardAsync(userId, boardId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You are not a member of this board.");
        }

        return MapToDto(boardWithMemberCount.Board, boardWithMemberCount.MemberCount);
    }

    public async Task<BoardDto> UpdateBoardAsync(Guid userId, Guid boardId, UpdateBoardRequest request, CancellationToken cancellationToken = default)
    {
        ValidateName(request.Name);

        _logger.LogInformation("Validation completed");

        var board = await _boardRepository.GetByIdAsync(boardId, cancellationToken);
        if (board == null)
        {
            throw new KeyNotFoundException($"Board with id {boardId} not found.");
        }

        if (!await _authorizationService.CanEditBoardAsync(userId, boardId, cancellationToken))
        {
            throw new UnauthorizedAccessException("Only the board owner can edit this board.");
        }

        board.UpdateName(request.Name);
        await _boardRepository.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Board updated | boardId={BoardId}", board.Id);

        var memberCount = await _boardRepository.GetMemberCountAsync(boardId, cancellationToken);
        return MapToDto(board, memberCount);
    }

    public async Task DeleteBoardAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
    {
        var board = await _boardRepository.GetByIdAsync(boardId, cancellationToken);
        if (board == null)
        {
            throw new KeyNotFoundException($"Board with id {boardId} not found.");
        }

        if (!await _authorizationService.CanDeleteBoardAsync(userId, boardId, cancellationToken))
        {
            throw new UnauthorizedAccessException("Only the board owner can delete this board.");
        }

        await _boardRepository.DeleteAsync(board, cancellationToken);
        await _boardRepository.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Board deleted | boardId={BoardId}", board.Id);
    }

    private static void ValidateName(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Board name is required.", nameof(name));
        }

        if (name.Length > 200)
        {
            throw new ArgumentException("Board name must not exceed 200 characters.", nameof(name));
        }
    }

    private static BoardDto MapToDto(Board board, int memberCount)
    {
        return new BoardDto(board.Id, board.Name, board.CreatedBy, board.CreatedAt, board.UpdatedAt, memberCount);
    }
}
