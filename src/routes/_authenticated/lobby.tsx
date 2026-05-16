import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { LobbyChat } from "@/components/LobbyChat";

/**
 * Tier 1 — Lobby landing.
 *
 * Every signed-in user lands here regardless of verification status. The
 * lobby is now a Discord-style continuous message thread — image
 * attachments, GIFs (Tenor), replies, and emoji reactions are open to
 * everyone.
 *
 * Verified holders get the hamburger nav for gated rooms; unverified
 * users see only this lobby plus profile/activity.
 */
export const Route = createFileRoute("/_authenticated/lobby")({
  head: () => ({
    meta: [
      { title: "Lobby — BAYCMC" },
      {
        name: "description",
        content:
          "The BAYCMC lobby — open chat for every member. Verify your BAYC or MAYC to unlock conference rooms and the rest of the clubhouse.",
      },
    ],
  }),
  component: LobbyPage,
});

interface ProfileRow {
  id: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
}

function triggerVerify() {
  window.dispatchEvent(new Event("baycmc:privy-bridge-retry"));
  toast.message("Re-checking BAYC/MAYC ownership…", {
    description:
      "Approve the signature in your wallet — we'll unlock the verified areas the moment it confirms.",
    duration: 5000,
  });
}

function LobbyPage() {
  const { isVerifiedHolder, loading: verifLoading } = useVerificationStatus();
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id,username,avatar_url,bio")
        .order("created_at", { ascending: false })
        .limit(12);
      if (cancelled) return;
      setProfiles((data as ProfileRow[]) ?? []);
      setProfilesLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/5 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-gold">
            <span className="h-1.5 w-1.5 rounded-full bg-gold animate-pulse-glow" />
            Lobby
          </div>
          <h1 className="mt-2 font-display text-2xl font-bold sm:text-3xl">
            The clubhouse lobby
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everyone's here. Say hi, drop GIFs, reply with reactions.
          </p>
        </div>
        {!verifLoading && !isVerifiedHolder && (
          <button
            type="button"
            onClick={triggerVerify}
            className="inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold transition hover:bg-gold/20 sm:text-sm"
          >
            <Lock className="h-3.5 w-3.5" />
            Verify holder access
          </button>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <LobbyChat />

        <aside className="space-y-4 lg:max-h-[80vh] lg:overflow-y-auto">
          <section className="glass rounded-2xl p-4 shadow-card">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Newest members
            </h2>
            {!profilesLoaded ? (
              <div className="mt-3 space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/20" />
                ))}
              </div>
            ) : profiles.length === 0 ? (
              <p className="mt-3 text-xs italic text-muted-foreground">
                No profiles yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {profiles.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-3 rounded-lg p-2 transition hover:bg-secondary/30"
                  >
                    <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-border bg-gradient-gold">
                      {p.avatar_url ? (
                        <img
                          src={p.avatar_url}
                          alt={p.username ?? "Member"}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-gold-foreground">
                          {(p.username ?? "??").slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {p.username ?? "Unnamed ape"}
                      </p>
                      {p.bio && (
                        <p className="truncate text-[11px] text-muted-foreground">
                          {p.bio}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!verifLoading && !isVerifiedHolder && (
            <section className="glass rounded-2xl p-4 shadow-card">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
                <Lock className="h-2.5 w-2.5" />
                Locked
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Conference rooms, the social feed, and Lifer chat are gated
                behind BAYC / MAYC ownership. Verify your wallet to unlock.
              </p>
              <button
                type="button"
                onClick={triggerVerify}
                className="mt-3 w-full rounded-md bg-gradient-gold px-3 py-2 text-xs font-semibold text-gold-foreground shadow-gold transition hover:opacity-90"
              >
                Verify holder access
              </button>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
