namespace PostIt.Domain.Entities;

public class User
{
    public Guid Id { get; private set; }
    public string Email { get; private set; } = string.Empty;
    public string PasswordHash { get; private set; } = string.Empty;
    public string DisplayName { get; private set; } = string.Empty;
    public DateTime CreatedAt { get; private set; }
    public DateTime UpdatedAt { get; private set; }

    private User() { }

    public User(string email, string passwordHash, string displayName)
    {
        Id = Guid.NewGuid();
        Email = email;
        PasswordHash = passwordHash;
        DisplayName = displayName;
        CreatedAt = DateTime.UtcNow;
        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdateDisplayName(string displayName)
    {
        DisplayName = displayName;
        UpdatedAt = DateTime.UtcNow;
    }
}
