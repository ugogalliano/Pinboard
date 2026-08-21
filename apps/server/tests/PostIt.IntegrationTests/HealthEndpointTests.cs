using System.Net;
using System.Text.Json;

namespace PostIt.IntegrationTests;

public class HealthEndpointTests : IClassFixture<TestWebApplicationFactory>
{
    private readonly TestWebApplicationFactory _factory;

    public HealthEndpointTests(TestWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Health_Returns_Ok()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Health_Returns_Healthy_Status()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/health");
        response.EnsureSuccessStatusCode();

        var content = await response.Content.ReadAsStringAsync();
        using var document = JsonDocument.Parse(content);
        var root = document.RootElement;

        var status = root.GetProperty("status").GetString();
        Assert.Equal("Healthy", status);

        var checks = root.GetProperty("checks").EnumerateArray().ToList();
        var dbCheck = checks.Single(c => c.GetProperty("name").GetString() == "postgresql");
        Assert.Equal("Healthy", dbCheck.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Ping_Returns_Ok()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/ping");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
