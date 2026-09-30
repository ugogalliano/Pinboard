using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using PostIt.Application.Interfaces;
using PostIt.Application.Services;
using PostIt.Domain.Entities;
using PostIt.Domain.Enums;

namespace PostIt.UnitTests.Application.Services;

public class BoardAuthorizationServiceTests
{
    private readonly Mock<IBoardMemberRepository> _repo = new();
    private readonly BoardAuthorizationService _svc;

    public BoardAuthorizationServiceTests()
    {
        _svc = new BoardAuthorizationService(_repo.Object, NullLogger<BoardAuthorizationService>.Instance);
    }

    private void SetupMember(BoardRole? role)
    {
        var boardId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var userId = Guid.Parse("22222222-2222-2222-2222-222222222222");

        if (role.HasValue)
        {
            var member = new BoardMember(boardId, userId, role.Value);
            _repo.Setup(r => r.GetByBoardAndUserAsync(boardId, userId, default))
                .ReturnsAsync(member);
        }
        else
        {
            _repo.Setup(r => r.GetByBoardAndUserAsync(boardId, userId, default))
                .ReturnsAsync((BoardMember?)null);
        }
    }

    [Theory]
    [InlineData(BoardRole.Owner, true)]
    [InlineData(BoardRole.Editor, true)]
    [InlineData(BoardRole.Viewer, true)]
    [InlineData(null, false)]
    public async Task CanReadBoardAsync_VariousRoles_ReturnsExpected(BoardRole? role, bool expected)
    {
        SetupMember(role);
        var boardId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var userId = Guid.Parse("22222222-2222-2222-2222-222222222222");

        var result = await _svc.CanReadBoardAsync(userId, boardId);

        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData(BoardRole.Owner, true)]
    [InlineData(BoardRole.Editor, false)]
    [InlineData(BoardRole.Viewer, false)]
    [InlineData(null, false)]
    public async Task CanEditBoardAsync_VariousRoles_ReturnsExpected(BoardRole? role, bool expected)
    {
        SetupMember(role);
        var boardId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var userId = Guid.Parse("22222222-2222-2222-2222-222222222222");

        var result = await _svc.CanEditBoardAsync(userId, boardId);

        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData(BoardRole.Owner, true)]
    [InlineData(BoardRole.Editor, false)]
    [InlineData(BoardRole.Viewer, false)]
    [InlineData(null, false)]
    public async Task CanDeleteBoardAsync_VariousRoles_ReturnsExpected(BoardRole? role, bool expected)
    {
        SetupMember(role);
        var boardId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var userId = Guid.Parse("22222222-2222-2222-2222-222222222222");

        var result = await _svc.CanDeleteBoardAsync(userId, boardId);

        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData(BoardRole.Owner, true)]
    [InlineData(BoardRole.Editor, false)]
    [InlineData(BoardRole.Viewer, false)]
    [InlineData(null, false)]
    public async Task CanManageMembersAsync_VariousRoles_ReturnsExpected(BoardRole? role, bool expected)
    {
        SetupMember(role);
        var boardId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var userId = Guid.Parse("22222222-2222-2222-2222-222222222222");

        var result = await _svc.CanManageMembersAsync(userId, boardId);

        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData(BoardRole.Owner, true)]
    [InlineData(BoardRole.Editor, true)]
    [InlineData(BoardRole.Viewer, false)]
    [InlineData(null, false)]
    public async Task CanCreateNoteAsync_VariousRoles_ReturnsExpected(BoardRole? role, bool expected)
    {
        SetupMember(role);
        var boardId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var userId = Guid.Parse("22222222-2222-2222-2222-222222222222");

        var result = await _svc.CanCreateNoteAsync(userId, boardId);

        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData(BoardRole.Owner, true)]
    [InlineData(BoardRole.Editor, true)]
    [InlineData(BoardRole.Viewer, false)]
    [InlineData(null, false)]
    public async Task CanEditNoteAsync_VariousRoles_ReturnsExpected(BoardRole? role, bool expected)
    {
        SetupMember(role);
        var boardId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var userId = Guid.Parse("22222222-2222-2222-2222-222222222222");

        var result = await _svc.CanEditNoteAsync(userId, boardId);

        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData(BoardRole.Owner, true)]
    [InlineData(BoardRole.Editor, true)]
    [InlineData(BoardRole.Viewer, false)]
    [InlineData(null, false)]
    public async Task CanDeleteNoteAsync_VariousRoles_ReturnsExpected(BoardRole? role, bool expected)
    {
        SetupMember(role);
        var boardId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var userId = Guid.Parse("22222222-2222-2222-2222-222222222222");

        var result = await _svc.CanDeleteNoteAsync(userId, boardId);

        Assert.Equal(expected, result);
    }
}
