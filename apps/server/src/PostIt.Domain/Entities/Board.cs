namespace PostIt.Domain.Entities;

public class Board
{
    public Guid Id { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public Guid CreatedBy { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public DateTime UpdatedAt { get; private set; }

    public User Creator { get; private set; } = null!;
    public ICollection<BoardMember> Members { get; private set; } = new List<BoardMember>();
    public ICollection<Note> Notes { get; private set; } = new List<Note>();

    private Board() { }

    public Board(string name, Guid createdBy)
    {
        Id = Guid.NewGuid();
        Name = name;
        CreatedBy = createdBy;
        CreatedAt = DateTime.UtcNow;
        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdateName(string name)
    {
        Name = name;
        UpdatedAt = DateTime.UtcNow;
    }
}
