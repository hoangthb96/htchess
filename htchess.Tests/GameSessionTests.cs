using htchess.Shared.Chess;
using Xunit;

namespace htchess.Tests;

public class GameSessionTests
{
    private static ClickOutcome Move(GameSession s, string from, string to)
    {
        Assert.Equal(ClickResult.Selected, s.Click(from).Result);
        return s.Click(to);
    }

    [Fact]
    public void NewGame_InitialPosition_32Pieces_WhiteToMove()
    {
        var s = new GameSession();

        Assert.Equal(32, s.GetPosition().Count);
        Assert.True(s.WhiteToMove);
        Assert.False(s.IsGameOver);
        Assert.Equal(0, s.PlyCount);
        Assert.Null(s.Selected);
    }

    [Fact]
    public void Click_EmptySquare_Deselected()
    {
        var s = new GameSession();

        Assert.Equal(ClickResult.Deselected, s.Click("e4").Result);
        Assert.Null(s.Selected);
    }

    [Fact]
    public void Click_OwnPiece_Selects_ThenEmptySquareDeselects()
    {
        var s = new GameSession();

        Assert.Equal(ClickResult.Selected, s.Click("e2").Result);
        Assert.Equal("e2", s.Selected);
        Assert.Contains("e3", s.SelectedTargets);
        Assert.Contains("e4", s.SelectedTargets);

        // a6 is empty and not a legal target -> deselect
        Assert.Equal(ClickResult.Deselected, s.Click("a6").Result);
        Assert.Null(s.Selected);
        Assert.Empty(s.SelectedTargets);
    }

    [Fact]
    public void Move_E2E4_AppliesSanE4_BlackToMove()
    {
        var s = new GameSession();

        var outcome = Move(s, "e2", "e4");

        Assert.Equal(ClickResult.MoveApplied, outcome.Result);
        Assert.NotNull(outcome.Move);
        Assert.Equal("e2", outcome.Move!.From);
        Assert.Equal("e4", outcome.Move.To);
        Assert.Equal("e4", s.History[^1].San);
        Assert.Equal(1, s.PlyCount);
        Assert.False(s.WhiteToMove);
        Assert.Equal("e2", s.LastFrom);
        Assert.Equal("e4", s.LastTo);
    }

    [Fact]
    public void Castling_KingDestinationIsG1_NotRookSquareH1()
    {
        var s = new GameSession();
        s.NewGameFromFen("r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1",
            GameMode.TwoPlayer, humanIsWhite: true);

        Assert.Equal(ClickResult.Selected, s.Click("e1").Result);
        // the castle target is shown as the king's landing square
        Assert.Contains("g1", s.SelectedTargets);
        Assert.DoesNotContain("h1", s.SelectedTargets);

        var outcome = s.Click("g1");
        Assert.Equal(ClickResult.MoveApplied, outcome.Result);
        Assert.Equal("g1", outcome.Move!.To);
        Assert.Equal("h1", outcome.Move.RookFrom);
        Assert.Equal("f1", outcome.Move.RookTo);
        Assert.Equal("O-O", s.History[^1].San);
        Assert.Equal("g1", s.LastTo);
    }

    [Fact]
    public void EnPassant_SanIsExd6Form()
    {
        var s = new GameSession();
        // white pawn e5, black just played d7d5 -> exd6 e.p. available
        s.NewGameFromFen("rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2",
            GameMode.TwoPlayer, humanIsWhite: true);

        var outcome = Move(s, "e5", "d6");

        Assert.Equal(ClickResult.MoveApplied, outcome.Result);
        Assert.Equal("exd6", s.History[^1].San);
        Assert.Equal("d5", outcome.Move!.CapturedSquare);
        Assert.DoesNotContain(s.GetPosition(), p => p.Square == "d5");
        Assert.Contains(s.GetPosition(), p => p.Square == "d6" && p.Type == "P" && p.Color == "w");
    }

    [Fact]
    public void ThreefoldRepetition_Draw()
    {
        var s = new GameSession();

        // Nf3 Nf6 Ng1 Ng8 x2 -> start position occurs for the 3rd time
        for (var i = 0; i < 2; i++)
        {
            Move(s, "g1", "f3");
            Move(s, "g8", "f6");
            Move(s, "f3", "g1");
            Move(s, "f6", "g8");
        }

        Assert.True(s.IsGameOver);
        Assert.Equal("½-½", s.ResultTag);
        Assert.Contains("lặp", s.GameOverReason);
        Assert.Equal(8, s.PlyCount);
    }

    [Fact]
    public void FiftyMoveRule_Draw()
    {
        var s = new GameSession();
        s.NewGameFromFen("4k3/8/8/8/8/8/8/R3K3 w - - 99 1",
            GameMode.TwoPlayer, humanIsWhite: true);
        Assert.False(s.IsGameOver); // 99 halfmoves: still playing

        var outcome = Move(s, "a1", "a2"); // non-pawn, non-capture -> clock hits 100

        Assert.Equal(ClickResult.MoveApplied, outcome.Result);
        Assert.True(s.IsGameOver);
        Assert.Equal("½-½", s.ResultTag);
        Assert.Contains("50", s.GameOverReason);
    }

    [Fact]
    public void InsufficientMaterial_KBvsK_GameOverOnLoad()
    {
        var s = new GameSession();
        s.NewGameFromFen("8/8/4k3/8/8/4K3/8/5B2 w - - 0 1",
            GameMode.TwoPlayer, humanIsWhite: true);

        Assert.True(s.IsGameOver);
        Assert.Equal("½-½", s.ResultTag);
    }

    [Fact]
    public void Flag_OpponentCannotMate_Draw()
    {
        var s = new GameSession();
        // white K+N, black K+N -> no auto-draw, but white alone cannot mate
        s.NewGameFromFen("4k3/4n3/8/8/8/8/8/4KN2 w - - 0 1",
            GameMode.TwoPlayer, humanIsWhite: true);
        Assert.False(s.IsGameOver);

        s.Flag(whiteFlagged: false); // black ran out of time, white "wins" on time

        Assert.True(s.IsGameOver);
        Assert.Equal("½-½", s.ResultTag);
        Assert.Contains("Hết giờ", s.GameOverReason);
    }

    [Fact]
    public void Flag_OpponentHasMatingMaterial_Win()
    {
        var s = new GameSession();
        s.NewGameFromFen("4k3/8/8/8/8/8/8/R3K3 w - - 0 1",
            GameMode.TwoPlayer, humanIsWhite: true);

        s.Flag(whiteFlagged: false); // black flagged, white has a rook -> real win

        Assert.True(s.IsGameOver);
        Assert.Equal("1-0", s.ResultTag);
        Assert.Contains("Trắng thắng", s.GameOverReason);
    }

    [Fact]
    public void Premove_SelectAndSet_WhileAiToMove()
    {
        var s = new GameSession();
        s.NewGame(GameMode.VsAi, humanIsWhite: false); // human is black, white (AI) to move

        Assert.False(s.SideToMoveIsHuman);

        Assert.Equal(ClickResult.PremoveSelect, s.Click("e7").Result);
        Assert.Equal("e7", s.PremoveFrom);
        Assert.Null(s.PremoveTo);

        Assert.Equal(ClickResult.PremoveSet, s.Click("e5").Result);
        Assert.Equal("e7", s.PremoveFrom);
        Assert.Equal("e5", s.PremoveTo);
    }

    [Fact]
    public void Promotion_NeedsPromotion_ThenResolveAppliesQueen()
    {
        var s = new GameSession();
        s.NewGameFromFen("8/P7/8/8/8/8/7k/4K3 w - - 0 1",
            GameMode.TwoPlayer, humanIsWhite: true);

        Assert.Equal(ClickResult.Selected, s.Click("a7").Result);
        var outcome = s.Click("a8");
        Assert.Equal(ClickResult.NeedsPromotion, outcome.Result);
        Assert.True(s.AwaitingPromotion);

        var resolved = s.ResolvePromotion("Q");
        Assert.NotNull(resolved);
        Assert.Equal(ClickResult.MoveApplied, resolved!.Result);
        Assert.Equal("Q", resolved.Move!.PromoteTo);
        Assert.False(s.AwaitingPromotion);
        Assert.Contains(s.GetPosition(), p => p.Square == "a8" && p.Type == "Q" && p.Color == "w");
    }

    [Fact]
    public void Undo_RestoresPositionAndHistory()
    {
        var s = new GameSession();
        Move(s, "e2", "e4");
        Assert.Equal(32, s.GetPosition().Count); // e2e4 captures nothing

        s.Undo(); // 2P mode undoes a single ply

        Assert.Equal(0, s.PlyCount);
        Assert.Empty(s.History);
        Assert.Equal(32, s.GetPosition().Count);
        Assert.True(s.WhiteToMove);
        Assert.Contains(s.GetPosition(), p => p.Square == "e2" && p.Type == "P" && p.Color == "w");
        Assert.DoesNotContain(s.GetPosition(), p => p.Square == "e4");
        Assert.Null(s.LastFrom);
        Assert.Null(s.LastTo);
    }

    [Fact]
    public void CapturedPieces_AfterCapture()
    {
        var s = new GameSession();
        s.NewGameFromFen("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1",
            GameMode.TwoPlayer, humanIsWhite: true);

        var outcome = Move(s, "e4", "d5");
        Assert.Equal(ClickResult.MoveApplied, outcome.Result);

        // uppercase = black victims taken by white
        Assert.Equal(new[] { "P" }, s.CapturedByWhite());
        Assert.Empty(s.CapturedByBlack());
    }

    [Fact]
    public void NewGameFromFen_Garbage_Throws()
    {
        var s = new GameSession();
        Assert.ThrowsAny<Exception>(() =>
            s.NewGameFromFen("this is not a fen", GameMode.TwoPlayer, humanIsWhite: true));
    }
}
