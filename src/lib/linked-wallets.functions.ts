import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAddress, isAddress, verifyMessage } from "viem";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Linked-wallet management. A user can attach additional wallets to their
 * account beyond the one they sign in with. Each linked wallet must prove
 * control via a personal_sign challenge before it counts toward BAYC/MAYC
 * verification (see `recomputeOwnership` — only `verified_at IS NOT NULL`
 * rows are walked).
 *
 * Flow:
 *   1. client calls `requestLinkedWalletNonce({ address })` → server stores
 *      a single-use nonce in `auth_nonces` with the requested wallet, returns
 *      the canonical message to sign.
 *   2. user signs the message with the target wallet (any EIP-1193 provider).
 *   3. client calls `verifyAndLinkWallet({ address, signature, label? })`.
 *   4. server verifies signature against the wallet, marks nonce consumed,
 *      upserts into `linked_wallets` with `verified_at = now()`.
 */

const LINK_NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function buildLinkMessage(userId: string, address: string, nonce: string): string {
  return [
    "BAYCMC — Link wallet",
    "",
    `Account: ${userId}`,
    `Wallet:  ${address}`,
    `Nonce:   ${nonce}`,
    "",
    "Sign this message to prove you control this wallet and link it to your BAYCMC account.",
    "This signature does not authorize any on-chain action.",
  ].join("\n");
}

export const listLinkedWallets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("linked_wallets")
      .select("id, address, label, verified_at, last_checked_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { wallets: data ?? [] };
  });

export const requestLinkedWalletNonce = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { address: string }) =>
    z
      .object({
        address: z
          .string()
          .regex(/^0x[a-fA-F0-9]{40}$/, "Not a valid Ethereum address")
          .max(64),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const address = getAddress(data.address);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const nonce = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + LINK_NONCE_TTL_MS).toISOString();
    const { error } = await supabaseAdmin.from("auth_nonces").insert({
      wallet_address: address,
      nonce,
      expires_at: expiresAt,
      consumed: false,
    });
    if (error) throw new Error(error.message);
    return {
      nonce,
      message: buildLinkMessage(userId, address, nonce),
      expiresAt,
    };
  });

export const verifyAndLinkWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { address: string; nonce: string; signature: string; label?: string }) =>
      z
        .object({
          address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
          nonce: z.string().uuid(),
          signature: z
            .string()
            .regex(/^0x[0-9a-fA-F]+$/)
            .min(2)
            .max(2048),
          label: z.string().trim().max(64).optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const address = getAddress(data.address);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: nonceRow } = await supabaseAdmin
      .from("auth_nonces")
      .select("id, expires_at, consumed, wallet_address")
      .eq("nonce", data.nonce)
      .maybeSingle();
    if (!nonceRow) throw new Error("Nonce not found");
    if (nonceRow.consumed) throw new Error("Nonce already used");
    if (new Date(nonceRow.expires_at).getTime() < Date.now()) {
      throw new Error("Nonce expired — request a fresh signature");
    }
    if (!nonceRow.wallet_address || getAddress(nonceRow.wallet_address) !== address) {
      throw new Error("Nonce was issued for a different wallet");
    }

    const message = buildLinkMessage(userId, address, data.nonce);
    const ok = await verifyMessage({
      address,
      message,
      signature: data.signature as `0x${string}`,
    });
    if (!ok) throw new Error("Signature does not match wallet");

    await supabaseAdmin.from("auth_nonces").update({ consumed: true }).eq("id", nonceRow.id);

    const nowIso = new Date().toISOString();
    const { error } = await supabase.from("linked_wallets").upsert(
      {
        user_id: userId,
        address,
        label: data.label?.trim() || null,
        verified_at: nowIso,
        last_checked_at: nowIso,
      },
      { onConflict: "user_id,address" },
    );
    if (error) throw new Error(error.message);

    // Trigger a fresh ownership recompute so the gated nav updates immediately.
    const { recomputeOwnership } = await import("@/server/ownership.server");
    const snapshot = await recomputeOwnership(userId).catch((e) => {
      console.error("verifyAndLinkWallet: recompute failed", e);
      return null;
    });

    return { ok: true, address, snapshot };
  });

export const removeLinkedWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { address: string }) =>
    z.object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!isAddress(data.address)) throw new Error("Invalid address");
    const address = getAddress(data.address);
    const { error } = await supabase
      .from("linked_wallets")
      .delete()
      .eq("user_id", userId)
      .eq("address", address);
    if (error) throw new Error(error.message);

    const { recomputeOwnership } = await import("@/server/ownership.server");
    await recomputeOwnership(userId).catch(() => null);
    return { ok: true };
  });
