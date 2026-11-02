using Rudzoft.ChessLib;
using Rudzoft.ChessLib.Factories;
using Rudzoft.ChessLib.MoveGeneration;
using Rudzoft.ChessLib.Types;
using Rudzoft.ChessLib.Enums;

namespace htchess.Shared.Chess;

/// Negamax + alpha-beta over ChessLib. Material + piece-square eval.
/// Searches on its own game built from the caller's FEN, so Task.Yield pauses
/// can't corrupt the live board; apply the returned move via GameSession.ApplyMove.
public sealed class SimpleAi
{
    private const int Mate = 100_000;
    private readonly Random _rng = new();
    public int Nodes { get; private set; }

    private static readonly int[] Values = { 0, 0, 100, 320, 330, 500, 900, 20000 };

    // Middlegame piece-square tables (white perspective, a1 = index 0).
    private static readonly int[] PawnPst =
    {
          0,  0,  0,  0,  0,  0,  0,  0,
          5, 10, 10,-20,-20, 10, 10,  5,
          5, -5,-10,  0,  0,-10, -5,  5,
          0,  0,  0, 20, 20,  0,  0,  0,
          5,  5, 10, 25, 25, 10,  5,  5,
         10, 10, 20, 30, 30, 20, 10, 10,
         50, 50, 50, 50, 50, 50, 50, 50,
          0,  0,  0,  0,  0,  0,  0,  0,
    };
    private static readonly int[] KnightPst =
    {
        -50,-40,-30,-30,-30,-30,-40,-50,
        -40,-20,  0,  5,  5,  0,-20,-40,
        -30,  5, 10, 15, 15, 10,  5,-30,
        -30,  0, 15, 20, 20, 15,  0,-30,
        -30,  5, 15, 20, 20, 15,  5,-30,
        -30,  0, 10, 15, 15, 10,  0,-30,
        -40,-20,  0,  0,  0,  0,-20,-40,
        -50,-40,-30,-30,-30,-30,-40,-50,
    };
    private static readonly int[] BishopPst =
    {
        -20,-10,-10,-10,-10,-10,-10,-20,
        -10,  5,  0,  0,  0,  0,  5,-10,
        -10, 10, 10, 10, 10, 10, 10,-10,
        -10,  0, 10, 10, 10, 10,  0,-10,
        -10,  5,  5, 10, 10,  5,  5,-10,
        -10,  0,  5, 10, 10,  5,  0,-10,
        -10,  0,  0,  0,  0,  0,  0,-10,
        -20,-10,-10,-10,-10,-10,-10,-20,
    };
    private static readonly int[] RookPst =
    {
          0,  0,  0,  5,  5,  0,  0,  0,
         -5,  0,  0,  0,  0,  0,  0, -5,
         -5,  0,  0,  0,  0,  0,  0, -5,
         -5,  0,  0,  0,  0,  0,  0, -5,
         -5,  0,  0,  0,  0,  0,  0, -5,
         -5,  0,  0,  0,  0,  0,  0, -5,
          5, 10, 10, 10, 10, 10, 10,  5,
          0,  0,  0,  0,  0,  0,  0,  0,
    };
    private static readonly int[] QueenPst =
    {
        -20,-10,-10, -5, -5,-10,-10,-20,
        -10,  0,  5,  0,  0,  0,  0,-10,
        -10,  5,  5,  5,  5,  5,  0,-10,
          0,  0,  5,  5,  5,  5,  0, -5,
         -5,  0,  5,  5,  5,  5,  0, -5,
        -10,  0,  5,  5,  5,  5,  0,-10,
        -10,  0,  0,  0,  0,  0,  0,-10,
        -20,-10,-10, -5, -5,-10,-10,-20,
    };
    private static readonly int[] KingPst =
    {
         20, 30, 10,  0,  0, 10, 30, 20,
         20, 20,  0,  0,  0,  0, 20, 20,
        -10,-20,-20,-20,-20,-20,-20,-10,
        -20,-30,-30,-40,-40,-30,-30,-20,
        -30,-40,-40,-50,-50,-40,-40,-30,
        -30,-40,-40,-50,-50,-40,-40,-30,
        -30,-40,-40,-50,-50,-40,-40,-30,
        -30,-40,-40,-50,-50,-40,-40,-30,
    };

    private static int Pst(PieceTypes type, Square sq, bool white)
    {
        // tables are written a1=0 like ChessLib square index; mirror rank for black
        var idx = sq.AsInt();
        if (!white) idx ^= 56;
        return type switch
        {
            PieceTypes.Pawn => PawnPst[idx],
            PieceTypes.Knight => KnightPst[idx],
            PieceTypes.Bishop => BishopPst[idx],
            PieceTypes.Rook => RookPst[idx],
            PieceTypes.Queen => QueenPst[idx],
            PieceTypes.King => KingPst[idx],
            _ => 0,
        };
    }

    private static int Evaluate(IPosition pos)
    {
        var score = 0;
        for (var i = 0; i < 64; i++)
        {
            Square sq = new(i);
            var p = pos.GetPiece(sq);
            if (p == Piece.EmptyPiece) continue;
            var white = p.ColorOf().IsWhite;
            var v = Values[(int)p.Type()] + Pst(p.Type(), sq, white);
            score += white ? v : -v;
        }
        return pos.SideToMove.IsWhite ? score : -score;
    }

    /// White-relative static score in centipawns (+ favors white).
    public static int EvaluateBoard(IPosition pos)
    {
        var stm = Evaluate(pos);
        return pos.SideToMove.IsWhite ? stm : -stm;
    }

    private int OrderScore(IPosition pos, Move m)
    {
        var victim = pos.GetPiece(m.ToSquare());
        var s = 0;
        if (victim != Piece.EmptyPiece)
            s += 10 * Values[(int)victim.Type()] - Values[(int)pos.GetPiece(m.FromSquare()).Type()];
        if (m.IsPromotionMove()) s += Values[(int)m.PromotedPieceType()];
        return s;
    }

    public async Task<Move?> FindBestAsync(string fen, int depth)
    {
        var game = GameFactory.Create();
        game.NewGame(fen);
        var pos = game.Pos;
        Nodes = 0;
        var moves = OrderedLegal(pos);
        if (moves.Count == 0) return null;

        Move? best = null;
        var bestScore = int.MinValue;
        var alpha = -Mate * 2;
        var sinceYield = 0;

        foreach (var m in moves)
        {
            var st = new State();
            pos.MakeMove(m, in st);
            var score = -await Negamax(pos, depth - 1, -Mate * 2, -alpha, 1);
            // a reported score equal to bestScore may be a proving-window bound
            // (child failed high), not a true tie — re-search open-windowed so a
            // bound can't displace a genuinely better move
            if (best is not null && score == bestScore)
                score = -await Negamax(pos, depth - 1, -Mate * 2, Mate * 2, 1);
            pos.TakeMove(m);

            if (score > bestScore || (score == bestScore && _rng.Next(2) == 0))
            {
                bestScore = score;
                best = m;
            }
            if (score > alpha) alpha = score;

            if (++sinceYield >= 8) { sinceYield = 0; await Task.Yield(); }
        }
        return best;
    }

    private async Task<int> Negamax(IPosition pos, int depth, int alpha, int beta, int ply)
    {
        Nodes++;
        var moves = new MoveList();
        moves.Generate(in pos, MoveGenerationType.Legal);
        if (moves.Length == 0)
            return pos.InCheck ? -Mate + ply : 0;
        if (pos.Rule50 >= 100 || pos.IsRepetition) return 0;
        // yield on deep subtrees so the single WASM thread can pump the UI
        if (depth >= 2 && (Nodes & 1023) == 0) await Task.Yield();
        if (depth <= 0) return Quiesce(pos, alpha, beta, 0);

        var ordered = new List<Move>(moves.Length);
        foreach (var em in moves) ordered.Add(em.Move);
        ordered.Sort((a, b) => OrderScore(pos, b) - OrderScore(pos, a));

        var bestScore = int.MinValue;
        foreach (var m in ordered)
        {
            var st = new State();
            pos.MakeMove(m, in st);
            var score = -await Negamax(pos, depth - 1, -beta, -alpha, ply + 1);
            pos.TakeMove(m);
            if (score > bestScore) bestScore = score;
            if (score > alpha) alpha = score;
            if (alpha >= beta) break;
        }
        return bestScore;
    }

    private int Quiesce(IPosition pos, int alpha, int beta, int qply)
    {
        Nodes++;
        var inCheck = pos.InCheck;
        var moves = new MoveList();
        moves.Generate(in pos, MoveGenerationType.Legal);
        if (moves.Length == 0)
            return inCheck ? -Mate + qply : 0;
        if (!inCheck)
        {
            // standing pat is illegal while in check — evasions only there
            var standPat = Evaluate(pos);
            if (standPat >= beta) return beta;
            if (standPat > alpha) alpha = standPat;
        }
        if (qply >= 6) return alpha;
        // in check every legal move is an evasion; otherwise captures only
        // (incl. en passant + promos) to bound the tree
        var caps = new List<Move>(moves.Length);
        foreach (var em in moves)
        {
            var m = em.Move;
            if (inCheck || pos.GetPiece(m.ToSquare()) != Piece.EmptyPiece || m.IsEnPassantMove() || m.IsPromotionMove())
                caps.Add(m);
        }
        caps.Sort((a, b) => OrderScore(pos, b) - OrderScore(pos, a));
        foreach (var m in caps)
        {
            var st = new State();
            pos.MakeMove(m, in st);
            var score = -Quiesce(pos, -beta, -alpha, qply + 1);
            pos.TakeMove(m);
            if (score >= beta) return beta;
            if (score > alpha) alpha = score;
        }
        return alpha;
    }

    private static List<Move> OrderedLegal(IPosition pos)
    {
        var ml = new MoveList();
        ml.Generate(in pos, MoveGenerationType.Legal);
        var list = new List<Move>(ml.Length);
        foreach (var em in ml) list.Add(em.Move);
        return list;
    }
}
