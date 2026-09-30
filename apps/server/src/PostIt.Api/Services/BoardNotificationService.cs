using System.Diagnostics;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using PostIt.Api.Hubs;
using PostIt.Application.DTOs;
using PostIt.Application.Interfaces;

namespace PostIt.Api.Services;

public class BoardNotificationService : IBoardNotificationService
{
    private readonly IHubContext<BoardHub> _hubContext;
    private readonly ILogger<BoardNotificationService> _logger;

    public BoardNotificationService(IHubContext<BoardHub> hubContext, ILogger<BoardNotificationService> logger)
    {
        _hubContext = hubContext;
        _logger = logger;
    }

    public async Task PostItCreated(Guid boardId, NoteDto note, CancellationToken cancellationToken = default)
    {
        await SendAsync(boardId, "PostItCreated",
            () => _hubContext.Clients.Group(boardId.ToString()).SendAsync("PostItCreated", note, cancellationToken));
    }

    public async Task PostItUpdated(Guid boardId, NoteDto note, CancellationToken cancellationToken = default)
    {
        await SendAsync(boardId, "PostItUpdated",
            () => _hubContext.Clients.Group(boardId.ToString()).SendAsync("PostItUpdated", note, cancellationToken));
    }

    public async Task PostItDeleted(Guid boardId, Guid noteId, CancellationToken cancellationToken = default)
    {
        await SendAsync(boardId, "PostItDeleted",
            () => _hubContext.Clients.Group(boardId.ToString()).SendAsync("PostItDeleted", noteId, cancellationToken));
    }

    private async Task SendAsync(Guid boardId, string eventName, Func<Task> send)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            await send();
            sw.Stop();
            _logger.LogInformation("Broadcast sent | boardId={BoardId} event={Event} durationMs={DurationMs}", boardId, eventName, sw.ElapsedMilliseconds);
        }
        catch (OperationCanceledException)
        {
            // Client aborted the request — normal in realtime apps, not an error.
            throw;
        }
        catch (Exception ex)
        {
            sw.Stop();
            _logger.LogError(ex, "Broadcast failed | boardId={BoardId} event={Event} durationMs={DurationMs}", boardId, eventName, sw.ElapsedMilliseconds);
            throw;
        }
    }
}
