using Rudzoft.ChessLib;
using Rudzoft.ChessLib.Factories;
using Rudzoft.ChessLib.MoveGeneration;
using Rudzoft.ChessLib.Notation;
using Rudzoft.ChessLib.Notation.Notations;
using Rudzoft.ChessLib.Types;
using Rudzoft.ChessLib.Enums;

namespace htchess.Client.Chess;

/// Wraps ChessLib: board state, selection, modes, undo, move list.
public sealed class GameSession
{
    private readonly IGame _game = GameFactory.Create();
    private readonly List<(Move Move, State State, string San)> _history = new();
    private readonly List<Move> _legal = new();

    public GameMode Mode { get; private set; } = GameMode.TwoPlayer;
    public bool HumanIsWhite { get; private set; } = true;

    public string? Selected { get; private set; }
    public List<string> SelectedTargets { get; } = new();
    public string? LastFrom { get; private set; }
    public string? LastTo { get; private set; }
    public bool AwaitingPromotion => _pendingPromoFrom is not null;

    private string? _pendingPromoFrom;
    private string? _pendingPromoTo;

    public GameSession()
    {
        _game.NewGame();
        RefreshLegal();
    }

    private IPosition Pos => _game.Pos;

    /// Live position for the AI (it makes/takes moves in place — call only between turns).
    public IPosition Position => _game.Pos;

    public bool WhiteToMove => Pos.SideToMove.IsWhite;
    public bool IsCheck => Pos.InCheck;
    public bool IsGameOver { get; private set; }
    public string? GameOverReason { get; private set; }
    public IReadOnlyList<(Move Move, string San)> History => _history.Select(h => (h.Move, h.San)).ToList();
    public int PlyCount => _history.Count;

    public void NewGame(GameMode mode, bool humanIsWhite)
    {
        Mode = mode;
        HumanIsWhite = humanIsWhite;
        _game.NewGame();
        _history.Clear();
        Selected = null;
        SelectedTargets.Clear();
        LastFrom = LastTo = null;
        _pendingPromoFrom = _pendingPromoTo = null;
        IsGameOver = false;
        GameOverReason = null;
        RefreshLegal();
    }

    private void RefreshLegal()
    {
        _legal.Clear();
        var pos = Pos;
        var ml = new MoveList();
        ml.Generate(in pos, MoveGenerationType.Legal);
        foreach (var em in ml)
            _legal.Add(em.Move);
        UpdateGameOver();
    }

    private void UpdateGameOver()
    {
        if (_legal.Count == 0)
        {
            IsGameOver = true;
            GameOverReason = Pos.InCheck
                ? (WhiteToMove ? "Chiếu hết — Đen thắng" : "Chiếu hết — Trắng thắng")
                : "Hòa — hết nước đi (stalemate)";
        }
        else if (Pos.IsRepetition || Pos.Rule50 >= 100)
        {
            IsGameOver = true;
            GameOverReason = "Hòa — lặp nước / luật 50 nước";
        }
        else
        {
            IsGameOver = false;
            GameOverReason = null;
        }
    }

    public bool SideToMoveIsHuman => Mode == GameMode.TwoPlayer || WhiteToMove == HumanIsWhite;

    public static string TypeChar(PieceTypes t) => t switch
    {
        PieceTypes.Pawn => "P",
        PieceTypes.Knight => "N",
        PieceTypes.Bishop => "B",
        PieceTypes.Rook => "R",
        PieceTypes.Queen => "Q",
        PieceTypes.King => "K",
        _ => "?",
    };

    public List<PieceDto> GetPosition()
    {
        var list = new List<PieceDto>(32);
        for (var i = 0; i < 64; i++)
        {
            Square sq = new(i);
            var p = Pos.GetPiece(sq);
            if (p == Piece.EmptyPiece) continue;
            list.Add(new PieceDto(sq.ToString(), TypeChar(p.Type()), p.ColorOf().IsWhite ? "w" : "b"));
        }
        return list;
    }

    public string? CheckedKingSquare()
    {
        if (!Pos.InCheck) return null;
        return Pos.GetKingSquare(Pos.SideToMove).ToString();
    }

    /// Handle a board click. Returns what the UI should do.
    public ClickOutcome Click(string squareName)
    {
        if (IsGameOver || !SideToMoveIsHuman) return new(ClickResult.Ignored);
        Square sq = squareName;

        // pending promotion: only the picker resolves it
        if (AwaitingPromotion) return new(ClickResult.Ignored);

        // clicked a legal target of current selection
        if (Selected is not null && SelectedTargets.Contains(squareName))
            return TryCommit(Selected, squareName, null);

        // clicked own piece -> select
        var piece = Pos.GetPiece(sq);
        if (piece != Piece.EmptyPiece && piece.ColorOf().IsWhite == WhiteToMove)
        {
            Selected = squareName;
            SelectedTargets.Clear();
            SelectedTargets.AddRange(_legal
                .Where(m => m.FromSquare().ToString() == squareName)
                .Select(m => m.ToSquare().ToString())
                .Distinct());
            return new(ClickResult.Selected);
        }

        Selected = null;
        SelectedTargets.Clear();
        return new(ClickResult.Deselected);
    }

    /// Picker answered with promo type char: 'Q','R','B','N'.
    public ClickOutcome? ResolvePromotion(string promo)
    {
        if (_pendingPromoFrom is null || _pendingPromoTo is null) return null;
        var outcome = TryCommit(_pendingPromoFrom, _pendingPromoTo, promo);
        _pendingPromoFrom = _pendingPromoTo = null;
        return outcome;
    }

    private ClickOutcome TryCommit(string from, string to, string? promo)
    {
        var candidates = _legal
            .Where(m => m.FromSquare().ToString() == from && m.ToSquare().ToString() == to)
            .ToList();
        if (candidates.Count == 0) return new(ClickResult.Ignored);

        if (candidates.Any(m => m.IsPromotionMove()))
        {
            if (promo is null)
            {
                _pendingPromoFrom = from;
                _pendingPromoTo = to;
                return new(ClickResult.NeedsPromotion);
            }
            var want = promo[0] switch
            {
                'Q' => PieceTypes.Queen,
                'R' => PieceTypes.Rook,
                'B' => PieceTypes.Bishop,
                _ => PieceTypes.Knight,
            };
            candidates = candidates.Where(m => m.PromotedPieceType() == want).ToList();
        }

        var applied = ApplyMove(candidates[0]);
        Selected = null;
        SelectedTargets.Clear();
        return new(ClickResult.MoveApplied, applied);
    }

    /// Applies a move: records SAN + history, updates flags, returns JS payload.
    public AppliedMove ApplyMove(Move move)
    {
        var san = MoveNotation.Create(Pos).ToNotation(MoveNotations.San).Convert(move);
        var captured = CapturedSquareOf(move);
        string? rookFrom = null, rookTo = null;
        if (move.IsCastleMove())
        {
            var to = move.ToSquare();
            var kingSide = to.FileChar == 'g';
            rookFrom = (kingSide ? "h" : "a") + to.RankChar;
            rookTo = (kingSide ? "f" : "d") + to.RankChar;
        }
        var st = new State();
        Pos.MakeMove(move, in st);
        _history.Add((move, st, san));
        LastFrom = move.FromSquare().ToString();
        LastTo = move.ToSquare().ToString();
        RefreshLegal();

        return new AppliedMove(
            LastFrom, LastTo,
            CapturedSquare: captured,
            RookFrom: rookFrom,
            RookTo: rookTo,
            PromoteTo: move.IsPromotionMove() ? TypeChar(move.PromotedPieceType()) : null);
    }

    private string? CapturedSquareOf(Move move)
    {
        var to = move.ToSquare();
        if (move.IsEnPassantMove())
            return "" + to.FileChar + move.FromSquare().RankChar;
        return Pos.GetPiece(to) != Piece.EmptyPiece ? to.ToString() : null;
    }

    public IReadOnlyList<Move> LegalMoves => _legal;

    /// Undo n plies (default: 1 in 2P mode, 2 vs AI so the human gets the turn back).
    public void Undo()
    {
        var plies = Mode == GameMode.VsAi ? 2 : 1;
        for (var i = 0; i < plies && _history.Count > 0; i++)
        {
            var (move, _, _) = _history[^1];
            _history.RemoveAt(_history.Count - 1);
            Pos.TakeMove(move);
        }
        var hasLast = _history.Count > 0;
        LastFrom = hasLast ? _history[^1].Move.FromSquare().ToString() : null;
        LastTo = hasLast ? _history[^1].Move.ToSquare().ToString() : null;
        Selected = null;
        SelectedTargets.Clear();
        _pendingPromoFrom = _pendingPromoTo = null;
        RefreshLegal();
    }

    /// Captured pieces, derived from piece counts. Returns e.g. ['q','p','p'] (black pieces white captured).
    public List<string> CapturedByWhite() => Captured(wantWhite: false);
    public List<string> CapturedByBlack() => Captured(wantWhite: true);

    private List<string> Captured(bool wantWhite)
    {
        var start = new Dictionary<char, int> { ['P'] = 8, ['N'] = 2, ['B'] = 2, ['R'] = 2, ['Q'] = 1 };
        var cur = new Dictionary<char, int>(start) { };
        foreach (var d in GetPosition())
            if ((d.Color == "w") == wantWhite && d.Type != "K")
                cur[d.Type[0]]--;
        var lost = new List<string>();
        foreach (var (t, n) in cur)
            for (var i = 0; i < n; i++)
                lost.Add(wantWhite ? char.ToLowerInvariant(t).ToString() : t.ToString());
        return lost;
    }
}
