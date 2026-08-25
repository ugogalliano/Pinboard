using Moq;
using PostIt.Application.DTOs;
using PostIt.Application.Interfaces;
using PostIt.Application.Services;
using PostIt.Domain.Entities;
using PostIt.Domain.Enums;

namespace PostIt.UnitTests.Application.Services;

public class BoardMemberServiceTests
{
    private readonly Mock<IBoardRepository> _boardRepo = new();
    private readonly Mock<IBoardMemberRepository> _memberRepo = new();
    private readonly Mock<IBoardAuthorizationService> _authSvc = new();
    private readonly Mock<IUserRepository> _userRepo = new();
    private readonly BoardMemberService _svc;

    public BoardMemberServiceTests()
    {
        _svc = new BoardMemberService(_boardRepo.Object, _memberRepo.Object, _authSvc.Object, _userRepo.Object);
    }

    private static Board CreateBoard(Guid boardId)
    {
        var board = new Board("Test Board", Guid.NewGuid());
        typeof(Board).GetProperty("Id")!.SetValue(board, boardId);
        return board;
    }

    private static User CreateUser(Guid userId, string email, string displayName)
    {
        var user = new User(email, "hash", displayName);
        typeof(User).GetProperty("Id")!.SetValue(user, userId);
        return user;
    }

    private static BoardMember CreateMember(Guid boardId, Guid userId, BoardRole role, User user)
    {
        var member = new BoardMember(boardId, userId, role);
        typeof(BoardMember).GetProperty("User")!.SetValue(member, user);
        return member;
    }

    [Fact]
    public async Task GetMembersAsync_ExistingBoardAndMember_ReturnsMembers()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var board = CreateBoard(boardId);
        var memberUser = CreateUser(Guid.NewGuid(), "member@example.com", "Member");
        var member = CreateMember(boardId, memberUser.Id, BoardRole.Editor, memberUser);

        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _authSvc.Setup(a => a.CanReadBoardAsync(userId, boardId, default)).ReturnsAsync(true);
        _memberRepo.Setup(r => r.GetMembersByBoardAsync(boardId, default)).ReturnsAsync(new List<BoardMember> { member });

        var result = await _svc.GetMembersAsync(userId, boardId);

        Assert.Single(result);
        Assert.Equal(memberUser.Id, result[0].UserId);
        Assert.Equal("member@example.com", result[0].Email);
        Assert.Equal("Member", result[0].DisplayName);
        Assert.Equal("Editor", result[0].Role);
    }

    [Fact]
    public async Task GetMembersAsync_MissingBoard_ThrowsKeyNotFoundException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync((Board?)null);

        var ex = await Assert.ThrowsAsync<KeyNotFoundException>(() => _svc.GetMembersAsync(userId, boardId));
        Assert.Contains("Board", ex.Message);
    }

    [Fact]
    public async Task GetMembersAsync_NotMember_ThrowsUnauthorizedAccessException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var board = CreateBoard(boardId);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _authSvc.Setup(a => a.CanReadBoardAsync(userId, boardId, default)).ReturnsAsync(false);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => _svc.GetMembersAsync(userId, boardId));
    }

    [Fact]
    public async Task AddMemberAsync_Owner_AddsMember()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var board = CreateBoard(boardId);
        var targetUser = CreateUser(Guid.NewGuid(), "new@example.com", "New User");

        _authSvc.Setup(a => a.CanManageMembersAsync(userId, boardId, default)).ReturnsAsync(true);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _userRepo.Setup(r => r.GetByEmailAsync("new@example.com", default)).ReturnsAsync(targetUser);
        _memberRepo.Setup(r => r.IsMemberAsync(boardId, targetUser.Id, default)).ReturnsAsync(false);
        _memberRepo.Setup(r => r.AddAsync(It.IsAny<BoardMember>(), default)).Returns(Task.CompletedTask);
        _memberRepo.Setup(r => r.SaveChangesAsync(default)).Returns(Task.CompletedTask);

        var result = await _svc.AddMemberAsync(userId, boardId, new AddMemberRequest("new@example.com", "Editor"));

        Assert.NotNull(result);
        Assert.Equal(targetUser.Id, result.UserId);
        Assert.Equal("new@example.com", result.Email);
        Assert.Equal("New User", result.DisplayName);
        Assert.Equal("Editor", result.Role);
        _memberRepo.Verify(r => r.AddAsync(It.Is<BoardMember>(m => m.UserId == targetUser.Id && m.Role == BoardRole.Editor), default), Times.Once);
        _memberRepo.Verify(r => r.SaveChangesAsync(default), Times.Once);
    }

    [Fact]
    public async Task AddMemberAsync_NonOwner_ThrowsUnauthorizedAccessException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        _authSvc.Setup(a => a.CanManageMembersAsync(userId, boardId, default)).ReturnsAsync(false);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => _svc.AddMemberAsync(userId, boardId, new AddMemberRequest("x@y.com", "Editor")));
    }

    [Fact]
    public async Task AddMemberAsync_MissingBoard_ThrowsKeyNotFoundException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        _authSvc.Setup(a => a.CanManageMembersAsync(userId, boardId, default)).ReturnsAsync(true);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync((Board?)null);

        var ex = await Assert.ThrowsAsync<KeyNotFoundException>(() => _svc.AddMemberAsync(userId, boardId, new AddMemberRequest("x@y.com", "Editor")));
        Assert.Contains("Board", ex.Message);
    }

    [Fact]
    public async Task AddMemberAsync_MissingUser_ThrowsKeyNotFoundException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var board = CreateBoard(boardId);
        _authSvc.Setup(a => a.CanManageMembersAsync(userId, boardId, default)).ReturnsAsync(true);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _userRepo.Setup(r => r.GetByEmailAsync("missing@example.com", default)).ReturnsAsync((User?)null);

        var ex = await Assert.ThrowsAsync<KeyNotFoundException>(() => _svc.AddMemberAsync(userId, boardId, new AddMemberRequest("missing@example.com", "Editor")));
        Assert.Contains("User", ex.Message);
    }

    [Fact]
    public async Task AddMemberAsync_AlreadyMember_ThrowsInvalidOperationException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var board = CreateBoard(boardId);
        var targetUser = CreateUser(Guid.NewGuid(), "existing@example.com", "Existing");
        _authSvc.Setup(a => a.CanManageMembersAsync(userId, boardId, default)).ReturnsAsync(true);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _userRepo.Setup(r => r.GetByEmailAsync("existing@example.com", default)).ReturnsAsync(targetUser);
        _memberRepo.Setup(r => r.IsMemberAsync(boardId, targetUser.Id, default)).ReturnsAsync(true);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => _svc.AddMemberAsync(userId, boardId, new AddMemberRequest("existing@example.com", "Editor")));
        Assert.Contains("already a member", ex.Message);
    }

    [Theory]
    [InlineData("Owner")]
    [InlineData("Invalid")]
    public async Task AddMemberAsync_InvalidRole_ThrowsArgumentException(string role)
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var board = CreateBoard(boardId);
        var targetUser = CreateUser(Guid.NewGuid(), "new@example.com", "New User");
        _authSvc.Setup(a => a.CanManageMembersAsync(userId, boardId, default)).ReturnsAsync(true);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _userRepo.Setup(r => r.GetByEmailAsync("new@example.com", default)).ReturnsAsync(targetUser);
        _memberRepo.Setup(r => r.IsMemberAsync(boardId, targetUser.Id, default)).ReturnsAsync(false);

        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _svc.AddMemberAsync(userId, boardId, new AddMemberRequest("new@example.com", role)));
        Assert.Contains("Role", ex.Message);
    }

    [Fact]
    public async Task UpdateMemberAsync_Owner_UpdatesRole()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var memberUserId = Guid.NewGuid();
        var board = CreateBoard(boardId);
        var targetUser = CreateUser(memberUserId, "target@example.com", "Target");
        var member = CreateMember(boardId, memberUserId, BoardRole.Editor, targetUser);

        _authSvc.Setup(a => a.CanManageMembersAsync(userId, boardId, default)).ReturnsAsync(true);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _memberRepo.Setup(r => r.GetByBoardAndUserAsync(boardId, memberUserId, default)).ReturnsAsync(member);
        _memberRepo.Setup(r => r.SaveChangesAsync(default)).Returns(Task.CompletedTask);

        var result = await _svc.UpdateMemberAsync(userId, boardId, memberUserId, new UpdateMemberRequest("Viewer"));

        Assert.Equal("Viewer", result.Role);
        _memberRepo.Verify(r => r.SaveChangesAsync(default), Times.Once);
    }

    [Fact]
    public async Task UpdateMemberAsync_NonOwner_ThrowsUnauthorizedAccessException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        _authSvc.Setup(a => a.CanManageMembersAsync(userId, boardId, default)).ReturnsAsync(false);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => _svc.UpdateMemberAsync(userId, boardId, Guid.NewGuid(), new UpdateMemberRequest("Viewer")));
    }

    [Fact]
    public async Task UpdateMemberAsync_MissingBoard_ThrowsKeyNotFoundException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        _authSvc.Setup(a => a.CanManageMembersAsync(userId, boardId, default)).ReturnsAsync(true);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync((Board?)null);

        var ex = await Assert.ThrowsAsync<KeyNotFoundException>(() => _svc.UpdateMemberAsync(userId, boardId, Guid.NewGuid(), new UpdateMemberRequest("Viewer")));
        Assert.Contains("Board", ex.Message);
    }

    [Fact]
    public async Task UpdateMemberAsync_MissingMember_ThrowsKeyNotFoundException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var memberUserId = Guid.NewGuid();
        var board = CreateBoard(boardId);
        _authSvc.Setup(a => a.CanManageMembersAsync(userId, boardId, default)).ReturnsAsync(true);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _memberRepo.Setup(r => r.GetByBoardAndUserAsync(boardId, memberUserId, default)).ReturnsAsync((BoardMember?)null);

        var ex = await Assert.ThrowsAsync<KeyNotFoundException>(() => _svc.UpdateMemberAsync(userId, boardId, memberUserId, new UpdateMemberRequest("Viewer")));
        Assert.Contains("Member", ex.Message);
    }

    [Fact]
    public async Task UpdateMemberAsync_OwnerRole_ThrowsInvalidOperationException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var memberUserId = Guid.NewGuid();
        var board = CreateBoard(boardId);
        var targetUser = CreateUser(memberUserId, "target@example.com", "Target");
        var member = CreateMember(boardId, memberUserId, BoardRole.Owner, targetUser);

        _authSvc.Setup(a => a.CanManageMembersAsync(userId, boardId, default)).ReturnsAsync(true);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _memberRepo.Setup(r => r.GetByBoardAndUserAsync(boardId, memberUserId, default)).ReturnsAsync(member);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => _svc.UpdateMemberAsync(userId, boardId, memberUserId, new UpdateMemberRequest("Viewer")));
        Assert.Contains("Owner", ex.Message);
    }

    [Theory]
    [InlineData("Owner")]
    [InlineData("Invalid")]
    public async Task UpdateMemberAsync_InvalidRole_ThrowsArgumentException(string role)
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var memberUserId = Guid.NewGuid();
        var board = CreateBoard(boardId);
        var targetUser = CreateUser(memberUserId, "target@example.com", "Target");
        var member = CreateMember(boardId, memberUserId, BoardRole.Editor, targetUser);

        _authSvc.Setup(a => a.CanManageMembersAsync(userId, boardId, default)).ReturnsAsync(true);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _memberRepo.Setup(r => r.GetByBoardAndUserAsync(boardId, memberUserId, default)).ReturnsAsync(member);

        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _svc.UpdateMemberAsync(userId, boardId, memberUserId, new UpdateMemberRequest(role)));
        Assert.Contains("Role", ex.Message);
    }

    [Fact]
    public async Task DeleteMemberAsync_Owner_DeletesMember()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var memberUserId = Guid.NewGuid();
        var board = CreateBoard(boardId);
        var targetUser = CreateUser(memberUserId, "target@example.com", "Target");
        var member = CreateMember(boardId, memberUserId, BoardRole.Editor, targetUser);

        _authSvc.Setup(a => a.CanManageMembersAsync(userId, boardId, default)).ReturnsAsync(true);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _memberRepo.Setup(r => r.GetByBoardAndUserAsync(boardId, memberUserId, default)).ReturnsAsync(member);
        _memberRepo.Setup(r => r.DeleteAsync(member, default)).Returns(Task.CompletedTask);
        _memberRepo.Setup(r => r.SaveChangesAsync(default)).Returns(Task.CompletedTask);

        await _svc.DeleteMemberAsync(userId, boardId, memberUserId);

        _memberRepo.Verify(r => r.DeleteAsync(member, default), Times.Once);
        _memberRepo.Verify(r => r.SaveChangesAsync(default), Times.Once);
    }

    [Fact]
    public async Task DeleteMemberAsync_NonOwner_ThrowsUnauthorizedAccessException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        _authSvc.Setup(a => a.CanManageMembersAsync(userId, boardId, default)).ReturnsAsync(false);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => _svc.DeleteMemberAsync(userId, boardId, Guid.NewGuid()));
    }

    [Fact]
    public async Task DeleteMemberAsync_MissingBoard_ThrowsKeyNotFoundException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        _authSvc.Setup(a => a.CanManageMembersAsync(userId, boardId, default)).ReturnsAsync(true);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync((Board?)null);

        var ex = await Assert.ThrowsAsync<KeyNotFoundException>(() => _svc.DeleteMemberAsync(userId, boardId, Guid.NewGuid()));
        Assert.Contains("Board", ex.Message);
    }

    [Fact]
    public async Task DeleteMemberAsync_MissingMember_ThrowsKeyNotFoundException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var memberUserId = Guid.NewGuid();
        var board = CreateBoard(boardId);
        _authSvc.Setup(a => a.CanManageMembersAsync(userId, boardId, default)).ReturnsAsync(true);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _memberRepo.Setup(r => r.GetByBoardAndUserAsync(boardId, memberUserId, default)).ReturnsAsync((BoardMember?)null);

        var ex = await Assert.ThrowsAsync<KeyNotFoundException>(() => _svc.DeleteMemberAsync(userId, boardId, memberUserId));
        Assert.Contains("Member", ex.Message);
    }

    [Fact]
    public async Task DeleteMemberAsync_LastOwner_ThrowsInvalidOperationException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var memberUserId = Guid.NewGuid();
        var board = CreateBoard(boardId);
        var targetUser = CreateUser(memberUserId, "target@example.com", "Target");
        var member = CreateMember(boardId, memberUserId, BoardRole.Owner, targetUser);

        _authSvc.Setup(a => a.CanManageMembersAsync(userId, boardId, default)).ReturnsAsync(true);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _memberRepo.Setup(r => r.GetByBoardAndUserAsync(boardId, memberUserId, default)).ReturnsAsync(member);
        _memberRepo.Setup(r => r.GetMembersByBoardAsync(boardId, default)).ReturnsAsync(new List<BoardMember> { member });

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => _svc.DeleteMemberAsync(userId, boardId, memberUserId));
        Assert.Contains("last Owner", ex.Message);
    }
}
