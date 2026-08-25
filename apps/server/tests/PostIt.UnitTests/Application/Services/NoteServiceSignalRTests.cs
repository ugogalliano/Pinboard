using Moq;
using PostIt.Application.DTOs;
using PostIt.Application.Interfaces;
using PostIt.Application.Services;
using PostIt.Domain.Entities;

namespace PostIt.UnitTests.Application.Services;

public class NoteServiceSignalRTests
{
    private readonly Mock<INoteRepository> _noteRepo = new();
    private readonly Mock<IBoardRepository> _boardRepo = new();
    private readonly Mock<IBoardAuthorizationService> _authSvc = new();
    private readonly Mock<IBoardNotificationService> _notificationSvc = new();
    private readonly NoteService _svc;

    public NoteServiceSignalRTests()
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
    public async Task CreateNoteAsync_Success_SendsPostItCreatedNotification()
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

        _notificationSvc.Verify(n => n.PostItCreated(boardId, result, default), Times.Once);
    }

    [Fact]
    public async Task CreateNoteAsync_Unauthorized_DoesNotSendNotification()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        _authSvc.Setup(a => a.CanCreateNoteAsync(userId, boardId, default)).ReturnsAsync(false);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => _svc.CreateNoteAsync(userId, boardId, new CreateNoteRequest("Hello", "yellow", 0, 0)));

        _notificationSvc.Verify(n => n.PostItCreated(It.IsAny<Guid>(), It.IsAny<NoteDto>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task CreateNoteAsync_MissingBoard_DoesNotSendNotification()
    {
        var userId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        _authSvc.Setup(a => a.CanCreateNoteAsync(userId, boardId, default)).ReturnsAsync(true);
        _boardRepo.Setup(r => r.GetByIdAsync(boardId, default)).ReturnsAsync((Board?)null);

        await Assert.ThrowsAsync<KeyNotFoundException>(() => _svc.CreateNoteAsync(userId, boardId, new CreateNoteRequest("Hello", "yellow", 0, 0)));

        _notificationSvc.Verify(n => n.PostItCreated(It.IsAny<Guid>(), It.IsAny<NoteDto>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task UpdateNoteAsync_Success_SendsPostItUpdatedNotification()
    {
        var userId = Guid.NewGuid();
        var noteId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var note = CreateNote(noteId, boardId, userId);

        _noteRepo.Setup(r => r.GetByIdAsync(noteId, default)).ReturnsAsync(note);
        _authSvc.Setup(a => a.CanEditNoteAsync(userId, boardId, default)).ReturnsAsync(true);
        _noteRepo.Setup(r => r.SaveChangesAsync(default)).Returns(Task.CompletedTask);

        var result = await _svc.UpdateNoteAsync(userId, noteId, new UpdateNoteRequest("Updated", "blue", 30, 40));

        _notificationSvc.Verify(n => n.PostItUpdated(boardId, result, default), Times.Once);
    }

    [Fact]
    public async Task UpdateNoteAsync_Unauthorized_DoesNotSendNotification()
    {
        var userId = Guid.NewGuid();
        var noteId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var note = CreateNote(noteId, boardId, Guid.NewGuid());

        _noteRepo.Setup(r => r.GetByIdAsync(noteId, default)).ReturnsAsync(note);
        _authSvc.Setup(a => a.CanEditNoteAsync(userId, boardId, default)).ReturnsAsync(false);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => _svc.UpdateNoteAsync(userId, noteId, new UpdateNoteRequest("Updated", "blue", 0, 0)));

        _notificationSvc.Verify(n => n.PostItUpdated(It.IsAny<Guid>(), It.IsAny<NoteDto>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task UpdateNoteAsync_MissingNote_DoesNotSendNotification()
    {
        var userId = Guid.NewGuid();
        var noteId = Guid.NewGuid();
        _noteRepo.Setup(r => r.GetByIdAsync(noteId, default)).ReturnsAsync((Note?)null);

        await Assert.ThrowsAsync<KeyNotFoundException>(() => _svc.UpdateNoteAsync(userId, noteId, new UpdateNoteRequest("Updated", "blue", 0, 0)));

        _notificationSvc.Verify(n => n.PostItUpdated(It.IsAny<Guid>(), It.IsAny<NoteDto>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task DeleteNoteAsync_Success_SendsPostItDeletedNotification()
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

        _notificationSvc.Verify(n => n.PostItDeleted(boardId, noteId, default), Times.Once);
    }

    [Fact]
    public async Task DeleteNoteAsync_Unauthorized_DoesNotSendNotification()
    {
        var userId = Guid.NewGuid();
        var noteId = Guid.NewGuid();
        var boardId = Guid.NewGuid();
        var note = CreateNote(noteId, boardId, Guid.NewGuid());

        _noteRepo.Setup(r => r.GetByIdAsync(noteId, default)).ReturnsAsync(note);
        _authSvc.Setup(a => a.CanDeleteNoteAsync(userId, boardId, default)).ReturnsAsync(false);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => _svc.DeleteNoteAsync(userId, noteId));

        _notificationSvc.Verify(n => n.PostItDeleted(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task DeleteNoteAsync_MissingNote_DoesNotSendNotification()
    {
        var userId = Guid.NewGuid();
        var noteId = Guid.NewGuid();
        _noteRepo.Setup(r => r.GetByIdAsync(noteId, default)).ReturnsAsync((Note?)null);

        await Assert.ThrowsAsync<KeyNotFoundException>(() => _svc.DeleteNoteAsync(userId, noteId));

        _notificationSvc.Verify(n => n.PostItDeleted(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
