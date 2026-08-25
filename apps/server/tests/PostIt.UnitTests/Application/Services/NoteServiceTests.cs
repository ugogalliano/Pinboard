using Moq;
using PostIt.Application.DTOs;
using PostIt.Application.Interfaces;
using PostIt.Application.Services;
using PostIt.Domain.Entities;

namespace PostIt.UnitTests.Application.Services;

public class NoteServiceTests
{
    private readonly Mock<INoteRepository> _noteRepo = new();
    private readonly Mock<IBoardRepository> _boardRepo = new();
    private readonly Mock<IBoardAuthorizationService> _authSvc = new();
    private readonly Mock<IBoardNotificationService> _notificationSvc = new();
    private readonly NoteService _svc;

    public NoteServiceTests()
    {
        _svc = new NoteService(_noteRepo.Object, _boardRepo.Object, _authSvc.Object, _notificationSvc.Object);
    }

    private static Board CreateBoard(Guid boardId)
    {
        var board = new Board("Test Board", Guid.NewGuid());
        typeof(Board).GetProperty("Id")!.SetValue(board, boardId);
        return board;
    }

    private static Note CreateNote(Guid noteId, Guid boardId, Guid? createdBy)
    {
        var note = new Note(boardId, createdBy, "Hello", "yellow", 10, 20);
        typeof(Note).GetProperty("Id")!.SetValue(note, noteId);
        return note;
    }

    [Fact]
    public async Task GetNotesAsync_ExistingBoardAndMember_ReturnsNotes()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var board = CreateBoard(boardId);
        var note = CreateNote(Guid.NewGuid(), boardId, userId);

        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _authSvc.Setup(a => a.CanReadBoardAsync(userId, boardId, default)).ReturnsAsync(true);
        _noteRepo.Setup(r => r.GetNotesByBoardAsync(boardId, default)).ReturnsAsync(new List<Note> { note });

        var result = await _svc.GetNotesAsync(userId, boardId);

        Assert.Single(result);
        Assert.Equal("Hello", result[0].Content);
        Assert.Equal("yellow", result[0].Color);
    }

    [Fact]
    public async Task GetNotesAsync_MissingBoard_ThrowsKeyNotFoundException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync((Board?)null);

        var ex = await Assert.ThrowsAsync<KeyNotFoundException>(() => _svc.GetNotesAsync(userId, boardId));
        Assert.Contains("Board", ex.Message);
    }

    [Fact]
    public async Task GetNotesAsync_NotMember_ThrowsUnauthorizedAccessException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var board = CreateBoard(boardId);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _authSvc.Setup(a => a.CanReadBoardAsync(userId, boardId, default)).ReturnsAsync(false);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => _svc.GetNotesAsync(userId, boardId));
    }

    [Fact]
    public async Task CreateNoteAsync_Owner_CreatesNote()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var board = CreateBoard(boardId);
        Note? capturedNote = null;

        _authSvc.Setup(a => a.CanCreateNoteAsync(userId, boardId, default)).ReturnsAsync(true);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync(board);
        _noteRepo.Setup(r => r.AddAsync(It.IsAny<Note>(), default))
            .Callback<Note, CancellationToken>((n, _) => capturedNote = n);
        _noteRepo.Setup(r => r.SaveChangesAsync(default)).Returns(Task.CompletedTask);

        var result = await _svc.CreateNoteAsync(userId, boardId, new CreateNoteRequest("Hello", "yellow", 10, 20));

        Assert.NotNull(result);
        Assert.Equal("Hello", result.Content);
        Assert.Equal("yellow", result.Color);
        Assert.Equal(10, result.PositionX);
        Assert.Equal(20, result.PositionY);
        Assert.Equal(userId, result.CreatedBy);
        _noteRepo.Verify(r => r.AddAsync(It.IsAny<Note>(), default), Times.Once);
        _noteRepo.Verify(r => r.SaveChangesAsync(default), Times.Once);
        Assert.NotNull(capturedNote);
        Assert.Equal(boardId, capturedNote!.BoardId);
    }

    [Fact]
    public async Task CreateNoteAsync_NonOwnerNonEditor_ThrowsUnauthorizedAccessException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        _authSvc.Setup(a => a.CanCreateNoteAsync(userId, boardId, default)).ReturnsAsync(false);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => _svc.CreateNoteAsync(userId, boardId, new CreateNoteRequest("Hello", "yellow", 0, 0)));
    }

    [Fact]
    public async Task CreateNoteAsync_MissingBoard_ThrowsKeyNotFoundException()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        _authSvc.Setup(a => a.CanCreateNoteAsync(userId, boardId, default)).ReturnsAsync(true);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync((Board?)null);

        var ex = await Assert.ThrowsAsync<KeyNotFoundException>(() => _svc.CreateNoteAsync(userId, boardId, new CreateNoteRequest("Hello", "yellow", 0, 0)));
        Assert.Contains("Board", ex.Message);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task CreateNoteAsync_EmptyContent_ThrowsArgumentException(string? content)
    {
        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _svc.CreateNoteAsync(Guid.NewGuid(), Guid.NewGuid(), new CreateNoteRequest(content!, "yellow", 0, 0)));
        Assert.Contains("Content", ex.Message);
    }

    [Fact]
    public async Task CreateNoteAsync_ContentTooLong_ThrowsArgumentException()
    {
        var request = new CreateNoteRequest(new string('x', 1001), "yellow", 0, 0);

        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _svc.CreateNoteAsync(Guid.NewGuid(), Guid.NewGuid(), request));
        Assert.Contains("1000", ex.Message);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task CreateNoteAsync_EmptyColor_ThrowsArgumentException(string? color)
    {
        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _svc.CreateNoteAsync(Guid.NewGuid(), Guid.NewGuid(), new CreateNoteRequest("Hello", color!, 0, 0)));
        Assert.Contains("Color", ex.Message);
    }

    [Fact]
    public async Task CreateNoteAsync_ColorTooLong_ThrowsArgumentException()
    {
        var request = new CreateNoteRequest("Hello", new string('x', 51), 0, 0);

        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _svc.CreateNoteAsync(Guid.NewGuid(), Guid.NewGuid(), request));
        Assert.Contains("50", ex.Message);
    }

    [Fact]
    public async Task UpdateNoteAsync_Owner_UpdatesNote()
    {
        var userId = Guid.NewGuid();
        var noteId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var note = CreateNote(noteId, boardId, userId);

        _noteRepo.Setup(r => r.GetByIdAsync(noteId, default)).ReturnsAsync(note);
        _authSvc.Setup(a => a.CanEditNoteAsync(userId, boardId, default)).ReturnsAsync(true);
        _noteRepo.Setup(r => r.SaveChangesAsync(default)).Returns(Task.CompletedTask);

        var result = await _svc.UpdateNoteAsync(userId, noteId, new UpdateNoteRequest("Updated", "blue", 30, 40));

        Assert.Equal("Updated", result.Content);
        Assert.Equal("blue", result.Color);
        Assert.Equal(30, result.PositionX);
        Assert.Equal(40, result.PositionY);
        _noteRepo.Verify(r => r.SaveChangesAsync(default), Times.Once);
    }

    [Fact]
    public async Task UpdateNoteAsync_MissingNote_ThrowsKeyNotFoundException()
    {
        var userId = Guid.NewGuid();
        var noteId = Guid.NewGuid();
        _noteRepo.Setup(r => r.GetByIdAsync(noteId, default)).ReturnsAsync((Note?)null);

        var ex = await Assert.ThrowsAsync<KeyNotFoundException>(() => _svc.UpdateNoteAsync(userId, noteId, new UpdateNoteRequest("Updated", "blue", 0, 0)));
        Assert.Contains("Note", ex.Message);
    }

    [Fact]
    public async Task UpdateNoteAsync_NonOwnerNonEditor_ThrowsUnauthorizedAccessException()
    {
        var userId = Guid.NewGuid();
        var noteId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var note = CreateNote(noteId, boardId, Guid.NewGuid());

        _noteRepo.Setup(r => r.GetByIdAsync(noteId, default)).ReturnsAsync(note);
        _authSvc.Setup(a => a.CanEditNoteAsync(userId, boardId, default)).ReturnsAsync(false);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => _svc.UpdateNoteAsync(userId, noteId, new UpdateNoteRequest("Updated", "blue", 0, 0)));
    }

    [Fact]
    public async Task UpdateNoteAsync_EmptyContent_ThrowsArgumentException()
    {
        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _svc.UpdateNoteAsync(Guid.NewGuid(), Guid.NewGuid(), new UpdateNoteRequest("", "blue", 0, 0)));
        Assert.Contains("Content", ex.Message);
    }

    [Fact]
    public async Task UpdateNoteAsync_ContentTooLong_ThrowsArgumentException()
    {
        var request = new UpdateNoteRequest(new string('x', 1001), "blue", 0, 0);

        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _svc.UpdateNoteAsync(Guid.NewGuid(), Guid.NewGuid(), request));
        Assert.Contains("1000", ex.Message);
    }

    [Fact]
    public async Task UpdateNoteAsync_EmptyColor_ThrowsArgumentException()
    {
        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _svc.UpdateNoteAsync(Guid.NewGuid(), Guid.NewGuid(), new UpdateNoteRequest("Hello", "", 0, 0)));
        Assert.Contains("Color", ex.Message);
    }

    [Fact]
    public async Task UpdateNoteAsync_ColorTooLong_ThrowsArgumentException()
    {
        var request = new UpdateNoteRequest("Hello", new string('x', 51), 0, 0);

        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _svc.UpdateNoteAsync(Guid.NewGuid(), Guid.NewGuid(), request));
        Assert.Contains("50", ex.Message);
    }

    [Fact]
    public async Task DeleteNoteAsync_Owner_DeletesNote()
    {
        var userId = Guid.NewGuid();
        var noteId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var note = CreateNote(noteId, boardId, userId);

        _noteRepo.Setup(r => r.GetByIdAsync(noteId, default)).ReturnsAsync(note);
        _authSvc.Setup(a => a.CanDeleteNoteAsync(userId, boardId, default)).ReturnsAsync(true);
        _noteRepo.Setup(r => r.DeleteAsync(note, default)).Returns(Task.CompletedTask);
        _noteRepo.Setup(r => r.SaveChangesAsync(default)).Returns(Task.CompletedTask);

        await _svc.DeleteNoteAsync(userId, noteId);

        _noteRepo.Verify(r => r.DeleteAsync(note, default), Times.Once);
        _noteRepo.Verify(r => r.SaveChangesAsync(default), Times.Once);
    }

    [Fact]
    public async Task DeleteNoteAsync_MissingNote_ThrowsKeyNotFoundException()
    {
        var userId = Guid.NewGuid();
        var noteId = Guid.NewGuid();
        _noteRepo.Setup(r => r.GetByIdAsync(noteId, default)).ReturnsAsync((Note?)null);

        var ex = await Assert.ThrowsAsync<KeyNotFoundException>(() => _svc.DeleteNoteAsync(userId, noteId));
        Assert.Contains("Note", ex.Message);
    }

    [Fact]
    public async Task DeleteNoteAsync_NonOwnerNonEditor_ThrowsUnauthorizedAccessException()
    {
        var userId = Guid.NewGuid();
        var noteId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var note = CreateNote(noteId, boardId, Guid.NewGuid());

        _noteRepo.Setup(r => r.GetByIdAsync(noteId, default)).ReturnsAsync(note);
        _authSvc.Setup(a => a.CanDeleteNoteAsync(userId, boardId, default)).ReturnsAsync(false);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => _svc.DeleteNoteAsync(userId, noteId));
    }
}
