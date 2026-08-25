using Microsoft.AspNetCore.SignalR;
using PostIt.Api.Hubs;
using PostIt.Application.DTOs;
using PostIt.Application.Interfaces;

namespace PostIt.Api.Services;

public class BoardNotificationService : IBoardNotificationService
{
    private readonly IHubContext<BoardHub> _hubContext;

    public BoardNotificationService(IHubContext<BoardHub> hubContext)
    {
        _hubContext = hubContext;
    }

    public async Task PostItCreated(Guid boardId, NoteDto note, CancellationToken cancellationToken = default)
    {
        await _hubContext.Clients.Group(boardId.ToString())
            .SendAsync("PostItCreated", note, cancellationToken);
    }

    public async Task PostItUpdated(Guid boardId, NoteDto note, CancellationToken cancellationToken = default)
    {
        await _hubContext.Clients.Group(boardId.ToString())
            .SendAsync("PostItUpdated", note, cancellationToken);
    }

    public async Task PostItDeleted(Guid boardId, Guid noteId, CancellationToken cancellationToken = default)
    {
        await _hubContext.Clients.Group(boardId.ToString())
            .SendAsync("PostItDeleted", noteId, cancellationToken);
    }
}
