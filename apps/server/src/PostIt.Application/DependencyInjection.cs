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
        services.AddScoped<IBoardMemberService, BoardMemberService>();
        services.AddScoped<IBoardAuthorizationService, BoardAuthorizationService>();
        services.AddScoped<INoteService, NoteService>();
        return services;
    }
}
