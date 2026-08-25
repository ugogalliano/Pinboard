using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PostIt.Application.DTOs;
using PostIt.Application.Interfaces;

namespace PostIt.Api.Controllers;

[ApiController]
[Route("api/boards")]
[Authorize]
public class BoardsController : ControllerBase
{
    private readonly IBoardService _boardService;
    private readonly IBoardMemberService _boardMemberService;

    public BoardsController(IBoardService boardService, IBoardMemberService boardMemberService)
    {
        _boardService = boardService;
        _boardMemberService = boardMemberService;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<BoardDto>>> GetBoards(CancellationToken cancellationToken)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized();
        }

        var boards = await _boardService.GetBoardsForUserAsync(userId.Value, cancellationToken);
        return Ok(boards);
    }

    [HttpPost]
    public async Task<ActionResult<BoardDto>> CreateBoard(CreateBoardRequest request, CancellationToken cancellationToken)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized();
        }

        try
        {
            var board = await _boardService.CreateBoardAsync(userId.Value, request, cancellationToken);
            return Ok(board);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpGet("{boardId:guid}")]
    public async Task<ActionResult<BoardDto>> GetBoard(Guid boardId, CancellationToken cancellationToken)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized();
        }

        try
        {
            var board = await _boardService.GetBoardAsync(userId.Value, boardId, cancellationToken);
            return Ok(board);
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    [HttpPut("{boardId:guid}")]
    public async Task<ActionResult<BoardDto>> UpdateBoard(Guid boardId, UpdateBoardRequest request, CancellationToken cancellationToken)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized();
        }

        try
        {
            var board = await _boardService.UpdateBoardAsync(userId.Value, boardId, request, cancellationToken);
            return Ok(board);
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpDelete("{boardId:guid}")]
    public async Task<IActionResult> DeleteBoard(Guid boardId, CancellationToken cancellationToken)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized();
        }

        try
        {
            await _boardService.DeleteBoardAsync(userId.Value, boardId, cancellationToken);
            return NoContent();
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    [HttpGet("{boardId:guid}/members")]
    public async Task<ActionResult<IReadOnlyList<BoardMemberDto>>> GetMembers(Guid boardId, CancellationToken cancellationToken)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized();
        }

        try
        {
            var members = await _boardMemberService.GetMembersAsync(userId.Value, boardId, cancellationToken);
            return Ok(members);
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
    }

    [HttpPost("{boardId:guid}/members")]
    public async Task<ActionResult<BoardMemberDto>> AddMember(Guid boardId, AddMemberRequest request, CancellationToken cancellationToken)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized();
        }

        try
        {
            var member = await _boardMemberService.AddMemberAsync(userId.Value, boardId, request, cancellationToken);
            return Ok(member);
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpPut("{boardId:guid}/members/{memberUserId:guid}")]
    public async Task<ActionResult<BoardMemberDto>> UpdateMember(Guid boardId, Guid memberUserId, UpdateMemberRequest request, CancellationToken cancellationToken)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized();
        }

        try
        {
            var member = await _boardMemberService.UpdateMemberAsync(userId.Value, boardId, memberUserId, request, cancellationToken);
            return Ok(member);
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    [HttpDelete("{boardId:guid}/members/{memberUserId:guid}")]
    public async Task<IActionResult> DeleteMember(Guid boardId, Guid memberUserId, CancellationToken cancellationToken)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized();
        }

        try
        {
            await _boardMemberService.DeleteMemberAsync(userId.Value, boardId, memberUserId, cancellationToken);
            return NoContent();
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
        catch (UnauthorizedAccessException)
        {
            return Forbid();
        }
        catch (InvalidOperationException ex)
        {
            return Conflict(new { error = ex.Message });
        }
    }

    private Guid? GetCurrentUserId()
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)
            ?? User.FindFirst("sub");

        if (userIdClaim == null || !Guid.TryParse(userIdClaim.Value, out var userId))
        {
            return null;
        }

        return userId;
    }
}
