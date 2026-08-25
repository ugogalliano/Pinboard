using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using PostIt.Application.DTOs;

namespace PostIt.IntegrationTests;

public class BoardEndpointsTests : IClassFixture<TestWebApplicationFactory>
{
    private readonly TestWebApplicationFactory _factory;
    private readonly HttpClient _client;

    public BoardEndpointsTests(TestWebApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task CreateBoard_ValidInput_ReturnsBoardDto()
    {
        var token = await RegisterAndLoginAsync("create-board@example.com", "Password123!", "Create Board");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var request = new CreateBoardRequest("My New Board");
        var response = await _client.PostAsJsonAsync("/api/boards", request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(result);
        Assert.Equal("My New Board", result.Name);
        Assert.NotEqual(Guid.Empty, result.Id);
    }

    [Fact]
    public async Task CreateBoard_InvalidName_ReturnsBadRequest()
    {
        var token = await RegisterAndLoginAsync("create-board-invalid@example.com", "Password123!", "Create Board Invalid");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var request = new CreateBoardRequest("");
        var response = await _client.PostAsJsonAsync("/api/boards", request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateBoard_WithoutToken_ReturnsUnauthorized()
    {
        _client.DefaultRequestHeaders.Authorization = null;
        var request = new CreateBoardRequest("My Board");
        var response = await _client.PostAsJsonAsync("/api/boards", request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task GetBoards_ReturnsOnlyUserBoards()
    {
        var token = await RegisterAndLoginAsync("get-boards@example.com", "Password123!", "Get Boards");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board A"));
        Assert.Equal(HttpStatusCode.OK, createResponse.StatusCode);

        var response = await _client.GetAsync("/api/boards");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<List<BoardDto>>();
        Assert.NotNull(result);
        Assert.Single(result);
        Assert.Equal("Board A", result[0].Name);
    }

    [Fact]
    public async Task GetBoards_WithoutToken_ReturnsUnauthorized()
    {
        _client.DefaultRequestHeaders.Authorization = null;
        var response = await _client.GetAsync("/api/boards");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task GetBoard_ExistingAndMember_ReturnsBoard()
    {
        var token = await RegisterAndLoginAsync("get-board@example.com", "Password123!", "Get Board");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board To Get"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        var response = await _client.GetAsync($"/api/boards/{created.Id}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(result);
        Assert.Equal(created.Id, result.Id);
        Assert.Equal("Board To Get", result.Name);
    }

    [Fact]
    public async Task GetBoard_NonExisting_ReturnsNotFound()
    {
        var token = await RegisterAndLoginAsync("get-board-404@example.com", "Password123!", "Get Board 404");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var response = await _client.GetAsync($"/api/boards/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetBoard_NotMember_ReturnsForbidden()
    {
        var ownerToken = await RegisterAndLoginAsync("get-board-owner@example.com", "Password123!", "Owner");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ownerToken);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Private Board"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        var otherToken = await RegisterAndLoginAsync("get-board-other@example.com", "Password123!", "Other");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", otherToken);

        var response = await _client.GetAsync($"/api/boards/{created.Id}");
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task UpdateBoard_Owner_ReturnsUpdatedBoard()
    {
        var token = await RegisterAndLoginAsync("update-board@example.com", "Password123!", "Update Board");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Old Name"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        var response = await _client.PutAsJsonAsync($"/api/boards/{created.Id}", new UpdateBoardRequest("New Name"));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(result);
        Assert.Equal("New Name", result.Name);
    }

    [Fact]
    public async Task UpdateBoard_NonOwner_ReturnsForbidden()
    {
        var ownerToken = await RegisterAndLoginAsync("update-owner@example.com", "Password123!", "Owner");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ownerToken);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        var otherToken = await RegisterAndLoginAsync("update-other@example.com", "Password123!", "Other");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", otherToken);

        var response = await _client.PutAsJsonAsync($"/api/boards/{created.Id}", new UpdateBoardRequest("Hacked"));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task UpdateBoard_NonExisting_ReturnsNotFound()
    {
        var token = await RegisterAndLoginAsync("update-404@example.com", "Password123!", "Update 404");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var response = await _client.PutAsJsonAsync($"/api/boards/{Guid.NewGuid()}", new UpdateBoardRequest("New"));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task DeleteBoard_Owner_ReturnsNoContent()
    {
        var token = await RegisterAndLoginAsync("delete-board@example.com", "Password123!", "Delete Board");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board To Delete"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        var response = await _client.DeleteAsync($"/api/boards/{created.Id}");
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        var getResponse = await _client.GetAsync($"/api/boards/{created.Id}");
        Assert.Equal(HttpStatusCode.NotFound, getResponse.StatusCode);
    }

    [Fact]
    public async Task DeleteBoard_NonOwner_ReturnsForbidden()
    {
        var ownerToken = await RegisterAndLoginAsync("delete-owner@example.com", "Password123!", "Owner");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ownerToken);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        var otherToken = await RegisterAndLoginAsync("delete-other@example.com", "Password123!", "Other");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", otherToken);

        var response = await _client.DeleteAsync($"/api/boards/{created.Id}");
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task DeleteBoard_NonExisting_ReturnsNotFound()
    {
        var token = await RegisterAndLoginAsync("delete-404@example.com", "Password123!", "Delete 404");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var response = await _client.DeleteAsync($"/api/boards/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
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
