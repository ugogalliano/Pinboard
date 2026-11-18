using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using PostIt.Application.DTOs;

namespace PostIt.IntegrationTests;

public class AuthEndpointsTests : IClassFixture<TestWebApplicationFactory>
{
    private readonly TestWebApplicationFactory _factory;
    private readonly HttpClient _client;

    public AuthEndpointsTests(TestWebApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task Register_ReturnsOk_WithTokens()
    {
        var request = new RegisterRequest("int-test@example.com", "Password123!", "Integration Test");

        var response = await _client.PostAsJsonAsync("/api/auth/register", request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(result);
        Assert.False(string.IsNullOrWhiteSpace(result.AccessToken));
        Assert.False(string.IsNullOrWhiteSpace(result.RefreshToken));
    }

    [Fact]
    public async Task Register_DuplicateEmail_ReturnsConflict()
    {
        var request = new RegisterRequest("dup@example.com", "Password123!", "Dup");
        var first = await _client.PostAsJsonAsync("/api/auth/register", request);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var second = await _client.PostAsJsonAsync("/api/auth/register", request);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task Register_DuplicateEmail_DifferentCase_ReturnsConflict()
    {
        var first = await _client.PostAsJsonAsync("/api/auth/register",
            new RegisterRequest("dupcase@example.com", "Password123!", "Dup Case"));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var second = await _client.PostAsJsonAsync("/api/auth/register",
            new RegisterRequest("DupCase@Example.COM", "Password123!", "Dup Case"));
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task Register_DisplayNameEmail_ConflictsWithPlainAddress_ReturnsConflict()
    {
        var first = await _client.PostAsJsonAsync("/api/auth/register",
            new RegisterRequest("displayname@example.com", "Password123!", "Plain Address"));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        // MailAddress accepts display-name syntax; the canonical address part
        // must still collide with the existing account.
        var second = await _client.PostAsJsonAsync("/api/auth/register",
            new RegisterRequest("Display Name <displayname@example.com>", "Password123!", "Display Name"));
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task Register_InvalidEmail_ReturnsBadRequest()
    {
        var request = new RegisterRequest("not-an-email", "Password123!", "Invalid Email");

        var response = await _client.PostAsJsonAsync("/api/auth/register", request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Register_ShortPassword_ReturnsBadRequest()
    {
        var request = new RegisterRequest("short-pw@example.com", "abc123", "Short Password");

        var response = await _client.PostAsJsonAsync("/api/auth/register", request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Login_ValidCredentials_ReturnsTokens()
    {
        var registerReq = new RegisterRequest("login-test@example.com", "Password123!", "Login Test");
        await _client.PostAsJsonAsync("/api/auth/register", registerReq);

        var loginReq = new LoginRequest("login-test@example.com", "Password123!");
        var response = await _client.PostAsJsonAsync("/api/auth/login", loginReq);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(result);
        Assert.False(string.IsNullOrWhiteSpace(result.AccessToken));
        Assert.False(string.IsNullOrWhiteSpace(result.RefreshToken));
    }

    [Fact]
    public async Task Login_MixedCaseEmail_ReturnsTokens()
    {
        var registerReq = new RegisterRequest("mixedcase-login@example.com", "Password123!", "Mixed Case Login");
        await _client.PostAsJsonAsync("/api/auth/register", registerReq);

        var loginReq = new LoginRequest("MixedCase-Login@Example.COM", "Password123!");
        var response = await _client.PostAsJsonAsync("/api/auth/login", loginReq);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Login_InvalidCredentials_ReturnsUnauthorized()
    {
        var loginReq = new LoginRequest("nonexistent@example.com", "Password123!");
        var response = await _client.PostAsJsonAsync("/api/auth/login", loginReq);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Refresh_ValidToken_ReturnsNewTokens()
    {
        var registerReq = new RegisterRequest("refresh-test@example.com", "Password123!", "Refresh Test");
        var registerResp = await _client.PostAsJsonAsync("/api/auth/register", registerReq);
        var registerResult = await registerResp.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(registerResult);

        var refreshReq = new RefreshRequest(registerResult.RefreshToken);
        var response = await _client.PostAsJsonAsync("/api/auth/refresh", refreshReq);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(result);
        Assert.False(string.IsNullOrWhiteSpace(result.AccessToken));
        Assert.False(string.IsNullOrWhiteSpace(result.RefreshToken));
        Assert.NotEqual(registerResult.RefreshToken, result.RefreshToken);
    }

    [Fact]
    public async Task Refresh_InvalidToken_ReturnsUnauthorized()
    {
        var refreshReq = new RefreshRequest("invalid-token");
        var response = await _client.PostAsJsonAsync("/api/auth/refresh", refreshReq);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Logout_ValidToken_ReturnsNoContent()
    {
        var registerReq = new RegisterRequest("logout-test@example.com", "Password123!", "Logout Test");
        var registerResp = await _client.PostAsJsonAsync("/api/auth/register", registerReq);
        var registerResult = await registerResp.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(registerResult);

        var logoutReq = new RefreshRequest(registerResult.RefreshToken);
        var response = await _client.PostAsJsonAsync("/api/auth/logout", logoutReq);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task Me_WithValidToken_ReturnsUser()
    {
        var registerReq = new RegisterRequest("me-test@example.com", "Password123!", "Me Test");
        var registerResp = await _client.PostAsJsonAsync("/api/auth/register", registerReq);
        var registerResult = await registerResp.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(registerResult);

        _client.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", registerResult.AccessToken);

        var response = await _client.GetAsync("/api/auth/me");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<MeResponse>();
        Assert.NotNull(result);
        Assert.Equal("me-test@example.com", result.Email);
        Assert.Equal("Me Test", result.DisplayName);
    }

    [Fact]
    public async Task Me_WithoutToken_ReturnsUnauthorized()
    {
        var response = await _client.GetAsync("/api/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
