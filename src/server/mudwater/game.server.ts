import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { CATALOG_VERSION, DECK_SIZE, RULES_VERSION, validateDeck } from "@/lib/mudwater/catalog";
import { agentView, privateView, publicView, type PublicGame } from "@/lib/mudwater/projections";
import { applyAction, endEarly, legalActions, other, validateAction } from "@/lib/mudwater/rules";
import type { Action, GameState, Seat } from "@/lib/mudwater/types";
import {
  AGENT_NAME,
  AGENT_POLICY_VERSION,
  chooseAgentAction,
  chooseAgentDeck,
} from "./agent.server";

/**
 * Server-authoritative Mudwater (Phase 1: free play).
 *
 * Every change is computed here with the shared engine and committed with
 * `mudwater_commit` (compare-and-swap on the match version), so two
 * requests can never both apply a move. Browsers only ever receive the
 * sanitized projections; the full state stays in `mudwater_state`.
 */

export class MudwaterError extends Error {}
const fail = (msg: string): never => {
  throw new MudwaterError(msg);
};

type MatchRow = {
  id: string;
  room_id: string;
  room_name: string;
  room_slug: string;
  required_collection: string | null;
  status: string;
  mode: string;
  advanced: boolean;
  turn_seconds: number;
  starting_seat: number | null;
  version: number;
  public_state: Json | null;
  turn_deadline: string | null;
  winner_seat: number | null;
  end_reason: string | null;
  scores: number[] | null;
  rematch_of: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};
type SeatRow = {
  match_id: string;
  seat: number;
  user_id: string | null;
  is_agent: boolean;
  display_name: string;
  avatar_url: string | null;
  ready: boolean;
  active: boolean;
};

const MATCH_COLS =
  "id,room_id,room_name,room_slug,required_collection,status,mode,advanced,turn_seconds,starting_seat,version,public_state,turn_deadline,winner_seat,end_reason,scores,rematch_of,created_at,started_at,finished_at";
const SEAT_COLS = "match_id,seat,user_id,is_agent,display_name,avatar_url,ready,active";

// ── Randomness ─────────────────────────────────────────────────────────────

/** Unbiased crypto random integer in [0, n). */
function randomInt(n: number): number {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % n;
  }
}
const randomId = () => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};

// ── Access ─────────────────────────────────────────────────────────────────

export async function canPlay(roomId: string, userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.rpc("mudwater_can_play", { _room: roomId, _uid: userId });
  return data === true;
}
export async function canWatch(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.rpc("mudwater_can_watch", { _uid: userId });
  return data === true;
}
async function canViewMatch(matchId: string, userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.rpc("mudwater_can_view_match", {
    _match: matchId,
    _uid: userId,
  });
  return data === true;
}

function collectionLabel(label: string | null): string {
  if (label === "PUNKS") return "CryptoPunks";
  return label ?? "";
}
const noPlayAccess = (required: string | null) =>
  required
    ? `This table is for verified ${collectionLabel(required)} holders. Sign in with a wallet that holds (or is delegated) one to play here.`
    : "Sign in to play.";

// ── Loading ────────────────────────────────────────────────────────────────

async function loadRoom(roomId: string) {
  const { data } = await supabaseAdmin
    .from("rooms")
    .select("id,name,slug,description,required_collection,kind,active,display_order")
    .eq("id", roomId)
    .maybeSingle();
  if (!data || data.kind !== "mudwater" || !data.active) fail("That Mudwater room doesn't exist.");
  return data!;
}

async function loadMatch(matchId: string): Promise<MatchRow> {
  const { data } = await supabaseAdmin
    .from("mudwater_matches")
    .select(MATCH_COLS)
    .eq("id", matchId)
    .maybeSingle();
  if (!data) fail("That match doesn't exist.");
  return data as MatchRow;
}
async function loadSeats(matchId: string): Promise<SeatRow[]> {
  const { data } = await supabaseAdmin
    .from("mudwater_seats")
    .select(SEAT_COLS)
    .eq("match_id", matchId)
    .order("seat");
  return (data ?? []) as SeatRow[];
}
async function loadState(matchId: string): Promise<GameState | null> {
  const { data } = await supabaseAdmin
    .from("mudwater_state")
    .select("state")
    .eq("match_id", matchId)
    .maybeSingle();
  return (data?.state as unknown as GameState) ?? null;
}
async function openMatchForRoom(roomId: string): Promise<MatchRow | null> {
  const { data } = await supabaseAdmin
    .from("mudwater_matches")
    .select(MATCH_COLS)
    .eq("room_id", roomId)
    .in("status", ["waiting", "playing"])
    .maybeSingle();
  return (data as MatchRow) ?? null;
}
async function latestMatchForRoom(roomId: string): Promise<MatchRow | null> {
  const { data } = await supabaseAdmin
    .from("mudwater_matches")
    .select(MATCH_COLS)
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as MatchRow) ?? null;
}

async function memberIdentity(userId: string) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("username,wallet_display,avatar_url")
    .eq("id", userId)
    .maybeSingle();
  return {
    display_name: data?.username?.trim() || data?.wallet_display || "Member",
    avatar_url: data?.avatar_url ?? null,
  };
}

// ── Commit ─────────────────────────────────────────────────────────────────

function patchFor(state: GameState, turnSeconds: number): Record<string, unknown> {
  const pub = publicView(state);
  if (state.result) {
    return {
      status: "finished",
      public_state: pub,
      turn_deadline: null,
      winner_seat: state.result.winner,
      end_reason: state.result.reason,
      scores: state.result.scores,
    };
  }
  return {
    public_state: pub,
    turn_deadline: new Date(Date.now() + turnSeconds * 1000).toISOString(),
    scores: pub.scores,
  };
}
function privateRows(state: GameState) {
  return ([0, 1] as const).map((seat) => {
    const p = privateView(state, seat);
    return { seat, hand: p.hand, rocks: p.myRocks };
  });
}

async function commit(
  match: { id: string; version: number; turn_seconds: number },
  state: GameState,
  opts: { patch?: Record<string, unknown>; action?: Record<string, unknown> | null } = {},
): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("mudwater_commit", {
    _match: match.id,
    _expected_version: match.version,
    _patch: { ...patchFor(state, match.turn_seconds), ...(opts.patch ?? {}) } as Json,
    _state: state as unknown as Json,
    _action: (opts.action ?? null) as Json,
    _private: privateRows(state) as unknown as Json,
  });
  if (error) {
    if (/duplicate key/i.test(error.message)) fail("That move was already received.");
    console.error("mudwater_commit failed", error);
    fail("Couldn't save the move. Please try again.");
  }
  if (data !== true)
    fail("The game moved on before your move arrived — the board has been refreshed.");
  return match.version + 1;
}

function actionRow(
  state: GameState,
  seat: Seat,
  action: Action,
  actor: "human" | "agent",
  actionId: string,
  captured: number[],
  ended: boolean,
) {
  return {
    move_number: state.moveNumber,
    seat,
    actor,
    kind: action.type,
    square: action.type === "pass" ? null : action.square,
    // Rocks are face down: the log never names the card.
    card: action.type === "place" || action.type === "upgrade" ? action.card : null,
    captured,
    ended,
    action_id: actionId,
  };
}

/**
 * After any change, keep the game moving without waiting on anyone:
 * the BAYCmc agent plays its turn, and a human seat with no legal move
 * passes automatically (passing is forced by the rules).
 */
async function advance(match: MatchRow, state: GameState, seats: SeatRow[]): Promise<GameState> {
  let version = match.version;
  for (let guard = 0; guard < 40 && !state.result; guard++) {
    const seat = state.turn;
    const seatRow = seats.find((s) => s.seat === seat);
    let action: Action;
    let actor: "human" | "agent";
    if (seatRow?.is_agent) {
      action = chooseAgentAction(agentView(state, seat), `${match.id}:${state.moveNumber}`);
      if (validateAction(state, seat, action)) {
        const legal = legalActions(state, seat);
        action = legal[0] ?? { type: "pass" };
      }
      actor = "agent";
    } else if (legalActions(state, seat).length === 0) {
      action = { type: "pass" };
      actor = "human";
    } else {
      break;
    }
    const { state: next, effect } = applyAction(state, seat, action);
    version = await commit({ ...match, version }, next, {
      action: actionRow(
        next,
        seat,
        action,
        actor,
        `${actor}-${next.moveNumber}`,
        effect.captured,
        effect.ended,
      ),
    });
    state = next;
  }
  match.version = version;
  return state;
}

// ── Room view ──────────────────────────────────────────────────────────────

export interface SeatView {
  seat: Seat;
  displayName: string;
  avatarUrl: string | null;
  isAgent: boolean;
  ready: boolean;
  isMe: boolean;
}
export interface MatchView {
  id: string;
  roomId: string;
  roomName: string;
  requiredCollection: string | null;
  status: "waiting" | "playing" | "finished" | "aborted";
  mode: "agent" | "pvp";
  advanced: boolean;
  version: number;
  turnDeadline: string | null;
  turnSeconds: number;
  endReason: string | null;
  winnerSeat: Seat | null;
  game: PublicGame | null;
  seats: SeatView[];
  rematchOf: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

function toMatchView(m: MatchRow, seats: SeatRow[], userId: string | null): MatchView {
  return {
    id: m.id,
    roomId: m.room_id,
    roomName: m.room_name,
    requiredCollection: m.required_collection,
    status: m.status as MatchView["status"],
    mode: m.mode as MatchView["mode"],
    advanced: m.advanced,
    version: m.version,
    turnDeadline: m.turn_deadline,
    turnSeconds: m.turn_seconds,
    endReason: m.end_reason,
    winnerSeat: (m.winner_seat as Seat | null) ?? null,
    game: (m.public_state as unknown as PublicGame) ?? null,
    seats: seats
      .filter((s) => s.active || m.status === "finished" || m.status === "aborted")
      .map((s) => ({
        seat: s.seat as Seat,
        displayName: s.display_name,
        avatarUrl: s.avatar_url,
        isAgent: s.is_agent,
        ready: s.ready,
        isMe: !!userId && s.user_id === userId,
      })),
    rematchOf: m.rematch_of,
    startedAt: m.started_at,
    finishedAt: m.finished_at,
  };
}

export async function getRoom(userId: string, roomId: string) {
  const room = await loadRoom(roomId);
  if (!(await canPlay(roomId, userId))) {
    // A game in progress finishes normally even if the member lost the
    // collection mid-game; access ends when it's over.
    const open = await openMatchForRoom(roomId);
    const seated =
      open?.status === "playing" &&
      (await loadSeats(open.id)).some((s) => s.user_id === userId && s.active);
    if (!seated) fail(noPlayAccess(room.required_collection));
  }
  // Prefer the open match; otherwise show the last finished one (results,
  // rematch) if this member played in it.
  let match = await openMatchForRoom(roomId);
  if (!match) {
    const last = await latestMatchForRoom(roomId);
    if (last) {
      const seats = await loadSeats(last.id);
      if (seats.some((s) => s.user_id === userId)) match = last;
    }
  }
  const seats = match ? await loadSeats(match.id) : [];
  const mine = seats.find(
    (s) =>
      s.user_id === userId &&
      (s.active || match!.status === "finished" || match!.status === "aborted"),
  );
  let me: null | {
    seat: Seat;
    deck: number[];
    hand: number[];
    rocks: { square: number; card: number; covered: boolean }[];
    legal: Action[];
  } = null;
  if (match && mine) {
    const { data: priv } = await supabaseAdmin
      .from("mudwater_seat_private")
      .select("deck,hand,rocks")
      .eq("match_id", match.id)
      .eq("seat", mine.seat)
      .maybeSingle();
    let legal: Action[] = [];
    if (match.status === "playing") {
      const state = await loadState(match.id);
      if (state && state.turn === mine.seat && !state.result)
        legal = legalActions(state, mine.seat as Seat);
    }
    me = {
      seat: mine.seat as Seat,
      deck: priv?.deck ?? [],
      hand: priv?.hand ?? [],
      rocks: (priv?.rocks ?? []) as unknown as { square: number; card: number; covered: boolean }[],
      legal,
    };
  }
  return {
    room: {
      id: room.id,
      name: room.name,
      description: room.description,
      requiredCollection: room.required_collection,
    },
    match: match ? toMatchView(match, seats, userId) : null,
    me,
    agentName: AGENT_NAME,
    canWatch: await canWatch(userId),
  };
}

// ── Seats ──────────────────────────────────────────────────────────────────

async function releaseStaleSeatsFor(userId: string) {
  // A member can hold one active seat. Free any seat they still hold in a
  // waiting match elsewhere (e.g. they wandered off); playing seats stay.
  const { data } = await supabaseAdmin
    .from("mudwater_seats")
    .select("match_id,seat,mudwater_matches!inner(status,room_name)")
    .eq("user_id", userId)
    .eq("active", true);
  for (const row of (data ?? []) as unknown as {
    match_id: string;
    seat: number;
    mudwater_matches: { status: string; room_name: string };
  }[]) {
    if (row.mudwater_matches.status === "waiting") {
      await leaveWaiting(row.match_id, userId);
    } else if (row.mudwater_matches.status === "playing") {
      fail(
        `You're still playing in ${row.mudwater_matches.room_name}. Finish or resign that game first.`,
      );
    }
  }
}

export async function claimSeat(
  userId: string,
  input: { roomId: string; mode: "agent" | "pvp"; advanced: boolean },
) {
  const room = await loadRoom(input.roomId);
  if (!(await canPlay(room.id, userId))) fail(noPlayAccess(room.required_collection));

  const open = await openMatchForRoom(room.id);
  if (open) {
    const seats = await loadSeats(open.id);
    if (seats.some((s) => s.user_id === userId && s.active)) return { matchId: open.id };
    if (open.status !== "waiting" || open.mode !== "pvp") {
      fail("This table is busy. Watch the match, or try another room.");
    }
    const taken = new Set(seats.filter((s) => s.active).map((s) => s.seat));
    const free = ([0, 1] as const).find((s) => !taken.has(s));
    if (free === undefined) fail("Both seats are taken.");
    await releaseStaleSeatsFor(userId);
    const who = await memberIdentity(userId);
    const { error } = await supabaseAdmin.from("mudwater_seats").insert({
      match_id: open.id,
      seat: free!,
      user_id: userId,
      ...who,
    });
    if (error)
      fail(
        /one_active_per_user/.test(error.message)
          ? "You already have a seat at another table."
          : "That seat was just taken.",
      );
    await supabaseAdmin
      .from("mudwater_seat_private")
      .upsert({ match_id: open.id, seat: free!, user_id: userId, deck: [], hand: [] });
    return { matchId: open.id };
  }

  await releaseStaleSeatsFor(userId);
  const { data: created, error } = await supabaseAdmin
    .from("mudwater_matches")
    .insert({
      room_id: room.id,
      room_name: room.name,
      room_slug: room.slug ?? room.name.toLowerCase(),
      required_collection: room.required_collection,
      mode: input.mode,
      advanced: input.advanced,
      catalog_version: CATALOG_VERSION,
      rules_version: RULES_VERSION,
      agent_policy: input.mode === "agent" ? AGENT_POLICY_VERSION : null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !created) fail("Someone just opened this table — try again.");
  const who = await memberIdentity(userId);
  const { error: seatErr } = await supabaseAdmin
    .from("mudwater_seats")
    .insert({ match_id: created!.id, seat: 0, user_id: userId, ...who });
  if (seatErr) {
    await supabaseAdmin.from("mudwater_matches").delete().eq("id", created!.id);
    fail("You already have a seat at another table.");
  }
  await supabaseAdmin
    .from("mudwater_seat_private")
    .insert({ match_id: created!.id, seat: 0, user_id: userId });
  if (input.mode === "agent") await seatAgent(created!.id, 1);
  return { matchId: created!.id };
}

async function seatAgent(matchId: string, seat: Seat) {
  await supabaseAdmin.from("mudwater_seats").insert({
    match_id: matchId,
    seat,
    is_agent: true,
    display_name: AGENT_NAME,
    ready: true,
  });
  await supabaseAdmin
    .from("mudwater_seat_private")
    .insert({ match_id: matchId, seat, deck: chooseAgentDeck(`${matchId}:${seat}`) });
}

async function mySeat(matchId: string, userId: string, activeOnly = true): Promise<SeatRow> {
  const seats = await loadSeats(matchId);
  const s = seats.find((x) => x.user_id === userId && (!activeOnly || x.active));
  if (!s) fail("You're not seated in this match.");
  return s!;
}

export async function setDeck(
  userId: string,
  input: { matchId: string; deck: number[]; ready: boolean },
) {
  const match = await loadMatch(input.matchId);
  if (match.status !== "waiting") fail("The game has already started.");
  const seat = await mySeat(match.id, userId);
  if (input.ready) {
    const problem = validateDeck(input.deck);
    if (problem) fail(problem);
    // Ownership is re-checked here: a member who lost access before the
    // game starts can't start it.
    if (!(await canPlay(match.room_id, userId))) fail(noPlayAccess(match.required_collection));
  } else if (input.deck.length > DECK_SIZE) {
    fail(`Pick ${DECK_SIZE} cards.`);
  }
  await supabaseAdmin
    .from("mudwater_seat_private")
    .update({ deck: input.deck, updated_at: new Date().toISOString() })
    .eq("match_id", match.id)
    .eq("seat", seat.seat);
  await supabaseAdmin
    .from("mudwater_seats")
    .update({ ready: input.ready, last_seen_at: new Date().toISOString() })
    .eq("match_id", match.id)
    .eq("seat", seat.seat);
  if (input.ready) await maybeStart(match.id);
  return { ok: true as const };
}

async function maybeStart(matchId: string) {
  const match = await loadMatch(matchId);
  if (match.status !== "waiting") return;
  const seats = (await loadSeats(matchId)).filter((s) => s.active);
  if (seats.length !== 2 || !seats.every((s) => s.ready)) return;
  const { data: privs } = await supabaseAdmin
    .from("mudwater_seat_private")
    .select("seat,deck")
    .eq("match_id", matchId);
  const deckOf = (seat: number) => privs?.find((p) => p.seat === seat)?.deck ?? [];
  const decks: [number[], number[]] = [deckOf(0), deckOf(1)];
  if (decks.some((d) => validateDeck(d))) return;

  // Free games: the server picks each seat's ante from its committed
  // 14-card selection, and the opener, with crypto randomness. A rematch
  // reverses who opened last time.
  let startingSeat: Seat = randomInt(2) as Seat;
  if (match.rematch_of) {
    const prev = await loadMatch(match.rematch_of).catch(() => null);
    if (prev?.starting_seat === 0 || prev?.starting_seat === 1)
      startingSeat = other(prev.starting_seat as Seat);
  }
  const { newGame } = await import("@/lib/mudwater/rules");
  const state = newGame({
    decks,
    anteIndex: [randomInt(DECK_SIZE), randomInt(DECK_SIZE)],
    startingSeat,
    rules: {
      advanced: match.advanced,
      catalogVersion: CATALOG_VERSION,
      rulesVersion: RULES_VERSION,
    },
  });
  try {
    match.version = await commit(match, state, {
      patch: { status: "playing", starting_seat: startingSeat },
    });
  } catch (e) {
    if (e instanceof MudwaterError) return; // someone else started it
    throw e;
  }
  match.status = "playing";
  await advance(match, state, seats);
}

async function leaveWaiting(matchId: string, userId: string) {
  const seats = await loadSeats(matchId);
  const s = seats.find((x) => x.user_id === userId && x.active);
  if (!s) return;
  await supabaseAdmin
    .from("mudwater_seat_private")
    .delete()
    .eq("match_id", matchId)
    .eq("seat", s.seat);
  await supabaseAdmin.from("mudwater_seats").delete().eq("match_id", matchId).eq("seat", s.seat);
  const humansLeft = seats.filter((x) => !x.is_agent && x.active && x.user_id !== userId).length;
  if (humansLeft === 0) {
    const m = await loadMatch(matchId);
    await supabaseAdmin
      .from("mudwater_matches")
      .update({
        status: "aborted",
        end_reason: "left",
        finished_at: new Date().toISOString(),
        version: m.version + 1,
      })
      .eq("id", matchId)
      .eq("version", m.version);
    await supabaseAdmin.from("mudwater_seats").update({ active: false }).eq("match_id", matchId);
  } else {
    // The remaining player must ready up again against whoever sits next.
    await supabaseAdmin
      .from("mudwater_seats")
      .update({ ready: false })
      .eq("match_id", matchId)
      .eq("is_agent", false);
  }
}

export async function leave(userId: string, input: { matchId: string }) {
  const match = await loadMatch(input.matchId);
  if (match.status === "waiting") {
    await leaveWaiting(match.id, userId);
    return { ok: true as const };
  }
  if (match.status === "playing") return resign(userId, input);
  // Finished: just release the seat (already inactive).
  return { ok: true as const };
}

export async function resign(userId: string, input: { matchId: string }) {
  const match = await loadMatch(input.matchId);
  if (match.status !== "playing") fail("There's no game in progress.");
  const seat = await mySeat(match.id, userId);
  const state = await loadState(match.id);
  if (!state || state.result) fail("The game is already over.");
  const ended = endEarly(state!, "resign", seat.seat as Seat);
  await commit(match, ended);
  return { ok: true as const };
}

// ── Moves ──────────────────────────────────────────────────────────────────

export async function playAction(
  userId: string,
  input: { matchId: string; action: Action; actionId: string; expectedVersion: number },
) {
  const match = await loadMatch(input.matchId);
  if (match.status !== "playing") fail("The game isn't in progress.");
  if (match.version !== input.expectedVersion) {
    fail("The game moved on before your move arrived — the board has been refreshed.");
  }
  const seat = await mySeat(match.id, userId);
  const state = await loadState(match.id);
  if (!state) fail("The game state is missing.");
  const problem = validateAction(state!, seat.seat as Seat, input.action);
  if (problem) fail(problem);
  const { state: next, effect } = applyAction(state!, seat.seat as Seat, input.action);
  match.version = await commit(match, next, {
    action: actionRow(
      next,
      seat.seat as Seat,
      input.action,
      "human",
      input.actionId,
      effect.captured,
      effect.ended,
    ),
  });
  await supabaseAdmin
    .from("mudwater_seats")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("match_id", match.id)
    .eq("seat", seat.seat);
  if (!next.result) await advance(match, next, await loadSeats(match.id));
  return { ok: true as const, captured: effect.captured };
}

/**
 * Called by every open client every few seconds. Records presence, lets
 * the agent resume a turn that an earlier request didn't finish, and
 * settles an expired turn: the member whose clock ran out forfeits.
 */
export async function tick(userId: string, input: { matchId: string }) {
  const match = await loadMatch(input.matchId);
  const seats = await loadSeats(match.id);
  const mine = seats.find((s) => s.user_id === userId && s.active);
  if (mine) {
    await supabaseAdmin
      .from("mudwater_seats")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("match_id", match.id)
      .eq("seat", mine.seat);
  } else if (!(await canViewMatch(match.id, userId))) {
    return { ok: false as const };
  }
  if (match.status !== "playing") return { ok: true as const };
  const state = await loadState(match.id);
  if (!state || state.result) return { ok: true as const };
  const turnSeat = seats.find((s) => s.seat === state.turn);
  try {
    if (turnSeat?.is_agent || legalActions(state, state.turn).length === 0) {
      await advance(match, state, seats);
    } else if (match.turn_deadline && Date.parse(match.turn_deadline) < Date.now()) {
      await commit(match, endEarly(state, "timeout", state.turn));
    }
  } catch (e) {
    if (!(e instanceof MudwaterError)) throw e; // lost a race — fine
  }
  return { ok: true as const };
}

export async function requestRematch(userId: string, input: { matchId: string }) {
  const prev = await loadMatch(input.matchId);
  if (prev.status !== "finished" && prev.status !== "aborted") fail("This game isn't over yet.");
  const seats = await loadSeats(prev.id);
  const mine = seats.find((s) => s.user_id === userId);
  if (!mine) fail("You didn't play in this match.");
  if (!(await canPlay(prev.room_id, userId))) fail(noPlayAccess(prev.required_collection));

  const open = await openMatchForRoom(prev.room_id);
  if (open) {
    if (open.rematch_of === prev.id && open.status === "waiting") {
      // The opponent already asked — take the same seat as last time.
      const oseats = await loadSeats(open.id);
      if (oseats.some((s) => s.user_id === userId && s.active)) return { matchId: open.id };
      if (oseats.some((s) => s.seat === mine!.seat && s.active)) fail("That seat was just taken.");
      await releaseStaleSeatsFor(userId);
      const who = await memberIdentity(userId);
      await supabaseAdmin
        .from("mudwater_seats")
        .insert({ match_id: open.id, seat: mine!.seat, user_id: userId, ...who });
      await supabaseAdmin
        .from("mudwater_seat_private")
        .upsert({ match_id: open.id, seat: mine!.seat, user_id: userId, deck: [], hand: [] });
      return { matchId: open.id };
    }
    fail("Someone else has already started a new game at this table.");
  }

  await releaseStaleSeatsFor(userId);
  const { data: created, error } = await supabaseAdmin
    .from("mudwater_matches")
    .insert({
      room_id: prev.room_id,
      room_name: prev.room_name,
      room_slug: prev.room_slug,
      required_collection: prev.required_collection,
      mode: prev.mode,
      advanced: prev.advanced,
      catalog_version: CATALOG_VERSION,
      rules_version: RULES_VERSION,
      agent_policy: prev.mode === "agent" ? AGENT_POLICY_VERSION : null,
      rematch_of: prev.id,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !created) fail("Someone just opened this table — try again.");
  const who = await memberIdentity(userId);
  await supabaseAdmin
    .from("mudwater_seats")
    .insert({ match_id: created!.id, seat: mine!.seat, user_id: userId, ...who });
  // Pre-fill the member's previous selection so a rematch is one tap.
  const { data: oldPriv } = await supabaseAdmin
    .from("mudwater_seat_private")
    .select("deck")
    .eq("match_id", prev.id)
    .eq("seat", mine!.seat)
    .maybeSingle();
  await supabaseAdmin.from("mudwater_seat_private").insert({
    match_id: created!.id,
    seat: mine!.seat,
    user_id: userId,
    deck: oldPriv?.deck ?? [],
  });
  if (prev.mode === "agent") await seatAgent(created!.id, other(mine!.seat as Seat));
  return { matchId: created!.id };
}

// ── Lobby + Watch Matches ──────────────────────────────────────────────────

export async function listRooms(userId: string) {
  const { data: rooms } = await supabaseAdmin
    .from("rooms")
    .select("id,name,description,required_collection,display_order")
    .eq("kind", "mudwater")
    .eq("active", true)
    .order("display_order");
  const { data: open } = await supabaseAdmin
    .from("mudwater_matches")
    .select("id,room_id,status,mode")
    .in("status", ["waiting", "playing"]);
  const watch = await canWatch(userId);
  const out = [];
  for (const r of rooms ?? []) {
    const m = open?.find((x) => x.room_id === r.id) ?? null;
    let seatsTaken = 0;
    if (m) seatsTaken = (await loadSeats(m.id)).filter((s) => s.active).length;
    out.push({
      id: r.id,
      name: r.name,
      description: r.description,
      requiredCollection: r.required_collection,
      canPlay: await canPlay(r.id, userId),
      status: (m?.status ?? "empty") as "empty" | "waiting" | "playing",
      mode: (m?.mode ?? null) as "agent" | "pvp" | null,
      seatsTaken,
      openSeat: !!m && m.status === "waiting" && m.mode === "pvp" && seatsTaken < 2,
      matchId: m?.id ?? null,
    });
  }
  return { rooms: out, canWatch: watch };
}

export async function listWatchable(userId: string) {
  if (!(await canWatch(userId))) {
    return { allowed: false as const, live: [], recent: [] };
  }
  const { data: live } = await supabaseAdmin
    .from("mudwater_matches")
    .select(MATCH_COLS)
    .eq("status", "playing")
    .order("started_at", { ascending: false })
    .limit(50);
  const { data: recent } = await supabaseAdmin
    .from("mudwater_matches")
    .select(MATCH_COLS)
    .eq("status", "finished")
    .order("finished_at", { ascending: false })
    .limit(20);
  const withSeats = async (rows: MatchRow[]) =>
    Promise.all(rows.map(async (m) => toMatchView(m, await loadSeats(m.id), userId)));
  return {
    allowed: true as const,
    live: await withSeats((live ?? []) as MatchRow[]),
    recent: await withSeats((recent ?? []) as MatchRow[]),
  };
}

export async function getMatchForViewer(userId: string, input: { matchId: string }) {
  if (!(await canViewMatch(input.matchId, userId))) {
    fail("Watching matches needs a wallet connected and signed in this session.");
  }
  const match = await loadMatch(input.matchId);
  const seats = await loadSeats(match.id);
  const { data: actions } = await supabaseAdmin
    .from("mudwater_actions")
    .select("move_number,seat,actor,kind,square,card,captured,ended,created_at")
    .eq("match_id", match.id)
    .order("move_number");
  // Buried rocks and antes stay hidden until the match ends; the public
  // state already applies that rule, so viewers only ever see it.
  return { match: toMatchView(match, seats, userId), actions: actions ?? [] };
}

export function newActionId() {
  return randomId();
}
