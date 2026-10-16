using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using PostIt.Application.DTOs;
using PostIt.Application.Interfaces;
using PostIt.Application.Services;
using PostIt.Domain.Entities;
using PostIt.Domain.Enums;

namespace PostIt.UnitTests.Application.Services;

public class BoardServiceTests
{
    private readonly Mock<IBoardRepository> _boardRepo = new();
    private readonly Mock<IBoardAuthorizationService> _authSvc = new();
    private readonly BoardService _svc;

    public BoardServiceTests()
    {
        _svc = new BoardService(_boardRepo.Object, _authSvc.Object, NullLogger<BoardService>.Instance);
    }

    [Fact]
    public async Task CreateBoardAsync_ValidInput_CreatesBoardWithOwnerMember()
    {
        var userId = Guid.NewGuid();
        var request = new CreateBoardRequest("My Board");
        Board? capturedBoard = null;
        _boardRepo.Setup(r => r.AddAsync(It.IsAny<Board>(), default))
            .Callback<Board, CancellationToken>((b, _) => capturedBoard = b);

        var result = await _svc.CreateBoardAsync(userId, request);

        Assert.NotNull(result);
        Assert.Equal("My Board", result.Name);
        Assert.Equal(userId, result.CreatedBy);
        Assert.Equal(1, result.MemberCount);
        _boardRepo.Verify(r => r.AddAsync(It.IsAny<Board>(), default), Times.Once);
        _boardRepo.Verify(r => r.SaveChangesAsync(default), Times.Once);
        Assert.NotNull(capturedBoard);
        Assert.Single(capturedBoard!.Members);
        Assert.Equal(userId, capturedBoard.Members.First().UserId);
        Assert.Equal(BoardRole.Owner, capturedBoard.Members.First().Role);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task CreateBoardAsync_EmptyName_ThrowsArgumentException(string? name)
    {
        var request = new CreateBoardRequest(name!);

        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _svc.CreateBoardAsync(Guid.NewGuid(), request));
        Assert.Contains("required", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CreateBoardAsync_NameTooLong_ThrowsArgumentException()
    {
        var request = new CreateBoardRequest(new string('x', 201));

        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _svc.CreateBoardAsync(Guid.NewGuid(), request));
        Assert.Contains("200", ex.Message);
    }

    [Fact]
    public async Task GetBoardsForUserAsync_ReturnsOnlyUserBoards()
    {
        var userId = Guid.NewGuid();
        var board1 = new Board("Board 1", userId);
        var board2 = new Board("Board 2", userId);
        _boardRepo.Setup(r => r.GetBoardsWithMemberCountForUserAsync(userId, default))
            .ReturnsAsync(new List<BoardWithMemberCount>
            {
                new(board1, 0),
                new(board2, 3)
            });

        var result = await _svc.GetBoardsForUserAsync(userId);

        Assert.Equal(2, result.Count);
        Assert.Equal("Board 1", result[0].Name);
        Assert.Equal("Board 2", result[1].Name);
        Assert.Equal(0, result[0].MemberCount);
        Assert.Equal(3, result[1].MemberCount);
    }

    [Fact]
    public async Task GetBoardAsync_ExistingAndMember_ReturnsBoard()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var board = new Board("Test Board", Guid.NewGuid());
        typeof(Board).GetProperty("Id")!.SetValue(board, boardId);
        _boardRepo.Setup(r => r.GetByIdWithMemberCountAsync(boardId, default))
            .ReturnsAsync(new BoardWithMemberCount(board, 0));
        _authSvc.Setup(a => a.CanReadBoardAsync(userId, boardId, default)).ReturnsAsync(true);

        var result = await _svc.GetBoardAsync(userId, boardId);

        Assert.NotNull(result);
        Assert.Equal(boardId, result.Id);
        Assert.Equal("Test Board", result.Name);
        Assert.Equal(0, result.MemberCount);
    }

    [Fact]
    public async Task GetBoardAsync_MissingBoard_ThrowsKeyNotFoundException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        _boardRepo.Setup(r => r.GetByIdWithMemberCountAsync(boardId, default))
            .ReturnsAsync((BoardWithMemberCount?)null);

        await Assert.ThrowsAsync<KeyNotFoundException>(() => _svc.GetBoardAsync(userId, boardId));
    }

    [Fact]
    public async Task GetBoardAsync_NotMember_ThrowsUnauthorizedAccessException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var board = new Board("Test Board", Guid.NewGuid());
        typeof(Board).GetProperty("Id")!.SetValue(board, boardId);
        _boardRepo.Setup(r => r.GetByIdWithMemberCountAsync(boardId, default))
            .ReturnsAsync(new BoardWithMemberCount(board, 0));
        _authSvc.Setup(a => a.CanReadBoardAsync(userId, boardId, default)).ReturnsAsync(false);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => _svc.GetBoardAsync(userId, boardId));
    }

    [Fact]
    public async Task UpdateBoardAsync_Owner_UpdatesName()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var board = new Board("Old Name", userId);
        typeof(Board).GetProperty("Id")!.SetValue(board, boardId);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _authSvc.Setup(a => a.CanEditBoardAsync(userId, boardId, default)).ReturnsAsync(true);
        _boardRepo.Setup(r => r.GetMemberCountAsync(boardId, default)).ReturnsAsync(3);

        var result = await _svc.UpdateBoardAsync(userId, boardId, new UpdateBoardRequest("New Name"));

        Assert.Equal("New Name", result.Name);
        Assert.Equal(3, result.MemberCount);
        _boardRepo.Verify(r => r.SaveChangesAsync(default), Times.Once);
    }

    [Fact]
    public async Task UpdateBoardAsync_MissingBoard_ThrowsKeyNotFoundException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync((Board?)null);

        await Assert.ThrowsAsync<KeyNotFoundException>(() => _svc.UpdateBoardAsync(userId, boardId, new UpdateBoardRequest("New")));
    }

    [Fact]
    public async Task UpdateBoardAsync_NonOwner_ThrowsUnauthorizedAccessException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var board = new Board("Old Name", Guid.NewGuid());
        typeof(Board).GetProperty("Id")!.SetValue(board, boardId);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _authSvc.Setup(a => a.CanEditBoardAsync(userId, boardId, default)).ReturnsAsync(false);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => _svc.UpdateBoardAsync(userId, boardId, new UpdateBoardRequest("New")));
    }

    [Fact]
    public async Task UpdateBoardAsync_InvalidName_ThrowsArgumentException()
    {
        var request = new UpdateBoardRequest("");

        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _svc.UpdateBoardAsync(Guid.NewGuid(), Guid.NewGuid(), request));
        Assert.Contains("required", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task DeleteBoardAsync_Owner_DeletesBoard()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var board = new Board("Board", userId);
        typeof(Board).GetProperty("Id")!.SetValue(board, boardId);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _authSvc.Setup(a => a.CanDeleteBoardAsync(userId, boardId, default)).ReturnsAsync(true);

        await _svc.DeleteBoardAsync(userId, boardId);

        _boardRepo.Verify(r => r.DeleteAsync(board, default), Times.Once);
        _boardRepo.Verify(r => r.SaveChangesAsync(default), Times.Once);
    }

    [Fact]
    public async Task DeleteBoardAsync_MissingBoard_ThrowsKeyNotFoundException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync((Board?)null);

        await Assert.ThrowsAsync<KeyNotFoundException>(() => _svc.DeleteBoardAsync(userId, boardId));
    }

    [Fact]
    public async Task DeleteBoardAsync_NonOwner_ThrowsUnauthorizedAccessException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var board = new Board("Board", Guid.NewGuid());
        typeof(Board).GetProperty("Id")!.SetValue(board, boardId);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _authSvc.Setup(a => a.CanDeleteBoardAsync(userId, boardId, default)).ReturnsAsync(false);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => _svc.DeleteBoardAsync(userId, boardId));
    }
}
