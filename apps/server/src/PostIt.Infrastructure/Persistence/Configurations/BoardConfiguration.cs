using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PostIt.Domain.Entities;

namespace PostIt.Infrastructure.Persistence.Configurations;

public class BoardConfiguration : IEntityTypeConfiguration<Board>
{
    public void Configure(EntityTypeBuilder<Board> builder)
    {
        builder.ToTable("Boards");

        builder.HasKey(b => b.Id);

        builder.Property(b => b.Name)
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(b => b.CreatedBy)
            .IsRequired();

        builder.Property(b => b.CreatedAt)
            .IsRequired();

        builder.Property(b => b.UpdatedAt)
            .IsRequired();

        builder.HasOne(b => b.Creator)
            .WithMany()
            .HasForeignKey(b => b.CreatedBy)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(b => b.Members)
            .WithOne(m => m.Board)
            .HasForeignKey(m => m.BoardId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(b => b.Notes)
            .WithOne(n => n.Board)
            .HasForeignKey(n => n.BoardId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
