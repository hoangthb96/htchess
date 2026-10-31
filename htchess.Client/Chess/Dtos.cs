namespace htchess.Client.Chess;

public enum GameMode { TwoPlayer, VsAi }

public enum ClickResult { Ignored, Selected, Deselected, NeedsPromotion, MoveApplied, PremoveSelect, PremoveSet }

public record PieceDto(string Square, string Type, string Color);

/// Payload for the JS renderer describing one applied move.
public record AppliedMove(
    string From,
    string To,
    string? CapturedSquare = null,
    string? RookFrom = null,
    string? RookTo = null,
    string? PromoteTo = null);

public record ClickOutcome(ClickResult Result, AppliedMove? Move = null);
