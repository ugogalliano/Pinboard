using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;

namespace PostIt.IntegrationTests;

public class HealthEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public HealthEndpointTests(WebApplicationFactory<Program> factory)
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
    public async Task Ping_Returns_Ok()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/ping");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }
}
