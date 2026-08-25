using System.Net;
using System.Net.Http.Json;
using PostIt.Application.DTOs;

namespace PostIt.IntegrationTests;

public class NoteEndpointsTests : IClassFixture<TestWebApplicationFactory>
{
    private readonly TestWebApplicationFactory _factory;
    private readonly HttpClient _client;

    public NoteEndpointsTests(TestWebApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task GetNotes_ExistingBoardAndMember_ReturnsNotes()
    {
        var token = await RegisterAndLoginAsync("get-notes@example.com", "Password123!", "Get Notes");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var boardResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Notes Board"));
        Assert.Equal(HttpStatusCode.OK, boardResponse.StatusCode);
        var board = await boardResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(board);

        var createNoteResponse = await _client.PostAsJsonAsync($"/api/boards/{board.Id}/notes", new CreateNoteRequest("Hello", "yellow", 10, 20));
        Assert.Equal(HttpStatusCode.OK, createNoteResponse.StatusCode);

        var response = await _client.GetAsync($"/api/boards/{board.Id}/notes");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<List<NoteDto>>();
        Assert.NotNull(result);
        Assert.Single(result);
        Assert.Equal("Hello", result[0].Content);
        Assert.Equal("yellow", result[0].Color);
        Assert.Equal(10, result[0].PositionX);
        Assert.Equal(20, result[0].PositionY);
    }

    [Fact]
    public async Task GetNotes_NonExistingBoard_ReturnsNotFound()
    {
        var token = await RegisterAndLoginAsync("get-notes-404@example.com", "Password123!", "Get Notes 404");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var response = await _client.GetAsync($"/api/boards/{Guid.NewGuid()}/notes");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetNotes_NotMember_ReturnsForbidden()
    {
        var ownerToken = await RegisterAndLoginAsync("get-notes-owner@example.com", "Password123!", "Owner");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ownerToken);

        var boardResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Private Board"));
        var board = await boardResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(board);

        var otherToken = await RegisterAndLoginAsync("get-notes-other@example.com", "Password123!", "Other");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", otherToken);

        var response = await _client.GetAsync($"/api/boards/{board.Id}/notes");
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task GetNotes_WithoutToken_ReturnsUnauthorized()
    {
        _client.DefaultRequestHeaders.Authorization = null;
        var response = await _client.GetAsync($"/api/boards/{Guid.NewGuid()}/notes");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task CreateNote_Owner_ReturnsNoteDto()
    {
        var token = await RegisterAndLoginAsync("create-note@example.com", "Password123!", "Create Note");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var boardResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Notes Board"));
        var board = await boardResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(board);

        var request = new CreateNoteRequest("Hello", "yellow", 10, 20);
        var response = await _client.PostAsJsonAsync($"/api/boards/{board.Id}/notes", request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<NoteDto>();
        Assert.NotNull(result);
        Assert.Equal("Hello", result.Content);
        Assert.Equal("yellow", result.Color);
        Assert.Equal(10, result.PositionX);
        Assert.Equal(20, result.PositionY);
        Assert.NotEqual(Guid.Empty, result.Id);
    }

    [Fact]
    public async Task CreateNote_InvalidContent_ReturnsBadRequest()
    {
        var token = await RegisterAndLoginAsync("create-note-invalid@example.com", "Password123!", "Create Note Invalid");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var boardResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Notes Board"));
        var board = await boardResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(board);

        var request = new CreateNoteRequest("", "yellow", 0, 0);
        var response = await _client.PostAsJsonAsync($"/api/boards/{board.Id}/notes", request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateNote_NonExistingBoard_ReturnsNotFound()
    {
        var token = await RegisterAndLoginAsync("create-note-404@example.com", "Password123!", "Create Note 404");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var request = new CreateNoteRequest("Hello", "yellow", 0, 0);
        var response = await _client.PostAsJsonAsync($"/api/boards/{Guid.NewGuid()}/notes", request);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task CreateNote_WithoutToken_ReturnsUnauthorized()
    {
        _client.DefaultRequestHeaders.Authorization = null;
        var request = new CreateNoteRequest("Hello", "yellow", 0, 0);
        var response = await _client.PostAsJsonAsync($"/api/boards/{Guid.NewGuid()}/notes", request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task UpdateNote_Owner_ReturnsUpdatedNote()
    {
        var token = await RegisterAndLoginAsync("update-note@example.com", "Password123!", "Update Note");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var boardResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Notes Board"));
        var board = await boardResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(board);

        var createResponse = await _client.PostAsJsonAsync($"/api/boards/{board.Id}/notes", new CreateNoteRequest("Hello", "yellow", 10, 20));
        var created = await createResponse.Content.ReadFromJsonAsync<NoteDto>();
        Assert.NotNull(created);

        var response = await _client.PutAsJsonAsync($"/api/notes/{created.Id}", new UpdateNoteRequest("Updated", "blue", 30, 40));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<NoteDto>();
        Assert.NotNull(result);
        Assert.Equal("Updated", result.Content);
        Assert.Equal("blue", result.Color);
        Assert.Equal(30, result.PositionX);
        Assert.Equal(40, result.PositionY);
    }

    [Fact]
    public async Task UpdateNote_NonExisting_ReturnsNotFound()
    {
        var token = await RegisterAndLoginAsync("update-note-404@example.com", "Password123!", "Update Note 404");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var response = await _client.PutAsJsonAsync($"/api/notes/{Guid.NewGuid()}", new UpdateNoteRequest("Updated", "blue", 0, 0));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task UpdateNote_InvalidContent_ReturnsBadRequest()
    {
        var token = await RegisterAndLoginAsync("update-note-invalid@example.com", "Password123!", "Update Note Invalid");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var boardResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Notes Board"));
        var board = await boardResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(board);

        var createResponse = await _client.PostAsJsonAsync($"/api/boards/{board.Id}/notes", new CreateNoteRequest("Hello", "yellow", 0, 0));
        var created = await createResponse.Content.ReadFromJsonAsync<NoteDto>();
        Assert.NotNull(created);

        var response = await _client.PutAsJsonAsync($"/api/notes/{created.Id}", new UpdateNoteRequest("", "blue", 0, 0));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateNote_WithoutToken_ReturnsUnauthorized()
    {
        _client.DefaultRequestHeaders.Authorization = null;
        var response = await _client.PutAsJsonAsync($"/api/notes/{Guid.NewGuid()}", new UpdateNoteRequest("Updated", "blue", 0, 0));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task DeleteNote_Owner_ReturnsNoContent()
    {
        var token = await RegisterAndLoginAsync("delete-note@example.com", "Password123!", "Delete Note");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var boardResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Notes Board"));
        var board = await boardResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(board);

        var createResponse = await _client.PostAsJsonAsync($"/api/boards/{board.Id}/notes", new CreateNoteRequest("Hello", "yellow", 0, 0));
        var created = await createResponse.Content.ReadFromJsonAsync<NoteDto>();
        Assert.NotNull(created);

        var response = await _client.DeleteAsync($"/api/notes/{created.Id}");
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        var getResponse = await _client.GetAsync($"/api/boards/{board.Id}/notes");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        var notes = await getResponse.Content.ReadFromJsonAsync<List<NoteDto>>();
        Assert.NotNull(notes);
        Assert.Empty(notes);
    }

    [Fact]
    public async Task DeleteNote_NonExisting_ReturnsNotFound()
    {
        var token = await RegisterAndLoginAsync("delete-note-404@example.com", "Password123!", "Delete Note 404");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var response = await _client.DeleteAsync($"/api/notes/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task DeleteNote_WithoutToken_ReturnsUnauthorized()
    {
        _client.DefaultRequestHeaders.Authorization = null;
        var response = await _client.DeleteAsync($"/api/notes/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
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
}
