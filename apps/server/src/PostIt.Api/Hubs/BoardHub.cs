using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace PostIt.Api.Hubs;

[Authorize]
public class BoardHub : Hub
{
    public async Task JoinBoard(Guid boardId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, boardId.ToString());
    }

    public async Task LeaveBoard(Guid boardId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, boardId.ToString());
    }
}
