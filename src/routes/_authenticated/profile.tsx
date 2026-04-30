import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { verifyBayc, verifyLumina } from "@/server/verification.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [{ title: "Your Profile — The Clubhouse" }],
  }),
  component: ProfilePage,
});

interface ProfileRow {
  id: string;
  wallet_address: string;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
}
interface VerifRow {
  bayc_verified: boolean;
  lumina_verified: boolean;
  delegation_verified: boolean;
  otherpage_verified: boolean;
  bayc_token_ids: number[];
}
interface RoleRow { role: string; }

function ProfilePage() {
  const { user } = useAuth();
  const { address } = useAccount();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [verif, setVerif] = useState<VerifRow | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [verifyingBayc, setVerifyingBayc] = useState(false);

  const verifyBaycFn = useServerFn(verifyBayc);
  const verifyLuminaFn = useServerFn(verifyLumina);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const [{ data: p }, { data: v }, { data: r }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).single(),
        supabase.from("user_verifications").select("*").eq("user_id", user.id).single(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      if (p) {
        setProfile(p as ProfileRow);
        setUsername(p.username ?? "");
        setBio(p.bio ?? "");
      }
      if (v) setVerif(v as VerifRow);
      if (r) setRoles((r as RoleRow[]).map((x) => x.role));
    })();
  }, [user]);

  async function saveProfile() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ username: username || null, bio: bio || null })
      .eq("id", user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Profile saved");
  }

  async function runBaycVerify() {
    if (!address) {
      toast.error("Connect a wallet first");
      return;
    }
    setVerifyingBayc(true);
    try {
      const res = await verifyBaycFn({ data: { wallet: address } });
      if (res.verified) {
        toast.success(`Verified — ${res.balance} BAYC found`);
      } else {
        toast.error(res.error || "No BAYC found in this wallet");
      }
      const { data: v } = await supabase
        .from("user_verifications")
        .select("*")
        .eq("user_id", user!.id)
        .single();
      if (v) setVerif(v as VerifRow);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setVerifyingBayc(false);
    }
  }

  async function runLumina() {
    if (!address) return;
    const res = await verifyLuminaFn({ data: { wallet: address } });
    if (!res.configured) toast("Lumina API not configured yet — coming soon");
    else if (res.verified) toast.success("Lumina verified");
    else toast.error(res.error || "Lumina verification failed");
  }

  if (!user) return null;

  const wallet = profile?.wallet_address ?? "";
  const short = wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "";

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      {/* Header card */}
      <div className="glass overflow-hidden rounded-2xl shadow-card">
        <div className="h-32 bg-gradient-gold opacity-80" />
        <div className="px-6 pb-6 sm:px-8">
          <div className="-mt-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-4">
              <div className="h-24 w-24 rounded-2xl border-4 border-background bg-gradient-gold shadow-gold" />
              <div>
                <h1 className="font-display text-2xl font-bold sm:text-3xl">
                  {username || "Anonymous Ape"}
                </h1>
                <p className="mt-1 font-mono text-sm text-muted-foreground">{short}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {roles.map((r) => (
                <span
                  key={r}
                  className="rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-gold"
                >
                  {r.replace("_", " ")}
                </span>
              ))}
              {roles.length === 0 && (
                <span className="rounded-full border border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
                  unverified
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        {/* Profile editor */}
        <section className="glass rounded-2xl p-6 shadow-card lg:col-span-3">
          <h2 className="font-display text-xl font-semibold">Edit profile</h2>
          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Username
              </label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={32}
                className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="apex_ape"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                maxLength={300}
                className="w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Holder since…"
              />
            </div>
            <button
              onClick={saveProfile}
              disabled={saving}
              className="rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
          </div>
        </section>

        {/* Verifications */}
        <section className="glass rounded-2xl p-6 shadow-card lg:col-span-2">
          <h2 className="font-display text-xl font-semibold">Verifications</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Unlock platform access by verifying ownership.
          </p>
          <ul className="mt-5 space-y-3">
            <VerifyRow
              label="BAYC ownership"
              ok={!!verif?.bayc_verified}
              action={
                <button
                  onClick={runBaycVerify}
                  disabled={verifyingBayc}
                  className="rounded-md border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/20 disabled:opacity-50"
                >
                  {verifyingBayc ? "Checking…" : verif?.bayc_verified ? "Re-check" : "Verify"}
                </button>
              }
            />
            <VerifyRow
              label="Lumina authenticity"
              ok={!!verif?.lumina_verified}
              action={
                <button
                  onClick={runLumina}
                  className="rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs font-semibold hover:bg-secondary"
                >
                  Verify
                </button>
              }
            />
            <VerifyRow
              label="delegate.cash vault"
              ok={!!verif?.delegation_verified}
              action={<span className="text-xs text-muted-foreground">Coming soon</span>}
            />
            <VerifyRow
              label="Otherpage premium"
              ok={!!verif?.otherpage_verified}
              action={<span className="text-xs text-muted-foreground">Coming soon</span>}
            />
          </ul>
        </section>
      </div>
    </main>
  );
}

function VerifyRow({
  label,
  ok,
  action,
}: {
  label: string;
  ok: boolean;
  action: React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
            ok ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"
          }`}
        >
          {ok ? "✓" : "·"}
        </span>
        <span className="text-sm">{label}</span>
      </div>
      {action}
    </li>
  );
}
