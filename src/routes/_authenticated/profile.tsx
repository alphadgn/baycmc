import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { toast } from "sonner";
import { VerificationStatusPanel } from "@/components/VerificationStatusPanel";
import { NftGallery } from "@/components/NftGallery";
import { MyPerformances } from "@/components/karaoke/MyPerformances";
import { LinkedWalletsPanel } from "@/components/LinkedWalletsPanel";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { AvatarPicker } from "@/components/AvatarPicker";
import { avatarShapeClass } from "@/lib/profile-avatar";
import { collectionNameForLabel } from "@/lib/web3/constants";
import type { NftItem } from "@/server/wallet-assets.functions";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Your Profile — BAYCmc" },
      {
        name: "description",
        content: "Manage your BAYCmc profile, linked wallets and live holder verification.",
      },
      { property: "og:title", content: "Your Profile — BAYCmc" },
      {
        property: "og:description",
        content: "Manage your BAYCmc profile, linked wallets and live holder verification.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
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

type LoadState = "idle" | "loading" | "ready" | "error";

function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const verification = useVerificationStatus();
  const roles = verification.roles;
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Lazy-load all server data after mount. We never block render on this —
  // the component shows a skeleton fallback while loadState !== "ready".
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoadState("loading");
    setLoadError(null);

    void (async () => {
      try {
        // Full wallet addresses are not readable from profiles (members see
        // only wallet_display); the owner gets their own via get_my_wallet().
        const [profileRes, walletRes] = await Promise.all([
          supabase
            .from("profiles")
            .select("id,username,bio,avatar_url,created_at,updated_at")
            .eq("id", user.id)
            .maybeSingle(),
          supabase.rpc("get_my_wallet"),
        ]);
        if (cancelled) return;

        const firstError = profileRes.error;
        if (firstError) {
          setLoadError(firstError.message);
          setLoadState("error");
          return;
        }

        if (profileRes.data) {
          const p = {
            ...profileRes.data,
            wallet_address: (walletRes.data as string | null) ?? "",
          } as unknown as ProfileRow;
          setProfile(p);
          setUsername(p.username ?? "");
          setBio(p.bio ?? "");
          setAvatarUrl(p.avatar_url ?? null);
        }
        setLoadState("ready");
      } catch (e) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Failed to load profile");
        setLoadState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  async function saveProfile() {
    if (!user) return;
    setSaving(true);
    // Upsert so email-only users (with no profile row yet) can still save.
    const { data, error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          username: username || null,
          bio: bio || null,
        },
        { onConflict: "id" },
      )
      .select("id");
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data || data.length === 0) {
      toast.error("Couldn't save your profile. Please try again.");
      return;
    }
    toast.success("Profile saved");
  }

  async function handleAvatarFile(file: File) {
    if (!user) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Pick an image file.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image is too large — max 2 MB.");
      return;
    }
    setUploadingAvatar(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const publicUrl = pub.publicUrl;
      // Upsert so users without a profile row yet still get one created.
      const { data: rows, error: updErr } = await supabase
        .from("profiles")
        .upsert(
          {
            id: user.id,
            avatar_url: publicUrl,
          },
          { onConflict: "id" },
        )
        .select("id");
      if (updErr) throw updErr;
      if (!rows || rows.length === 0) {
        throw new Error("Couldn't save your avatar. Please try again.");
      }
      setAvatarUrl(publicUrl);
      toast.success("Avatar updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't upload avatar");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handlePickNft(nft: NftItem) {
    if (!user || !nft.image) return;
    setPickerOpen(false);
    setUploadingAvatar(true);
    const { data: rows, error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          avatar_url: nft.image,
        },
        { onConflict: "id" },
      )
      .select("id");
    setUploadingAvatar(false);
    if (error || !rows?.length) {
      toast.error(error?.message ?? "Couldn't save your avatar. Please try again.");
      return;
    }
    setAvatarUrl(nft.image);
    toast.success("Avatar updated");
  }

  // Verification is handled at Entrance via Privy + on-chain check; profile
  // only shows the public-facing BAYC/MAYC status. Lifer access is checked
  // silently in the background — the Lifer rooms appear in the navigation
  // menu only when both gates pass, with no visible "badge" affordance here.

  if (authLoading || !user) return <ProfileSkeleton />;
  if (loadState === "loading" || loadState === "idle") return <ProfileSkeleton />;
  if (loadState === "error") {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="glass rounded-2xl p-8 text-center shadow-card">
          <h1 className="font-display text-2xl font-semibold">Couldn't load your profile</h1>
          <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
          <button
            onClick={() => setLoadState("idle")}
            className="mt-6 rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  const wallet = profile?.wallet_address ?? "";
  const short = wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "";

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="glass overflow-hidden rounded-2xl shadow-card">
        <div className="h-32 bg-gradient-gold opacity-80" />
        <div className="px-6 pb-6 sm:px-8">
          <div className="-mt-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-4">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                disabled={uploadingAvatar}
                className={`group relative h-24 w-24 cursor-pointer overflow-hidden ${avatarShapeClass(
                  avatarUrl,
                )} border-4 border-background bg-gradient-gold shadow-gold transition hover:opacity-90 disabled:cursor-wait`}
                aria-label="Change avatar"
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Your avatar" className="h-full w-full object-cover" />
                ) : null}
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
                  {uploadingAvatar ? (
                    <Loader2 className="h-6 w-6 animate-spin text-white" />
                  ) : (
                    <Camera className="h-6 w-6 text-white" />
                  )}
                </span>
                {uploadingAvatar && !avatarUrl && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <Loader2 className="h-6 w-6 animate-spin text-white" />
                  </span>
                )}
              </button>
              <AvatarPicker
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                primaryWallet={profile?.wallet_address ?? ""}
                onPickDevice={() => {
                  setPickerOpen(false);
                  fileInputRef.current?.click();
                }}
                onPickNft={(n) => void handlePickNft(n)}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleAvatarFile(file);
                  e.target.value = "";
                }}
              />
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
              {/* Every collection verified this session — full-access AND
                  partner collections (Temp Agency / Orca / Ugly Duck), which
                  don't grant the holder clubhouse but are still verified. */}
              {verification.collections.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-success"
                >
                  {collectionNameForLabel(label)} verified
                </span>
              ))}
              {verification.isVerifiedHolder && verification.collections.length === 0 && (
                <span className="rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-success">
                  Holder verified
                </span>
              )}
              {!verification.isVerifiedHolder && verification.collections.length === 0 && (
                <span className="rounded-full border border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
                  {verification.loading
                    ? "Checking…"
                    : verification.error
                      ? "Status unavailable"
                      : "Not verified"}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
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

        <section className="glass rounded-2xl p-6 shadow-card lg:col-span-2">
          <h2 className="font-display text-xl font-semibold">Verification</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Status from your last on-chain ownership check. Re-verify any time by tapping{" "}
            <span className="font-semibold text-foreground">Entrance</span> in the header.
          </p>
          <ul className="mt-5 space-y-3">
            <VerifyRow
              label="Collections (this sign-in)"
              ok={verification.collections.length > 0}
              action={
                <span className="text-right text-xs text-muted-foreground">
                  {verification.loading
                    ? "Checking…"
                    : verification.collections.length > 0
                      ? verification.collections.map((l) => collectionNameForLabel(l)).join(", ")
                      : verification.error
                        ? "Status unavailable"
                        : "None found"}
                </span>
              }
            />
            <VerifyRow
              label="Holder clubhouse (BAYC / MAYC / CryptoPunks)"
              ok={verification.isVerifiedHolder}
              action={
                <span className="text-xs text-muted-foreground">
                  {verification.loading
                    ? "Checking…"
                    : verification.isVerifiedHolder
                      ? "Verified"
                      : verification.error
                        ? "Status unavailable"
                        : "Not verified"}
                </span>
              }
            />
            <VerifyRow
              label="delegate.cash vault"
              ok={verification.delegationVerified}
              action={
                <span className="text-xs text-muted-foreground">
                  {verification.loading
                    ? "Checking…"
                    : verification.delegationVerified
                      ? "Verified"
                      : "Not verified"}
                </span>
              }
            />
          </ul>
          <div className="mt-6">
            <VerificationStatusPanel />
          </div>
        </section>
      </div>

      <section id="linked-wallets" className="mt-10">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-display text-2xl font-bold">Linked wallets</h2>
          <p className="text-xs text-muted-foreground">
            Add wallets you also control (e.g. a delegate.xyz vault) to prove ownership across them.
          </p>
        </div>
        <LinkedWalletsPanel />
      </section>

      {user && (
        <section className="mt-10">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-display text-2xl font-bold">Your collection</h2>
            <p className="text-xs text-muted-foreground">
              Connected wallets · allowed collections · live from Alchemy
            </p>
          </div>
          <NftGallery address={wallet} includeLinkedWallets />
        </section>
      )}
      {user && <MyPerformances userId={user.id} />}
    </main>
  );
}

function ProfileSkeleton() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14" aria-busy="true">
      <div className="glass overflow-hidden rounded-2xl shadow-card">
        <div className="h-32 animate-pulse bg-muted/30" />
        <div className="px-6 pb-6 sm:px-8">
          <div className="-mt-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-4">
              <div className="h-24 w-24 animate-pulse rounded-2xl border-4 border-background bg-muted/40" />
              <div className="space-y-2">
                <div className="h-7 w-48 animate-pulse rounded bg-muted/40" />
                <div className="h-4 w-32 animate-pulse rounded bg-muted/30" />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="h-6 w-20 animate-pulse rounded-full bg-muted/30" />
            </div>
          </div>
        </div>
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        <div className="glass h-72 animate-pulse rounded-2xl bg-muted/10 p-6 lg:col-span-3" />
        <div className="glass h-72 animate-pulse rounded-2xl bg-muted/10 p-6 lg:col-span-2" />
      </div>
    </main>
  );
}

function VerifyRow({ label, ok, action }: { label: string; ok: boolean; action: React.ReactNode }) {
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
