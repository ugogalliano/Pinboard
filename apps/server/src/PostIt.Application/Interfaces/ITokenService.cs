using PostIt.Domain.Entities;

namespace PostIt.Application.Interfaces;

public interface ITokenService
{
    string GenerateAccessToken(User user);
    string GenerateRefreshToken();
    Guid? GetUserIdFromAccessToken(string accessToken);
}
