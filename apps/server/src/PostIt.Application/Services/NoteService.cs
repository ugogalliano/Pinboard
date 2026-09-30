using Microsoft.Extensions.Logging;
using PostIt.Application.DTOs;
using PostIt.Application.Interfaces;
using PostIt.Domain.Entities;

namespace PostIt.Application.Services;

public class NoteService : INoteService
{
    private readonly INoteRepository _noteRepository;
    private readonly IBoardRepository _boardRepository;
    private readonly IBoardAuthorizationService _authorizationService;
    private readonly IBoardNotificationService _notificationService;
    private readonly ILogger<NoteService> _logger;

    public NoteService(
        INoteRepository noteRepository,
        IBoardRepository boardRepository,
        IBoardAuthorizationService authorizationService,
        IBoardNotificationService notificationService,
        ILogger<NoteService> logger)
    {
        _noteRepository = noteRepository;
        _boardRepository = boardRepository;
        _authorizationService = authorizationService;
        _notificationService = notificationService;
        _logger = logger;
    }

    public async Task<IReadOnlyList<NoteDto>> GetNotesAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
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

        var notes = await _noteRepository.GetNotesByBoardAsync(boardId, cancellationToken);
        return notes.Select(MapToDto).ToList();
    }

    public async Task<NoteDto> CreateNoteAsync(Guid userId, Guid boardId, CreateNoteRequest request, CancellationToken cancellationToken = default)
    {
        ValidateContent(request.Content);
        ValidateColor(request.Color);

        _logger.LogInformation("Validation completed");

        if (!await _authorizationService.CanCreateNoteAsync(userId, boardId, cancellationToken))
        {
            throw new UnauthorizedAccessException("Only Owner or Editor can create notes.");
        }

        var board = await _boardRepository.GetByIdAsync(boardId, cancellationToken);
        if (board == null)
        {
            throw new KeyNotFoundException($"Board with id {boardId} not found.");
        }

        var note = new Note(boardId, userId, request.Content, request.Color, request.PositionX, request.PositionY);
        await _noteRepository.AddAsync(note, cancellationToken);
        await _noteRepository.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Note created | noteId={NoteId} boardId={BoardId}", note.Id, boardId);

        var noteDto = MapToDto(note);
        await _notificationService.PostItCreated(boardId, noteDto, cancellationToken);

        return noteDto;
    }

    public async Task<NoteDto> UpdateNoteAsync(Guid userId, Guid noteId, UpdateNoteRequest request, CancellationToken cancellationToken = default)
    {
        ValidateContent(request.Content);
        ValidateColor(request.Color);

        _logger.LogInformation("Validation completed");

        var note = await _noteRepository.GetByIdAsync(noteId, cancellationToken);
        if (note == null)
        {
            throw new KeyNotFoundException($"Note with id {noteId} not found.");
        }

        if (!await _authorizationService.CanEditNoteAsync(userId, note.BoardId, cancellationToken))
        {
            throw new UnauthorizedAccessException("Only Owner or Editor can update notes.");
        }

        note.UpdateContent(request.Content);
        note.UpdateColor(request.Color);
        note.UpdatePosition(request.PositionX, request.PositionY);
        await _noteRepository.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Note updated | noteId={NoteId} boardId={BoardId}", note.Id, note.BoardId);

        var noteDto = MapToDto(note);
        await _notificationService.PostItUpdated(note.BoardId, noteDto, cancellationToken);

        return noteDto;
    }

    public async Task DeleteNoteAsync(Guid userId, Guid noteId, CancellationToken cancellationToken = default)
    {
        var note = await _noteRepository.GetByIdAsync(noteId, cancellationToken);
        if (note == null)
        {
            throw new KeyNotFoundException($"Note with id {noteId} not found.");
        }

        if (!await _authorizationService.CanDeleteNoteAsync(userId, note.BoardId, cancellationToken))
        {
            throw new UnauthorizedAccessException("Only Owner or Editor can delete notes.");
        }

        await _noteRepository.DeleteAsync(note, cancellationToken);
        await _noteRepository.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Note deleted | noteId={NoteId} boardId={BoardId}", noteId, note.BoardId);

        await _notificationService.PostItDeleted(note.BoardId, noteId, cancellationToken);
    }

    private static void ValidateContent(string content)
    {
        if (string.IsNullOrWhiteSpace(content))
        {
            throw new ArgumentException("Content is required.", nameof(content));
        }

        if (content.Length > 1000)
        {
            throw new ArgumentException("Content must not exceed 1000 characters.", nameof(content));
        }
    }

    private static void ValidateColor(string color)
    {
        if (string.IsNullOrWhiteSpace(color))
        {
            throw new ArgumentException("Color is required.", nameof(color));
        }

        if (color.Length > 50)
        {
            throw new ArgumentException("Color must not exceed 50 characters.", nameof(color));
        }
    }

    private static NoteDto MapToDto(Note note)
    {
        return new NoteDto(
            note.Id,
            note.BoardId,
            note.CreatedBy,
            note.Content,
            note.Color,
            note.PositionX,
            note.PositionY,
            note.CreatedAt,
            note.UpdatedAt);
    }
}
