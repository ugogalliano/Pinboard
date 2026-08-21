using PostIt.Domain.Entities;

namespace PostIt.Application.Interfaces;

public interface IPasswordHasher
{
    string HashPassword(User user, string password);
    bool VerifyHashedPassword(User user, string hashedPassword, string providedPassword);
}
