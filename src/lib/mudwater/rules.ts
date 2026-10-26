import { DECK_SIZE, HAND_SIZE, getCard } from "./catalog";
import type {
  Action,
  ActionEffect,
  Card,
  Family,
  GameResult,
  GameState,
  RulesConfig,
  Seat,
  Square,
} from "./types";

/**
 * Pure Mudwater rules engine (published Swamp Origins gameplay, paraphrased
 * by the operator — see docs/MUDWATER_IMPLEMENTATION.md for the exact
 * rules and our application policies).
 *
 * Board squares are numbered 0–8, row by row:
 *   0 1 2
 *   3 4 5
 *   6 7 8
 * Every card keeps one fixed orientation for both seats: north = top.
 */

export const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

const rowOf = (i: number) => Math.floor(i / 3);
const colOf = (i: number) => i % 3;

/** Orthogonal neighbours with the attacking edge and the defending edge. */
export function neighbours(square: number): {
  square: number;
  attack: keyof Pick<Card, "north" | "east" | "south" | "west">;
  defend: keyof Pick<Card, "north" | "east" | "south" | "west">;
}[] {
  const out: ReturnType<typeof neighbours> = [];
  if (rowOf(square) > 0) out.push({ square: square - 3, attack: "north", defend: "south" });
  if (rowOf(square) < 2) out.push({ square: square + 3, attack: "south", defend: "north" });
  if (colOf(square) > 0) out.push({ square: square - 1, attack: "west", defend: "east" });
  if (colOf(square) < 2) out.push({ square: square + 1, attack: "east", defend: "west" });
  return out;
}

/** Family advantage (advanced mode): each family beats exactly one other. */
const BEATS: Record<Family, Family> = {
  CLUB: "MUTANT",
  MUTANT: "COSMIC",
  COSMIC: "ARCANA",
  ARCANA: "CLUB",
};
export function familyBeats(attacker: Family, defender: Family): boolean {
  return BEATS[attacker] === defender;
}

const top = (sq: Square) => sq.stack[sq.stack.length - 1]!;

/** A square whose top card is face down — an uncovered rock. */
export function isRock(sq: Square | null): boolean {
  return !!sq && top(sq).faceDown;
}

/** Level used for upgrading: a rock counts as Level I. */
export function effectiveLevel(sq: Square): number {
  const t = top(sq);
  return t.faceDown ? 1 : getCard(t.card).level;
}

export function uncoveredRocks(state: GameState, seat: Seat): number {
  return state.board.filter((sq) => isRock(sq) && sq!.controller === seat).length;
}

// ── Setup ──────────────────────────────────────────────────────────────────

/**
 * Deal a new game. `anteIndex[s]` is the position (0–13) in seat s's deck
 * chosen as the hidden ante; `startingSeat` who opens. Both come from the
 * caller's randomness (server crypto for free games).
 */
export function newGame(params: {
  decks: [number[], number[]];
  anteIndex: [number, number];
  startingSeat: Seat;
  rules: RulesConfig;
}): GameState {
  const { decks, anteIndex, startingSeat, rules } = params;
  for (const s of [0, 1] as const) {
    if (decks[s].length !== DECK_SIZE)
      throw new Error(`Seat ${s} deck must have ${DECK_SIZE} cards`);
    if (new Set(decks[s]).size !== DECK_SIZE) throw new Error(`Seat ${s} deck has duplicates`);
    decks[s].forEach((n) => getCard(n));
    if (anteIndex[s] < 0 || anteIndex[s] >= DECK_SIZE) throw new Error("Bad ante index");
  }
  const antes: [number, number] = [decks[0][anteIndex[0]]!, decks[1][anteIndex[1]]!];
  const hands: [number[], number[]] = [
    decks[0].filter((_, i) => i !== anteIndex[0]),
    decks[1].filter((_, i) => i !== anteIndex[1]),
  ];
  if (hands[0].length !== HAND_SIZE || hands[1].length !== HAND_SIZE) {
    throw new Error("Hands must have 13 cards");
  }
  return {
    rules,
    board: Array.from({ length: 9 }, () => null),
    hands,
    antes,
    decks: [[...decks[0]], [...decks[1]]],
    turn: startingSeat,
    startingSeat,
    passes: 0,
    moveNumber: 0,
    result: null,
  };
}

// ── Legal actions ──────────────────────────────────────────────────────────

/** Every legal non-pass action for `seat` (empty → the seat must pass). */
export function legalActions(state: GameState, seat: Seat = state.turn): Action[] {
  if (state.result) return [];
  const hand = state.hands[seat];
  const out: Action[] = [];
  const canRock = uncoveredRocks(state, seat) === 0;
  const uniqueHand = [...new Set(hand)];
  state.board.forEach((sq, square) => {
    if (!sq) {
      for (const card of uniqueHand) {
        if (getCard(card).level === 1) out.push({ type: "place", card, square });
        if (canRock) out.push({ type: "rock", card, square });
      }
    } else if (sq.controller === seat) {
      const need = effectiveLevel(sq) + 1;
      for (const card of uniqueHand) {
        if (getCard(card).level === need) out.push({ type: "upgrade", card, square });
      }
    }
  });
  return out;
}

/** Why an action is illegal, or null if it's legal. */
export function validateAction(state: GameState, seat: Seat, action: Action): string | null {
  if (state.result) return "The game is over.";
  if (seat !== state.turn) return "It isn't your turn.";
  if (action.type === "pass") {
    return legalActions(state, seat).length > 0
      ? "You can't pass while you have a legal move."
      : null;
  }
  if (!Number.isInteger(action.square) || action.square < 0 || action.square > 8) {
    return "Pick a square on the board.";
  }
  if (!state.hands[seat].includes(action.card)) return "That card isn't in your hand.";
  const card = getCard(action.card);
  const sq = state.board[action.square];
  switch (action.type) {
    case "place":
      if (sq) return "That square is already occupied.";
      if (card.level !== 1) return "Only Level I cards can be placed on an empty square.";
      return null;
    case "rock":
      if (sq) return "That square is already occupied.";
      if (uncoveredRocks(state, seat) > 0) {
        return "You already have an uncovered rock — cover it with an upgrade first.";
      }
      return null;
    case "upgrade": {
      if (!sq) return "You can only upgrade a square that has a card on it.";
      if (sq.controller !== seat) return "You can only upgrade a square you control.";
      const need = effectiveLevel(sq) + 1;
      if (card.level !== need) {
        return `This square needs a Level ${roman(need)} card (exactly one level higher).`;
      }
      return null;
    }
  }
}

export function roman(n: number): string {
  return ["", "I", "II", "III", "IV", "V"][n] ?? String(n);
}

// ── Applying actions ───────────────────────────────────────────────────────

function cloneState(s: GameState): GameState {
  return {
    ...s,
    rules: { ...s.rules },
    board: s.board.map((sq) =>
      sq ? { controller: sq.controller, stack: sq.stack.map((e) => ({ ...e })) } : null,
    ),
    hands: [[...s.hands[0]], [...s.hands[1]]],
    antes: [...s.antes] as [number, number],
    decks: [[...s.decks[0]], [...s.decks[1]]],
    result: s.result ? { ...s.result, scores: [...s.result.scores] as [number, number] } : null,
  };
}

/**
 * Resolve captures for a newly played face-up card. Only the new card
 * attacks; each orthogonal enemy neighbour is checked independently;
 * rocks are immune; no chain reactions.
 */
function resolveCaptures(state: GameState, square: number, seat: Seat): number[] {
  const attacker = getCard(top(state.board[square]!).card);
  const captured: number[] = [];
  for (const nb of neighbours(square)) {
    const sq = state.board[nb.square];
    if (!sq || sq.controller === seat || isRock(sq)) continue;
    const defender = getCard(top(sq).card);
    const a = attacker[nb.attack];
    const d = defender[nb.defend];
    const wins =
      a > d || (a === d && state.rules.advanced && familyBeats(attacker.family, defender.family));
    if (wins) captured.push(nb.square);
  }
  for (const c of captured) state.board[c]!.controller = seat;
  return captured;
}

export function score(state: GameState): [number, number] {
  const s: [number, number] = [0, 0];
  for (const sq of state.board) if (sq) s[sq.controller]++;
  return s;
}

function finish(state: GameState, reason: GameResult["reason"]) {
  const scores = score(state);
  state.result = {
    winner: scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1,
    scores,
    reason,
  };
}

/**
 * Apply a validated action. Throws on an illegal action — callers should
 * validateAction first to show a friendly reason.
 */
export function applyAction(
  prev: GameState,
  seat: Seat,
  action: Action,
): { state: GameState; effect: ActionEffect } {
  const problem = validateAction(prev, seat, action);
  if (problem) throw new Error(problem);
  const state = cloneState(prev);
  const effect: ActionEffect = {
    seat,
    type: action.type,
    square: action.type === "pass" ? null : action.square,
    card: null,
    captured: [],
    ended: false,
  };

  if (action.type === "pass") {
    state.passes += 1;
  } else {
    state.passes = 0;
    const hand = state.hands[seat];
    hand.splice(hand.indexOf(action.card), 1);
    if (action.type === "rock") {
      state.board[action.square] = {
        controller: seat,
        stack: [{ card: action.card, faceDown: true, playedBy: seat }],
      };
    } else {
      if (action.type === "place") {
        state.board[action.square] = { controller: seat, stack: [] };
      }
      state.board[action.square]!.stack.push({
        card: action.card,
        faceDown: false,
        playedBy: seat,
      });
      effect.card = action.card;
      effect.captured = resolveCaptures(state, action.square, seat);
    }
  }
  state.moveNumber += 1;

  // Captures resolve first; then the game ends at once if the board is full.
  if (state.board.every(Boolean)) {
    finish(state, "board_full");
  } else if (state.passes >= 2) {
    finish(state, "double_pass");
  } else {
    state.turn = other(seat);
  }
  effect.ended = !!state.result;
  return { state, effect };
}

/** End the game early (resignation / timeout / abandonment). */
export function endEarly(
  prev: GameState,
  reason: "resign" | "timeout" | "abandoned" | "aborted",
  loser: Seat | null,
): GameState {
  const state = cloneState(prev);
  state.result = {
    winner: loser === null ? null : other(loser),
    scores: score(state),
    reason,
  };
  return state;
}
