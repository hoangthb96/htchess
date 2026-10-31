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
    // position-key -> occurrence count, for a true threefold check
    // (ChessLib's IsRepetition fires at 2-fold, a search heuristic; State.Key is
    // the pre-move key, so key on FEN fields 1-4 instead)
    private readonly Dictionary<string, int> _repCount = new();
    // FEN after every ply (index 0 = start position) for move navigation
    private readonly List<string> _fens = new();

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
        _fens.Add(Pos.FenNotation);
        TrackPosition();
        RefreshLegal();
    }

    private IPosition Pos => _game.Pos;

    /// Live position for the AI (it makes/takes moves in place — call only between turns).
    public IPosition Position => _game.Pos;

    public bool WhiteToMove => Pos.SideToMove.IsWhite;
    public bool IsCheck => Pos.InCheck;
    public bool IsGameOver { get; private set; }
    public string? GameOverReason { get; private set; }
    /// "1-0", "0-1", "½-½" or null while playing.
    public string? ResultTag { get; private set; }

    public string? PremoveFrom { get; private set; }
    public string? PremoveTo { get; private set; }
    public IReadOnlyList<(Move Move, string San)> History => _history.Select(h => (h.Move, h.San)).ToList();
    public int PlyCount => _history.Count;

    public void NewGame(GameMode mode, bool humanIsWhite) => ResetTo(mode, humanIsWhite, null);

    /// Start a game from a FEN string (setup positions / takeback experiments).
    public void NewGameFromFen(string fen, GameMode mode, bool humanIsWhite) => ResetTo(mode, humanIsWhite, fen);

    private void ResetTo(GameMode mode, bool humanIsWhite, string? fen)
    {
        Mode = mode;
        HumanIsWhite = humanIsWhite;
        if (fen is null) _game.NewGame(); else _game.NewGame(fen);
        _history.Clear();
        Selected = null;
        SelectedTargets.Clear();
        LastFrom = LastTo = null;
        _pendingPromoFrom = _pendingPromoTo = null;
        PremoveFrom = PremoveTo = null;
        IsGameOver = false;
        GameOverReason = null;
        ResultTag = null;
        _fens.Clear();
        _fens.Add(Pos.FenNotation);
        _repCount.Clear();
        TrackPosition();
        RefreshLegal();
    }

    /// Piece list of the position after ply `ply` (0 = start). For move navigation.
    public List<PieceDto> PiecesAt(int ply) => ParseFenBoard(_fens[Math.Clamp(ply, 0, _fens.Count - 1)]);

    /// Displayed from/to of the move at history index `plyIndex` (castle = king squares).
    public (string From, string To)? MoveSquaresOf(int plyIndex)
    {
        if (plyIndex < 0 || plyIndex >= _history.Count) return null;
        var m = _history[plyIndex].Move;
        return (m.FromSquare().ToString(), CastleKingDest(m) ?? m.ToSquare().ToString());
    }

    private static List<PieceDto> ParseFenBoard(string fen)
    {
        var list = new List<PieceDto>(32);
        var rows = fen.Split(' ')[0].Split('/');
        for (var r = 0; r < 8; r++)
        {
            var file = 0;
            foreach (var ch in rows[r])
            {
                if (char.IsDigit(ch)) { file += ch - '0'; continue; }
                var sq = $"{(char)('a' + file)}{8 - r}";
                list.Add(new PieceDto(sq, char.ToUpperInvariant(ch).ToString(),
                    char.IsUpper(ch) ? "w" : "b"));
                file++;
            }
        }
        return list;
    }

    private string PosKey => string.Join(' ', Pos.FenNotation.Split(' ').Take(4));
    private void TrackPosition() => _repCount[PosKey] = _repCount.GetValueOrDefault(PosKey) + 1;
    private void UntrackPosition()
    {
        var k = PosKey;
        if (_repCount.TryGetValue(k, out var n)) _repCount[k] = n - 1;
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
            End(Pos.InCheck
                ? (WhiteToMove ? "Chiếu hết — Đen thắng" : "Chiếu hết — Trắng thắng")
                : "Hòa — hết nước đi (stalemate)",
                Pos.InCheck ? (WhiteToMove ? "0-1" : "1-0") : "½-½");
        }
        else if (_repCount.GetValueOrDefault(PosKey) >= 3)
        {
            End("Hòa — lặp nước 3 lần", "½-½");
        }
        else if (Pos.Rule50 >= 100)
        {
            End("Hòa — luật 50 nước", "½-½");
        }
        else if (InsufficientMaterial())
        {
            End("Hòa — không đủ quân chiếu hết", "½-½");
        }
        else
        {
            IsGameOver = false;
            GameOverReason = null;
            ResultTag = null;
        }
    }

    private void End(string reason, string tag)
    {
        IsGameOver = true;
        GameOverReason = reason;
        ResultTag = tag;
        Selected = null;
        SelectedTargets.Clear();
        PremoveFrom = PremoveTo = null;
        _pendingPromoFrom = _pendingPromoTo = null;
    }

    /// Lichess-style: K vs K, K+minor vs K, or bishops-only on same colour.
    private bool InsufficientMaterial()
    {
        var minors = new List<PieceDto>();
        foreach (var p in GetPosition())
        {
            if (p.Type is "P" or "R" or "Q") return false;
            if (p.Type != "K") minors.Add(p);
        }
        if (minors.Count == 0) return true;
        if (minors.Count == 1) return true;
        return minors.All(p => p.Type == "B") &&
               minors.Select(p => SqColor(p.Square)).Distinct().Count() == 1;
    }

    private static int SqColor(string sq) => (sq[0] - 'a' + sq[1] - '1') & 1;

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
        if (IsGameOver || AwaitingPromotion) return new(ClickResult.Ignored);
        Square sq = squareName;
        var piece = Pos.GetPiece(sq);

        // premove path: vs AI while the machine is thinking
        if (!SideToMoveIsHuman)
        {
            var ownHuman = piece != Piece.EmptyPiece && piece.ColorOf().IsWhite == HumanIsWhite;
            if (PremoveFrom is not null && PremoveTo is null && squareName != PremoveFrom)
            {
                PremoveTo = squareName;
                return new(ClickResult.PremoveSet);
            }
            if (ownHuman)
            {
                PremoveFrom = PremoveFrom == squareName ? null : squareName;
                PremoveTo = null;
                return new(ClickResult.PremoveSelect);
            }
            PremoveFrom = PremoveTo = null;
            return new(ClickResult.Ignored);
        }

        // human's turn now: a half-entered premove resolves as a normal move
        if (PremoveFrom is not null)
        {
            var from = PremoveFrom;
            PremoveFrom = PremoveTo = null;
            if (squareName != from && FindCandidates(from, squareName).Count > 0)
                return TryCommit(from, squareName, null);
        }

        // clicked a legal target of current selection (incl. own-rook castle squares)
        if (Selected is not null && FindCandidates(Selected, squareName).Count > 0)
            return TryCommit(Selected, squareName, null);

        // clicked own piece -> select
        if (piece != Piece.EmptyPiece && piece.ColorOf().IsWhite == WhiteToMove)
        {
            Selected = squareName;
            SelectedTargets.Clear();
            SelectedTargets.AddRange(_legal
                .Where(m => m.FromSquare().ToString() == squareName)
                .Select(DisplayTarget)
                .Distinct());
            return new(ClickResult.Selected);
        }

        Selected = null;
        SelectedTargets.Clear();
        return new(ClickResult.Deselected);
    }

    /// After the opponent moves, fire the queued premove if still legal.
    /// Returns the applied move, or null when the premove is illegal now.
    public AppliedMove? TryPlayPremove()
    {
        if (PremoveFrom is null) return null;
        var from = PremoveFrom; var to = PremoveTo;
        PremoveFrom = PremoveTo = null;
        if (!SideToMoveIsHuman || IsGameOver) return null;

        // half-entered premove: keep the piece selected so the destination click plays it
        if (to is null)
        {
            Selected = from;
            SelectedTargets.Clear();
            SelectedTargets.AddRange(_legal
                .Where(m => m.FromSquare().ToString() == from)
                .Select(DisplayTarget)
                .Distinct());
            return null;
        }

        var candidates = FindCandidates(from, to);
        if (candidates.Count == 0) return null;
        // lichess premoves auto-promote to queen
        var move = candidates.Any(m => m.IsPromotionMove())
            ? candidates.First(m => m.PromotedPieceType() == PieceTypes.Queen)
            : candidates[0];
        return ApplyMove(move);
    }

    /// ChessLib encodes castling as king->rook square (e1h1). Display/accept the
    /// king's destination square (g1) like lichess instead.
    private static string? CastleKingDest(Move m)
    {
        if (!m.IsCastleMove()) return null;
        var rook = m.ToSquare();
        return (rook.FileChar == 'h' ? "g" : "c") + rook.RankChar.ToString();
    }

    /// Square shown as a target dot (and accepted as a click) for a move.
    private static string DisplayTarget(Move m) => CastleKingDest(m) ?? m.ToSquare().ToString();

    private List<Move> FindCandidates(string from, string to) => _legal
        .Where(m => m.FromSquare().ToString() == from &&
                    (DisplayTarget(m) == to || m.ToSquare().ToString() == to))
        .ToList();

    /// Right-click: drop selection and premove without making a move.
    public void ClearSelection()
    {
        Selected = null;
        SelectedTargets.Clear();
        PremoveFrom = PremoveTo = null;
    }

    /// Side to move resigns (vs AI: the human resigns).
    public void Resign()
    {
        if (IsGameOver) return;
        var resignerWhite = Mode == GameMode.VsAi ? HumanIsWhite : WhiteToMove;
        End(resignerWhite ? "Trắng đầu hàng — Đen thắng" : "Đen đầu hàng — Trắng thắng",
            resignerWhite ? "0-1" : "1-0");
    }

    /// Draw request. 2P: agreement (always accepted). vs AI: accepted unless the AI is better.
    public bool OfferDraw()
    {
        if (IsGameOver) return false;
        if (Mode == GameMode.TwoPlayer || !AiIsWinning())
        {
            End("Hòa — hai bên đồng ý", "½-½");
            return true;
        }
        return false;
    }

    private bool AiIsWinning()
    {
        // Evaluate is side-to-move relative; ask whether the AI is ahead.
        var aiIsWhite = !HumanIsWhite;
        var score = SimpleAi.EvaluateBoard(Pos); // + favors white
        return aiIsWhite ? score > 100 : score < -100;
    }

    /// Clock flag fell. whiteFlagged = white ran out of time.
    public void Flag(bool whiteFlagged)
    {
        if (IsGameOver) return;
        var winnerCanMate = SideHasMatingMaterial(!whiteFlagged);
        if (winnerCanMate)
            End(whiteFlagged ? "Trắng hết giờ — Đen thắng" : "Đen hết giờ — Trắng thắng",
                whiteFlagged ? "0-1" : "1-0");
        else
            End("Hết giờ — hòa (đối phương không đủ quân chiếu hết)", "½-½");
    }

    private bool SideHasMatingMaterial(bool white)
    {
        var minors = 0;
        foreach (var p in GetPosition())
        {
            if (p.Color == (white ? "w" : "b"))
            {
                if (p.Type is "P" or "R" or "Q") return true;
                if (p.Type != "K") minors++;
            }
        }
        return minors >= 2; // two minors can still deliver mate (bare king vs K+NN is possible)
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
        var candidates = FindCandidates(from, to);
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
        // ChessLib emits "ep" + from-file + to ("eped6"); real SAN is "exd6"
        if (move.IsEnPassantMove() && san.Length > 3 && san.StartsWith("ep"))
            san = san[2] + "x" + san[3..];
        var captured = CapturedSquareOf(move);
        string? rookFrom = null, rookTo = null;
        // ChessLib encodes castle as king->rook square; the king's real landing is g/c file
        var kingDest = CastleKingDest(move) ?? move.ToSquare().ToString();
        if (move.IsCastleMove())
        {
            var rook = move.ToSquare();
            var kingSide = rook.FileChar == 'h';
            rookFrom = rook.ToString();
            rookTo = (kingSide ? "f" : "d") + rook.RankChar.ToString();
        }
        var st = new State();
        Pos.MakeMove(move, in st);
        TrackPosition();
        _fens.Add(Pos.FenNotation);
        _history.Add((move, st, san));
        LastFrom = move.FromSquare().ToString();
        LastTo = kingDest;
        RefreshLegal();

        return new AppliedMove(
            LastFrom, kingDest,
            CapturedSquare: captured,
            RookFrom: rookFrom,
            RookTo: rookTo,
            PromoteTo: move.IsPromotionMove() ? TypeChar(move.PromotedPieceType()) : null);
    }

    private string? CapturedSquareOf(Move move)
    {
        if (move.IsCastleMove()) return null; // "to" is own rook, not a victim
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
        var removed = 0;
        for (var i = 0; i < plies && _history.Count > 0; i++)
        {
            var (move, _, _) = _history[^1];
            _history.RemoveAt(_history.Count - 1);
            _fens.RemoveAt(_fens.Count - 1);
            removed++;
            UntrackPosition(); // the position we are leaving
            Pos.TakeMove(move);
        }
        var hasLast = _history.Count > 0;
        LastFrom = hasLast ? _history[^1].Move.FromSquare().ToString() : null;
        LastTo = hasLast ? (CastleKingDest(_history[^1].Move) ?? _history[^1].Move.ToSquare().ToString()) : null;
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
