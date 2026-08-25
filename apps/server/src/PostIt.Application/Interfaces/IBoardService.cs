using PostIt.Application.DTOs;

namespace PostIt.Application.Interfaces;

public interface IBoardService
{
    Task<BoardDto> CreateBoardAsync(Guid userId, CreateBoardRequest request, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<BoardDto>> GetBoardsForUserAsync(Guid userId, CancellationToken cancellationToken = default);
    Task<BoardDto> GetBoardAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default);
    Task<BoardDto> UpdateBoardAsync(Guid userId, Guid boardId, UpdateBoardRequest request, CancellationToken cancellationToken = default);
    Task DeleteBoardAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default);
}
