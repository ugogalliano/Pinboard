using PostIt.Application.DTOs;
using PostIt.Application.Interfaces;
using PostIt.Domain.Entities;
using PostIt.Domain.Enums;

namespace PostIt.Application.Services;

public class BoardMemberService : IBoardMemberService
{
    private readonly IBoardRepository _boardRepository;
    private readonly IBoardMemberRepository _boardMemberRepository;
    private readonly IBoardAuthorizationService _authorizationService;
    private readonly IUserRepository _userRepository;

    public BoardMemberService(
        IBoardRepository boardRepository,
        IBoardMemberRepository boardMemberRepository,
        IBoardAuthorizationService authorizationService,
        IUserRepository userRepository)
    {
        _boardRepository = boardRepository;
        _boardMemberRepository = boardMemberRepository;
        _authorizationService = authorizationService;
        _userRepository = userRepository;
    }

    public async Task<IReadOnlyList<BoardMemberDto>> GetMembersAsync(Guid userId, Guid boardId, CancellationToken cancellationToken = default)
    {
        var board = await _boardRepository.GetByIdAsync(boardId, cancellationToken);
        if (board == null)
        {
            throw new KeyNotFoundException($"Board with id {boardId} not found.");
        }

        if (!await _authorizationService.CanReadBoardAsync(userId, boardId, cancellationToken))
        {
            throw new UnauthorizedAccessException("You are not a member of this board.");
        }

        var members = await _boardMemberRepository.GetMembersByBoardAsync(boardId, cancellationToken);
        return members.Select(MapToDto).ToList();
    }

    public async Task<BoardMemberDto> AddMemberAsync(Guid userId, Guid boardId, AddMemberRequest request, CancellationToken cancellationToken = default)
    {
        if (!await _authorizationService.CanManageMembersAsync(userId, boardId, cancellationToken))
        {
            throw new UnauthorizedAccessException("Only the board owner can manage members.");
        }

        var board = await _boardRepository.GetByIdAsync(boardId, cancellationToken);
        if (board == null)
        {
            throw new KeyNotFoundException($"Board with id {boardId} not found.");
        }

        var targetUser = await _userRepository.GetByEmailAsync(request.Email, cancellationToken);
        if (targetUser == null)
        {
            throw new KeyNotFoundException($"User with email {request.Email} not found.");
        }

        if (await _boardMemberRepository.IsMemberAsync(boardId, targetUser.Id, cancellationToken))
        {
            throw new InvalidOperationException("User is already a member of this board.");
        }

        if (!Enum.TryParse<BoardRole>(request.Role, out var role) || role == BoardRole.Owner)
        {
            throw new ArgumentException("Role must be Editor or Viewer.", nameof(request.Role));
        }

        var member = new BoardMember(boardId, targetUser.Id, role);
        await _boardMemberRepository.AddAsync(member, cancellationToken);
        await _boardMemberRepository.SaveChangesAsync(cancellationToken);

        return new BoardMemberDto(targetUser.Id, targetUser.Email, targetUser.DisplayName, role.ToString(), member.CreatedAt);
    }

    public async Task<BoardMemberDto> UpdateMemberAsync(Guid userId, Guid boardId, Guid memberUserId, UpdateMemberRequest request, CancellationToken cancellationToken = default)
    {
        if (!await _authorizationService.CanManageMembersAsync(userId, boardId, cancellationToken))
        {
            throw new UnauthorizedAccessException("Only the board owner can manage members.");
        }

        var board = await _boardRepository.GetByIdAsync(boardId, cancellationToken);
        if (board == null)
        {
            throw new KeyNotFoundException($"Board with id {boardId} not found.");
        }

        var member = await _boardMemberRepository.GetByBoardAndUserAsync(boardId, memberUserId, cancellationToken);
        if (member == null)
        {
            throw new KeyNotFoundException($"Member with user id {memberUserId} not found on this board.");
        }

        if (member.Role == BoardRole.Owner)
        {
            throw new InvalidOperationException("Cannot change the role of an Owner.");
        }

        if (!Enum.TryParse<BoardRole>(request.Role, out var role) || role == BoardRole.Owner)
        {
            throw new ArgumentException("Role must be Editor or Viewer.", nameof(request.Role));
        }

        member.UpdateRole(role);
        await _boardMemberRepository.SaveChangesAsync(cancellationToken);

        return MapToDto(member);
    }

    public async Task DeleteMemberAsync(Guid userId, Guid boardId, Guid memberUserId, CancellationToken cancellationToken = default)
    {
        if (!await _authorizationService.CanManageMembersAsync(userId, boardId, cancellationToken))
        {
            throw new UnauthorizedAccessException("Only the board owner can manage members.");
        }

        var board = await _boardRepository.GetByIdAsync(boardId, cancellationToken);
        if (board == null)
        {
            throw new KeyNotFoundException($"Board with id {boardId} not found.");
        }

        var member = await _boardMemberRepository.GetByBoardAndUserAsync(boardId, memberUserId, cancellationToken);
        if (member == null)
        {
            throw new KeyNotFoundException($"Member with user id {memberUserId} not found on this board.");
        }

        if (member.Role == BoardRole.Owner)
        {
            var members = await _boardMemberRepository.GetMembersByBoardAsync(boardId, cancellationToken);
            var ownerCount = members.Count(m => m.Role == BoardRole.Owner);
            if (ownerCount <= 1)
            {
                throw new InvalidOperationException("Cannot remove the last Owner.");
            }
        }

        await _boardMemberRepository.DeleteAsync(member, cancellationToken);
        await _boardMemberRepository.SaveChangesAsync(cancellationToken);
    }

    private static BoardMemberDto MapToDto(BoardMember member)
    {
        return new BoardMemberDto(
            member.UserId,
            member.User.Email,
            member.User.DisplayName,
            member.Role.ToString(),
            member.CreatedAt);
    }
}
