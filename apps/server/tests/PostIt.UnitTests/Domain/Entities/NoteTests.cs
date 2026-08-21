using PostIt.Domain.Entities;

namespace PostIt.UnitTests.Domain.Entities;

public class NoteTests
{
    [Fact]
    public void Constructor_Sets_Properties_Correctly()
    {
        var boardId = Guid.NewGuid();
        var createdBy = Guid.NewGuid();
        var note = new Note(boardId, createdBy, "Hello", "yellow", 10, 20);

        Assert.NotEqual(Guid.Empty, note.Id);
        Assert.Equal(boardId, note.BoardId);
        Assert.Equal(createdBy, note.CreatedBy);
        Assert.Equal("Hello", note.Content);
        Assert.Equal("yellow", note.Color);
        Assert.Equal(10, note.PositionX);
        Assert.Equal(20, note.PositionY);
        Assert.True(note.CreatedAt <= DateTime.UtcNow);
        Assert.True((note.UpdatedAt - note.CreatedAt).TotalSeconds < 1);
    }

    [Fact]
    public void Constructor_Allows_Null_CreatedBy()
    {
        var note = new Note(Guid.NewGuid(), null, "Hello", "yellow", 0, 0);

        Assert.Null(note.CreatedBy);
    }

    [Fact]
    public void UpdateContent_Updates_Content_And_UpdatedAt()
    {
        var note = new Note(Guid.NewGuid(), null, "Old", "yellow", 0, 0);
        var originalUpdatedAt = note.UpdatedAt;

        Thread.Sleep(10);
        note.UpdateContent("New");

        Assert.Equal("New", note.Content);
        Assert.True(note.UpdatedAt > originalUpdatedAt);
    }

    [Fact]
    public void UpdateColor_Updates_Color_And_UpdatedAt()
    {
        var note = new Note(Guid.NewGuid(), null, "Hello", "yellow", 0, 0);
        var originalUpdatedAt = note.UpdatedAt;

        Thread.Sleep(10);
        note.UpdateColor("blue");

        Assert.Equal("blue", note.Color);
        Assert.True(note.UpdatedAt > originalUpdatedAt);
    }

    [Fact]
    public void UpdatePosition_Updates_Position_And_UpdatedAt()
    {
        var note = new Note(Guid.NewGuid(), null, "Hello", "yellow", 0, 0);
        var originalUpdatedAt = note.UpdatedAt;

        Thread.Sleep(10);
        note.UpdatePosition(100, 200);

        Assert.Equal(100, note.PositionX);
        Assert.Equal(200, note.PositionY);
        Assert.True(note.UpdatedAt > originalUpdatedAt);
    }
}
