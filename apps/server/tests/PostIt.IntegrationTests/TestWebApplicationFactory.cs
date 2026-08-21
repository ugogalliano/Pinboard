using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PostIt.Infrastructure.Persistence;
using Testcontainers.PostgreSql;

namespace PostIt.IntegrationTests;

public class TestWebApplicationFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgresContainer;

    public TestWebApplicationFactory()
    {
        _postgresContainer = new PostgreSqlBuilder()
            .WithDatabase("postit_test")
            .WithUsername("postit")
            .WithPassword("postit")
            .WithImage("postgres:16-alpine")
            .Build();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = _postgresContainer.GetConnectionString(),
                ["JwtSettings:Secret"] = "test-secret-key-that-is-at-least-32-characters-long-for-hmac",
                ["JwtSettings:Issuer"] = "PostItTest",
                ["JwtSettings:Audience"] = "PostItTest",
                ["DisableRateLimiting"] = "true"
            });
        });

        builder.ConfigureServices(services =>
        {
            // Remove any existing DbContext configuration
            var descriptor = services.SingleOrDefault(
                d => d.ServiceType == typeof(DbContextOptions<PostItDbContext>));
            if (descriptor != null)
            {
                services.Remove(descriptor);
            }

            services.AddDbContext<PostItDbContext>(options =>
            {
                options.UseNpgsql(
                    _postgresContainer.GetConnectionString(),
                    npgsqlOptions => npgsqlOptions.MigrationsAssembly("PostIt.Api"));
            });
        });
    }

    public async Task InitializeAsync()
    {
        await _postgresContainer.StartAsync();

        using var scope = Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<PostItDbContext>();
        await context.Database.MigrateAsync();
    }

    public async new Task DisposeAsync()
    {
        await _postgresContainer.StopAsync();
        await _postgresContainer.DisposeAsync();
        await base.DisposeAsync();
    }
}
