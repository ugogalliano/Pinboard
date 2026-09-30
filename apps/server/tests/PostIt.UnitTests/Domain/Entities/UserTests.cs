using PostIt.Domain.Entities;

namespace PostIt.UnitTests.Domain.Entities;

public class UserTests
{
    [Fact]
    public void Constructor_Sets_Properties_Correctly()
    {
        var user = new User("test@example.com", "hash123", "Test User");

        Assert.NotEqual(Guid.Empty, user.Id);
        Assert.Equal("test@example.com", user.Email);
        Assert.Equal("hash123", user.PasswordHash);
        Assert.Equal("Test User", user.DisplayName);
        Assert.True(user.CreatedAt <= DateTime.UtcNow);
        Assert.True((user.UpdatedAt - user.CreatedAt).TotalSeconds < 1);
    }

    [Fact]
    public void UpdateDisplayName_Updates_DisplayName_And_UpdatedAt()
    {
        var user = new User("test@example.com", "hash123", "Test User");
        var originalUpdatedAt = user.UpdatedAt;

        // Small delay to ensure UpdatedAt changes
        Thread.Sleep(10);
        user.UpdateDisplayName("New Name");

        Assert.Equal("New Name", user.DisplayName);
        Assert.True(user.UpdatedAt > originalUpdatedAt);
    }

    [Fact]
    public void SetPasswordHash_Updates_PasswordHash_And_UpdatedAt()
    {
        var user = new User("test@example.com", "hash123", "Test User");
        var originalUpdatedAt = user.UpdatedAt;

        // Small delay to ensure UpdatedAt changes
        Thread.Sleep(10);
        user.SetPasswordHash("newhash");

        Assert.Equal("newhash", user.PasswordHash);
        Assert.True(user.UpdatedAt > originalUpdatedAt);
    }
}
