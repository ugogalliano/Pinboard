using System.Net;
using System.Net.Http.Json;
using PostIt.Application.DTOs;

namespace PostIt.IntegrationTests;

public class BoardMemberEndpointsTests : IClassFixture<TestWebApplicationFactory>
{
    private readonly TestWebApplicationFactory _factory;
    private readonly HttpClient _client;

    public BoardMemberEndpointsTests(TestWebApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task GetMembers_ExistingBoardAndMember_ReturnsMembers()
    {
        var token = await RegisterAndLoginAsync("get-members@example.com", "Password123!", "Get Members");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board With Members"));
        Assert.Equal(HttpStatusCode.OK, createResponse.StatusCode);
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        var response = await _client.GetAsync($"/api/boards/{created.Id}/members");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<List<BoardMemberDto>>();
        Assert.NotNull(result);
        Assert.Single(result);
        Assert.Equal("Get Members", result[0].DisplayName);
        Assert.Equal("Owner", result[0].Role);
    }

    [Fact]
    public async Task GetMembers_MissingBoard_ReturnsNotFound()
    {
        var token = await RegisterAndLoginAsync("get-members-404@example.com", "Password123!", "Get Members 404");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var response = await _client.GetAsync($"/api/boards/{Guid.NewGuid()}/members");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task GetMembers_NotMember_ReturnsForbidden()
    {
        var ownerToken = await RegisterAndLoginAsync("get-members-owner@example.com", "Password123!", "Owner");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ownerToken);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Private Board"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        var otherToken = await RegisterAndLoginAsync("get-members-other@example.com", "Password123!", "Other");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", otherToken);

        var response = await _client.GetAsync($"/api/boards/{created.Id}/members");
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task AddMember_Owner_AddsMember()
    {
        var ownerToken = await RegisterAndLoginAsync("add-member-owner@example.com", "Password123!", "Owner");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ownerToken);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board To Share"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        await RegisterAndLoginAsync("add-member-target@example.com", "Password123!", "Target");

        var response = await _client.PostAsJsonAsync($"/api/boards/{created.Id}/members", new AddMemberRequest("add-member-target@example.com", "Editor"));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<BoardMemberDto>();
        Assert.NotNull(result);
        Assert.Equal("add-member-target@example.com", result.Email);
        Assert.Equal("Target", result.DisplayName);
        Assert.Equal("Editor", result.Role);
    }

    [Fact]
    public async Task AddMember_NonOwner_ReturnsForbidden()
    {
        var ownerToken = await RegisterAndLoginAsync("add-member-non-owner-o@example.com", "Password123!", "Owner");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ownerToken);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        var otherToken = await RegisterAndLoginAsync("add-member-non-owner@example.com", "Password123!", "Other");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", otherToken);

        var response = await _client.PostAsJsonAsync($"/api/boards/{created.Id}/members", new AddMemberRequest("x@y.com", "Editor"));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task AddMember_MissingUser_ReturnsNotFound()
    {
        var token = await RegisterAndLoginAsync("add-member-missing@example.com", "Password123!", "Add Member Missing");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        var response = await _client.PostAsJsonAsync($"/api/boards/{created.Id}/members", new AddMemberRequest("nonexistent@example.com", "Editor"));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task AddMember_AlreadyMember_ReturnsConflict()
    {
        var ownerToken = await RegisterAndLoginAsync("add-member-dup-owner@example.com", "Password123!", "Owner");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ownerToken);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        await RegisterAndLoginAsync("add-member-dup-target@example.com", "Password123!", "Target");

        var firstResponse = await _client.PostAsJsonAsync($"/api/boards/{created.Id}/members", new AddMemberRequest("add-member-dup-target@example.com", "Editor"));
        Assert.Equal(HttpStatusCode.OK, firstResponse.StatusCode);

        var secondResponse = await _client.PostAsJsonAsync($"/api/boards/{created.Id}/members", new AddMemberRequest("add-member-dup-target@example.com", "Viewer"));
        Assert.Equal(HttpStatusCode.Conflict, secondResponse.StatusCode);
    }

    [Fact]
    public async Task AddMember_InvalidRole_ReturnsBadRequest()
    {
        var token = await RegisterAndLoginAsync("add-member-invalid@example.com", "Password123!", "Add Member Invalid");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        var response = await _client.PostAsJsonAsync($"/api/boards/{created.Id}/members", new AddMemberRequest("x@y.com", "Owner"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateMember_Owner_UpdatesRole()
    {
        var ownerToken = await RegisterAndLoginAsync("update-member-owner@example.com", "Password123!", "Owner");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ownerToken);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        var targetTokenResponse = await RegisterAndLoginAsync("update-member-target@example.com", "Password123!", "Target");

        var addResponse = await _client.PostAsJsonAsync($"/api/boards/{created.Id}/members", new AddMemberRequest("update-member-target@example.com", "Editor"));
        Assert.Equal(HttpStatusCode.OK, addResponse.StatusCode);
        var added = await addResponse.Content.ReadFromJsonAsync<BoardMemberDto>();
        Assert.NotNull(added);

        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ownerToken);

        var response = await _client.PutAsJsonAsync($"/api/boards/{created.Id}/members/{added.UserId}", new UpdateMemberRequest("Viewer"));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<BoardMemberDto>();
        Assert.NotNull(result);
        Assert.Equal("Viewer", result.Role);
    }

    [Fact]
    public async Task UpdateMember_NonOwner_ReturnsForbidden()
    {
        var ownerToken = await RegisterAndLoginAsync("update-member-non-o@example.com", "Password123!", "Owner");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ownerToken);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        var targetResponse = await RegisterAndLoginAsync("update-member-non-t@example.com", "Password123!", "Target");
        var addResponse = await _client.PostAsJsonAsync($"/api/boards/{created.Id}/members", new AddMemberRequest("update-member-non-t@example.com", "Editor"));
        Assert.Equal(HttpStatusCode.OK, addResponse.StatusCode);
        var added = await addResponse.Content.ReadFromJsonAsync<BoardMemberDto>();
        Assert.NotNull(added);

        var otherToken = await RegisterAndLoginAsync("update-member-non-other@example.com", "Password123!", "Other");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", otherToken);

        var response = await _client.PutAsJsonAsync($"/api/boards/{created.Id}/members/{added.UserId}", new UpdateMemberRequest("Viewer"));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task UpdateMember_MissingMember_ReturnsNotFound()
    {
        var token = await RegisterAndLoginAsync("update-member-404@example.com", "Password123!", "Update 404");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        var response = await _client.PutAsJsonAsync($"/api/boards/{created.Id}/members/{Guid.NewGuid()}", new UpdateMemberRequest("Viewer"));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task UpdateMember_OwnerRole_ReturnsConflict()
    {
        var token = await RegisterAndLoginAsync("update-member-owner-role@example.com", "Password123!", "Update Owner");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        var getMembersResponse = await _client.GetAsync($"/api/boards/{created.Id}/members");
        Assert.Equal(HttpStatusCode.OK, getMembersResponse.StatusCode);
        var members = await getMembersResponse.Content.ReadFromJsonAsync<List<BoardMemberDto>>();
        Assert.NotNull(members);
        Assert.Single(members);

        var response = await _client.PutAsJsonAsync($"/api/boards/{created.Id}/members/{members[0].UserId}", new UpdateMemberRequest("Viewer"));
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task DeleteMember_Owner_DeletesMember()
    {
        var ownerToken = await RegisterAndLoginAsync("delete-member-owner@example.com", "Password123!", "Owner");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ownerToken);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        await RegisterAndLoginAsync("delete-member-target@example.com", "Password123!", "Target");

        var addResponse = await _client.PostAsJsonAsync($"/api/boards/{created.Id}/members", new AddMemberRequest("delete-member-target@example.com", "Editor"));
        Assert.Equal(HttpStatusCode.OK, addResponse.StatusCode);
        var added = await addResponse.Content.ReadFromJsonAsync<BoardMemberDto>();
        Assert.NotNull(added);

        var response = await _client.DeleteAsync($"/api/boards/{created.Id}/members/{added.UserId}");
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);

        var getResponse = await _client.GetAsync($"/api/boards/{created.Id}/members");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        var members = await getResponse.Content.ReadFromJsonAsync<List<BoardMemberDto>>();
        Assert.NotNull(members);
        Assert.Single(members);
    }

    [Fact]
    public async Task DeleteMember_NonOwner_ReturnsForbidden()
    {
        var ownerToken = await RegisterAndLoginAsync("delete-member-non-o@example.com", "Password123!", "Owner");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", ownerToken);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        var targetResponse = await RegisterAndLoginAsync("delete-member-non-t@example.com", "Password123!", "Target");
        var addResponse = await _client.PostAsJsonAsync($"/api/boards/{created.Id}/members", new AddMemberRequest("delete-member-non-t@example.com", "Editor"));
        Assert.Equal(HttpStatusCode.OK, addResponse.StatusCode);
        var added = await addResponse.Content.ReadFromJsonAsync<BoardMemberDto>();
        Assert.NotNull(added);

        var otherToken = await RegisterAndLoginAsync("delete-member-non-other@example.com", "Password123!", "Other");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", otherToken);

        var response = await _client.DeleteAsync($"/api/boards/{created.Id}/members/{added.UserId}");
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task DeleteMember_MissingMember_ReturnsNotFound()
    {
        var token = await RegisterAndLoginAsync("delete-member-404@example.com", "Password123!", "Delete 404");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        var response = await _client.DeleteAsync($"/api/boards/{created.Id}/members/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task DeleteMember_LastOwner_ReturnsConflict()
    {
        var token = await RegisterAndLoginAsync("delete-member-last-owner@example.com", "Password123!", "Last Owner");
        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

        var createResponse = await _client.PostAsJsonAsync("/api/boards", new CreateBoardRequest("Board"));
        var created = await createResponse.Content.ReadFromJsonAsync<BoardDto>();
        Assert.NotNull(created);

        var getMembersResponse = await _client.GetAsync($"/api/boards/{created.Id}/members");
        Assert.Equal(HttpStatusCode.OK, getMembersResponse.StatusCode);
        var members = await getMembersResponse.Content.ReadFromJsonAsync<List<BoardMemberDto>>();
        Assert.NotNull(members);
        Assert.Single(members);

        var response = await _client.DeleteAsync($"/api/boards/{created.Id}/members/{members[0].UserId}");
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
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
