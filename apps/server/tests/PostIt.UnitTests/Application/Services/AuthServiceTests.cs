using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using PostIt.Application.DTOs;
using PostIt.Application.Interfaces;
using PostIt.Application.Services;
using PostIt.Domain.Entities;

namespace PostIt.UnitTests.Application.Services;

public class AuthServiceTests
{
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
        var req = new RegisterRequest("a@b.com", "pw", "User");
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
    public async Task RegisterAsync_DuplicateEmail_Throws()
    {
        var req = new RegisterRequest("a@b.com", "pw", "User");
        _userRepo.Setup(r => r.EmailExistsAsync(req.Email, default)).ReturnsAsync(true);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => _svc.RegisterAsync(req));
        Assert.Contains("already exists", ex.Message);
    }

    [Fact]
    public async Task LoginAsync_Valid_ReturnsTokens()
    {
        var req = new LoginRequest("a@b.com", "pw");
        var user = new User("a@b.com", "hash", "User");
        _userRepo.Setup(r => r.GetByEmailAsync(req.Email, default)).ReturnsAsync(user);
        _hasher.Setup(h => h.VerifyHashedPassword(user, "hash", req.Password)).Returns(true);
        _tokenSvc.Setup(t => t.GenerateAccessToken(user)).Returns("at");
        _tokenSvc.Setup(t => t.GenerateRefreshToken()).Returns("rt");

        var res = await _svc.LoginAsync(req);

        Assert.Equal("at", res.AccessToken);
        Assert.Equal("rt", res.RefreshToken);
    }

    [Fact]
    public async Task LoginAsync_InvalidEmail_Throws()
    {
        var req = new LoginRequest("a@b.com", "pw");
        _userRepo.Setup(r => r.GetByEmailAsync(req.Email, default)).ReturnsAsync((User?)null);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => _svc.LoginAsync(req));
        Assert.Contains("Invalid", ex.Message);
    }

    [Fact]
    public async Task LoginAsync_InvalidPassword_Throws()
    {
        var req = new LoginRequest("a@b.com", "pw");
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
    }

    [Fact]
    public async Task LogoutAsync_Missing_DoesNotThrow()
    {
        _tokenRepo.Setup(r => r.GetByTokenAsync("missing", default)).ReturnsAsync((RefreshToken?)null);

        await _svc.LogoutAsync("missing");

        _tokenRepo.Verify(r => r.UpdateAsync(It.IsAny<RefreshToken>(), It.IsAny<CancellationToken>()), Times.Never);
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
