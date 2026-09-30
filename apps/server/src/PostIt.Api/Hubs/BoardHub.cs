using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;

namespace PostIt.Api.Hubs;

[Authorize]
public class BoardHub : Hub
{
    private readonly ILogger<BoardHub> _logger;

    public BoardHub(ILogger<BoardHub> logger)
    {
        _logger = logger;
    }

    public async Task JoinBoard(Guid boardId)
    {
        var userId = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? Context.User?.FindFirst("sub")?.Value;

        await Groups.AddToGroupAsync(Context.ConnectionId, boardId.ToString());

        _logger.LogInformation("Hub joined | connectionId={ConnectionId} boardId={BoardId} userId={UserId}", Context.ConnectionId, boardId, userId);
    }

    public async Task LeaveBoard(Guid boardId)
    {
        var userId = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? Context.User?.FindFirst("sub")?.Value;

        await Groups.RemoveFromGroupAsync(Context.ConnectionId, boardId.ToString());

        _logger.LogInformation("Hub left | connectionId={ConnectionId} boardId={BoardId} userId={UserId}", Context.ConnectionId, boardId, userId);
    }
}
