import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Tokenproof partner-API integration.
 *
 * Tokenproof handles wallet connection + signature on the user's phone via
 * the Tokenproof app. Our server only:
 *   1. starts an authentication session (`init`) — gets an authUrl + QR
 *   2. polls the session until the user approves (or rejects/expires)
 *   3. on success, mints a Supabase session for the wallet address that
 *      Tokenproof attests holds BAYC or MAYC.
 *
 * Required secret: `TOKENPROOF_API_KEY` (partner credential from
 * tokenproof.xyz). Optional: `TOKENPROOF_PARTNER_ID`,
 * `TOKENPROOF_POLICY_ID` (BAYC/MAYC ownership policy configured in the
 * partner dashboard).
 */

const TP_BASE = "https://api.tokenproof.xyz";

function requireApiKey(): string {
  const key = process.env.TOKENPROOF_API_KEY;
  if (!key) {
    throw new Error(
      "Tokenproof is not configured yet. Add the TOKENPROOF_API_KEY secret to enable verification.",
    );
  }
  return key;
}

export const startTokenproofSession = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({}).parse(d))
  .handler(async () => {
    const apiKey = requireApiKey();
    const policyId = process.env.TOKENPROOF_POLICY_ID;

    const res = await fetch(`${TP_BASE}/v2/authenticate/init`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        policy_id: policyId,
        // BAYC + MAYC contracts as a fallback when no policy is set up.
        collections: policyId
          ? undefined
          : [
              { chain: "ethereum", address: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" }, // BAYC
              { chain: "ethereum", address: "0x60E4d786628Fea6478F785A6d7e704777c86a7c6" }, // MAYC
            ],
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Tokenproof init failed (${res.status}): ${txt}`);
    }

    const data = (await res.json()) as {
      session_id: string;
      auth_url: string;
      qr_code_url?: string;
    };

    return {
      sessionId: data.session_id,
      authUrl: data.auth_url,
      qrUrl:
        data.qr_code_url ??
        `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(data.auth_url)}`,
    };
  });

type PollResult =
  | { status: "pending" }
  | { status: "rejected" | "expired" }
  | {
      status: "verified";
      collection: string | null;
      session: { access_token: string; refresh_token: string };
    };

export const pollTokenproofSession = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ sessionId: z.string().min(8) }).parse(d),
  )
  .handler(async ({ data }): Promise<PollResult> => {
    const apiKey = requireApiKey();

    const res = await fetch(
      `${TP_BASE}/v2/authenticate/session/${data.sessionId}`,
      { headers: { "x-api-key": apiKey } },
    );

    if (!res.ok) {
      throw new Error(`Tokenproof poll failed (${res.status})`);
    }

    const body = (await res.json()) as {
      status: "pending" | "approved" | "rejected" | "expired";
      wallet?: string;
      collection?: { name?: string } | null;
    };

    if (body.status === "pending") return { status: "pending" };
    if (body.status === "rejected" || body.status === "expired") {
      return { status: body.status };
    }

    // Approved — mint a Supabase session for this wallet.
    const wallet = body.wallet?.toLowerCase();
    if (!wallet) throw new Error("Tokenproof did not return a wallet address");

    const email = `${wallet}@wallet.baycmc.local`;
    const password = `tp:${wallet}:${process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 16) ?? ""}`;

    // Ensure user exists
    const { data: existing } =
      await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
    const found = existing?.users.find((u) => u.email === email);
    let userId = found?.id;

    if (!userId) {
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { wallet, via: "tokenproof" },
      });
      if (error) throw error;
      userId = created.user!.id;
    }

    // Upsert profile + verification flag (BAYC verified covers MAYC too here)
    await supabaseAdmin.from("profiles").upsert(
      { id: userId, wallet_address: wallet },
      { onConflict: "id" },
    );
    await supabaseAdmin.from("user_verifications").upsert(
      {
        user_id: userId,
        bayc_verified: true,
        verified_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    // Sign in as that user to get tokens.
    const { data: signIn, error: signInErr } =
      await supabaseAdmin.auth.signInWithPassword({ email, password });
    if (signInErr || !signIn.session) {
      throw signInErr ?? new Error("Could not mint session");
    }

    return {
      status: "verified",
      collection: body.collection?.name ?? null,
      session: {
        access_token: signIn.session.access_token,
        refresh_token: signIn.session.refresh_token,
      },
    };
  });
