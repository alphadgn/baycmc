import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SiweMessage } from "siwe";
import {
  createPublicClient,
  http,
  getAddress,
  parseAbi,
  isAddress,
} from "viem";
import { mainnet } from "viem/chains";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ETH_RPC_URL } from "@/lib/web3/constants";

/**
 * Privy / SIWE entrance verification.
 *
 * Flow:
 *   1. Client opens Privy modal, user connects an EVM wallet, signs a SIWE
 *      message generated client-side.
 *   2. Client posts { message, signature } here.
 *   3. We verify the SIWE signature, then call balanceOf() on BAYC and MAYC
 *      via a public Ethereum RPC.
 *   4. If they own at least one of either, we mint a Supabase session for
 *      that wallet (same pattern as tokenproof).
 */

const BAYC = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" as const;
const MAYC = "0x60E4d786628Fea6478F785A6d7e704777c86a7c6" as const;

const erc721Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

function client() {
  return createPublicClient({ chain: mainnet, transport: http(ETH_RPC_URL) });
}

/**
 * Public Privy config — App IDs are publishable, safe to ship to the client.
 * We surface them via a server fn so the secret value stays out of the
 * browser bundle until the user actually opens the entrance.
 */
export const getPrivyPublicConfig = createServerFn({ method: "GET" }).handler(
  async () => {
    const appId = process.env.PRIVY_APP_ID ?? "";
    return { appId, configured: appId.length > 0 };
  },
);

export const verifyPrivyOwnership = createServerFn({ method: "POST" })
  .inputValidator((input: { message: string; signature: string }) =>
    z
      .object({
        message: z.string().min(20).max(4000),
        signature: z.string().min(20).max(400),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    // 1) Verify SIWE signature
    let address: string;
    try {
      const siwe = new SiweMessage(data.message);
      const result = await siwe.verify({ signature: data.signature });
      if (!result.success || !result.data?.address) {
        throw new Error("Signature verification failed");
      }
      address = result.data.address;
    } catch (e) {
      console.error("SIWE verify failed", e);
      throw new Error(
        "We couldn't verify your wallet signature. Please try again.",
      );
    }

    if (!isAddress(address)) {
      throw new Error("Invalid wallet address returned from signature.");
    }
    const wallet = getAddress(address);

    // 2) Check BAYC + MAYC balances on-chain
    let baycBal = 0n;
    let maycBal = 0n;
    try {
      const c = client();
      [baycBal, maycBal] = await Promise.all([
        c.readContract({
          address: BAYC,
          abi: erc721Abi,
          functionName: "balanceOf",
          args: [wallet],
        }) as Promise<bigint>,
        c.readContract({
          address: MAYC,
          abi: erc721Abi,
          functionName: "balanceOf",
          args: [wallet],
        }) as Promise<bigint>,
      ]);
    } catch (e) {
      console.error("RPC balanceOf failed", e);
      throw new Error(
        "We couldn't reach Ethereum to check your holdings. Try again in a moment.",
      );
    }

    if (baycBal === 0n && maycBal === 0n) {
      return {
        verified: false as const,
        reason:
          "This wallet doesn't hold any BAYC or MAYC. Try a different wallet.",
        wallet,
      };
    }

    const collection: "BAYC" | "MAYC" = baycBal > 0n ? "BAYC" : "MAYC";

    // 3) Mint / fetch Supabase user (same pattern as tokenproof)
    const lower = wallet.toLowerCase();
    const email = `${lower}@wallet.baycmc.local`;
    const password = `pv:${lower}:${process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 16) ?? ""}`;

    const { data: existing } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    const found = existing?.users.find((u) => u.email === email);
    let userId = found?.id;

    if (!userId) {
      const { data: created, error } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { wallet: lower, via: "privy" },
        });
      if (error) throw error;
      userId = created.user!.id;
    }

    await supabaseAdmin
      .from("profiles")
      .upsert({ id: userId, wallet_address: lower }, { onConflict: "id" });

    await supabaseAdmin.from("user_verifications").upsert(
      {
        user_id: userId,
        bayc_verified: true,
        bayc_collection: collection,
        verified_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    const { data: signIn, error: signInErr } =
      await supabaseAdmin.auth.signInWithPassword({ email, password });
    if (signInErr || !signIn.session) {
      throw signInErr ?? new Error("Could not mint session");
    }

    return {
      verified: true as const,
      collection,
      wallet,
      session: {
        access_token: signIn.session.access_token,
        refresh_token: signIn.session.refresh_token,
      },
    };
  });
