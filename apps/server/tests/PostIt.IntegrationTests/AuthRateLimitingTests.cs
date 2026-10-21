using System.Net;
using System.Net.Http.Json;
using PostIt.Application.DTOs;

namespace PostIt.IntegrationTests;

public class AuthRateLimitingTests : IAsyncLifetime
{
    private readonly TestWebApplicationFactory _productionFactory = new()
    {
        EnvironmentName = "Production",
        DisableRateLimiting = true
    };
    private readonly TestWebApplicationFactory _developmentFactory = new()
    {
        EnvironmentName = "Development",
        DisableRateLimiting = false
    };
    private HttpClient _productionClient = null!;
    private HttpClient _developmentClient = null!;

    public async Task InitializeAsync()
    {
        await _productionFactory.InitializeAsync();
        await _developmentFactory.InitializeAsync();
        _productionClient = _productionFactory.CreateClient();
        _developmentClient = _developmentFactory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        _productionClient.Dispose();
        _developmentClient.Dispose();
        await _productionFactory.DisposeAsync();
        await _developmentFactory.DisposeAsync();
    }

    [Fact]
    public async Task Production_EnforcesSeparateAuthBucketsAndExcludesMeAndLogout()
    {
        var registered = await _productionClient.PostAsJsonAsync(
            "/api/auth/register",
            new RegisterRequest("me-rate-limit@example.com", "Password123!", "Rate Limit"));
        Assert.Equal(HttpStatusCode.OK, registered.StatusCode);
        var tokens = await registered.Content.ReadFromJsonAsync<LoginResponse>();
        Assert.NotNull(tokens);
        _productionClient.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", tokens.AccessToken);

        for (var index = 0; index < 11; index++)
        {
            var me = await _productionClient.GetAsync("/api/auth/me");
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        }

        for (var index = 0; index < 9; index++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/login")
            {
                Content = JsonContent.Create(new LoginRequest($"missing-{index}@example.com", "Password123!"))
            };
            request.Headers.Add("X-Forwarded-For", $"198.51.100.{index + 1}");
            using var response = await _productionClient.SendAsync(request);
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        var limitedRegister = await _productionClient.PostAsJsonAsync(
            "/api/auth/register",
            new RegisterRequest("limited@example.com", "Password123!", "Limited"));
        Assert.Equal(HttpStatusCode.TooManyRequests, limitedRegister.StatusCode);
        Assert.True(limitedRegister.Headers.RetryAfter != null);

        for (var index = 0; index < 10; index++)
        {
            var response = await _productionClient.PostAsJsonAsync(
                "/api/auth/refresh",
                new RefreshRequest($"invalid-refresh-{index}"));
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        var limitedRefresh = await _productionClient.PostAsJsonAsync(
            "/api/auth/refresh",
            new RefreshRequest("another-invalid-refresh"));
        Assert.Equal(HttpStatusCode.TooManyRequests, limitedRefresh.StatusCode);
        Assert.True(limitedRefresh.Headers.RetryAfter != null);

        var logout = await _productionClient.PostAsJsonAsync(
            "/api/auth/logout",
            new RefreshRequest("invalid-logout-token"));
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
    }

    [Fact]
    public async Task Development_DoesNotApplyAuthRateLimits()
    {
        for (var index = 0; index < 11; index++)
        {
            var response = await _developmentClient.PostAsJsonAsync(
                "/api/auth/login",
                new LoginRequest($"missing-{index}@example.com", "Password123!"));
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }
    }
}
