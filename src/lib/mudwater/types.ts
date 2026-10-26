/**
 * Mudwater core types. The engine (rules.ts) is pure and deterministic:
 * same state + same action → same result. All randomness (ante pick,
 * starting seat) happens outside the engine and is passed in.
 */

export type Family = "CLUB" | "MUTANT" | "COSMIC" | "ARCANA";
export type Level = 1 | 2 | 3 | 4 | 5;
export type Rarity = "Common" | "Uncommon" | "Rare" | "Prestige" | "Legendary";

export interface Card {
  /** Printed card number, 1–120 — the stable id. */
  number: number;
  name: string;
  family: Family;
  rarity: Rarity;
  level: Level;
  north: number;
  east: number;
  south: number;
  west: number;
}

/** Seat 0 / seat 1. */
export type Seat = 0 | 1;

/** One card in a square's stack, bottom → top. */
export interface StackEntry {
  card: number;
  /** Face-down = a rock (only ever the bottom entry). */
  faceDown: boolean;
  /** Who played this card (its original owner) — separate from control. */
  playedBy: Seat;
}

export interface Square {
  stack: StackEntry[];
  /** Who controls the square right now (changes on capture). */
  controller: Seat;
}

export type Action =
  | { type: "place"; card: number; square: number }
  | { type: "rock"; card: number; square: number }
  | { type: "upgrade"; card: number; square: number }
  | { type: "pass" };

export type EndReason =
  "board_full" | "double_pass" | "resign" | "timeout" | "abandoned" | "aborted";

export interface GameResult {
  /** null = draw / no winner. */
  winner: Seat | null;
  scores: [number, number];
  reason: EndReason;
}

export interface RulesConfig {
  /** Family advantage breaks equal-edge ties (both players agreed). */
  advanced: boolean;
  catalogVersion: string;
  rulesVersion: string;
}

/** Full, privileged game state — server-side only. */
export interface GameState {
  rules: RulesConfig;
  board: (Square | null)[];
  hands: [number[], number[]];
  /** Hidden ante card per seat (never playable). */
  antes: [number, number];
  /** Each seat's committed 14-card selection. */
  decks: [number[], number[]];
  turn: Seat;
  startingSeat: Seat;
  /** Count of consecutive passes (2 ends the game). */
  passes: number;
  /** Number of actions applied so far. */
  moveNumber: number;
  result: GameResult | null;
}

/** What an applied action changed — safe to show everyone. */
export interface ActionEffect {
  seat: Seat;
  type: Action["type"];
  square: number | null;
  /** Face-up card played (null for rocks and passes). */
  card: number | null;
  captured: number[];
  ended: boolean;
}
