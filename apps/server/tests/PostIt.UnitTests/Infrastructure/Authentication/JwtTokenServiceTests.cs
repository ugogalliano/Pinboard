using Microsoft.Extensions.Configuration;
using PostIt.Domain.Entities;
using PostIt.Infrastructure.Authentication;

namespace PostIt.UnitTests.Infrastructure.Authentication;

public class JwtTokenServiceTests
{
    private readonly JwtTokenService _service;

    public JwtTokenServiceTests()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["JwtSettings:Secret"] = "test-secret-key-that-is-at-least-32-characters-long-for-hmac",
                ["JwtSettings:Issuer"] = "PostItTest",
                ["JwtSettings:Audience"] = "PostItTest"
            })
            .Build();
        _service = new JwtTokenService(config);
    }

    [Fact]
    public void GenerateAccessToken_ReturnsNonEmptyString()
    {
        var user = new User("a@b.com", "hash", "User");
        var token = _service.GenerateAccessToken(user);

        Assert.False(string.IsNullOrWhiteSpace(token));
    }

    [Fact]
    public void GenerateRefreshToken_ReturnsNonEmptyString()
    {
        var token = _service.GenerateRefreshToken();

        Assert.False(string.IsNullOrWhiteSpace(token));
        Assert.NotEqual(_service.GenerateRefreshToken(), token);
    }

    [Fact]
    public void GetUserIdFromAccessToken_WithValidToken_ReturnsUserId()
    {
        var user = new User("a@b.com", "hash", "User");
        var token = _service.GenerateAccessToken(user);

        var userId = _service.GetUserIdFromAccessToken(token);

        Assert.Equal(user.Id, userId);
    }

    [Fact]
    public void GetUserIdFromAccessToken_WithInvalidToken_ReturnsNull()
    {
        var userId = _service.GetUserIdFromAccessToken("invalid.token.here");

        Assert.Null(userId);
    }
}
