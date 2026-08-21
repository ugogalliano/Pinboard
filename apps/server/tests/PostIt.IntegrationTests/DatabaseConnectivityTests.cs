using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PostIt.Infrastructure.Persistence;

namespace PostIt.IntegrationTests;

public class DatabaseConnectivityTests : IClassFixture<TestWebApplicationFactory>
{
    private readonly TestWebApplicationFactory _factory;

    public DatabaseConnectivityTests(TestWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Can_Connect_To_Database()
    {
        using var scope = _factory.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<PostItDbContext>();

        var canConnect = await context.Database.CanConnectAsync();

        Assert.True(canConnect);
    }

    [Fact]
    public async Task Can_Apply_Migrations()
    {
        using var scope = _factory.Services.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<PostItDbContext>();

        await context.Database.MigrateAsync();

        var appliedMigrations = await context.Database.GetAppliedMigrationsAsync();
        Assert.NotEmpty(appliedMigrations);
    }
}
