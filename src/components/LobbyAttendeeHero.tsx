import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import karaokeLobbyBg from "@/assets/karaoke-lobby-bg.png.asset.json";

interface OnlineMember {
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  wallet_address: string | null;
}

/**
 * Lobby hero — features the signed-in user's profile picture at the top
 * center over a featured background, with all other attendees rendered
 * dynamically around it. Tile size scales with the count so a busy lobby
 * stays visually balanced.
 */
export function LobbyAttendeeHero() {
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

  const self = members.find((m) => m.user_id === user.id) ?? {
    user_id: user.id,
    username: null,
    avatar_url: null,
    wallet_address: null,
  };
  const others = members.filter((m) => m.user_id !== user.id);

  // Scale other-attendee tiles down as the room fills so they all fit.
  const otherSize =
    others.length <= 6 ? 56 : others.length <= 12 ? 44 : others.length <= 24 ? 36 : 28;

  return (
    <section
      aria-label="Lobby attendees"
      className="relative flex w-full shrink-0 flex-col items-center justify-start overflow-hidden border-b border-gold/20"
      style={{ height: 220 }}
    >
      {/* Featured background — karaoke lounge photo, darkened so the
          avatar + name stay legible on top. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${karaokeLobbyBg.url})` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background/40 via-background/55 to-background/85"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30 [background:radial-gradient(circle_at_50%_0%,hsl(var(--gold)/0.4),transparent_60%)]"
      />

      <div className="relative z-10 flex h-full w-full flex-col items-center justify-between px-4 py-3">
        {/* Self avatar — top center, prominent */}
        <div className="flex flex-col items-center gap-1">
          <Avatar member={self} size={72} highlight />
          <span className="text-[11px] font-semibold text-gold">
            {displayName(self)} <span className="text-muted-foreground">(you)</span>
          </span>
        </div>

        {/* Other attendees — wrap dynamically */}
        <div className="flex w-full flex-1 items-center justify-center overflow-hidden pt-2">
          {others.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              You're the first one here. Invite the apes.
            </p>
          ) : (
            <ul className="flex max-h-full flex-wrap items-center justify-center gap-2">
              {others.map((m) => (
                <li key={m.user_id} title={displayName(m)}>
                  <Avatar member={m} size={otherSize} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {members.length} in the lobby
        </div>
      </div>
    </section>
  );
}

function displayName(m: OnlineMember): string {
  return (
    m.username ??
    (m.wallet_address ? `${m.wallet_address.slice(0, 6)}…${m.wallet_address.slice(-4)}` : "anon")
  );
}

function Avatar({
  member,
  size,
  highlight,
}: {
  member: OnlineMember;
  size: number;
  highlight?: boolean;
}) {
  const name = displayName(member);
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <div
      style={{ width: size, height: size }}
      className={`inline-flex items-center justify-center overflow-hidden rounded-full border bg-gradient-gold ${
        highlight
          ? "border-gold ring-2 ring-gold/60 shadow-gold"
          : "border-background ring-1 ring-gold/30"
      }`}
    >
      {member.avatar_url ? (
        <img src={member.avatar_url} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span
          className="font-semibold text-gold-foreground"
          style={{ fontSize: Math.max(10, size * 0.32) }}
        >
          {initials}
        </span>
      )}
    </div>
  );
}
