using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PostIt.Infrastructure;

namespace PostIt.UnitTests.Infrastructure;

public class DependencyInjectionTests
{
    [Fact]
    public void AddInfrastructure_ShortJwtSecret_Throws()
    {
        var configuration = BuildConfiguration("JwtSettings:Secret", "too-short-secret");

        var services = new ServiceCollection();

        var ex = Assert.Throws<InvalidOperationException>(() => services.AddInfrastructure(configuration));
        Assert.Contains("at least 32 characters", ex.Message);
    }

    [Fact]
    public void AddInfrastructure_ValidJwtSecret_Succeeds()
    {
        var configuration = BuildConfiguration(
            "JwtSettings:Secret",
            "test-secret-key-that-is-at-least-32-characters-long-for-hmac");

        var services = new ServiceCollection();

        services.AddInfrastructure(configuration);

        Assert.NotEmpty(services);
    }

    [Fact]
    public void AddInfrastructure_MissingJwtSecret_Throws()
    {
        // Fail fast at composition: an unconfigured signing key must never be
        // accepted and only blow up at first token issuance.
        var configuration = BuildConfiguration("JwtSettings:Issuer", "PostIt");

        var services = new ServiceCollection();

        var ex = Assert.Throws<InvalidOperationException>(() => services.AddInfrastructure(configuration));
        Assert.Contains("at least 32 characters", ex.Message);
    }

    [Fact]
    public void AddInfrastructure_WhitespaceJwtSecret_Throws()
    {
        var configuration = BuildConfiguration("JwtSettings:Secret", "   ");

        var services = new ServiceCollection();

        var ex = Assert.Throws<InvalidOperationException>(() => services.AddInfrastructure(configuration));
        Assert.Contains("at least 32 characters", ex.Message);
    }

    private static IConfiguration BuildConfiguration(string key, string value)
    {
        return new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                [key] = value,
                ["ConnectionStrings:DefaultConnection"] = "Host=localhost;Database=postit;Username=postgres;Password=postgres"
            })
            .Build();
    }
}
