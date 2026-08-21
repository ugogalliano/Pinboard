using Microsoft.EntityFrameworkCore;

namespace PostIt.Infrastructure.Persistence;

public class PostItDbContext : DbContext
{
    public PostItDbContext(DbContextOptions<PostItDbContext> options)
        : base(options)
    {
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.HasDefaultSchema("public");
    }
}
