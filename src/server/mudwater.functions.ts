import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Mudwater server functions (Phase 1: free play + spectating). Thin
 * wrappers: all rules, access checks and state live in
 * src/server/mudwater/game.server.ts. Game errors come back as
 * `{ ok: false, error }` with a member-friendly message.
 */

const uuid = z.string().uuid();
const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("place"),
    card: z.number().int().min(1).max(120),
    square: z.number().int().min(0).max(8),
  }),
  z.object({
    type: z.literal("rock"),
    card: z.number().int().min(1).max(120),
    square: z.number().int().min(0).max(8),
  }),
  z.object({
    type: z.literal("upgrade"),
    card: z.number().int().min(1).max(120),
    square: z.number().int().min(0).max(8),
  }),
  z.object({ type: z.literal("pass") }),
]);

async function run<T>(fn: (g: typeof import("@/server/mudwater/game.server")) => Promise<T>) {
  const g = await import("@/server/mudwater/game.server");
  try {
    return { ok: true as const, data: await fn(g) };
  } catch (e) {
    if (e instanceof g.MudwaterError) return { ok: false as const, error: e.message };
    console.error("[mudwater]", e);
    return { ok: false as const, error: "Something went wrong. Please try again." };
  }
}

export const mudwaterListRooms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => run((g) => g.listRooms(context.userId)));

export const mudwaterGetRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ roomId: uuid }).parse(d))
  .handler(({ context, data }) => run((g) => g.getRoom(context.userId, data.roomId)));

export const mudwaterClaimSeat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ roomId: uuid, mode: z.enum(["agent", "pvp"]), advanced: z.boolean() }).parse(d),
  )
  .handler(({ context, data }) => run((g) => g.claimSeat(context.userId, data)));

export const mudwaterSetDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        matchId: uuid,
        deck: z.array(z.number().int().min(1).max(120)).max(14),
        ready: z.boolean(),
      })
      .parse(d),
  )
  .handler(({ context, data }) => run((g) => g.setDeck(context.userId, data)));

export const mudwaterPlay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        matchId: uuid,
        action: actionSchema,
        actionId: z
          .string()
          .min(8)
          .max(64)
          .regex(/^[A-Za-z0-9_-]+$/),
        expectedVersion: z.number().int().min(0),
      })
      .parse(d),
  )
  .handler(({ context, data }) => run((g) => g.playAction(context.userId, data)));

export const mudwaterTick = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ matchId: uuid }).parse(d))
  .handler(({ context, data }) => run((g) => g.tick(context.userId, data)));

export const mudwaterResign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ matchId: uuid }).parse(d))
  .handler(({ context, data }) => run((g) => g.resign(context.userId, data)));

export const mudwaterLeave = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ matchId: uuid }).parse(d))
  .handler(({ context, data }) => run((g) => g.leave(context.userId, data)));

export const mudwaterRematch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ matchId: uuid }).parse(d))
  .handler(({ context, data }) => run((g) => g.requestRematch(context.userId, data)));

export const mudwaterListWatchable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => run((g) => g.listWatchable(context.userId)));

export const mudwaterWatchMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ matchId: uuid }).parse(d))
  .handler(({ context, data }) => run((g) => g.getMatchForViewer(context.userId, data)));
