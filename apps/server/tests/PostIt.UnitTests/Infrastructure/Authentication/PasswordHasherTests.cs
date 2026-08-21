using PostIt.Domain.Entities;
using PostIt.Infrastructure.Authentication;

namespace PostIt.UnitTests.Infrastructure.Authentication;

public class PasswordHasherTests
{
    private readonly PasswordHasher _hasher = new();

    [Fact]
    public void HashPassword_ReturnsNonEmptyString()
    {
        var user = new User("a@b.com", "", "User");
        var hash = _hasher.HashPassword(user, "password123");

        Assert.False(string.IsNullOrWhiteSpace(hash));
        Assert.NotEqual("password123", hash);
    }

    [Fact]
    public void VerifyHashedPassword_WithCorrectPassword_ReturnsTrue()
    {
        var user = new User("a@b.com", "", "User");
        var hash = _hasher.HashPassword(user, "password123");

        var result = _hasher.VerifyHashedPassword(user, hash, "password123");

        Assert.True(result);
    }

    [Fact]
    public void VerifyHashedPassword_WithWrongPassword_ReturnsFalse()
    {
        var user = new User("a@b.com", "", "User");
        var hash = _hasher.HashPassword(user, "password123");

        var result = _hasher.VerifyHashedPassword(user, hash, "wrongpassword");

        Assert.False(result);
    }
}
