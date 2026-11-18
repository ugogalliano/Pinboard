namespace PostIt.Api.Hubs;

/// <summary>
/// Single source of truth for SignalR group names so the hub and the
/// notification service cannot drift apart.
/// </summary>
internal static class BoardGroup
{
    public static string Name(Guid boardId) => $"board:{boardId}";
}
