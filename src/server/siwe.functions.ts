import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyMessage, getAddress } from "viem";
import { createHmac, randomBytes } from "crypto";

async function getAdmin() {
  const mod = await import("@/integrations/supabase/client.server");
  return mod.supabaseAdmin;
}

const NONCE_TTL_SECONDS = 5 * 60;

function hmacPassword(wallet: string): string {
  // Deterministic Supabase password derived from wallet + server secret.
  // The wallet only proves itself via a fresh signature; this password is
  // never exposed to the client.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
  return createHmac("sha256", key).update(`siwe:${wallet.toLowerCase()}`).digest("hex");
}

function walletEmail(wallet: string): string {
  return `${wallet.toLowerCase()}@wallet.clubhouse.local`;
}

function buildSiweMessage(params: {
  domain: string;
  address: string;
  uri: string;
  nonce: string;
  issuedAt: string;
}): string {
  const { domain, address, uri, nonce, issuedAt } = params;
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "Sign in to The Clubhouse — token-gated platform for verified BAYC holders.",
    "",
    `URI: ${uri}`,
    "Version: 1",
    "Chain ID: 1",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

export const requestNonce = createServerFn({ method: "POST" })
  .inputValidator((input: { wallet: string; domain: string; uri: string }) =>
    z
      .object({
        wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        domain: z.string().min(1).max(255),
        uri: z.string().url().max(500),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const wallet = getAddress(data.wallet); // checksummed
    const nonce = randomBytes(16).toString("hex");
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + NONCE_TTL_SECONDS * 1000).toISOString();

    const { error } = await supabaseAdmin.from("auth_nonces").insert({
      wallet_address: wallet.toLowerCase(),
      nonce,
      expires_at: expiresAt,
    });
    if (error) throw new Error(`Failed to issue nonce: ${error.message}`);

    const message = buildSiweMessage({
      domain: data.domain,
      address: wallet,
      uri: data.uri,
      nonce,
      issuedAt,
    });
    return { message, nonce };
  });

export const verifySignature = createServerFn({ method: "POST" })
  .inputValidator((input: { wallet: string; message: string; signature: string }) =>
    z
      .object({
        wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        message: z.string().min(20).max(2000),
        signature: z.string().regex(/^0x[a-fA-F0-9]+$/).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const wallet = getAddress(data.wallet);
    const walletLower = wallet.toLowerCase();

    // Extract nonce from message
    const nonceMatch = data.message.match(/Nonce: ([a-f0-9]+)/);
    if (!nonceMatch) throw new Error("Malformed SIWE message: missing nonce");
    const nonce = nonceMatch[1];

    // Look up nonce
    const { data: nonceRow, error: nonceErr } = await supabaseAdmin
      .from("auth_nonces")
      .select("*")
      .eq("nonce", nonce)
      .eq("wallet_address", walletLower)
      .single();
    if (nonceErr || !nonceRow) throw new Error("Invalid or unknown nonce");
    if (nonceRow.consumed) throw new Error("Nonce already used");
    if (new Date(nonceRow.expires_at).getTime() < Date.now()) {
      throw new Error("Nonce expired — request a new one");
    }

    // Verify signature
    const valid = await verifyMessage({
      address: wallet,
      message: data.message,
      signature: data.signature as `0x${string}`,
    });
    if (!valid) throw new Error("Signature verification failed");

    // Consume nonce
    await supabaseAdmin
      .from("auth_nonces")
      .update({ consumed: true })
      .eq("id", nonceRow.id);

    // Get-or-create Supabase user keyed by wallet
    const email = walletEmail(wallet);
    const password = hmacPassword(wallet);

    // Try sign-in first
    const signIn = await supabaseAdmin.auth.signInWithPassword({ email, password });
    let session = signIn.data.session;
    let userId = signIn.data.user?.id;

    if (!session) {
      // First time — create the user, then sign in
      const created = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { wallet_address: wallet },
      });
      if (created.error || !created.data.user) {
        throw new Error(`Failed to create user: ${created.error?.message}`);
      }
      userId = created.data.user.id;

      // Insert profile + verifications shells
      await supabaseAdmin
        .from("profiles")
        .insert({ id: userId, wallet_address: wallet });
      await supabaseAdmin
        .from("user_verifications")
        .insert({ user_id: userId });

      // First registered user gets super_admin
      const { count } = await supabaseAdmin
        .from("user_roles")
        .select("*", { count: "exact", head: true })
        .eq("role", "super_admin");
      if ((count ?? 0) === 0) {
        await supabaseAdmin
          .from("user_roles")
          .insert({ user_id: userId, role: "super_admin" });
      }

      const retry = await supabaseAdmin.auth.signInWithPassword({ email, password });
      if (retry.error || !retry.data.session) {
        throw new Error(`Sign-in failed after create: ${retry.error?.message}`);
      }
      session = retry.data.session;
    }

    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      user_id: userId!,
      wallet_address: wallet,
    };
  });
