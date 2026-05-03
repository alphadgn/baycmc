import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Tokenproof partner-API integration — the ONLY entrance verification path.
 *
 * Tokenproof handles wallet connection + signature on the user's phone via
 * the Tokenproof app. Our server only:
 *   1. starts an authentication session (`init`) — gets an authUrl + QR
 *   2. polls the session until the user approves (or rejects/expires)
 *   3. on success, mints a Supabase session for the wallet address that
 *      Tokenproof attests holds BAYC or MAYC.
 *
 * Required secret: `TOKENPROOF_API_KEY` (partner credential from
 * tokenproof.xyz). Optional: `TOKENPROOF_POLICY_ID` (BAYC/MAYC ownership
 * policy configured in the partner dashboard). When no policy is set, the
 * BAYC and MAYC mainnet contracts are passed inline.
 */

const TP_BASE = "https://api.tokenproof.xyz";

// Sessions older than this are considered expired by us, even if Tokenproof
// has not surfaced an "expired" status yet. Keeps the UI from polling forever.
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getApiKey(): string | null {
  const key = process.env.TOKENPROOF_API_KEY;
  return key && key.trim().length > 0 ? key : null;
}

// In-memory map of session start times so the server can enforce a TTL even
// if Tokenproof doesn't return one. Keyed by Tokenproof session id.
const sessionStartedAt = new Map<string, number>();

function pruneOldSessions() {
  const now = Date.now();
  for (const [id, started] of sessionStartedAt) {
    if (now - started > SESSION_TTL_MS * 2) sessionStartedAt.delete(id);
  }
}

export const startTokenproofSession = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({}).parse(d))
  .handler(async () => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return { notConfigured: true as const };
    }
    const policyId = process.env.TOKENPROOF_POLICY_ID;

    let res: Response;
    try {
      res = await fetch(`${TP_BASE}/v2/authenticate/init`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          policy_id: policyId,
          collections: policyId
            ? undefined
            : [
                // BAYC
                { chain: "ethereum", address: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" },
                // MAYC
                { chain: "ethereum", address: "0x60E4d786628Fea6478F785A6d7e704777c86a7c6" },
              ],
        }),
      });
    } catch (e) {
      console.error("Tokenproof init network error", e);
      throw new Error("Couldn't reach Tokenproof. Check your connection and try again.");
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`Tokenproof init ${res.status}: ${txt}`);
      throw new Error(
        res.status === 401 || res.status === 403
          ? "Tokenproof rejected our credentials. The site admin needs to update TOKENPROOF_API_KEY."
          : `Tokenproof couldn't start a session (${res.status}). Try again in a moment.`,
      );
    }

    const data = (await res.json()) as {
      session_id: string;
      auth_url: string;
      qr_code_url?: string;
    };

    pruneOldSessions();
    sessionStartedAt.set(data.session_id, Date.now());

    return {
      sessionId: data.session_id,
      authUrl: data.auth_url,
      qrUrl:
        data.qr_code_url ??
        `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(data.auth_url)}`,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
  });

type PollResult =
  | { status: "pending" }
  | {
      status: "rejected" | "expired" | "network" | "credentials";
      reason?: string;
    }
  | {
      status: "verified";
      collection: "BAYC" | "MAYC";
      session: { access_token: string; refresh_token: string };
    };

const BAYC = "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d";
const MAYC = "0x60e4d786628fea6478f785a6d7e704777c86a7c6";

function detectCollection(body: {
  collection?: string;
  collections?: Array<{ address?: string; name?: string }>;
  contract?: string;
}): "BAYC" | "MAYC" {
  const raw = (body.collection ?? body.contract ?? "").toLowerCase();
  if (raw.includes("mayc") || raw === MAYC) return "MAYC";
  if (raw.includes("bayc") || raw === BAYC) return "BAYC";
  const hit = body.collections?.find((c) => {
    const a = (c.address ?? "").toLowerCase();
    const n = (c.name ?? "").toLowerCase();
    return a === MAYC || n.includes("mayc");
  });
  return hit ? "MAYC" : "BAYC";
}

export const pollTokenproofSession = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ sessionId: z.string().min(8) }).parse(d),
  )
  .handler(async ({ data }): Promise<PollResult> => {
    const apiKey = requireApiKey();

    // Local TTL check — if we issued this session more than SESSION_TTL_MS
    // ago, treat it as expired regardless of what Tokenproof says.
    const startedAt = sessionStartedAt.get(data.sessionId);
    if (startedAt && Date.now() - startedAt > SESSION_TTL_MS) {
      sessionStartedAt.delete(data.sessionId);
      return {
        status: "expired",
        reason: "Your verification session timed out. Start a new one.",
      };
    }

    let res: Response;
    try {
      res = await fetch(
        `${TP_BASE}/v2/authenticate/session/${encodeURIComponent(data.sessionId)}`,
        { headers: { "x-api-key": apiKey } },
      );
    } catch (e) {
      console.error("Tokenproof poll network error", e);
      // Transient network blip — let the client keep polling.
      return { status: "pending" };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        status: "credentials",
        reason:
          "Tokenproof rejected our credentials. The site admin needs to update the API key.",
      };
    }
    if (res.status === 404) {
      sessionStartedAt.delete(data.sessionId);
      return {
        status: "expired",
        reason: "This verification session no longer exists. Start a new one.",
      };
    }
    if (!res.ok) {
      console.error(`Tokenproof poll ${res.status}`);
      return { status: "pending" };
    }

    const body = (await res.json()) as {
      status: "pending" | "approved" | "rejected" | "expired";
      wallet?: string;
      collection?: string;
      contract?: string;
      collections?: Array<{ address?: string; name?: string }>;
    };

    if (body.status === "pending") return { status: "pending" };
    if (body.status === "rejected") {
      sessionStartedAt.delete(data.sessionId);
      return {
        status: "rejected",
        reason: "You declined the request in Tokenproof. Try again to enter.",
      };
    }
    if (body.status === "expired") {
      sessionStartedAt.delete(data.sessionId);
      return {
        status: "expired",
        reason: "The Tokenproof session expired. Start a new one.",
      };
    }

    // Approved — mint a Supabase session for this wallet.
    const wallet = body.wallet?.toLowerCase();
    if (!wallet) {
      throw new Error("Tokenproof approved the session but didn't return a wallet.");
    }

    const collection = detectCollection(body);

    const email = `${wallet}@wallet.baycmc.local`;
    const password = `tp:${wallet}:${process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 16) ?? ""}`;

    const { data: existing } =
      await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
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

    await supabaseAdmin.from("profiles").upsert(
      { id: userId, wallet_address: wallet },
      { onConflict: "id" },
    );
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

    sessionStartedAt.delete(data.sessionId);

    return {
      status: "verified",
      collection,
      session: {
        access_token: signIn.session.access_token,
        refresh_token: signIn.session.refresh_token,
      },
    };
  });

