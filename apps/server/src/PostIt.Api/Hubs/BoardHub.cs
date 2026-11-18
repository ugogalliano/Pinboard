using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using PostIt.Application.Interfaces;

namespace PostIt.Api.Hubs;

[Authorize]
public class BoardHub : Hub
{
    private readonly ILogger<BoardHub> _logger;
    private readonly IBoardAuthorizationService _authorizationService;

    public BoardHub(ILogger<BoardHub> logger, IBoardAuthorizationService authorizationService)
    {
        _logger = logger;
        _authorizationService = authorizationService;
    }

    public async Task JoinBoard(Guid boardId)
    {
        var userId = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? Context.User?.FindFirst("sub")?.Value;
        if (userId == null || !Guid.TryParse(userId, out var parsedUserId))
        {
            _logger.LogWarning("Authorization denied | connectionId={ConnectionId} boardId={BoardId} operation=JoinBoard reason=InvalidIdentity", Context.ConnectionId, boardId);
            throw new HubException("The caller identity is invalid.");
        }

        // Denials are logged (WARNING "Authorization denied") inside BoardAuthorizationService.
        if (!await _authorizationService.CanReadBoardAsync(parsedUserId, boardId, Context.ConnectionAborted))
        {
            throw new HubException("You are not a member of this board.");
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, BoardGroup.Name(boardId));

        _logger.LogInformation("Hub joined | connectionId={ConnectionId} boardId={BoardId} userId={UserId}", Context.ConnectionId, boardId, userId);
    }

    public async Task LeaveBoard(Guid boardId)
    {
        var userId = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? Context.User?.FindFirst("sub")?.Value;

        await Groups.RemoveFromGroupAsync(Context.ConnectionId, BoardGroup.Name(boardId));

        _logger.LogInformation("Hub left | connectionId={ConnectionId} boardId={BoardId} userId={UserId}", Context.ConnectionId, boardId, userId);
    }
}
