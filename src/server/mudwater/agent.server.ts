import { CARDS, getCard } from "@/lib/mudwater/catalog";
import { stateForSeat, type AgentView } from "@/lib/mudwater/projections";
import { applyAction, isRock, legalActions, neighbours, other } from "@/lib/mudwater/rules";
import type { Action, Card, GameState, Seat } from "@/lib/mudwater/types";

/**
 * BAYCmc agent — normal difficulty.
 *
 * Input: ONLY an AgentView (its own hand + own rocks + the public board).
 * It never sees the opponent's hand, antes, hidden rock identities,
 * spectator bets or treasury data, and its play never depends on stakes.
 *
 * Method: enumerate every legal action from the same engine players use,
 * simulate each (captures + game end), and score the result on
 *   - terminal outcome (a full board ends the game at once),
 *   - square control,
 *   - position,
 *   - defensive exposure, estimated from PUBLIC catalogue statistics only
 *     (how many cards of the level an opponent could play next would beat
 *     each of our exposed edges),
 *   - remaining upgrade options in our own hand,
 *   - card economy (prefer rocking weak cards, keep strong cards).
 * Ties are broken with a seeded RNG; if anything fails, a seeded random
 * legal action is used so the agent can never freeze a match.
 */

export const AGENT_NAME = "BAYCmc agent";
export const AGENT_POLICY_VERSION = "baycmc-agent-normal-v1";

type Edge = "north" | "east" | "south" | "west";

/** Share of catalogue cards at `level` whose `edge` beats `value`. */
const beatShare = (() => {
  const cache = new Map<string, number>();
  return (level: number, edge: Edge, value: number) => {
    const key = `${level}|${edge}|${value}`;
    let v = cache.get(key);
    if (v === undefined) {
      const pool = CARDS.filter((c) => c.level === level);
      v = pool.length ? pool.filter((c) => c[edge] > value).length / pool.length : 0;
      cache.set(key, v);
    }
    return v;
  };
})();

/** Deterministic PRNG (mulberry32) seeded from a string. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rebuild a simulation state from public info + the agent's own hand. */
function beliefState(view: AgentView): GameState {
  return { ...stateForSeat(view.publicGame, view.seat, view.hand, view.myRocks), result: null };
}

const POSITION = [0.6, 0.3, 0.6, 0.3, 1, 0.3, 0.6, 0.3, 0.6];

function evaluate(state: GameState, me: Seat, action: Action, handAfter: number[]): number {
  if (state.result) {
    const [a, b] =
      me === 0 ? state.result.scores : [state.result.scores[1], state.result.scores[0]];
    if (state.result.winner === null) return a - b;
    return (state.result.winner === me ? 1000 : -1000) + (a - b) * 10;
  }
  const opp = other(me);
  let value = 0;
  let empty = 0;
  state.board.forEach((sq, i) => {
    if (!sq) {
      empty++;
      return;
    }
    if (sq.controller === me) value += 10 + POSITION[i]!;
    else value -= 10 + POSITION[i]!;
  });

  // Defensive exposure of our face-up squares.
  state.board.forEach((sq, i) => {
    if (!sq || sq.controller !== me || isRock(sq)) return;
    const card = getCard(sq.stack[sq.stack.length - 1]!.card);
    for (const nb of neighbours(i)) {
      const n = state.board[nb.square];
      // Opponent attacks from nb.square with its edge facing us (nb.defend
      // from our point of view is their attacking edge).
      const ourEdge = card[nb.attack];
      if (!n) {
        // An empty neighbour: they could place a Level I card there.
        value -= 6 * beatShare(1, nb.defend as Edge, ourEdge);
      } else if (n.controller === opp) {
        // They could upgrade that square one level and attack us.
        const lvl = isRock(n) ? 1 : getCard(n.stack[n.stack.length - 1]!.card).level;
        if (lvl < 5) value -= 4 * beatShare(lvl + 1, nb.defend as Edge, ourEdge);
      }
    }
  });

  // One empty square left → whoever fills it ends the game. If it's the
  // opponent's turn next, assume they can end it on their terms.
  if (empty === 1) value -= 3;

  // Upgrade options we keep for our own squares.
  const levelsInHand = new Set(handAfter.map((n) => getCard(n).level));
  state.board.forEach((sq) => {
    if (!sq || sq.controller !== me) return;
    const lvl = isRock(sq) ? 1 : getCard(sq.stack[sq.stack.length - 1]!.card).level;
    if (levelsInHand.has((lvl + 1) as Card["level"])) value += 1.5;
  });

  // Card economy.
  if (action.type === "rock") value -= 1.2 * getCard(action.card).level;
  else if (action.type !== "pass") value -= 0.25 * getCard(action.card).level;
  return value;
}

/**
 * Choose the agent's action. Always returns a legal action for the
 * belief state (and therefore for the real game, since legality only
 * depends on the agent's own hand and the public board).
 */
export function chooseAgentAction(view: AgentView, seed: string): Action {
  const rand = seededRandom(seed);
  let state: GameState;
  let actions: Action[];
  try {
    state = beliefState(view);
    actions = legalActions(state, view.seat);
  } catch {
    return { type: "pass" };
  }
  if (actions.length === 0) return { type: "pass" };
  try {
    let best: Action[] = [];
    let bestScore = -Infinity;
    for (const a of actions) {
      const { state: next } = applyAction(state, view.seat, a);
      const handAfter = next.hands[view.seat];
      const v = evaluate(next, view.seat, a, handAfter);
      if (v > bestScore + 1e-9) {
        bestScore = v;
        best = [a];
      } else if (Math.abs(v - bestScore) <= 1e-9) {
        best.push(a);
      }
    }
    return best[Math.floor(rand() * best.length)] ?? actions[0]!;
  } catch {
    // Seeded random legal fallback — never freeze the match.
    return actions[Math.floor(rand() * actions.length)]!;
  }
}

/** The agent's 14-card selection for a new match. */
export function chooseAgentDeck(seed: string): number[] {
  const rand = seededRandom(`deck:${seed}`);
  const pick = (level: number, n: number) => {
    const pool = CARDS.filter((c) => c.level === level)
      .map((c) => ({ c, w: c.north + c.east + c.south + c.west + rand() * 3 }))
      .sort((a, b) => b.w - a.w);
    return pool.slice(0, n).map((x) => x.c.number);
  };
  return [...pick(1, 7), ...pick(2, 3), ...pick(3, 2), ...pick(4, 1), ...pick(5, 1)];
}
