using Microsoft.Extensions.DependencyInjection;
using PostIt.Application.Interfaces;
using PostIt.Application.Services;

namespace PostIt.Application;
public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<IAuthService, AuthService>();
        services.AddScoped<IBoardService, BoardService>();
        services.AddScoped<IBoardAuthorizationService, BoardAuthorizationService>();
        return services;
    }
}
