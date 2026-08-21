using PostIt.Application.DTOs;
using PostIt.Application.Interfaces;
using PostIt.Domain.Entities;

namespace PostIt.Application.Services;

public class AuthService : IAuthService
{
    private readonly IUserRepository _userRepository;
    private readonly IRefreshTokenRepository _refreshTokenRepository;
    private readonly IPasswordHasher _passwordHasher;
    private readonly ITokenService _tokenService;

    public AuthService(
        IUserRepository userRepository,
        IRefreshTokenRepository refreshTokenRepository,
        IPasswordHasher passwordHasher,
        ITokenService tokenService)
    {
        _userRepository = userRepository;
        _refreshTokenRepository = refreshTokenRepository;
        _passwordHasher = passwordHasher;
        _tokenService = tokenService;
    }

    public async Task<LoginResponse> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken = default)
    {
        if (await _userRepository.EmailExistsAsync(request.Email, cancellationToken))
        {
            throw new InvalidOperationException("User with this email already exists.");
        }

        var user = new User(request.Email, string.Empty, request.DisplayName);
        var passwordHash = _passwordHasher.HashPassword(user, request.Password);
        
        // Use reflection or recreate - since PasswordHash is private set, 
        // we can use a trick: the User constructor sets PasswordHash from parameter,
        // but it doesn't hash it. Wait, looking at User entity:
        // public User(string email, string passwordHash, string displayName)
        // So we pass the hash directly.
        user = new User(request.Email, passwordHash, request.DisplayName);

        await _userRepository.AddAsync(user, cancellationToken);

        var accessToken = _tokenService.GenerateAccessToken(user);
        var refreshTokenValue = _tokenService.GenerateRefreshToken();
        var refreshToken = new RefreshToken(
            refreshTokenValue,
            user.Id,
            DateTime.UtcNow.AddDays(7));

        await _refreshTokenRepository.AddAsync(refreshToken, cancellationToken);

        return new LoginResponse(accessToken, refreshTokenValue, DateTime.UtcNow.AddMinutes(15));
    }

    public async Task<LoginResponse> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default)
    {
        var user = await _userRepository.GetByEmailAsync(request.Email, cancellationToken);
        if (user == null)
        {
            throw new InvalidOperationException("Invalid email or password.");
        }

        if (!_passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password))
        {
            throw new InvalidOperationException("Invalid email or password.");
        }

        var accessToken = _tokenService.GenerateAccessToken(user);
        var refreshTokenValue = _tokenService.GenerateRefreshToken();
        var refreshToken = new RefreshToken(
            refreshTokenValue,
            user.Id,
            DateTime.UtcNow.AddDays(7));

        await _refreshTokenRepository.AddAsync(refreshToken, cancellationToken);

        return new LoginResponse(accessToken, refreshTokenValue, DateTime.UtcNow.AddMinutes(15));
    }

    public async Task<LoginResponse> RefreshAsync(RefreshRequest request, CancellationToken cancellationToken = default)
    {
        var refreshToken = await _refreshTokenRepository.GetByTokenAsync(request.RefreshToken, cancellationToken);
        if (refreshToken == null || refreshToken.IsRevoked || refreshToken.ExpiresAt < DateTime.UtcNow)
        {
            throw new InvalidOperationException("Invalid or expired refresh token.");
        }

        var user = await _userRepository.GetByIdAsync(refreshToken.UserId, cancellationToken);
        if (user == null)
        {
            throw new InvalidOperationException("User not found.");
        }

        // Rotate: revoke old token
        var newRefreshTokenValue = _tokenService.GenerateRefreshToken();
        refreshToken.Revoke(newRefreshTokenValue);
        await _refreshTokenRepository.UpdateAsync(refreshToken, cancellationToken);

        // Create new token
        var newRefreshToken = new RefreshToken(
            newRefreshTokenValue,
            user.Id,
            DateTime.UtcNow.AddDays(7));
        await _refreshTokenRepository.AddAsync(newRefreshToken, cancellationToken);

        var accessToken = _tokenService.GenerateAccessToken(user);

        return new LoginResponse(accessToken, newRefreshTokenValue, DateTime.UtcNow.AddMinutes(15));
    }

    public async Task LogoutAsync(string refreshToken, CancellationToken cancellationToken = default)
    {
        var token = await _refreshTokenRepository.GetByTokenAsync(refreshToken, cancellationToken);
        if (token != null && !token.IsRevoked)
        {
            token.Revoke();
            await _refreshTokenRepository.UpdateAsync(token, cancellationToken);
        }
    }

    public async Task<MeResponse?> GetMeAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var user = await _userRepository.GetByIdAsync(userId, cancellationToken);
        if (user == null)
        {
            return null;
        }

        return new MeResponse(user.Id, user.Email, user.DisplayName);
    }
}
