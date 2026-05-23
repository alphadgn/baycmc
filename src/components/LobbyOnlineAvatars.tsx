import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";

interface OnlineMember {
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  wallet_address: string | null;
}

interface LobbyOnlineAvatarsProps {
  /** Max avatars to show before collapsing the tail into "+N". */
  max?: number;
}

/**
 * Live presence strip for the lobby. Every signed-in user who has the
 * lobby open broadcasts their profile through a Supabase Realtime
 * presence channel; we render the union as a row of small avatars at the
 * top of the lobby hero. As people open / close the tab they appear or
 * fall off without a refresh.
 */
export function LobbyOnlineAvatars({ max = 12 }: LobbyOnlineAvatarsProps) {
  const { user } = useAuth();
  const [members, setMembers] = useState<OnlineMember[]>([]);

  useEffect(() => {
    if (!user) {
      setMembers([]);
      return;
    }

    let cancelled = false;
    let selfPayload: OnlineMember = {
      user_id: user.id,
      username: null,
      avatar_url: null,
      wallet_address: null,
    };

    // The presence row is keyed by the user id so each session updates the
    // single tile for that user rather than appearing as a duplicate.
    const channel = supabase.channel("lobby-presence", {
      config: { presence: { key: user.id } },
    });

    function syncFromState() {
      const state = channel.presenceState() as Record<
        string,
        Array<OnlineMember & { presence_ref?: string }>
      >;
      const seen = new Map<string, OnlineMember>();
      for (const arr of Object.values(state)) {
        const row = arr[0];
        if (!row?.user_id) continue;
        if (seen.has(row.user_id)) continue;
        seen.set(row.user_id, {
          user_id: row.user_id,
          username: row.username ?? null,
          avatar_url: row.avatar_url ?? null,
          wallet_address: row.wallet_address ?? null,
        });
      }
      if (!cancelled) setMembers([...seen.values()]);
    }

    channel.on("presence", { event: "sync" }, syncFromState);

    void (async () => {
      // Look up the signed-in user's profile once so the broadcast carries
      // their real avatar / username instead of a wallet placeholder.
      const { data } = await supabase
        .from("profiles")
        .select("username,avatar_url,wallet_address")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      selfPayload = {
        user_id: user.id,
        username: data?.username ?? null,
        avatar_url: data?.avatar_url ?? null,
        wallet_address: data?.wallet_address ?? null,
      };

      channel.subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return;
        await channel.track(selfPayload);
      });
    })();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [user]);

  if (!user) return null;
  if (members.length === 0) return null;

  const visible = members.slice(0, max);
  const overflow = members.length - visible.length;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-full border border-gold/20 bg-background/40 px-2 py-1 backdrop-blur"
      aria-label={`${members.length} member${members.length === 1 ? "" : "s"} online in the lobby`}
    >
      <span className="ml-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-emerald-300">
        <span className="relative inline-flex h-1.5 w-1.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/80" />
          <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        <span className="text-muted-foreground">
          {members.length} online
        </span>
      </span>
      <ul className="flex items-center -space-x-2">
        {visible.map((m) => {
          const name =
            m.username ??
            (m.wallet_address
              ? `${m.wallet_address.slice(0, 6)}…${m.wallet_address.slice(-4)}`
              : "anon");
          const initials = (name ?? "??").slice(0, 2).toUpperCase();
          return (
            <li
              key={m.user_id}
              title={name}
              className="inline-flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-background bg-gradient-gold ring-1 ring-gold/40"
            >
              {m.avatar_url ? (
                <img src={m.avatar_url} alt={name} className="h-full w-full object-cover" />
              ) : (
                <span className="text-sm font-semibold text-gold-foreground">{initials}</span>
              )}
            </li>
          );
        })}
        {overflow > 0 && (
          <li className="inline-flex h-20 min-w-[5rem] items-center justify-center rounded-full border border-background bg-secondary px-2 text-sm font-semibold text-foreground ring-1 ring-border">
            +{overflow}
          </li>
        )}
      </ul>
    </div>
  );
}
