using Microsoft.EntityFrameworkCore;
using PostIt.Domain.Entities;
using System.Reflection;

namespace PostIt.Infrastructure.Persistence;

public class PostItDbContext : DbContext
{
    public PostItDbContext(DbContextOptions<PostItDbContext> options)
        : base(options)
    {
    }

    public DbSet<User> Users => Set<User>();
    public DbSet<Board> Boards => Set<Board>();
    public DbSet<BoardMember> BoardMembers => Set<BoardMember>();
    public DbSet<Note> Notes => Set<Note>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.HasDefaultSchema("public");
        modelBuilder.ApplyConfigurationsFromAssembly(Assembly.GetExecutingAssembly());
    }
}
