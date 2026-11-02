using htchess.Shared.Chess;
using Xunit;

namespace htchess.Tests;

/// Tests for the APIs added for persistence/drag-gating/deselect-toggle.
public class GameSessionNewApiTests
{
    [Fact]
    public void Reclicking_selected_own_piece_deselects()
    {
        var s = new GameSession();
        Assert.Equal(ClickResult.Selected, s.Click("e2").Result);
        Assert.Equal("e2", s.Selected);
        var outcome = s.Click("e2");
        Assert.Equal(ClickResult.Deselected, outcome.Result);
        Assert.Null(s.Selected);
        Assert.Empty(s.SelectedTargets);
    }

    [Fact]
    public void Clicking_other_own_piece_switches_selection()
    {
        var s = new GameSession();
        s.Click("e2");
        Assert.Equal(ClickResult.Selected, s.Click("d2").Result);
        Assert.Equal("d2", s.Selected);
    }

    [Fact]
    public void UciMoves_and_fen_properties_track_history()
    {
        var s = new GameSession();
        Assert.Empty(s.UciMoves);
        s.Click("e2");
        var outcome = s.Click("e4");
        Assert.Equal(ClickResult.MoveApplied, outcome.Result);
        Assert.Equal(new[] { "e2e4" }, s.UciMoves);
        Assert.NotEqual(s.StartFen, s.CurrentFen);
        Assert.StartsWith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w", s.StartFen);
        Assert.StartsWith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b", s.CurrentFen);
    }

    [Fact]
    public void Replay_restores_game()
    {
        var s = new GameSession();
        s.NewGameFromMoves(null, GameMode.TwoPlayer, true, new[] { "e2e4", "e7e5", "g1f3" });
        Assert.Equal(3, s.PlyCount);
        Assert.False(s.WhiteToMove);
        Assert.Equal("Nf3", s.History[2].San);
        Assert.Equal(3, s.UciMoves.Count);
    }

    [Fact]
    public void Replay_accepts_castle_king_to_rook_encoding()
    {
        var s = new GameSession();
        // UciMoves emits ChessLib's king->rook encoding; replay must accept it back.
        s.NewGameFromMoves("r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1",
            GameMode.TwoPlayer, true, new[] { "e1h1" });
        var pos = s.GetPosition();
        Assert.Contains(pos, p => p.Square == "g1" && p.Type == "K" && p.Color == "w");
        Assert.Contains(pos, p => p.Square == "f1" && p.Type == "R" && p.Color == "w");
        Assert.Equal("O-O", s.History[0].San);
    }

    [Fact]
    public void Replay_promotion_carries_suffix()
    {
        var s = new GameSession();
        s.NewGameFromMoves("8/P6k/8/8/8/8/8/K7 w - - 0 1",
            GameMode.TwoPlayer, true, new[] { "a7a8q" });
        Assert.Contains(s.GetPosition(), p => p.Square == "a8" && p.Type == "Q");
        Assert.Equal(new[] { "a7a8q" }, s.UciMoves);
    }

    [Fact]
    public void Replay_throws_on_illegal_move()
    {
        var s = new GameSession();
        Assert.Throws<InvalidOperationException>(() =>
            s.NewGameFromMoves(null, GameMode.TwoPlayer, true, new[] { "e2e5" }));
    }

    [Fact]
    public void DraggableSquares_are_legal_sources_on_human_turn()
    {
        var s = new GameSession();
        var d = s.DraggableSquares();
        // 8 pawns + 2 knights have legal moves at the start
        Assert.Equal(10, d.Count);
        Assert.Contains("e2", d);
        Assert.DoesNotContain("e1", d); // king can't move
    }

    [Fact]
    public void DraggableSquares_empty_when_game_over()
    {
        var s = new GameSession();
        // fool's mate
        s.NewGameFromMoves(null, GameMode.TwoPlayer, true,
            new[] { "f2f3", "e7e5", "g2g4", "d8h4" });
        Assert.True(s.IsGameOver);
        Assert.Empty(s.DraggableSquares());
    }
}
