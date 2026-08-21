namespace PostIt.Domain.Entities;

public class Note
{
    public Guid Id { get; private set; }
    public Guid BoardId { get; private set; }
    public Guid? CreatedBy { get; private set; }
    public string Content { get; private set; } = string.Empty;
    public string Color { get; private set; } = string.Empty;
    public int PositionX { get; private set; }
    public int PositionY { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public DateTime UpdatedAt { get; private set; }

    public Board Board { get; private set; } = null!;
    public User? Creator { get; private set; }

    private Note() { }

    public Note(Guid boardId, Guid? createdBy, string content, string color, int positionX, int positionY)
    {
        Id = Guid.NewGuid();
        BoardId = boardId;
        CreatedBy = createdBy;
        Content = content;
        Color = color;
        PositionX = positionX;
        PositionY = positionY;
        CreatedAt = DateTime.UtcNow;
        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdateContent(string content)
    {
        Content = content;
        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdateColor(string color)
    {
        Color = color;
        UpdatedAt = DateTime.UtcNow;
    }

    public void UpdatePosition(int positionX, int positionY)
    {
        PositionX = positionX;
        PositionY = positionY;
        UpdatedAt = DateTime.UtcNow;
    }
}
