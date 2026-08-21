using PostIt.Application.Interfaces;
using PostIt.Domain.Entities;

namespace PostIt.Infrastructure.Authentication;

public class PasswordHasher : IPasswordHasher
{
    private readonly Microsoft.AspNetCore.Identity.PasswordHasher<User> _passwordHasher = new();

    public string HashPassword(User user, string password)
    {
        return _passwordHasher.HashPassword(user, password);
    }

    public bool VerifyHashedPassword(User user, string hashedPassword, string providedPassword)
    {
        var result = _passwordHasher.VerifyHashedPassword(user, hashedPassword, providedPassword);
        return result == Microsoft.AspNetCore.Identity.PasswordVerificationResult.Success
            || result == Microsoft.AspNetCore.Identity.PasswordVerificationResult.SuccessRehashNeeded;
    }
}
