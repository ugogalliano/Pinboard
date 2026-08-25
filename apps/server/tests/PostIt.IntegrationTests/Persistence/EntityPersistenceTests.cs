using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PostIt.Domain.Entities;
using PostIt.Domain.Enums;
using PostIt.Infrastructure.Persistence;

namespace PostIt.IntegrationTests.Persistence;

public class EntityPersistenceTests : IClassFixture<TestWebApplicationFactory>
{
    private readonly TestWebApplicationFactory _factory;

    public EntityPersistenceTests(TestWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private PostItDbContext CreateContext()
    {
        var scope = _factory.Services.CreateScope();
        return scope.ServiceProvider.GetRequiredService<PostItDbContext>();
    }

    [Fact]
    public async Task Can_Create_And_Read_User()
    {
        using var context = CreateContext();
        await context.Database.EnsureCreatedAsync();

        var user = new User("persist@example.com", "hash", "Persist User");
        context.Users.Add(user);
        await context.SaveChangesAsync();

        context.ChangeTracker.Clear();

        var retrieved = await context.Users.FindAsync(user.Id);
        Assert.NotNull(retrieved);
        Assert.Equal("persist@example.com", retrieved.Email);
        Assert.Equal("Persist User", retrieved.DisplayName);
    }

    [Fact]
    public async Task Can_Create_And_Read_Board_With_Relationships()
    {
        using var context = CreateContext();
        await context.Database.EnsureCreatedAsync();

        var user = new User("board@example.com", "hash", "Board User");
        context.Users.Add(user);
        await context.SaveChangesAsync();

        var board = new Board("Test Board", user.Id);
        context.Boards.Add(board);
        await context.SaveChangesAsync();

        context.ChangeTracker.Clear();

        var retrieved = await context.Boards
            .Include(b => b.Creator)
            .FirstAsync(b => b.Id == board.Id);

        Assert.NotNull(retrieved);
        Assert.Equal("Test Board", retrieved.Name);
        Assert.Equal(user.Id, retrieved.CreatedBy);
        Assert.NotNull(retrieved.Creator);
        Assert.Equal("Board User", retrieved.Creator.DisplayName);
    }

    [Fact]
    public async Task Can_Create_And_Read_BoardMember()
    {
        using var context = CreateContext();
        await context.Database.EnsureCreatedAsync();

        var owner = new User("owner@example.com", "hash", "Owner");
        var member = new User("member@example.com", "hash", "Member");
        context.Users.AddRange(owner, member);
        await context.SaveChangesAsync();

        var board = new Board("Shared Board", owner.Id);
        context.Boards.Add(board);
        await context.SaveChangesAsync();

        var boardMember = new BoardMember(board.Id, member.Id, BoardRole.Editor);
        context.BoardMembers.Add(boardMember);
        await context.SaveChangesAsync();

        context.ChangeTracker.Clear();

        var retrieved = await context.BoardMembers
            .Include(bm => bm.Board)
            .Include(bm => bm.User)
            .FirstAsync(bm => bm.Id == boardMember.Id);

        Assert.NotNull(retrieved);
        Assert.Equal(BoardRole.Editor, retrieved.Role);
        Assert.Equal(board.Id, retrieved.BoardId);
        Assert.Equal(member.Id, retrieved.UserId);
    }

    [Fact]
    public async Task Duplicate_BoardMember_Is_Rejected()
    {
        using var context = CreateContext();
        await context.Database.EnsureCreatedAsync();

        var owner = new User("dup-owner@example.com", "hash", "Owner");
        var member = new User("dup-member@example.com", "hash", "Member");
        context.Users.AddRange(owner, member);
        await context.SaveChangesAsync();

        var board = new Board("Dup Board", owner.Id);
        context.Boards.Add(board);
        await context.SaveChangesAsync();

        var boardMember1 = new BoardMember(board.Id, member.Id, BoardRole.Viewer);
        context.BoardMembers.Add(boardMember1);
        await context.SaveChangesAsync();

        var boardMember2 = new BoardMember(board.Id, member.Id, BoardRole.Editor);
        context.BoardMembers.Add(boardMember2);

        await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
    }

    [Fact]
    public async Task Can_Create_And_Read_Note()
    {
        using var context = CreateContext();
        await context.Database.EnsureCreatedAsync();

        var user = new User("note@example.com", "hash", "Note User");
        context.Users.Add(user);
        await context.SaveChangesAsync();

        var board = new Board("Note Board", user.Id);
        context.Boards.Add(board);
        await context.SaveChangesAsync();

        var note = new Note(board.Id, user.Id, "Hello World", "pink", 50, 100);
        context.Notes.Add(note);
        await context.SaveChangesAsync();

        context.ChangeTracker.Clear();

        var retrieved = await context.Notes
            .Include(n => n.Board)
            .Include(n => n.Creator)
            .FirstAsync(n => n.Id == note.Id);

        Assert.NotNull(retrieved);
        Assert.Equal("Hello World", retrieved.Content);
        Assert.Equal("pink", retrieved.Color);
        Assert.Equal(50, retrieved.PositionX);
        Assert.Equal(100, retrieved.PositionY);
        Assert.NotNull(retrieved.Board);
        Assert.NotNull(retrieved.Creator);
    }

    [Fact]
    public async Task Board_Cascade_Deletes_Members_And_Notes()
    {
        using var context = CreateContext();
        await context.Database.EnsureCreatedAsync();

        var user = new User("cascade@example.com", "hash", "Cascade User");
        context.Users.Add(user);
        await context.SaveChangesAsync();

        var board = new Board("Cascade Board", user.Id);
        context.Boards.Add(board);
        await context.SaveChangesAsync();

        var member = new BoardMember(board.Id, user.Id, BoardRole.Owner);
        context.BoardMembers.Add(member);

        var note = new Note(board.Id, user.Id, "Cascade Note", "green", 0, 0);
        context.Notes.Add(note);
        await context.SaveChangesAsync();

        context.Boards.Remove(board);
        await context.SaveChangesAsync();

        context.ChangeTracker.Clear();

        Assert.Null(await context.Boards.FindAsync(board.Id));
        Assert.Null(await context.BoardMembers.FindAsync(member.Id));
        Assert.Null(await context.Notes.FindAsync(note.Id));
    }

    [Fact]
    public async Task Note_Creator_SetNull_On_User_Delete()
    {
        using var context = CreateContext();
        await context.Database.EnsureCreatedAsync();

        var user = new User("setnull@example.com", "hash", "SetNull User");
        context.Users.Add(user);
        await context.SaveChangesAsync();

        var board = new Board("SetNull Board", user.Id);
        context.Boards.Add(board);
        await context.SaveChangesAsync();

        var note = new Note(board.Id, user.Id, "SetNull Note", "blue", 0, 0);
        context.Notes.Add(note);
        await context.SaveChangesAsync();

        context.Users.Remove(user);
        await context.SaveChangesAsync();

        context.ChangeTracker.Clear();

        var retrievedBoard = await context.Boards.FindAsync(board.Id);
        Assert.Null(retrievedBoard); // Board cascade deleted because user created it

        // Note should be gone because board was cascade deleted
        var retrievedNote = await context.Notes.FindAsync(note.Id);
        Assert.Null(retrievedNote);
    }

    [Fact]
    public async Task Can_Query_Notes_By_BoardId()
    {
        using var context = CreateContext();
        await context.Database.EnsureCreatedAsync();

        var user = new User("query@example.com", "hash", "Query User");
        context.Users.Add(user);
        await context.SaveChangesAsync();

        var board1 = new Board("Board 1", user.Id);
        var board2 = new Board("Board 2", user.Id);
        context.Boards.AddRange(board1, board2);
        await context.SaveChangesAsync();

        var note1 = new Note(board1.Id, user.Id, "Note 1", "red", 0, 0);
        var note2 = new Note(board1.Id, user.Id, "Note 2", "red", 10, 10);
        var note3 = new Note(board2.Id, user.Id, "Note 3", "blue", 20, 20);
        context.Notes.AddRange(note1, note2, note3);
        await context.SaveChangesAsync();

        context.ChangeTracker.Clear();

        var board1Notes = await context.Notes
            .Where(n => n.BoardId == board1.Id)
            .ToListAsync();

        Assert.Equal(2, board1Notes.Count);
        Assert.Contains(board1Notes, n => n.Content == "Note 1");
        Assert.Contains(board1Notes, n => n.Content == "Note 2");
    }
}
