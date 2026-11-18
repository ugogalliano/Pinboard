using Microsoft.Extensions.Logging;
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
    private readonly ILogger<AuthService> _logger;

    public AuthService(
        IUserRepository userRepository,
        IRefreshTokenRepository refreshTokenRepository,
        IPasswordHasher passwordHasher,
        ITokenService tokenService,
        ILogger<AuthService> logger)
    {
        _userRepository = userRepository;
        _refreshTokenRepository = refreshTokenRepository;
        _passwordHasher = passwordHasher;
        _tokenService = tokenService;
        _logger = logger;
    }

    public async Task<LoginResponse> RegisterAsync(RegisterRequest request, CancellationToken cancellationToken = default)
    {
        var email = ValidateRegister(request.Email, request.Password, request.DisplayName);

        if (await _userRepository.EmailExistsAsync(email, cancellationToken))
        {
            throw new InvalidOperationException("User with this email already exists.");
        }

        var user = new User(email, string.Empty, request.DisplayName);
        var passwordHash = _passwordHasher.HashPassword(user, request.Password);
        user.SetPasswordHash(passwordHash);

        await _userRepository.AddAsync(user, cancellationToken);

        var accessToken = _tokenService.GenerateAccessToken(user);
        var refreshTokenValue = _tokenService.GenerateRefreshToken();
        var refreshToken = new RefreshToken(
            refreshTokenValue,
            user.Id,
            DateTime.UtcNow.AddDays(7));

        await _refreshTokenRepository.AddAsync(refreshToken, cancellationToken);

        // Single unit of work: user and refresh token commit in one transaction.
        await _userRepository.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Registration succeeded | userId={UserId}", user.Id);

        return new LoginResponse(accessToken, refreshTokenValue, DateTime.UtcNow.AddMinutes(15));
    }

    public async Task<LoginResponse> LoginAsync(LoginRequest request, CancellationToken cancellationToken = default)
    {
        var normalizedEmail = EmailNormalizer.TryNormalize(request.Email);
        var user = normalizedEmail == null
            ? null
            : await _userRepository.GetByEmailAsync(normalizedEmail, cancellationToken);
        if (user == null)
        {
            _logger.LogWarning("Login failed | reason=Invalid credentials");
            throw new InvalidOperationException("Invalid email or password.");
        }

        if (!_passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password))
        {
            _logger.LogWarning("Login failed | reason=Invalid credentials");
            throw new InvalidOperationException("Invalid email or password.");
        }

        var accessToken = _tokenService.GenerateAccessToken(user);
        var refreshTokenValue = _tokenService.GenerateRefreshToken();
        var refreshToken = new RefreshToken(
            refreshTokenValue,
            user.Id,
            DateTime.UtcNow.AddDays(7));

        await _refreshTokenRepository.AddAsync(refreshToken, cancellationToken);
        await _refreshTokenRepository.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Login succeeded | userId={UserId}", user.Id);

        return new LoginResponse(accessToken, refreshTokenValue, DateTime.UtcNow.AddMinutes(15));
    }

    public async Task<LoginResponse> RefreshAsync(RefreshRequest request, CancellationToken cancellationToken = default)
    {
        var refreshToken = await _refreshTokenRepository.GetByTokenAsync(request.RefreshToken, cancellationToken);
        if (refreshToken == null || refreshToken.IsRevoked || refreshToken.ExpiresAt < DateTime.UtcNow)
        {
            _logger.LogWarning("Refresh failed | reason=Invalid or expired refresh token");
            throw new InvalidOperationException("Invalid or expired refresh token.");
        }

        var user = await _userRepository.GetByIdAsync(refreshToken.UserId, cancellationToken);
        if (user == null)
        {
            _logger.LogWarning("Refresh failed | reason=User not found");
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

        // Single unit of work: revoke + replacement commit in one transaction.
        await _refreshTokenRepository.SaveChangesAsync(cancellationToken);

        var accessToken = _tokenService.GenerateAccessToken(user);

        _logger.LogInformation("Refresh succeeded | userId={UserId}", user.Id);

        return new LoginResponse(accessToken, newRefreshTokenValue, DateTime.UtcNow.AddMinutes(15));
    }

    public async Task LogoutAsync(string refreshToken, CancellationToken cancellationToken = default)
    {
        var token = await _refreshTokenRepository.GetByTokenAsync(refreshToken, cancellationToken);
        if (token != null && !token.IsRevoked)
        {
            token.Revoke();
            await _refreshTokenRepository.UpdateAsync(token, cancellationToken);
            await _refreshTokenRepository.SaveChangesAsync(cancellationToken);
        }

        _logger.LogInformation("Logout completed");
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

    /// <summary>
    /// Validates registration input and returns the canonical email address to
    /// store and check for duplicates.
    /// </summary>
    private static string ValidateRegister(string email, string password, string displayName)
    {
        var normalizedEmail = EmailNormalizer.TryNormalize(email);
        if (normalizedEmail == null)
        {
            throw new ArgumentException("Email is not a valid email address.", nameof(email));
        }

        if (password == null || password.Length < 8)
        {
            throw new ArgumentException("Password must be at least 8 characters.", nameof(password));
        }

        if (string.IsNullOrWhiteSpace(displayName))
        {
            throw new ArgumentException("Display name is required.", nameof(displayName));
        }

        return normalizedEmail;
    }
}
