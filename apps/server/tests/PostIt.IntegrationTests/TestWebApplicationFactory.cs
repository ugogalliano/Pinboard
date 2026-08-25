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
    private PostgreSqlContainer? _postgresContainer;
    private string _connectionString = $"DataSource=postit_test_{Guid.NewGuid()}.db";
    private bool _useFallback = true;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = _connectionString,
                ["JwtSettings:Secret"] = "test-secret-key-that-is-at-least-32-characters-long-for-hmac",
                ["JwtSettings:Issuer"] = "PostItTest",
                ["JwtSettings:Audience"] = "PostItTest",
                ["DisableRateLimiting"] = "true"
            });
        });

        builder.ConfigureServices(services =>
        {
            var descriptor = services.SingleOrDefault(
                d => d.ServiceType == typeof(DbContextOptions<PostItDbContext>));
            if (descriptor != null)
            {
                services.Remove(descriptor);
            }

            if (_useFallback)
            {
                services.AddDbContext<PostItDbContext>(options =>
                {
                    options.UseSqlite(_connectionString);
                });
            }
            else
            {
                services.AddDbContext<PostItDbContext>(options =>
                {
                    options.UseNpgsql(
                        _connectionString,
                        npgsqlOptions => npgsqlOptions.MigrationsAssembly("PostIt.Api"));
                });
            }
        });
    }

    public async Task InitializeAsync()
    {
        if (IsDockerAvailable())
        {
            _postgresContainer = new PostgreSqlBuilder()
                .WithDatabase("postit_test")
                .WithUsername("postit")
                .WithPassword("postit")
                .WithImage("postgres:16-alpine")
                .Build();

            await _postgresContainer.StartAsync();
            _connectionString = _postgresContainer.GetConnectionString();
            _useFallback = false;
        }

        using var scope = Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<PostItDbContext>();

        if (_useFallback)
        {
            await context.Database.EnsureCreatedAsync();
        }
        else
        {
            await context.Database.MigrateAsync();
        }
    }

    public async new Task DisposeAsync()
    {
        if (_postgresContainer != null)
        {
            await _postgresContainer.StopAsync();
            await _postgresContainer.DisposeAsync();
        }

        if (_useFallback)
        {
            var dbPath = _connectionString.Replace("DataSource=", "");
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (File.Exists(dbPath))
            {
                File.Delete(dbPath);
            }
        }

        await base.DisposeAsync();
    }

    private static bool IsDockerAvailable()
    {
        try
        {
            var process = new System.Diagnostics.Process
            {
                StartInfo = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "docker",
                    Arguments = "ps",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };
            process.Start();
            process.WaitForExit(5000);
            return process.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }
}
