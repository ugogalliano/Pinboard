using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.SignalR.Client;
using PostIt.Application.DTOs;

namespace PostIt.IntegrationTests;

public class SignalRTests : IClassFixture<TestWebApplicationFactory>
{
    private readonly TestWebApplicationFactory _factory;
    private readonly HttpClient _client;

    public SignalRTests(TestWebApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task Connect_WithValidToken_Succeeds()
    {
        var token = await RegisterAndLoginAsync("signalr-connect@example.com", "Password123!", "SignalR Connect");
        var connection = CreateHubConnection(token);

        await connection.StartAsync();

        Assert.Equal(HubConnectionState.Connected, connection.State);
        await connection.StopAsync();
    }

    [Fact]
    public async Task Connect_WithoutToken_ThrowsException()
    {
        var connection = CreateHubConnection(null);

        var ex = await Assert.ThrowsAsync<HttpRequestException>(() => connection.StartAsync());
        Assert.Contains("401", ex.Message);
    }

    [Fact]
    public async Task JoinBoard_AddsConnectionToGroup()
    {
        var token = await RegisterAndLoginAsync("signalr-join@example.com", "Password123!", "SignalR Join");
        var board = await CreateBoardAsync(token, "SignalR Board");
        var connection = CreateHubConnection(token);

        await connection.StartAsync();
        await connection.InvokeAsync("JoinBoard", board.Id);

        // If JoinBoard didn't throw, the connection was added to the group successfully
        Assert.Equal(HubConnectionState.Connected, connection.State);
        await connection.StopAsync();
    }

    [Fact]
    public async Task ReceiveNotification_WhenNoteCreated()
    {
        var token = await RegisterAndLoginAsync("signalr-create@example.com", "Password123!", "SignalR Create");
        var board = await CreateBoardAsync(token, "SignalR Create Board");
        var connection = CreateHubConnection(token);

        var tcs = new TaskCompletionSource<NoteDto>();
        connection.On<NoteDto>("PostItCreated", note => tcs.TrySetResult(note));

        await connection.StartAsync();
        await connection.InvokeAsync("JoinBoard", board.Id);

        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        var response = await _client.PostAsJsonAsync($"/api/boards/{board.Id}/notes", new CreateNoteRequest("Hello SignalR", "yellow", 10, 20));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var result = await tcs.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.NotNull(result);
        Assert.Equal("Hello SignalR", result.Content);
        Assert.Equal("yellow", result.Color);

        await connection.StopAsync();
    }

    [Fact]
    public async Task ReceiveNotification_WhenNoteUpdated()
    {
        var token = await RegisterAndLoginAsync("signalr-update@example.com", "Password123!", "SignalR Update");
        var board = await CreateBoardAsync(token, "SignalR Update Board");
        var connection = CreateHubConnection(token);

        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        var createResponse = await _client.PostAsJsonAsync($"/api/boards/{board.Id}/notes", new CreateNoteRequest("Hello", "yellow", 10, 20));
        var created = await createResponse.Content.ReadFromJsonAsync<NoteDto>();
        Assert.NotNull(created);

        var tcs = new TaskCompletionSource<NoteDto>();
        connection.On<NoteDto>("PostItUpdated", note => tcs.TrySetResult(note));

        await connection.StartAsync();
        await connection.InvokeAsync("JoinBoard", board.Id);

        var response = await _client.PutAsJsonAsync($"/api/notes/{created.Id}", new UpdateNoteRequest("Updated", "blue", 30, 40));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var result = await tcs.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.NotNull(result);
        Assert.Equal("Updated", result.Content);
        Assert.Equal("blue", result.Color);

        await connection.StopAsync();
    }

    [Fact]
    public async Task ReceiveNotification_WhenNoteDeleted()
    {
        var token = await RegisterAndLoginAsync("signalr-delete@example.com", "Password123!", "SignalR Delete");
        var board = await CreateBoardAsync(token, "SignalR Delete Board");
        var connection = CreateHubConnection(token);

        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        var createResponse = await _client.PostAsJsonAsync($"/api/boards/{board.Id}/notes", new CreateNoteRequest("Hello", "yellow", 10, 20));
        var created = await createResponse.Content.ReadFromJsonAsync<NoteDto>();
        Assert.NotNull(created);

        var tcs = new TaskCompletionSource<Guid>();
        connection.On<Guid>("PostItDeleted", noteId => tcs.TrySetResult(noteId));

        await connection.StartAsync();
        await connection.InvokeAsync("JoinBoard", board.Id);

        var response = await _client.DeleteAsync($"/api/notes/{created.Id}");
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        var result = await tcs.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(created.Id, result);

        await connection.StopAsync();
    }

    private HubConnection CreateHubConnection(string? token)
    {
        var url = new Uri(_factory.Server.BaseAddress, "/hubs/board").ToString();
        var builder = new HubConnectionBuilder()
            .WithUrl(url, options =>
            {
                options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                if (!string.IsNullOrEmpty(token))
                {
                    options.AccessTokenProvider = () => Task.FromResult(token)!;
                }
            });

        return builder.Build();
    }

    private async Task<string> RegisterAndLoginAsync(string email, string password, string displayName)
    {
        var registerReq = new RegisterRequest(email, password, displayName);
        var registerResp = await _client.PostAsJsonAsync("/api/auth/register", registerReq);
        registerResp.EnsureSuccessStatusCode();
        var registerResult = await registerResp.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(registerResult);
        return registerResult.AccessToken;
    }

    private async Task<BoardDto> CreateBoardAsync(string token, string name)
    {
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        var response = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest(name));
        response.EnsureSuccessStatusCode();
        var board = await response.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(board);
        return board;
    }
}
