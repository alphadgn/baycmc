import { describe, expect, it } from "vitest";
import {
  CARDS,
  getCard,
  parseCatalog,
  recommendedDeck,
  validateDeck,
} from "@/lib/mudwater/catalog";
import { CATALOG_CSV } from "@/lib/mudwater/catalog-data";
import { agentView, privateView, publicView } from "@/lib/mudwater/projections";
import {
  applyAction,
  familyBeats,
  legalActions,
  newGame,
  validateAction,
} from "@/lib/mudwater/rules";
import type { GameState, Seat, Square } from "@/lib/mudwater/types";
// eslint-disable-next-line no-restricted-imports -- unit tests run server-side
import { chooseAgentAction, chooseAgentDeck } from "@/server/mudwater/agent.server";

// Cards used below (live catalogue values, N/E/S/W):
//  #1 Bottle Rocket   CLUB   L1  2/4/3/2      #10 Off Duty     CLUB L1 2/2/2/2
//  #26 Bored Stiff    CLUB   L1  4/1/1/4      #63 Serum I    MUTANT L1 2/2/3/3
//  #95 Moon Dust      COSMIC L1  4/2/2/2      #91 The Abduction COSMIC L1 2/2/2/4
//  #101 The Degen     ARCANA L1  2/2/3/3      #2 Sea Dog       CLUB L1 3/2/3/3
//  #31 Golden Stacks  CLUB   L2  4/4/4/4      #34 Bored at the Door CLUB L3 5/5/5/5
//  #8 Lofi on the Dock CLUB  L4  8/8/3/7      #49 Good Boy Gary CLUB L5 7/9/7/3

const RULES = { advanced: false, catalogVersion: "test", rulesVersion: "test" };

/** Build a mid-game state directly. */
function mk(opts: {
  board?: Record<number, { cards: [number, boolean, Seat][]; controller: Seat }>;
  hands?: [number[], number[]];
  turn?: Seat;
  advanced?: boolean;
  passes?: number;
}): GameState {
  const board: (Square | null)[] = Array.from({ length: 9 }, () => null);
  for (const [i, sq] of Object.entries(opts.board ?? {})) {
    board[Number(i)] = {
      controller: sq.controller,
      stack: sq.cards.map(([card, faceDown, playedBy]) => ({ card, faceDown, playedBy })),
    };
  }
  return {
    rules: { ...RULES, advanced: !!opts.advanced },
    board,
    hands: opts.hands ?? [[], []],
    antes: [0, 0],
    decks: [[], []],
    turn: opts.turn ?? 0,
    startingSeat: 0,
    passes: opts.passes ?? 0,
    moveNumber: 0,
    result: null,
  };
}

describe("catalogue", () => {
  it("loads all 120 cards and validates cleanly", () => {
    expect(CARDS).toHaveLength(120);
    expect(parseCatalog(CATALOG_CSV).issues).toEqual([]);
    expect(getCard(84).name).toBe("The Box");
    expect(getCard(120)).toMatchObject({ family: "ARCANA", level: 5, north: 8, east: 3 });
  });
  it("reports bad rows instead of guessing", () => {
    const bad = `number,name,family,rarity,level,north,east,south,west
1,A,CLUB,Common,1,2,2,2
2,B,CLUB,Common,2,2,2,2,2
2,C,NOPE,Common,1,2,2,2,2`;
    const { issues } = parseCatalog(bad);
    const problems = issues.map((i) => i.problem).join(" | ");
    expect(problems).toMatch(/expected 9 fields/);
    expect(problems).toMatch(/doesn't match rarity/);
    expect(problems).toMatch(/duplicate number/);
    expect(problems).toMatch(/unknown family/);
  });
  it("deck validation: 14 distinct real cards with a Level I", () => {
    expect(validateDeck(recommendedDeck())).toBeNull();
    expect(validateDeck(recommendedDeck().slice(0, 13))).toMatch(/exactly 14/);
    const dup = recommendedDeck();
    dup[1] = dup[0]!;
    expect(validateDeck(dup)).toMatch(/only once/);
    const noL1 = CARDS.filter((c) => c.level > 1)
      .slice(0, 14)
      .map((c) => c.number);
    expect(validateDeck(noL1)).toMatch(/Level I/);
  });
});

describe("setup", () => {
  it("removes the ante from the hand", () => {
    const deck = recommendedDeck();
    const g = newGame({
      decks: [deck, recommendedDeck(1)],
      anteIndex: [3, 0],
      startingSeat: 1,
      rules: RULES,
    });
    expect(g.hands[0]).toHaveLength(13);
    expect(g.hands[0]).not.toContain(deck[3]);
    expect(g.antes[0]).toBe(deck[3]);
    expect(g.turn).toBe(1);
  });
});

describe("placing and upgrading", () => {
  it("only Level I cards can be placed on an empty square", () => {
    const s = mk({ hands: [[31, 10], []] });
    expect(validateAction(s, 0, { type: "place", card: 31, square: 0 })).toMatch(/Level I/);
    expect(validateAction(s, 0, { type: "place", card: 10, square: 0 })).toBeNull();
  });
  it("upgrades need exactly one level higher on a square you control", () => {
    const s = mk({
      board: {
        0: { cards: [[10, false, 0]], controller: 0 },
        1: { cards: [[2, false, 1]], controller: 1 },
      },
      hands: [[31, 34], []],
    });
    expect(validateAction(s, 0, { type: "upgrade", card: 34, square: 0 })).toMatch(/Level II/);
    expect(validateAction(s, 0, { type: "upgrade", card: 31, square: 0 })).toBeNull();
    expect(validateAction(s, 0, { type: "upgrade", card: 31, square: 1 })).toMatch(/you control/);
  });
  it("a captured square can be upgraded by its new controller", () => {
    // Square 1 holds seat 1's card but seat 0 controls it.
    const s = mk({ board: { 1: { cards: [[2, false, 1]], controller: 0 } }, hands: [[31], []] });
    expect(validateAction(s, 0, { type: "upgrade", card: 31, square: 1 })).toBeNull();
    const { state } = applyAction(s, 0, { type: "upgrade", card: 31, square: 1 });
    expect(state.board[1]!.stack.map((e) => [e.card, e.playedBy])).toEqual([
      [2, 1],
      [31, 0],
    ]);
  });
});

describe("rocks", () => {
  it("count as Level I, can't be captured, and only one may be uncovered", () => {
    const s = mk({ hands: [[34, 31, 10], [26]] });
    const r1 = applyAction(s, 0, { type: "rock", card: 34, square: 4 }).state;
    // Seat 1 places Bored Stiff (east 4) next to the rock: no capture.
    const r2 = applyAction(r1, 1, { type: "place", card: 26, square: 3 });
    expect(r2.effect.captured).toEqual([]);
    expect(r2.state.board[4]!.controller).toBe(0);
    // A second uncovered rock is not allowed.
    expect(validateAction(r2.state, 0, { type: "rock", card: 10, square: 0 })).toMatch(
      /uncovered rock/,
    );
    // The rock takes a Level II upgrade (even though the hidden card is L3).
    expect(validateAction(r2.state, 0, { type: "upgrade", card: 31, square: 4 })).toBeNull();
  });
  it("covering a rock allows another rock", () => {
    const s = mk({
      board: { 4: { cards: [[34, true, 0]], controller: 0 } },
      hands: [[31, 10], []],
    });
    expect(validateAction(s, 0, { type: "rock", card: 10, square: 0 })).toMatch(/uncovered rock/);
    const covered = applyAction(s, 0, { type: "upgrade", card: 31, square: 4 }).state;
    covered.turn = 0;
    expect(validateAction(covered, 0, { type: "rock", card: 10, square: 0 })).toBeNull();
  });
});

describe("captures", () => {
  it("higher touching edge captures; equal or lower holds", () => {
    // Bottle Rocket at 0 attacks east with 4.
    const vsLower = mk({
      board: { 1: { cards: [[2, false, 1]], controller: 1 } },
      hands: [[1], []],
    }); // west 3
    expect(applyAction(vsLower, 0, { type: "place", card: 1, square: 0 }).effect.captured).toEqual([
      1,
    ]);
    const vsEqual = mk({
      board: { 1: { cards: [[91, false, 1]], controller: 1 } },
      hands: [[1], []],
    }); // west 4
    expect(applyAction(vsEqual, 0, { type: "place", card: 1, square: 0 }).effect.captured).toEqual(
      [],
    );
  });
  it("checks all four directions, ignores diagonals", () => {
    // Golden Stacks (4/4/4/4) upgrades centre; Off Duty (2s) all around + a diagonal.
    const enemy = (sq: number) => ({
      cards: [[10, false, 1]] as [number, boolean, Seat][],
      controller: 1 as Seat,
    });
    const s = mk({
      board: {
        4: { cards: [[10, false, 0]], controller: 0 },
        1: enemy(1),
        3: enemy(3),
        5: enemy(5),
        7: enemy(7),
        0: enemy(0),
      },
      hands: [[31], []],
    });
    const { effect, state } = applyAction(s, 0, { type: "upgrade", card: 31, square: 4 });
    expect(effect.captured.sort()).toEqual([1, 3, 5, 7]);
    expect(state.board[0]!.controller).toBe(1);
  });
  it("captured cards don't chain-attack", () => {
    // 0 captures 1 (Off Duty); 1's neighbour 2 is a weak enemy card but must stay.
    const s = mk({
      board: {
        1: { cards: [[26, false, 1]], controller: 1 },
        2: { cards: [[10, false, 1]], controller: 1 },
      },
      hands: [[1], []],
    });
    const { state } = applyAction(s, 0, { type: "place", card: 1, square: 0 }); // east 4 vs Bored Stiff west 4 → hold
    expect(state.board[1]!.controller).toBe(1);
    const s2 = mk({
      board: {
        1: { cards: [[63, false, 1]], controller: 1 },
        2: { cards: [[10, false, 1]], controller: 1 },
      },
      hands: [[1], []],
    });
    const r = applyAction(s2, 0, { type: "place", card: 1, square: 0 }); // 4 vs Serum I west 3 → capture
    expect(r.effect.captured).toEqual([1]);
    expect(r.state.board[2]!.controller).toBe(1);
  });
  it("advanced mode: family advantage only breaks equal edges", () => {
    expect(familyBeats("CLUB", "MUTANT")).toBe(true);
    expect(familyBeats("MUTANT", "COSMIC")).toBe(true);
    expect(familyBeats("COSMIC", "ARCANA")).toBe(true);
    expect(familyBeats("ARCANA", "CLUB")).toBe(true);
    for (const [a, b] of [
      ["CLUB", "COSMIC"],
      ["MUTANT", "ARCANA"],
      ["CLUB", "CLUB"],
      ["MUTANT", "CLUB"],
    ] as const) {
      expect(familyBeats(a, b)).toBe(false);
    }
    // Moon Dust (COSMIC, north 4) placed at 3 attacks square 0 (Bored Stiff, CLUB, south 1) → normal win.
    // Equal-edge case: Off Duty (CLUB, east 2) at 0 vs Serum I (MUTANT, west 3) → lower, no capture even in advanced.
    const lower = mk({
      board: { 1: { cards: [[63, false, 1]], controller: 1 } },
      hands: [[10], []],
      advanced: true,
    });
    expect(applyAction(lower, 0, { type: "place", card: 10, square: 0 }).effect.captured).toEqual(
      [],
    );
    // Off Duty (CLUB, south 2) at 0 vs The Gurgle (#68 MUTANT, north 2) at 3 → equal, CLUB beats MUTANT.
    const tie = mk({ board: { 3: { cards: [[68, false, 1]], controller: 1 } }, hands: [[10], []] });
    expect(applyAction(tie, 0, { type: "place", card: 10, square: 0 }).effect.captured).toEqual([]);
    const tieAdv = { ...tie, rules: { ...tie.rules, advanced: true } };
    expect(applyAction(tieAdv, 0, { type: "place", card: 10, square: 0 }).effect.captured).toEqual([
      3,
    ]);
    // Rocks stay immune in advanced mode.
    const rock = mk({
      board: { 3: { cards: [[68, true, 1]], controller: 1 } },
      hands: [[10], []],
      advanced: true,
    });
    expect(applyAction(rock, 0, { type: "place", card: 10, square: 0 }).effect.captured).toEqual(
      [],
    );
  });
});

describe("ending", () => {
  it("resolves the ninth card's captures before scoring", () => {
    const own = (c: number): { cards: [number, boolean, Seat][]; controller: Seat } => ({
      cards: [[c, false, 0]],
      controller: 0,
    });
    const opp = (c: number): { cards: [number, boolean, Seat][]; controller: Seat } => ({
      cards: [[c, false, 1]],
      controller: 1,
    });
    // Board full except 8; seat 1 leads 5–3 before the last move.
    const s = mk({
      board: {
        0: own(10),
        1: own(10),
        2: own(10),
        3: opp(10),
        4: opp(10),
        5: opp(10),
        6: opp(10),
        7: opp(10),
      },
      hands: [[31, 1], []],
    });
    // Bottle Rocket at 8 attacks 5 (north 2 vs south 2 → hold) and 7 (west 2 vs east 2 → hold).
    const hold = applyAction(s, 0, { type: "place", card: 1, square: 8 });
    expect(hold.state.result).toMatchObject({ reason: "board_full", scores: [4, 5], winner: 1 });
    // Bored Stiff (north 4, west 4) captures 5 and 7 → 6–3 the other way.
    const s2 = { ...s, hands: [[26], []] as [number[], number[]] };
    const win = applyAction(s2, 0, { type: "place", card: 26, square: 8 });
    expect(win.effect.captured.sort()).toEqual([5, 7]);
    expect(win.state.result).toMatchObject({ scores: [6, 3], winner: 0 });
  });
  it("passing is only allowed when there's no legal move; two passes end in a draw on equal scores", () => {
    const s = mk({ hands: [[10], []] });
    expect(validateAction(s, 0, { type: "pass" })).toMatch(/can't pass/);
    // Seat 1 has no cards → must pass; then seat 0 (no cards either) passes.
    const s2 = mk({
      board: {
        0: { cards: [[10, false, 0]], controller: 0 },
        8: { cards: [[10, false, 1]], controller: 1 },
      },
      turn: 1,
    });
    expect(legalActions(s2, 1)).toEqual([]);
    const p1 = applyAction(s2, 1, { type: "pass" }).state;
    expect(p1.result).toBeNull();
    const p2 = applyAction(p1, 0, { type: "pass" }).state;
    expect(p2.result).toMatchObject({ reason: "double_pass", winner: null, scores: [1, 1] });
  });
  it("any non-pass action resets the pass count", () => {
    const s = mk({ hands: [[10], []], passes: 1 });
    expect(applyAction(s, 0, { type: "place", card: 10, square: 0 }).state.passes).toBe(0);
  });
  it("scores squares, not stacks", () => {
    const s = mk({
      board: {
        0: {
          cards: [
            [10, false, 0],
            [31, false, 0],
            [34, false, 0],
          ],
          controller: 0,
        },
      },
    });
    expect(publicView(s).scores).toEqual([1, 0]);
  });
});

describe("hidden information", () => {
  const deckA = recommendedDeck();
  const deckB = recommendedDeck(2);
  const g0 = newGame({ decks: [deckA, deckB], anteIndex: [0, 5], startingSeat: 0, rules: RULES });
  const rockCard = g0.hands[0].find((n) => getCard(n).level === 3)!;
  const g = applyAction(g0, 0, { type: "rock", card: rockCard, square: 4 }).state;

  it("public view hides hands, antes and rock identities", () => {
    const pv = publicView(g);
    expect(pv.antes).toBeNull();
    expect(pv.board[4]!.layers[0]).toEqual({ card: null, faceDown: true, playedBy: 0 });
    expect(Object.keys(pv)).not.toContain("hands");
    expect(pv.handCounts).toEqual([12, 13]);
  });
  it("each seat sees only its own hand and rocks", () => {
    expect(privateView(g, 0).myRocks).toEqual([{ square: 4, card: rockCard, covered: false }]);
    expect(privateView(g, 1).myRocks).toEqual([]);
    expect(privateView(g, 1).hand).toEqual(g.hands[1]);
  });
  it("the agent view carries no opponent hand or antes", () => {
    const av = agentView(g, 1);
    expect(av.hand).toEqual(g.hands[1]);
    expect(av.publicGame.antes).toBeNull();
    expect(JSON.stringify(av)).not.toContain(`"card":${rockCard},"faceDown":true`);
  });
  it("reveals antes and buried rocks after the match", () => {
    const over = {
      ...g,
      result: { winner: 0 as Seat, scores: [1, 0] as [number, number], reason: "resign" as const },
    };
    const pv = publicView(over);
    expect(pv.antes).toEqual([deckA[0], deckB[5]]);
    expect(pv.board[4]!.layers[0]!.card).toBe(rockCard);
  });
});

describe("BAYCmc agent", () => {
  it("builds a valid deck", () => {
    expect(validateDeck(chooseAgentDeck("x"))).toBeNull();
  });
  it("only ever chooses legal actions and finishes complete games", () => {
    for (let seed = 0; seed < 30; seed++) {
      let g = newGame({
        decks: [chooseAgentDeck(`a${seed}`), chooseAgentDeck(`b${seed}`)],
        anteIndex: [seed % 14, (seed * 5) % 14],
        startingSeat: (seed % 2) as Seat,
        rules: { ...RULES, advanced: seed % 3 === 0 },
      });
      let guard = 0;
      while (!g.result && guard++ < 60) {
        const action = chooseAgentAction(agentView(g, g.turn), `s${seed}:${g.moveNumber}`);
        expect(validateAction(g, g.turn, action)).toBeNull();
        g = applyAction(g, g.turn, action).state;
      }
      expect(g.result).not.toBeNull();
    }
  });
  it("takes an available capture over a quiet move", () => {
    const s = mk({
      board: { 1: { cards: [[2, false, 0]], controller: 0 } },
      hands: [[], [26, 10]],
      turn: 1,
    });
    // Bored Stiff (west 4) at 2 beats Sea Dog's east 2 at square 1.
    const a = chooseAgentAction(agentView(s, 1), "t");
    const { effect } = applyAction(s, 1, a);
    expect(effect.captured).toEqual([1]);
  });
});
