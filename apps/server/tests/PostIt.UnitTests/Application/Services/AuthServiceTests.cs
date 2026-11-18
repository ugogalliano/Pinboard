using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using PostIt.Application.DTOs;
using PostIt.Application.Interfaces;
using PostIt.Application.Services;
using PostIt.Domain.Entities;

namespace PostIt.UnitTests.Application.Services;

public class AuthServiceTests
{
    private const string ValidPassword = "password123";

    private readonly Mock<IUserRepository> _userRepo = new();
    private readonly Mock<IRefreshTokenRepository> _tokenRepo = new();
    private readonly Mock<IPasswordHasher> _hasher = new();
    private readonly Mock<ITokenService> _tokenSvc = new();
    private readonly AuthService _svc;

    public AuthServiceTests()
    {
        _svc = new AuthService(_userRepo.Object, _tokenRepo.Object, _hasher.Object, _tokenSvc.Object, NullLogger<AuthService>.Instance);
    }

    [Fact]
    public async Task RegisterAsync_NewEmail_ReturnsTokens()
    {
        var req = new RegisterRequest("a@b.com", ValidPassword, "User");
        _userRepo.Setup(r => r.EmailExistsAsync(req.Email, default)).ReturnsAsync(false);
        _hasher.Setup(h => h.HashPassword(It.IsAny<User>(), req.Password)).Returns("hash");
        _tokenSvc.Setup(t => t.GenerateAccessToken(It.IsAny<User>())).Returns("at");
        _tokenSvc.Setup(t => t.GenerateRefreshToken()).Returns("rt");

        var res = await _svc.RegisterAsync(req);

        Assert.Equal("at", res.AccessToken);
        Assert.Equal("rt", res.RefreshToken);
        _userRepo.Verify(r => r.AddAsync(It.Is<User>(u => u.Email == req.Email), default), Times.Once);
        _tokenRepo.Verify(r => r.AddAsync(It.IsAny<RefreshToken>(), default), Times.Once);
    }

    [Fact]
    public async Task RegisterAsync_SavesOnceForUserAndRefreshToken()
    {
        var req = new RegisterRequest("a@b.com", ValidPassword, "User");
        _userRepo.Setup(r => r.EmailExistsAsync(req.Email, default)).ReturnsAsync(false);
        _hasher.Setup(h => h.HashPassword(It.IsAny<User>(), req.Password)).Returns("hash");
        _tokenSvc.Setup(t => t.GenerateAccessToken(It.IsAny<User>())).Returns("at");
        _tokenSvc.Setup(t => t.GenerateRefreshToken()).Returns("rt");

        await _svc.RegisterAsync(req);

        // Single unit of work: exactly one SaveChangesAsync for user + refresh token.
        _userRepo.Verify(r => r.SaveChangesAsync(default), Times.Once);
        _tokenRepo.Verify(r => r.SaveChangesAsync(default), Times.Never);
    }

    [Fact]
    public async Task RegisterAsync_MixedCaseEmail_StoresNormalizedEmail()
    {
        var req = new RegisterRequest("  Mixed.Case@Example.COM ", ValidPassword, "User");
        _userRepo.Setup(r => r.EmailExistsAsync("mixed.case@example.com", default)).ReturnsAsync(false);
        _hasher.Setup(h => h.HashPassword(It.IsAny<User>(), It.IsAny<string>())).Returns("hash");
        _tokenSvc.Setup(t => t.GenerateAccessToken(It.IsAny<User>())).Returns("at");
        _tokenSvc.Setup(t => t.GenerateRefreshToken()).Returns("rt");

        await _svc.RegisterAsync(req);

        _userRepo.Verify(r => r.EmailExistsAsync("mixed.case@example.com", default), Times.Once);
        _userRepo.Verify(r => r.AddAsync(It.Is<User>(u => u.Email == "mixed.case@example.com"), default), Times.Once);
    }

    [Fact]
    public async Task RegisterAsync_DisplayNameEmail_StoresCanonicalAddress()
    {
        // MailAddress accepts "John Doe <a@b.com>"; only the address part may
        // be stored/checked so canonical duplicates cannot be escaped.
        var req = new RegisterRequest("John Doe <a@b.com>", ValidPassword, "User");
        _userRepo.Setup(r => r.EmailExistsAsync("a@b.com", default)).ReturnsAsync(false);
        _hasher.Setup(h => h.HashPassword(It.IsAny<User>(), It.IsAny<string>())).Returns("hash");
        _tokenSvc.Setup(t => t.GenerateAccessToken(It.IsAny<User>())).Returns("at");
        _tokenSvc.Setup(t => t.GenerateRefreshToken()).Returns("rt");

        await _svc.RegisterAsync(req);

        _userRepo.Verify(r => r.EmailExistsAsync("a@b.com", default), Times.Once);
        _userRepo.Verify(r => r.AddAsync(It.Is<User>(u => u.Email == "a@b.com"), default), Times.Once);
    }

    [Fact]
    public async Task RegisterAsync_DisplayNameEmail_DuplicateCanonical_Throws()
    {
        var req = new RegisterRequest("John Doe <a@b.com>", ValidPassword, "User");
        _userRepo.Setup(r => r.EmailExistsAsync("a@b.com", default)).ReturnsAsync(true);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => _svc.RegisterAsync(req));
        Assert.Contains("already exists", ex.Message);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not-an-email")]
    public async Task RegisterAsync_InvalidEmail_ThrowsArgumentException(string? email)
    {
        var req = new RegisterRequest(email!, ValidPassword, "User");

        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _svc.RegisterAsync(req));
        Assert.Contains("Email", ex.Message);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("short")]
    public async Task RegisterAsync_ShortPassword_ThrowsArgumentException(string? password)
    {
        var req = new RegisterRequest("a@b.com", password!, "User");

        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _svc.RegisterAsync(req));
        Assert.Contains("8 characters", ex.Message);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task RegisterAsync_EmptyDisplayName_ThrowsArgumentException(string? displayName)
    {
        var req = new RegisterRequest("a@b.com", ValidPassword, displayName!);

        var ex = await Assert.ThrowsAsync<ArgumentException>(() => _svc.RegisterAsync(req));
        Assert.Contains("Display name", ex.Message);
    }

    [Fact]
    public async Task RegisterAsync_InvalidInput_DoesNotCheckDuplicateFirst()
    {
        // Validation must run BEFORE the duplicate-email check.
        var req = new RegisterRequest("not-an-email", ValidPassword, "User");
        _userRepo.Setup(r => r.EmailExistsAsync(It.IsAny<string>(), default)).ReturnsAsync(true);

        await Assert.ThrowsAsync<ArgumentException>(() => _svc.RegisterAsync(req));

        _userRepo.Verify(r => r.EmailExistsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task RegisterAsync_DuplicateEmail_Throws()
    {
        var req = new RegisterRequest("a@b.com", ValidPassword, "User");
        _userRepo.Setup(r => r.EmailExistsAsync(req.Email, default)).ReturnsAsync(true);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => _svc.RegisterAsync(req));
        Assert.Contains("already exists", ex.Message);
    }

    [Fact]
    public async Task LoginAsync_Valid_ReturnsTokens()
    {
        var req = new LoginRequest("a@b.com", ValidPassword);
        var user = new User("a@b.com", "hash", "User");
        _userRepo.Setup(r => r.GetByEmailAsync(req.Email, default)).ReturnsAsync(user);
        _hasher.Setup(h => h.VerifyHashedPassword(user, "hash", req.Password)).Returns(true);
        _tokenSvc.Setup(t => t.GenerateAccessToken(user)).Returns("at");
        _tokenSvc.Setup(t => t.GenerateRefreshToken()).Returns("rt");

        var res = await _svc.LoginAsync(req);

        Assert.Equal("at", res.AccessToken);
        Assert.Equal("rt", res.RefreshToken);
        _tokenRepo.Verify(r => r.SaveChangesAsync(default), Times.Once);
    }

    [Fact]
    public async Task LoginAsync_MixedCaseEmail_NormalizesLookup()
    {
        var req = new LoginRequest("  Mixed.Case@Example.COM ", ValidPassword);
        var user = new User("mixed.case@example.com", "hash", "User");
        _userRepo.Setup(r => r.GetByEmailAsync("mixed.case@example.com", default)).ReturnsAsync(user);
        _hasher.Setup(h => h.VerifyHashedPassword(user, "hash", req.Password)).Returns(true);
        _tokenSvc.Setup(t => t.GenerateAccessToken(user)).Returns("at");
        _tokenSvc.Setup(t => t.GenerateRefreshToken()).Returns("rt");

        var res = await _svc.LoginAsync(req);

        Assert.Equal("at", res.AccessToken);
        _userRepo.Verify(r => r.GetByEmailAsync("mixed.case@example.com", default), Times.Once);
    }

    [Fact]
    public async Task LoginAsync_DisplayNameEmail_NormalizesLookup()
    {
        var req = new LoginRequest("John Doe <a@b.com>", ValidPassword);
        var user = new User("a@b.com", "hash", "User");
        _userRepo.Setup(r => r.GetByEmailAsync("a@b.com", default)).ReturnsAsync(user);
        _hasher.Setup(h => h.VerifyHashedPassword(user, "hash", req.Password)).Returns(true);
        _tokenSvc.Setup(t => t.GenerateAccessToken(user)).Returns("at");
        _tokenSvc.Setup(t => t.GenerateRefreshToken()).Returns("rt");

        var res = await _svc.LoginAsync(req);

        Assert.Equal("at", res.AccessToken);
        _userRepo.Verify(r => r.GetByEmailAsync("a@b.com", default), Times.Once);
    }

    [Fact]
    public async Task LoginAsync_InvalidEmail_Throws()
    {
        var req = new LoginRequest("a@b.com", ValidPassword);
        _userRepo.Setup(r => r.GetByEmailAsync(req.Email, default)).ReturnsAsync((User?)null);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => _svc.LoginAsync(req));
        Assert.Contains("Invalid", ex.Message);
    }

    [Fact]
    public async Task LoginAsync_InvalidPassword_Throws()
    {
        var req = new LoginRequest("a@b.com", ValidPassword);
        var user = new User("a@b.com", "hash", "User");
        _userRepo.Setup(r => r.GetByEmailAsync(req.Email, default)).ReturnsAsync(user);
        _hasher.Setup(h => h.VerifyHashedPassword(user, "hash", req.Password)).Returns(false);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => _svc.LoginAsync(req));
        Assert.Contains("Invalid", ex.Message);
    }

    [Fact]
    public async Task RefreshAsync_Valid_RotatesAndReturnsNewTokens()
    {
        var uid = Guid.NewGuid();
        var user = new User("a@b.com", "hash", "User");
        typeof(User).GetProperty("Id")!.SetValue(user, uid);
        var old = new RefreshToken("old", uid, DateTime.UtcNow.AddDays(7));
        _tokenRepo.Setup(r => r.GetByTokenAsync("old", default)).ReturnsAsync(old);
        _userRepo.Setup(r => r.GetByIdAsync(uid, default)).ReturnsAsync(user);
        _tokenSvc.Setup(t => t.GenerateRefreshToken()).Returns("new");
        _tokenSvc.Setup(t => t.GenerateAccessToken(user)).Returns("at2");

        var res = await _svc.RefreshAsync(new RefreshRequest("old"));

        Assert.Equal("at2", res.AccessToken);
        Assert.Equal("new", res.RefreshToken);
        _tokenRepo.Verify(r => r.UpdateAsync(It.Is<RefreshToken>(t => t.IsRevoked && t.ReplacedByToken == "new"), default), Times.Once);
        _tokenRepo.Verify(r => r.AddAsync(It.Is<RefreshToken>(t => t.Token == "new"), default), Times.Once);
    }

    [Fact]
    public async Task RefreshAsync_RotationCommitsAtomicallyInSingleSave()
    {
        var uid = Guid.NewGuid();
        var user = new User("a@b.com", "hash", "User");
        typeof(User).GetProperty("Id")!.SetValue(user, uid);
        var old = new RefreshToken("old", uid, DateTime.UtcNow.AddDays(7));
        _tokenRepo.Setup(r => r.GetByTokenAsync("old", default)).ReturnsAsync(old);
        _userRepo.Setup(r => r.GetByIdAsync(uid, default)).ReturnsAsync(user);
        _tokenSvc.Setup(t => t.GenerateRefreshToken()).Returns("new");
        _tokenSvc.Setup(t => t.GenerateAccessToken(user)).Returns("at2");

        var callOrder = new List<string>();
        _tokenRepo.Setup(r => r.UpdateAsync(It.IsAny<RefreshToken>(), default))
            .Callback(() => callOrder.Add("update"))
            .Returns(Task.CompletedTask);
        _tokenRepo.Setup(r => r.AddAsync(It.IsAny<RefreshToken>(), default))
            .Callback(() => callOrder.Add("add"))
            .Returns(Task.CompletedTask);
        _tokenRepo.Setup(r => r.SaveChangesAsync(default))
            .Callback(() => callOrder.Add("save"))
            .Returns(Task.CompletedTask);

        await _svc.RefreshAsync(new RefreshRequest("old"));

        // Revoke + new token are staged before a single SaveChangesAsync.
        Assert.Equal(new[] { "update", "add", "save" }, callOrder);
        _tokenRepo.Verify(r => r.SaveChangesAsync(default), Times.Once);
    }

    [Fact]
    public async Task RefreshAsync_Revoked_Throws()
    {
        var t = new RefreshToken("r", Guid.NewGuid(), DateTime.UtcNow.AddDays(7));
        t.Revoke();
        _tokenRepo.Setup(r => r.GetByTokenAsync("r", default)).ReturnsAsync(t);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => _svc.RefreshAsync(new RefreshRequest("r")));
        Assert.Contains("Invalid or expired", ex.Message);
    }

    [Fact]
    public async Task RefreshAsync_Expired_Throws()
    {
        var t = new RefreshToken("e", Guid.NewGuid(), DateTime.UtcNow.AddDays(-1));
        _tokenRepo.Setup(r => r.GetByTokenAsync("e", default)).ReturnsAsync(t);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => _svc.RefreshAsync(new RefreshRequest("e")));
        Assert.Contains("Invalid or expired", ex.Message);
    }

    [Fact]
    public async Task LogoutAsync_Valid_Revokes()
    {
        var t = new RefreshToken("x", Guid.NewGuid(), DateTime.UtcNow.AddDays(7));
        _tokenRepo.Setup(r => r.GetByTokenAsync("x", default)).ReturnsAsync(t);

        await _svc.LogoutAsync("x");

        Assert.True(t.IsRevoked);
        _tokenRepo.Verify(r => r.UpdateAsync(t, default), Times.Once);
        _tokenRepo.Verify(r => r.SaveChangesAsync(default), Times.Once);
    }

    [Fact]
    public async Task LogoutAsync_Missing_DoesNotThrow()
    {
        _tokenRepo.Setup(r => r.GetByTokenAsync("missing", default)).ReturnsAsync((RefreshToken?)null);

        await _svc.LogoutAsync("missing");

        _tokenRepo.Verify(r => r.UpdateAsync(It.IsAny<RefreshToken>(), It.IsAny<CancellationToken>()), Times.Never);
        _tokenRepo.Verify(r => r.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task GetMeAsync_Existing_ReturnsDto()
    {
        var uid = Guid.NewGuid();
        var user = new User("a@b.com", "hash", "User");
        typeof(User).GetProperty("Id")!.SetValue(user, uid);
        _userRepo.Setup(r => r.GetByIdAsync(uid, default)).ReturnsAsync(user);

        var res = await _svc.GetMeAsync(uid);

        Assert.NotNull(res);
        Assert.Equal(uid, res.Id);
        Assert.Equal("a@b.com", res.Email);
        Assert.Equal("User", res.DisplayName);
    }

    [Fact]
    public async Task GetMeAsync_Missing_ReturnsNull()
    {
        _userRepo.Setup(r => r.GetByIdAsync(It.IsAny<Guid>(), default)).ReturnsAsync((User?)null);

        var res = await _svc.GetMeAsync(Guid.NewGuid());

        Assert.Null(res);
    }
}
