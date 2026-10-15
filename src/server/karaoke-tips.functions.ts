/**
 * $APE tips for karaoke performers. See karaoke-tips.server.ts for the
 * eligibility rules and on-chain verification.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getKaraokeTipTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { roomId: string }) =>
    z.object({ roomId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { resolveTipTarget } = await import("@/server/karaoke-tips.server");
    try {
      return await resolveTipTarget(data.roomId, context.userId);
    } catch (e) {
      console.error("[tips] resolveTipTarget failed", e);
      return {
        eligible: false,
        reason: "not-holder" as const,
        performerId: null,
        performerName: null,
        wallet: null,
        collection: null,
        generation: null,
      };
    }
  });

export const recordKaraokeTip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { roomId: string; recipientId: string; txHash: string; generation: number | null }) =>
      z
        .object({
          roomId: z.string().uuid(),
          recipientId: z.string().uuid(),
          txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
          generation: z.number().int().nullable(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { verifyAndRecordTip, TipError } = await import("@/server/karaoke-tips.server");
    try {
      const res = await verifyAndRecordTip({
        roomId: data.roomId,
        tipperId: context.userId,
        recipientId: data.recipientId,
        txHash: data.txHash as `0x${string}`,
        generation: data.generation,
      });
      return { ok: true as const, ...res };
    } catch (e) {
      const msg =
        e instanceof TipError ? e.message : "Couldn't confirm the tip yet — it's still on-chain.";
      if (!(e instanceof TipError)) console.error("[tips] record failed", e);
      return { ok: false as const, error: msg };
    }
  });
