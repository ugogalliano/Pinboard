using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PostIt.Domain.Entities;

namespace PostIt.Infrastructure.Persistence.Configurations;

public class BoardMemberConfiguration : IEntityTypeConfiguration<BoardMember>
{
    public void Configure(EntityTypeBuilder<BoardMember> builder)
    {
        builder.ToTable("BoardMembers");

        builder.HasKey(m => m.Id);

        builder.Property(m => m.BoardId)
            .IsRequired();

        builder.Property(m => m.UserId)
            .IsRequired();

        builder.Property(m => m.Role)
            .IsRequired()
            .HasConversion<string>()
            .HasMaxLength(20);

        builder.Property(m => m.CreatedAt)
            .IsRequired();

        builder.HasIndex(m => new { m.BoardId, m.UserId })
            .IsUnique();

        builder.HasOne(m => m.Board)
            .WithMany(b => b.Members)
            .HasForeignKey(m => m.BoardId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(m => m.User)
            .WithMany()
            .HasForeignKey(m => m.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
