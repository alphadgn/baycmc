# Mudwater — Phase 1 implementation notes

Phase 1 covers free play, the five tables (MWroom1–5), the BAYCmc agent,
member-vs-member play, Watch Matches, and the agreed verification rule
changes. **Wagering (proposal §11–17) is not built or activated.** The
betting entry points are placeholders only; no APE, cards or contracts are
involved.

## Card catalogue

- Source: the live Swamp Origins catalogue supplied by the operator,
  pinned as `swamp-origins-live-2026-10-26` (`src/lib/mudwater/catalog-data.ts`).
- 120 cards. The printed number (1–120) is the stable card id.
- Rarity sets the level: Common I, Uncommon II, Rare III, Prestige IV,
  Legendary V.
- Strengths are north / east / south / west. Top = north. Both seats use the
  same fixed orientation.
- The catalogue is validated when it loads. Every number must be 1–120 and
  unique. Names must be unique. Family, rarity and level must be valid.
  Strengths must be whole numbers from 1 to 10. A bad row stops the load; it
  is never guessed or repaired.
- Every match records `catalog_version` and `rules_version`, so a later
  catalogue update can't change a game in progress.
- We use the live catalogue values consistently. We do **not** claim parity
  with the publisher's printed examples. The tutorial text ("How to play")
  is written from the imported values, not from rulebook example cards.
- Cards are styled text faces. Artwork can be added later without any
  change to the rules.

## Rules as implemented (`src/lib/mudwater/rules.ts`)

**Setup**
- Each player picks 14 different cards, including at least one Level I.
- For free games, the server picks one card from each committed selection
  as that seat's hidden ante, using crypto randomness. The other 13 cards
  are the hand.
- The opener is chosen with crypto randomness. In a rematch, the other seat
  opens.
- Any future wagered mode must keep a verifiable-randomness requirement for
  the ante.

**A turn is exactly one of:**
- **Place:** put a Level I card face up on an empty square.
- **Rock:** put any card face down on an empty square.
  - A rock counts as Level I.
  - It can't be captured.
  - A seat may have only one uncovered rock at a time.
- **Upgrade:** put a card exactly one level higher on a square you control.
  - That includes captured squares and your own rocks.
  - Control and the original owner are tracked separately.
- **Pass:** allowed only when you have no legal move. The server passes for
  you automatically.

**Captures**
- Only the newly played face-up card attacks.
- It checks each orthogonal enemy neighbour on its own. Diagonals don't
  count.
- Strictly higher wins.
- An equal edge holds, except in advanced mode, where family advantage
  breaks the tie: Club > Mutant > Cosmic > Arcana > Club.
- Rocks are immune.
- Captures never chain.

**End of the game**
- The game ends at once when the board is full. The ninth card's captures
  are resolved first.
- It also ends when both players pass in a row.

**Scoring**
- Each controlled square counts as 1.
- An uncovered rock counts as one square. An upgraded stack also counts as
  one square.
- Most squares wins. An equal score is a **draw**.

**Clock and early endings**
- Each turn has 2 minutes.
- If your clock runs out, you forfeit (`timeout`).
- Resigning loses the game.
- If nobody is connected to settle a turn for 90 seconds past its deadline,
  the match is closed as `abandoned`, with no result.

**Hidden information (application policy)**
- Hands, antes and the identity of every rock (uncovered or buried) are
  never sent to the opponent or to spectators.
- After the match, antes and buried rocks are revealed in the replay.
- The engine's full state lives only in `mudwater_state`. Browsers have no
  read access to it. Every client gets a sanitized view from
  `src/lib/mudwater/projections.ts`.

## BAYCmc agent (`src/server/mudwater/agent.server.ts`)

- Policy `baycmc-agent-normal-v1` (normal difficulty).
- **What it can see:** an `AgentView` — its own hand, its own rocks and the
  public board. It never sees:
  - the opponent's hand,
  - the antes,
  - hidden rocks,
  - spectator positions,
  - treasury data.
- **How it chooses:**
  - It enumerates every legal action with the same engine players use, and
    simulates each one (captures and game end).
  - It scores each result on:
    - the terminal outcome,
    - square control,
    - position,
    - defensive exposure, estimated from public catalogue statistics only,
    - remaining upgrade options,
    - card economy.
  - Ties are broken with a seeded random choice.
  - If anything fails, it falls back to a seeded random legal move, so it
    can never freeze a match.
- **Deck:** a strength-weighted 7/3/2/1/1 level spread.
- **When it moves:** in the same server request that applied the human's
  move. If that request is interrupted, the next 5-second "tick" from any
  open client resumes the agent's turn. Commits are compare-and-swap on the
  match version, so a move can never be applied twice.

## Tables and access

| Room | Who can play | Who can watch |
|---|---|---|
| MWroom1, MWroom2 | Any signed-in member, including email-only | See below |
| MWroom3 | BAYC verified **in this sign-in session** | See below |
| MWroom4 | CryptoPunks verified in this session | See below |
| MWroom5 | MAYC verified in this session | See below |

**Watching** is open to any member with a wallet proven by signature in
this session, plus admins and verified-role members. It covers all five
rooms.

**Playing seats**
- Playing seats use `mudwater_can_play`, which reads only this session's
  verification. There is **no** admin or verified-role shortcut for gated
  seats.
- Holding several collections opens each matching room.
- A member holds at most one active seat at a time.

**Betting placeholders (betting itself is a later phase)**
- Email-only members see greyed-out "Watch & bet" / "Back seat" links.
  Clicking one opens the wallet connect dialog.
- Members who can watch see disabled "coming in a later phase" controls.
- The later-phase requirements are recorded but not built:
  - the APE balance check (stake plus estimated gas),
  - betting closes before the first move,
  - the game never waits.

Mudwater rooms:
- are excluded from Conference Rooms, the Calendar and room booking;
- never get a LiveKit token (there is no voice or video in v1);
- are hidden from other room lists by row-level security unless the member
  can play there.

Punks Brunch now finds its own room by `livekit_room = 'punks-brunch'`, so
it no longer collides with MWroom4.

## Verification rule changes (app-wide)

1. **Session wallets.** Access is decided only from wallets connected and
   proven by signature in the **current** sign-in session
   (`session_wallets`), plus their delegate.xyz delegations.
   - At wallet sign-in, the signer is the session's first wallet.
   - Wallets proven via wallet linking during the session are added.
   - Wallets linked in earlier sessions, and Glyph-linked wallets, no longer
     count until they are proven again.
   - An email-only sign-in proves no wallet.
   - How wallets are linked is unchanged. Linked wallets are still recorded
     for account-merge detection.
2. **No mid-session gains.** Buying an NFT during a session doesn't grant
   access; it counts from the next sign-in. Mid-session checks only remove.
   A Lifer token that appears mid-session also waits for the next sign-in.
3. **Sale detection.** About once a minute while the app is open, the
   server re-checks this session's wallets for losses. A check that errors
   for a collection keeps it (unknown is not zero). Selling one ape while
   still holding another of the same collection changes nothing.
4. **When access ends:**
   - The member gets a notification.
   - Live video rooms, Holders Chat and other collection-opened areas: the
     member is removed straight away, back to the lobby.
   - Mudwater: a game in progress finishes normally, then access ends.
5. **Sign-out or timeout** clears the session's wallets and verification.
   The next sign-in runs a full check.
6. **Admins and verified-role members** aren't affected by sale detection
   while they hold the role.
7. **The verified role now counts exactly like a BAYC/MAYC holding:**
   - menu areas follow the super admin's BAYC/MAYC matrix settings;
   - it opens collection rooms that accept BAYC or MAYC;
   - Lifer access needs a verified Otherpage token, the same as holders.

   Previously the role opened every area.
8. **Transition.** Members who were in a verified session when this was
   deployed had their primary and signature-verified linked wallets
   recorded as this session's wallets. From their next sign-in, the new
   rules apply in full.

## Database objects

Migrations:
- `20261026000001_mudwater_core.sql`
- `20261026000002_session_wallet_rules.sql`

Objects:
- **Tables:**
  - `session_wallets`
  - `mudwater_matches`
  - `mudwater_seats`
  - `mudwater_seat_private` (each member reads only their own row)
  - `mudwater_state` (no browser access)
  - `mudwater_actions` (public move log; rocks carry no card)
- **Functions:**
  - `mudwater_can_play`
  - `mudwater_can_watch`
  - `mudwater_can_view_match`
  - `mudwater_commit` (service role only, compare-and-swap on version)
  - `mudwater_sweep`
- **Cleanup:** the pg_cron job `mudwater-sweep` runs every minute, using SQL
  only (no outbound calls). It:
  - releases idle waiting seats after 120 s;
  - closes empty tables;
  - aborts abandoned games with no winner.

## Known limitations (Phase 1)

- No voice or video at the tables.
- No card artwork yet.
- No wagering, and no card or APE transfers.
- The agent has a single difficulty.
- Reconnecting resumes the game from the server state. A member who closes
  the tab mid-turn will time out after 2 minutes.
