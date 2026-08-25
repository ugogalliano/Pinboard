using PostIt.Application.DTOs;
using PostIt.Application.Interfaces;
using PostIt.Domain.Entities;
using PostIt.Domain.Enums;

namespace PostIt.Application.Services;

public class BoardService : IBoardService
{
    private readonly IBoardRepository _boardRepository;
    private readonly IBoardAuthorizationService _authorizationService;

    public BoardService(IBoardRepository boardRepository, IBoardAuthorizationService authorizationService)
    {
        _boardRepository = boardRepository;
        _authorizationService = authorizationService;
    }

    public async Task<BoardDto> CreateBoardAsync(Guid userId, CreateBoardRequest request, CancellationToken cancellationToken = default)
    {
        ValidateName(request.Name);

        var board = new Board(request.Name, userId);
        board.Members.Add(new BoardMember(board.Id, userId, BoardRole.Owner));

        await _boardRepository.AddAsync(board, cancellationToken);
        await _boardRepository.SaveChangesAsync(cancellationToken);

        return MapToDto(board);
    }

    public async Task<IReadOnlyList<BoardDto>> GetBoardsForUserAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var boards = await _boardRepository.GetBoardsForUserAsync(userId, cancellationToken);
        return boards.Select(MapToDto).ToList();
    }

    public async Task<BoardDto> GetBoardAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
    {
        var board = await _boardRepository.GetByIdAsync(boardId, cancellationToken);
        if (board == null)
        {
            throw new KeyNotFoundException($"Board with id {boardId} not found.");
        }

        if (!await _authorizationService.CanReadBoardAsync(userId, boardId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You are not a member of this board.");
        }

        return MapToDto(board);
    }

    public async Task<BoardDto> UpdateBoardAsync(Guid userId, Guid boardId, UpdateBoardRequest request, CancellationToken cancellationToken = default)
    {
        ValidateName(request.Name);

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

        return MapToDto(board);
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

    private static BoardDto MapToDto(Board board)
    {
        return new BoardDto(board.Id, board.Name, board.CreatedBy, board.CreatedAt, board.UpdatedAt);
    }
}
