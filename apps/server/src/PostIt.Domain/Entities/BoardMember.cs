using PostIt.Domain.Enums;

namespace PostIt.Domain.Entities;

public class BoardMember
{
    public Guid Id { get; private set; }
    public Guid BoardId { get; private set; }
    public Guid UserId { get; private set; }
    public BoardRole Role { get; private set; }
    public DateTime CreatedAt { get; private set; }

    public Board Board { get; private set; } = null!;
    public User User { get; private set; } = null!;

    private BoardMember() { }

    public BoardMember(Guid boardId, Guid userId, BoardRole role)
    {
        Id = Guid.NewGuid();
        BoardId = boardId;
        UserId = userId;
        Role = role;
        CreatedAt = DateTime.UtcNow;
    }

    public void UpdateRole(BoardRole role)
    {
        Role = role;
    }
}
