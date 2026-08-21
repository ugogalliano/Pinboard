using PostIt.Domain.Entities;

namespace PostIt.UnitTests.Domain.Entities;

public class BoardTests
{
    [Fact]
    public void Constructor_Sets_Properties_Correctly()
    {
        var creatorId = Guid.NewGuid();
        var board = new Board("My Board", creatorId);

        Assert.NotEqual(Guid.Empty, board.Id);
        Assert.Equal("My Board", board.Name);
        Assert.Equal(creatorId, board.CreatedBy);
        Assert.True(board.CreatedAt <= DateTime.UtcNow);
        Assert.True((board.UpdatedAt - board.CreatedAt).TotalSeconds < 1);
        Assert.Empty(board.Members);
        Assert.Empty(board.Notes);
    }

    [Fact]
    public void UpdateName_Updates_Name_And_UpdatedAt()
    {
        var board = new Board("Old Name", Guid.NewGuid());
        var originalUpdatedAt = board.UpdatedAt;

        Thread.Sleep(10);
        board.UpdateName("New Name");

        Assert.Equal("New Name", board.Name);
        Assert.True(board.UpdatedAt > originalUpdatedAt);
    }
}
