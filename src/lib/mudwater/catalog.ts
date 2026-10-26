import { CATALOG_CSV } from "./catalog-data";
import type { Card, Family, Level, Rarity } from "./types";

/**
 * Pinned catalogue version. Matches record the version they were dealt
 * with, so a future catalogue update can never change a game in progress.
 */
export const CATALOG_VERSION = "swamp-origins-live-2026-10-26";
export const RULES_VERSION = "mudwater-v1";
export const DECK_SIZE = 14;
export const HAND_SIZE = 13;

const RARITY_LEVEL: Record<Rarity, Level> = {
  Common: 1,
  Uncommon: 2,
  Rare: 3,
  Prestige: 4,
  Legendary: 5,
};
const FAMILIES: Family[] = ["CLUB", "MUTANT", "COSMIC", "ARCANA"];

export interface CatalogIssue {
  line: number;
  problem: string;
}

/**
 * Parse + validate catalogue CSV. Returns the cards and every problem
 * found; a valid catalogue has no issues. Nothing is ever filled in or
 * guessed — a bad row is reported, not repaired.
 */
export function parseCatalog(csv: string): { cards: Card[]; issues: CatalogIssue[] } {
  const lines = csv.trim().split(/\r?\n/);
  const issues: CatalogIssue[] = [];
  const header = lines[0]?.trim();
  if (header !== "number,name,family,rarity,level,north,east,south,west") {
    issues.push({ line: 1, problem: `unexpected header "${header}"` });
  }
  const cards: Card[] = [];
  const numbers = new Set<number>();
  const names = new Set<string>();
  lines.slice(1).forEach((raw, i) => {
    const line = i + 2;
    if (!raw.trim()) return;
    const f = raw.split(",").map((s) => s.trim());
    if (f.length !== 9) {
      issues.push({ line, problem: `expected 9 fields, got ${f.length}` });
      return;
    }
    const [num, name, family, rarity, level, n, e, s, w] = f;
    const number = Number(num);
    const strengths = [n, e, s, w].map(Number);
    if (!Number.isInteger(number) || number < 1 || number > 120) {
      issues.push({ line, problem: `bad card number "${num}"` });
    }
    if (numbers.has(number)) issues.push({ line, problem: `duplicate number ${number}` });
    if (!name) issues.push({ line, problem: "missing name" });
    if (names.has(name.toLowerCase())) issues.push({ line, problem: `duplicate name "${name}"` });
    if (!FAMILIES.includes(family as Family)) {
      issues.push({ line, problem: `unknown family "${family}"` });
    }
    const rl = RARITY_LEVEL[rarity as Rarity];
    if (!rl) issues.push({ line, problem: `unknown rarity "${rarity}"` });
    if (rl && Number(level) !== rl) {
      issues.push({ line, problem: `level ${level} doesn't match rarity ${rarity} (${rl})` });
    }
    if (strengths.some((v) => !Number.isInteger(v) || v < 1 || v > 10)) {
      issues.push({ line, problem: `strengths must be whole numbers 1–10: ${[n, e, s, w]}` });
    }
    numbers.add(number);
    names.add(name.toLowerCase());
    cards.push({
      number,
      name,
      family: family as Family,
      rarity: rarity as Rarity,
      level: (rl ?? Number(level)) as Level,
      north: strengths[0]!,
      east: strengths[1]!,
      south: strengths[2]!,
      west: strengths[3]!,
    });
  });
  cards.sort((a, b) => a.number - b.number);
  return { cards, issues };
}

function load(): Card[] {
  const { cards, issues } = parseCatalog(CATALOG_CSV);
  if (issues.length) {
    throw new Error(
      `Mudwater catalogue failed validation: ${issues
        .slice(0, 5)
        .map((i) => `line ${i.line}: ${i.problem}`)
        .join("; ")}`,
    );
  }
  return cards;
}

export const CARDS: readonly Card[] = load();
const BY_NUMBER = new Map(CARDS.map((c) => [c.number, c]));

export function getCard(number: number): Card {
  const c = BY_NUMBER.get(number);
  if (!c) throw new Error(`Unknown Mudwater card #${number}`);
  return c;
}

export function isCard(number: number): boolean {
  return BY_NUMBER.has(number);
}

/** Validate a 14-card selection: distinct, real card numbers. */
export function validateDeck(deck: number[]): string | null {
  if (!Array.isArray(deck) || deck.length !== DECK_SIZE) {
    return `Choose exactly ${DECK_SIZE} cards.`;
  }
  if (new Set(deck).size !== deck.length) return "Each card can be chosen only once.";
  const unknown = deck.find((n) => !isCard(n));
  if (unknown !== undefined) return `Card #${unknown} isn't in the catalogue.`;
  if (!deck.some((n) => getCard(n).level === 1)) {
    return "Include at least one Level I card — only Level I cards can be placed on an empty square.";
  }
  return null;
}

/**
 * A sensible starting deck: mostly strong Level I cards (the only cards that
 * can open a square) plus an upgrade ladder. Deterministic for a given
 * `variant`, so the picker can offer "another suggestion".
 */
export function recommendedDeck(variant = 0): number[] {
  const byLevel = (lvl: Level) =>
    CARDS.filter((c) => c.level === lvl).sort(
      (a, b) =>
        b.north + b.east + b.south + b.west - (a.north + a.east + a.south + a.west) ||
        a.number - b.number,
    );
  const want: [Level, number][] = [
    [1, 7],
    [2, 3],
    [3, 2],
    [4, 1],
    [5, 1],
  ];
  const deck: number[] = [];
  for (const [lvl, count] of want) {
    const pool = byLevel(lvl);
    const start = (variant * count) % Math.max(1, pool.length - count + 1);
    deck.push(...pool.slice(start, start + count).map((c) => c.number));
  }
  return deck;
}
