import { CARDS } from "./catalog";
import { score } from "./rules";
import type { GameResult, GameState, RulesConfig, Seat, Square } from "./types";

/**
 * Sanitized views of a game. The full GameState never leaves the server;
 * everyone (players, spectators, the agent, realtime, logs) gets one of
 * these instead.
 *
 * Hidden until the match ends: hand contents, ante cards, and the identity
 * of every face-down rock (uncovered or buried under an upgrade). After the
 * match, antes and buried rocks are revealed in the public replay — an
 * application policy, not a published-rules requirement.
 */

export interface PublicLayer {
  /** null while hidden (a face-down rock before the match ends). */
  card: number | null;
  faceDown: boolean;
  playedBy: Seat;
}

export interface PublicSquare {
  controller: Seat;
  /** Bottom → top. */
  layers: PublicLayer[];
}

export interface PublicGame {
  rules: RulesConfig;
  board: (PublicSquare | null)[];
  handCounts: [number, number];
  turn: Seat;
  startingSeat: Seat;
  passes: number;
  moveNumber: number;
  scores: [number, number];
  result: GameResult | null;
  /** Revealed only after the match ends. */
  antes: [number, number] | null;
}

export function publicView(state: GameState): PublicGame {
  const over = !!state.result;
  return {
    rules: state.rules,
    board: state.board.map((sq) =>
      sq
        ? {
            controller: sq.controller,
            layers: sq.stack.map((e) => ({
              card: e.faceDown && !over ? null : e.card,
              faceDown: e.faceDown,
              playedBy: e.playedBy,
            })),
          }
        : null,
    ),
    handCounts: [state.hands[0].length, state.hands[1].length],
    turn: state.turn,
    startingSeat: state.startingSeat,
    passes: state.passes,
    moveNumber: state.moveNumber,
    scores: state.result?.scores ?? score(state),
    result: state.result,
    antes: over ? [...state.antes] : null,
  };
}

export interface PrivateSeatView {
  seat: Seat;
  hand: number[];
  /** This seat's own rocks (uncovered or buried) — only its owner sees them. */
  myRocks: { square: number; card: number; covered: boolean }[];
}

export function privateView(state: GameState, seat: Seat): PrivateSeatView {
  const myRocks: PrivateSeatView["myRocks"] = [];
  state.board.forEach((sq, square) => {
    if (!sq) return;
    const rock = sq.stack[0];
    if (rock?.faceDown && rock.playedBy === seat) {
      myRocks.push({ square, card: rock.card, covered: sq.stack.length > 1 });
    }
  });
  return { seat, hand: [...state.hands[seat]], myRocks };
}

/**
 * What the BAYCmc agent may know: its own hand and rocks plus the public
 * board. It never sees the opponent's hand, the antes or hidden rocks.
 */
export interface AgentView {
  seat: Seat;
  publicGame: PublicGame;
  hand: number[];
  myRocks: PrivateSeatView["myRocks"];
}

export function agentView(state: GameState, seat: Seat): AgentView {
  const priv = privateView(state, seat);
  return { seat, publicGame: publicView(state), hand: priv.hand, myRocks: priv.myRocks };
}

/**
 * Rebuild a playable state for one seat from what that seat may see: the
 * public board plus its own hand and rocks. Legality and captures only
 * depend on these (hidden rocks are immune and count as Level I), so the
 * engine gives the same answers here as on the server. Used by the agent
 * and by the play screen to explain why a move isn't allowed.
 */
export function stateForSeat(
  pg: PublicGame,
  seat: Seat,
  hand: number[],
  myRocks: PrivateSeatView["myRocks"],
): GameState {
  const myRockBySquare = new Map(myRocks.map((r) => [r.square, r.card]));
  const placeholder = CARDS[0]!.number;
  const board: (Square | null)[] = pg.board.map((sq, i) =>
    sq
      ? {
          controller: sq.controller,
          stack: sq.layers.map((l, depth) => ({
            card: l.card ?? (depth === 0 ? (myRockBySquare.get(i) ?? placeholder) : placeholder),
            faceDown: l.faceDown,
            playedBy: l.playedBy,
          })),
        }
      : null,
  );
  const hands: [number[], number[]] = [[], []];
  hands[seat] = [...hand];
  return {
    rules: pg.rules,
    board,
    hands,
    antes: [0, 0],
    decks: [[], []],
    turn: pg.turn,
    startingSeat: pg.startingSeat,
    passes: pg.passes,
    moveNumber: pg.moveNumber,
    result: pg.result,
  };
}
