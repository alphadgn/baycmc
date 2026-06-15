import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  findAccountCollision,
  mergeAccounts,
  recordKeepSeparate,
  type CollisionInfo,
} from "@/server/account-merge.functions";
import { signOut } from "@/lib/auth/useAuth";

export const Route = createFileRoute("/_authenticated/account-merge")({
  component: AccountMergePage,
});

type Step = "choose" | "pickSurvivor" | "pickFields" | "confirm" | "decided";

function AccountMergePage() {
  const navigate = useNavigate();
  const findFn = useServerFn(findAccountCollision);
  const mergeFn = useServerFn(mergeAccounts);
  const separateFn = useServerFn(recordKeepSeparate);

  const { data, isLoading } = useQuery({
    queryKey: ["account-collision"],
    queryFn: () => findFn(),
    staleTime: 0,
  });

  const [step, setStep] = useState<Step>("choose");
  const [survivor, setSurvivor] = useState<"mine" | "other" | null>(null);
  const [keep, setKeep] = useState<{
    username: "mine" | "other";
    avatar_url: "mine" | "other";
    bio: "mine" | "other";
  }>({ username: "mine", avatar_url: "mine", bio: "mine" });
  const [busy, setBusy] = useState(false);

  // If no collision (resolved while page loaded), bounce to lobby.
  useEffect(() => {
    if (!isLoading && !data) {
      void navigate({ to: "/lobby", replace: true });
    }
  }, [isLoading, data, navigate]);

  if (isLoading || !data) {
    return (
      <main className="flex min-h-[60dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </main>
    );
  }

  const collision = data as CollisionInfo;

  async function handleKeepSeparate() {
    setBusy(true);
    try {
      await separateFn({ data: { otherUserId: collision.otherUserId } });
      toast.success("Accounts kept separate. You won't be asked again.");
      void navigate({ to: "/lobby", replace: true });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleMerge() {
    if (!survivor) return;
    setBusy(true);
    try {
      const survivorUserId =
        survivor === "mine" ? collision.myProfile.id : collision.otherProfile.id;
      const result = await mergeFn({
        data: { otherUserId: collision.otherUserId, survivorUserId, keep },
      });
      toast.success("Accounts merged.");
      if (result.callerWasRemoved) {
        // The caller's account was deleted — sign out and back to landing.
        await signOut();
        void navigate({ to: "/", replace: true });
      } else {
        void navigate({ to: "/lobby", replace: true });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="rounded-2xl border border-gold/30 bg-card/90 p-6 shadow-card backdrop-blur sm:p-8">
        <h1 className="font-display text-2xl text-gradient-gold sm:text-3xl">
          Existing account detected
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We found another BAYCmc account that shares your{" "}
          <span className="text-gold">{collision.collisionReason}</span>. You can merge the two
          accounts into one, or keep them separate.{" "}
          <strong className="text-foreground">
            This is a one-time decision — it can't be changed later.
          </strong>
        </p>

        {step === "choose" && (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep("pickSurvivor")}
              className="rounded-xl border border-gold/40 bg-gradient-gold px-4 py-3 text-sm font-semibold text-gold-foreground shadow-gold transition hover:opacity-90 disabled:opacity-60"
            >
              Merge accounts
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleKeepSeparate}
              className="rounded-xl border border-gold/30 bg-secondary/40 px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-secondary/60 disabled:opacity-60"
            >
              Keep separate (forever)
            </button>
          </div>
        )}

        {step === "pickSurvivor" && (
          <div className="mt-6 space-y-4">
            <h2 className="font-display text-lg text-gold">Which account should survive?</h2>
            <p className="text-xs text-muted-foreground">
              All content, wallets, and verifications from the other account will be moved to the
              survivor. The other account is permanently deleted.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <AccountCard
                label="This account (signed in now)"
                profile={collision.myProfile}
                selected={survivor === "mine"}
                onSelect={() => setSurvivor("mine")}
              />
              <AccountCard
                label="Other existing account"
                profile={collision.otherProfile}
                selected={survivor === "other"}
                onSelect={() => setSurvivor("other")}
              />
            </div>
            <div className="flex justify-between gap-2">
              <button
                type="button"
                onClick={() => setStep("choose")}
                className="rounded-md border border-border px-3 py-2 text-xs"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!survivor}
                onClick={() => setStep("pickFields")}
                className="rounded-md bg-gradient-gold px-3 py-2 text-xs font-semibold text-gold-foreground disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === "pickFields" && (
          <div className="mt-6 space-y-4">
            <h2 className="font-display text-lg text-gold">Which details should be kept?</h2>
            <FieldPicker
              label="Display name / username"
              mine={collision.myProfile.username}
              other={collision.otherProfile.username}
              value={keep.username}
              onChange={(v) => setKeep((k) => ({ ...k, username: v }))}
            />
            <FieldPicker
              label="Profile picture"
              mine={collision.myProfile.avatar_url}
              other={collision.otherProfile.avatar_url}
              value={keep.avatar_url}
              onChange={(v) => setKeep((k) => ({ ...k, avatar_url: v }))}
              renderValue={(url) =>
                url ? (
                  <img
                    src={url}
                    alt=""
                    className="h-12 w-12 rounded-full border border-gold/30 object-cover"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">(none)</span>
                )
              }
            />
            <FieldPicker
              label="Bio"
              mine={collision.myProfile.bio}
              other={collision.otherProfile.bio}
              value={keep.bio}
              onChange={(v) => setKeep((k) => ({ ...k, bio: v }))}
            />
            <p className="text-[11px] text-muted-foreground">
              All wallet addresses from both accounts will be merged onto the surviving account.
            </p>
            <div className="flex justify-between gap-2">
              <button
                type="button"
                onClick={() => setStep("pickSurvivor")}
                className="rounded-md border border-border px-3 py-2 text-xs"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep("confirm")}
                className="rounded-md bg-gradient-gold px-3 py-2 text-xs font-semibold text-gold-foreground"
              >
                Review
              </button>
            </div>
          </div>
        )}

        {step === "confirm" && (
          <div className="mt-6 space-y-4">
            <h2 className="font-display text-lg text-gold">Confirm merge</h2>
            <p className="text-sm">
              You're about to <strong className="text-foreground">permanently delete</strong> the{" "}
              {survivor === "mine" ? "other" : "current"} account. This cannot be undone.
            </p>
            <div className="flex justify-between gap-2">
              <button
                type="button"
                onClick={() => setStep("pickFields")}
                className="rounded-md border border-border px-3 py-2 text-xs"
              >
                Back
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleMerge}
                className="rounded-md bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground disabled:opacity-60"
              >
                {busy ? "Merging…" : "Merge accounts"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function AccountCard({
  label,
  profile,
  selected,
  onSelect,
}: {
  label: string;
  profile: CollisionInfo["myProfile"];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-xl border p-3 text-left transition ${
        selected ? "border-gold bg-gold/10" : "border-border bg-secondary/30"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 flex items-center gap-3">
        {profile.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt=""
            className="h-10 w-10 rounded-full border border-gold/30 object-cover"
          />
        ) : (
          <div className="h-10 w-10 rounded-full border border-gold/30 bg-secondary" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{profile.username ?? "—"}</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {profile.wallet_address ?? "no wallet"}
          </div>
        </div>
      </div>
    </button>
  );
}

function FieldPicker<T extends string | null>({
  label,
  mine,
  other,
  value,
  onChange,
  renderValue,
}: {
  label: string;
  mine: T;
  other: T;
  value: "mine" | "other";
  onChange: (v: "mine" | "other") => void;
  renderValue?: (v: T) => React.ReactNode;
}) {
  const render =
    renderValue ?? ((v: T) => v ?? <span className="text-xs text-muted-foreground">(empty)</span>);
  return (
    <div>
      <div className="text-xs font-semibold text-foreground">{label}</div>
      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        {(["mine", "other"] as const).map((side) => (
          <button
            key={side}
            type="button"
            onClick={() => onChange(side)}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
              value === side ? "border-gold bg-gold/10" : "border-border bg-secondary/30"
            }`}
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {side === "mine" ? "This account" : "Other account"}
            </div>
            <div className="mt-1">{render(side === "mine" ? mine : other)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
