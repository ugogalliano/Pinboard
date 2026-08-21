using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PostIt.Domain.Entities;

namespace PostIt.Infrastructure.Persistence.Configurations;

public class NoteConfiguration : IEntityTypeConfiguration<Note>
{
    public void Configure(EntityTypeBuilder<Note> builder)
    {
        builder.ToTable("Notes");

        builder.HasKey(n => n.Id);

        builder.Property(n => n.BoardId)
            .IsRequired();

        builder.Property(n => n.Content)
            .IsRequired()
            .HasMaxLength(2000);

        builder.Property(n => n.Color)
            .IsRequired()
            .HasMaxLength(50);

        builder.Property(n => n.PositionX)
            .IsRequired();

        builder.Property(n => n.PositionY)
            .IsRequired();

        builder.Property(n => n.CreatedAt)
            .IsRequired();

        builder.Property(n => n.UpdatedAt)
            .IsRequired();

        builder.HasIndex(n => n.BoardId);

        builder.HasOne(n => n.Board)
            .WithMany(b => b.Notes)
            .HasForeignKey(n => n.BoardId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(n => n.Creator)
            .WithMany()
            .HasForeignKey(n => n.CreatedBy)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
