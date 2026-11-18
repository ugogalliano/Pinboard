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
    private const string TestJwtSecret = "test-secret-key-that-is-at-least-32-characters-long-for-hmac";

    // AddInfrastructure validates JwtSettings:Secret eagerly at composition
    // (Program.cs runs before the deferred in-memory sources from
    // ConfigureAppConfiguration are merged into the final host configuration).
    // Non-Development hosts have no JWT secret in appsettings.json, so the test
    // secret is also exposed via the environment, which the builder's default
    // configuration always reads. All factories in this assembly share the same
    // secret; the in-memory override below still wins for the final host.
    static TestWebApplicationFactory()
    {
        Environment.SetEnvironmentVariable("JwtSettings__Secret", TestJwtSecret);
    }

    private PostgreSqlContainer? _postgresContainer;
    private string _connectionString = $"DataSource=postit_test_{Guid.NewGuid()}.db";
    private bool _useFallback = true;

    public string EnvironmentName { get; set; } = "Development";
    public bool DisableRateLimiting { get; set; } = true;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(EnvironmentName);
        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = _connectionString,
                ["JwtSettings:Secret"] = TestJwtSecret,
                ["JwtSettings:Issuer"] = "PostItTest",
                ["JwtSettings:Audience"] = "PostItTest",
                ["DisableRateLimiting"] = DisableRateLimiting.ToString()
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
            try
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
            catch (Exception ex)
            {
                // Docker CLI is reachable but a container could not be started or
                // became ready (e.g. a loaded engine timing out). Fall back to
                // SQLite, same as when Docker is unavailable.
                Console.WriteLine($"Testcontainers PostgreSQL unavailable, falling back to SQLite: {ex.GetType().Name}: {ex.Message}");
                if (_postgresContainer != null)
                {
                    try
                    {
                        await _postgresContainer.DisposeAsync();
                    }
                    catch
                    {
                        // Best-effort cleanup of a container that never started.
                    }

                    _postgresContainer = null;
                }

                _connectionString = $"DataSource=postit_test_{Guid.NewGuid()}.db";
                _useFallback = true;
            }
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
