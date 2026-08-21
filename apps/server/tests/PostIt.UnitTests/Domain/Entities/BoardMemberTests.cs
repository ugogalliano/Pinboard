using PostIt.Domain.Entities;
using PostIt.Domain.Enums;

namespace PostIt.UnitTests.Domain.Entities;

public class BoardMemberTests
{
    [Fact]
    public void Constructor_Sets_Properties_Correctly()
    {
        var boardId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var member = new BoardMember(boardId, userId, BoardRole.Editor);

        Assert.NotEqual(Guid.Empty, member.Id);
        Assert.Equal(boardId, member.BoardId);
        Assert.Equal(userId, member.UserId);
        Assert.Equal(BoardRole.Editor, member.Role);
        Assert.True(member.CreatedAt <= DateTime.UtcNow);
    }

    [Fact]
    public void UpdateRole_Changes_Role()
    {
        var member = new BoardMember(Guid.NewGuid(), Guid.NewGuid(), BoardRole.Viewer);

        member.UpdateRole(BoardRole.Owner);

        Assert.Equal(BoardRole.Owner, member.Role);
    }
}
